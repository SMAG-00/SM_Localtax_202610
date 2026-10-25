import { throttleKey } from "@/lib/auth/throttle-key";
import { parseQuoteInput, QUOTE_CODES, QUOTE_HREF, type QuoteCode } from "@/lib/education/rules";
import { isSameSiteRequest } from "@/lib/server/dal";
import { readAuthLimits, requestIp, requireGuardSecret, throttleHit } from "@/lib/server/auth-guard";
import { HttpError, errorJson, handle, json } from "@/lib/server/http";
import { parseFeatures } from "@/lib/server/public/settings";
import { adminClient } from "@/lib/server/supabase";

// 위탁교육 견적 요청 제출 (W10-g - PRD-02 BIZ-06, docs/dev/W10-g_설계.md) - POST /api/edu/quotes
//  · 기능 키 edu + education_billing이 꺼져 있으면 404. Origin 필수·같은 사이트. 일반 폼이면 303(JS 없이 동작), JSON이면 JSON
//  · 봇 차단: 숨은 칸(website) -> form_ip 횟수. 필수 동의·연락처·긴 숫자 차단을 서버가 다시 검사하고 DB 트리거가 한 번 더 본다
//  · 결제 칸이 요청에 있어도 읽지 않는다(parseQuoteInput이 정해진 칸만 꺼낸다). 이 경로에 결제 모듈·모델 호출 0
//  · 응답·주소·로그에 기관명·담당자·연락처를 싣지 않는다 - 접수 번호와 기관 종류(통계 속성)만
export const dynamic = "force-dynamic";

const STATUS: Partial<Record<QuoteCode, number>> = { bot: 422, too_many: 429, unavailable: 503 };

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
  if (!raw.edu || !raw.education_billing) return errorJson(404, "찾을 수 없습니다");
  const secret = requireGuardSecret();

  const reply = (code: QuoteCode, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response => {
    if (!isJson) {
      const target =
        code === "sent"
          ? `${QUOTE_HREF}?sent=${encodeURIComponent(String(extra.ref ?? ""))}&t=${encodeURIComponent(String(extra.org_type ?? ""))}`
          : `${QUOTE_HREF}?e=${code}&field=${encodeURIComponent(String(extra.field ?? ""))}`;
      return new Response(null, { status: 303, headers: { location: target, ...headers } });
    }
    const status = code === "sent" ? 201 : (STATUS[code] ?? 422);
    const response = status === 201 ? json({ ok: true, message: QUOTE_CODES.sent, ...extra }, 201) : errorJson(status, QUOTE_CODES[code], { code, ...extra });
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
    for (const [k, v] of (await request.formData()).entries()) if (typeof v === "string") fields[k] = v;
  }

  if (typeof fields.website === "string" && fields.website !== "") return reply("bot");
  const limits = await readAuthLimits(db);
  const hit = await throttleHit(db, "form_ip", throttleKey(secret, "form_ip", requestIp(request)), limits.form_ip);
  if (!hit.allowed) return reply("too_many", { retry_after_seconds: hit.retryAfter }, { "retry-after": String(hit.retryAfter) });

  // 동의 문구·과정 선택지는 공개 뷰와 같은 원본 (승인된 정책만)
  const [notice, options] = await Promise.all([
    db.from("public_training_quote_notice").select("consent_version, consent_items, target_business_days, message_max_chars").maybeSingle(),
    db.from("public_quote_course_options").select("id"),
  ]);
  const policy = notice.data as { consent_version: string; consent_items: string[]; target_business_days: number; message_max_chars: number } | null;
  if (notice.error || options.error || !policy) return reply("unavailable");

  const parsed = parseQuoteInput(fields, {
    messageMaxChars: policy.message_max_chars,
    courseIds: (options.data ?? []).map((o) => Number((o as { id: number | string }).id)),
    consentItemCount: policy.consent_items.length,
  });
  if (!parsed.ok) return reply(parsed.code, { field: parsed.field });
  const v = parsed.value;

  const ins = await db
    .from("training_quotes")
    .insert({
      org_name: v.org_name,
      org_type: v.org_type,
      contact_name: v.contact_name,
      phone: v.phone,
      email: v.email,
      course_id: v.course_id,
      course_text: v.course_text,
      headcount: v.headcount,
      preferred_period: v.preferred_period,
      message: v.message,
      consent_version: policy.consent_version,
      consented_at: new Date().toISOString(),
      updated_by: "user:form",
    })
    .select("receipt_no")
    .single();
  if (ins.error || !ins.data) {
    // 내용은 서버 로그에 남기지 않는다 - 규칙 위반(23514)은 화면 문장으로, 그 밖은 접수 불가
    console.error("[edu] 견적 요청 저장 실패:", ins.error?.code);
    return reply(ins.error?.code === "23514" ? (/긴 숫자/.test(ins.error.message) ? "sensitive" : "course") : "unavailable");
  }
  return reply("sent", { ref: (ins.data as { receipt_no: string }).receipt_no, org_type: v.org_type, target_business_days: policy.target_business_days });
});
