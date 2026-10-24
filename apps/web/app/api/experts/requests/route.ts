import { parseRequestInput, addBusinessDays, REQUEST_CODES, type RequestCode } from "@/lib/experts/logic";
import { throttleKey } from "@/lib/auth/throttle-key";
import { isSameSiteRequest } from "@/lib/server/dal";
import { readAuthLimits, requestIp, requireGuardSecret, throttleHit } from "@/lib/server/auth-guard";
import { adminEmails, mailEnv, siteUrl } from "@/lib/server/env";
import { HttpError, errorJson, handle, json } from "@/lib/server/http";
import { mailConfigured, sendMail } from "@/lib/server/mail";
import { parseFeatures } from "@/lib/server/public/settings";
import { adminClient } from "@/lib/server/supabase";

// SM 전문가 연락 요청 제출 (W7c - PRD-01C EXPL-13·15·18·20, docs/dev/W7c_설계.md 1장 4단계) - POST /api/experts/requests
//  · 기능 키 experts + expert_requests가 꺼져 있으면 404. Origin 필수·같은 사이트. 일반 폼이면 303(JS 없이 동작), JSON이면 JSON
//  · 봇 차단: 숨은 칸(website) -> form_ip 횟수. 거부 문장은 하나(bot)로 통일
//  · 필수 동의·내용 확인·연락처·긴 숫자 차단을 서버가 다시 검사한다 (클라이언트를 우회한 요청도 거부) - DB 트리거가 한 번 더 본다
//  · 연락처·요약은 AI 호출 경로에 닿지 않는다(이 경로에 모델 호출 0). 저장은 service_role, 관리자 알림 메일은 개인정보 0 (접수 번호·분야·보안 화면 주소만)
//  · 메일 설정이 없으면 알림 없이 저장만 한다 - 접수는 유지
export const dynamic = "force-dynamic";

const STATUS: Partial<Record<RequestCode, number>> = { bot: 422, too_many: 429, unavailable: 503 };

export const POST = handle(async (request: Request) => {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const isJson = contentType.startsWith("application/json");
  const isForm = contentType.startsWith("application/x-www-form-urlencoded") || contentType.startsWith("multipart/form-data");
  if (!isJson && !isForm) return errorJson(415, "요청 본문은 application/json 또는 폼이어야 합니다");
  if (request.headers.get("origin") === null || !isSameSiteRequest(request)) return errorJson(403, "다른 사이트에서 온 요청은 받지 않습니다");

  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const flags = await db.from("settings").select("value").eq("key", "feature_flags").maybeSingle();
  const raw = parseFeatures(flags.data?.value);
  if (!raw.experts || !raw.expert_requests) return errorJson(404, "찾을 수 없습니다");
  const secret = requireGuardSecret();

  const reply = (code: RequestCode, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response => {
    if (!isJson) {
      const target = code === "sent" ? `/experts/request?sent=${encodeURIComponent(String(extra.ref ?? ""))}` : `/experts/request?e=${code}&field=${encodeURIComponent(String(extra.field ?? ""))}`;
      return new Response(null, { status: 303, headers: { location: target, ...headers } });
    }
    const status = code === "sent" ? 201 : (STATUS[code] ?? 422);
    const response = status === 201 ? json({ ok: true, message: REQUEST_CODES.sent, ...extra }, 201) : errorJson(status, REQUEST_CODES[code], { code, ...extra });
    for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
    return response;
  };

  const fields: Record<string, unknown> = {};
  if (isJson) {
    try {
      const v: unknown = JSON.parse(await request.text());
      if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("not object");
      Object.assign(fields, v);
    } catch {
      throw new HttpError(400, "요청 본문이 JSON 객체가 아닙니다");
    }
  } else {
    const form = await request.formData();
    for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
  }

  if (typeof fields.website === "string" && fields.website !== "") return reply("bot");
  const limits = await readAuthLimits(db);
  const hit = await throttleHit(db, "form_ip", throttleKey(secret, "form_ip", requestIp(request)), limits.form_ip);
  if (!hit.allowed) return reply("too_many", { retry_after_seconds: hit.retryAfter }, { "retry-after": String(hit.retryAfter) });

  // 양식 선택지·동의 문구는 공개 뷰와 같은 원본 (승인된 정책만)
  const [notice, options] = await Promise.all([
    db.from("public_expert_request_notice").select("consent_version, consent_items, target_business_days, summary_max_chars").maybeSingle(),
    db.from("public_expert_request_options").select("code"),
  ]);
  const policy = notice.data as { consent_version: string; consent_items: string[]; target_business_days: number; summary_max_chars: number } | null;
  if (notice.error || options.error || !policy) return reply("unavailable");

  const parsed = parseRequestInput(fields, {
    summaryMaxChars: policy.summary_max_chars,
    categories: (options.data ?? []).map((o) => (o as { code: string }).code),
    consentItemCount: policy.consent_items.length,
  });
  if (!parsed.ok) return reply(parsed.code, { field: parsed.field });
  const v = parsed.value;

  const now = new Date();
  const ins = await db
    .from("expert_requests")
    .insert({
      source: v.source,
      category_code: v.category_code,
      summary: v.summary,
      summary_origin: "user",
      summary_confirmed: true,
      name: v.name,
      phone: v.phone,
      email: v.email,
      preferred_time: v.preferred_time,
      deadline_urgent: v.deadline_urgent,
      consent_version: policy.consent_version,
      consented_at: now.toISOString(),
      due_at: addBusinessDays(now, policy.target_business_days).toISOString(),
      updated_by: "user:form",
    })
    .select("id, receipt_no")
    .single();
  if (ins.error || !ins.data) {
    console.error("[experts] 요청 저장 실패:", ins.error?.code);
    // 내용은 서버 로그에 남기지 않는다 - 규칙 위반(23514)은 화면 문장으로, 그 밖은 접수 불가
    return reply(ins.error?.code === "23514" ? (/긴 숫자/.test(ins.error.message) ? "sensitive" : "category") : "unavailable");
  }
  const row = ins.data as { id: number; receipt_no: string };

  // 관리자 알림 (개인정보 0) - 메일 설정이 없으면 저장만
  const to = adminEmails();
  const base = siteUrl();
  if (mailConfigured(mailEnv()) && to.length > 0 && base) {
    const label = (await db.from("expert_categories").select("name").eq("code", v.category_code).maybeSingle()).data as { name: string } | null;
    for (const addr of to) await sendMail({ to: addr, template: "expert_request_notice", vars: { refCode: row.receipt_no, categoryLabel: label?.name ?? v.category_code, link: `${base.replace(/\/+$/, "")}/admin/experts/requests/${row.id}` } });
  }
  return reply("sent", { ref: row.receipt_no, due_at: addBusinessDays(now, policy.target_business_days).toISOString() });
});
