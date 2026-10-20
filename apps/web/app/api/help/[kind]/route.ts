import { randomUUID } from "node:crypto";
import { CODE_MESSAGES, HELP_FORMS, MIME_OF, articleSlugOf, checkAttachments, checkHelpToken, isHelpSlug, parseHelpInput, parseHelpSettings, type HelpCode, type HelpSlug, type AttachmentInput } from "@/lib/help/forms";
import { effectiveFeatures } from "@/lib/policy/feature-open";
import { readAuthLimits, requestIp, requireGuardSecret, publishedDocKeys, throttleHit } from "@/lib/server/auth-guard";
import { throttleKey } from "@/lib/auth/throttle-key";
import { getViewer, isSameSiteRequest } from "@/lib/server/dal";
import { mailEnv, siteUrl } from "@/lib/server/env";
import { HttpError, errorJson, handle, json } from "@/lib/server/http";
import { mailConfigured, sendMail } from "@/lib/server/mail";
import { parseFeatures } from "@/lib/server/public/settings";
import { adminClient } from "@/lib/server/supabase";

// 고객센터 폼 제출 (W2-e 설계 7.1 · 7.4 · 4.5) — POST /api/help/[kind]  (kind = report · subscribe · ad · contribute · corrections)
//  · 기능 키 page_help(+처리방침 게시본)가 꺼져 있으면 404. Origin 필수·같은 사이트
//  · 봇 차단: 숨은 칸(website) → 폼 열림 토큰(최소 작성 시간·유효 시간) → form_ip 횟수. 거부 문장은 하나(bot)로 통일
//  · 본문은 저장 전에 가린다(W2-d 가림 규칙). 첨부는 개수·합계·확장자·파일 앞부분 시그니처를 검사하고 이름은 서버가 새로 짓는다
//  · 일반 폼이면 303으로 돌아가고(JS 없이 동작), JSON이면 JSON으로 답한다. 접수 확인 메일은 이메일이 있을 때만, 실패해도 접수는 유지
export const dynamic = "force-dynamic";

const STATUS: Partial<Record<HelpCode, number>> = { bot: 422, too_many: 429, unavailable: 503, attachment_size: 413 };
const BUCKET = "inquiry-attachments";

type Ctx = { params: Promise<{ kind: string }> };

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const slug = (await params).kind;
  if (!isHelpSlug(slug)) return errorJson(404, "찾을 수 없습니다");
  const spec = HELP_FORMS[slug as HelpSlug];
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const isJson = contentType.startsWith("application/json");
  const isForm = contentType.startsWith("application/x-www-form-urlencoded") || contentType.startsWith("multipart/form-data");
  if (!isJson && !isForm) return errorJson(415, "요청 본문은 application/json 또는 폼이어야 합니다");
  if (request.headers.get("origin") === null || !isSameSiteRequest(request)) return errorJson(403, "다른 사이트에서 온 요청은 받지 않습니다");

  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const mailReady = mailConfigured(mailEnv());
  const flags = await db.from("settings").select("value").eq("key", "feature_flags").maybeSingle();
  const raw = parseFeatures(flags.data?.value);
  if (!raw.page_help || !effectiveFeatures(raw, await publishedDocKeys(db), mailReady).page_help) return errorJson(404, "찾을 수 없습니다");
  const secret = requireGuardSecret();

  const reply = (code: HelpCode, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response => {
    if (!isJson) {
      const target = code === "sent" ? `${spec.path}?sent=${encodeURIComponent(String(extra.ref ?? ""))}` : `${spec.path}?e=${code}`;
      return new Response(null, { status: 303, headers: { location: target, ...headers } });
    }
    const status = code === "sent" ? 201 : (STATUS[code] ?? 422);
    const response = status === 201 ? json({ ok: true, message: CODE_MESSAGES.sent, ...extra }, 201) : errorJson(status, CODE_MESSAGES[code], { code, ...extra });
    for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
    return response;
  };

  const settingRow = await db.from("settings").select("value").eq("key", "help").maybeSingle();
  const settings = parseHelpSettings(settingRow.data?.value);
  if (!settings) {
    console.error("[help] 설정 help가 없거나 모양이 틀립니다");
    return reply("unavailable");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > settings.maxTotalBytes + 500_000) return reply("attachment_size");

  // 본문 읽기 — 폼(multipart·urlencoded)은 문자열 칸 + 파일, JSON은 문자열 칸만
  const fields: Record<string, unknown> = {};
  const files: File[] = [];
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
    for (const [k, v] of form.entries()) {
      if (typeof v === "string") fields[k] = v;
      else if (k === "files" && !(v.size === 0 && v.name === "")) files.push(v);
    }
  }

  if ((typeof fields.website === "string" && fields.website !== "") || checkHelpToken(secret, fields.fill, Date.now(), settings) !== "ok") return reply("bot");
  const limits = await readAuthLimits(db);
  const hit = await throttleHit(db, "form_ip", throttleKey(secret, "form_ip", requestIp(request)), limits.form_ip);
  if (!hit.allowed) return reply("too_many", { retry_after_seconds: hit.retryAfter }, { "retry-after": String(hit.retryAfter) });

  const parsed = parseHelpInput(slug, fields, settings);
  if (!parsed.ok) return reply(parsed.code, { field: parsed.field });
  const v = parsed.value;

  const inputs: AttachmentInput[] = [];
  const buffers: Buffer[] = [];
  if (files.length > 0 && !spec.attachments) return reply("attachment_type");
  for (const f of files) {
    const buf = Buffer.from(await f.arrayBuffer());
    buffers.push(buf);
    inputs.push({ name: f.name, size: buf.length, head: buf.subarray(0, 16) });
  }
  const checked = checkAttachments(inputs, settings);
  if (!checked.ok) return reply(checked.code);

  // 기사 주소 → 사이트 안 기사면 연결, 아니면 본문에 남기고 연결은 비운다
  let relatedArticleId: number | null = null;
  const hosts = [new URL(request.url).host, request.headers.get("host"), siteUrl() ? new URL(siteUrl()!).host : null].filter((h): h is string => Boolean(h));
  const articleSlug = articleSlugOf(v.articleUrl, hosts);
  if (articleSlug) {
    const art = await db.from("articles").select("id").eq("slug", articleSlug).maybeSingle();
    relatedArticleId = (art.data as { id: number } | null)?.id ?? null;
  }
  const body = v.articleUrl && relatedArticleId === null ? `${v.body}\n\n(관련 기사 주소: ${maskedUrl(v.articleUrl)})` : v.body;

  let privacyVersionId: number | null = null;
  if (v.contactEmail) {
    const p = await db.from("policy_versions").select("id").eq("doc_key", "privacy").eq("status", "published").maybeSingle();
    privacyVersionId = (p.data as { id: number } | null)?.id ?? null;
    if (privacyVersionId === null) return reply("unavailable");
  }
  let submittedBy: string | null = null;
  try {
    submittedBy = (await getViewer(request))?.userId ?? null;
  } catch {
    submittedBy = null;
  }

  let row: { id: number; ref_code: string } | null = null;
  for (let attempt = 0; attempt < 3 && !row; attempt++) {
    const ins = await db
      .from("inquiries")
      .insert({
        kind: v.kind,
        body,
        title: v.title,
        contact_name: v.contactName,
        organization: v.organization,
        contact_email: v.contactEmail,
        request_type: v.requestType,
        related_article_id: relatedArticleId,
        submitted_by: submittedBy,
        privacy_version_id: privacyVersionId,
        mail_status: v.contactEmail ? (mailReady ? "queued" : "skipped") : "none",
      })
      .select("id, ref_code")
      .single();
    if (!ins.error) row = ins.data as { id: number; ref_code: string };
    else if (ins.error.code !== "23505") {
      console.error("[help] 문의 저장 실패:", ins.error.code);
      return reply(ins.error.code === "23514" ? "body" : "unavailable");
    }
  }
  if (!row) return reply("unavailable");

  if (checked.files.length > 0) {
    const stored: { path: string; name: string; bytes: number; ext: string }[] = [];
    for (let i = 0; i < checked.files.length; i++) {
      const f = checked.files[i]!;
      const path = `${row.id}/${randomUUID()}.${f.ext}`;
      const up = await db.storage.from(BUCKET).upload(path, buffers[i]!, { contentType: MIME_OF[f.ext] ?? "application/octet-stream", upsert: false });
      if (up.error) {
        console.error("[help] 첨부 저장 실패:", up.error.message);
        await db.storage.from(BUCKET).remove(stored.map((s) => s.path));
        await db.from("inquiries").delete().eq("id", row.id);
        return reply("unavailable");
      }
      stored.push({ path, name: f.name, bytes: f.bytes, ext: f.ext });
    }
    const upd = await db.from("inquiries").update({ attachments: stored }).eq("id", row.id);
    if (upd.error) {
      await db.storage.from(BUCKET).remove(stored.map((s) => s.path));
      await db.from("inquiries").delete().eq("id", row.id);
      return reply("unavailable");
    }
  }

  if (v.contactEmail && mailReady) {
    const sent = await sendMail({ to: v.contactEmail, template: "inquiry_receipt", vars: { refCode: row.ref_code, kindLabel: spec.label } });
    await db.from("inquiries").update({ mail_status: sent.ok ? "sent" : "failed" }).eq("id", row.id);
  }
  return reply("sent", { ref: row.ref_code });
});

/** 본문에 남기는 기사 주소 — 이메일·긴 숫자 모양은 다시 가린다 */
function maskedUrl(url: string): string {
  return url.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "[이메일]").replace(/[0-9](?:[^0-9A-Za-z가-힣]*[0-9]){8,}/g, "[번호]").slice(0, 300);
}
