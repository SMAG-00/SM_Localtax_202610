import { checkFillToken } from "@/lib/auth/signup-input";
import { throttleKey } from "@/lib/auth/throttle-key";
import { SUBSCRIBE_MESSAGES, parseSubscribeInput, type SubscribeCode } from "@/lib/brief/subscribe";
import { briefOpen, readAuthLimits, requestIp, requireGuardSecret, throttleHit } from "@/lib/server/auth-guard";
import { featureOn } from "@/lib/server/brief/policy";
import { subscribe } from "@/lib/server/brief/subscribe";
import { isSameSiteRequest } from "@/lib/server/dal";
import { HttpError, errorJson, handle, json } from "@/lib/server/http";
import { siteBase } from "@/lib/server/site-base";
import { adminClient } from "@/lib/server/supabase";

// 브리핑·개정 알림 구독 신청 (W10-e - BRIEF-02 · TX-12) - 이중 확인: 확인 메일의 링크를 눌러야 구독이 끝난다.
//  · 닫혀 있으면(brief 기능 키·메일 설정 없음 또는 brief_regular 꺼짐) 404. 순서는 /api/brief와 같다: 같은 사이트 -> 숨은 칸·열림 토큰 -> 형식·동의 -> 횟수 제한 -> 저장·메일
//  · 브리핑과 알림은 동의를 따로 받는다(수신 동의는 회원 가입 동의와 분리). 이미 확정된 구독은 건드리지 않는다
//  · 일반 HTML 폼이면 303으로 /brief/subscribe에 돌아가고, JSON이면 JSON으로 답한다
export const dynamic = "force-dynamic";

const STATUS: Partial<Record<SubscribeCode, number>> = { bot: 422, too_many: 429, mail_down: 503, email: 422, consent: 422, prefs: 422 };

export const POST = handle(async (request: Request) => {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const isForm = contentType.startsWith("application/x-www-form-urlencoded");
  if (!isForm && !contentType.startsWith("application/json")) return errorJson(415, "요청 본문은 application/json 또는 폼이어야 합니다");
  if (request.headers.get("origin") === null || !isSameSiteRequest(request)) return errorJson(403, "다른 사이트에서 온 요청은 받지 않습니다");
  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  if (!(await briefOpen(db)) || !(await featureOn(db, "brief_regular"))) return errorJson(404, "찾을 수 없습니다");
  const secret = requireGuardSecret();

  const reply = (code: SubscribeCode, headers: Record<string, string> = {}, extra: Record<string, unknown> = {}): Response => {
    if (isForm) {
      const ok = code === "sent" || code === "already";
      return new Response(null, { status: 303, headers: { location: ok ? `/brief/subscribe?done=${code}` : `/brief/subscribe?e=${code}`, ...headers } });
    }
    const status = STATUS[code] ?? 200;
    const response = status === 200 ? json({ ok: true, code, message: SUBSCRIBE_MESSAGES[code] }) : errorJson(status, SUBSCRIBE_MESSAGES[code], { code, ...extra });
    for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
    return response;
  };

  const text = await request.text();
  if (text.length > 8_000) throw new HttpError(413, "요청 본문이 너무 큽니다");
  let raw: Record<string, unknown>;
  if (isForm) {
    const p = new URLSearchParams(text);
    raw = {
      email: p.get("email") ?? "",
      agree_brief: p.get("agree_brief") ?? "",
      agree_alert: p.get("agree_alert") ?? "",
      include_docs: p.get("include_docs") ?? "",
      tax_kinds: p.getAll("tax_kinds"),
      amendment_ids: p.getAll("amendment_ids"),
      website: p.get("website") ?? "",
      fill: p.get("fill") ?? "",
    };
  } else {
    try {
      const value: unknown = JSON.parse(text);
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("not object");
      raw = value as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "요청 본문이 JSON 객체가 아닙니다");
    }
  }
  if ((typeof raw.website === "string" && raw.website !== "") || checkFillToken(secret, raw.fill, Date.now()) !== "ok") return reply("bot");

  const parsed = parseSubscribeInput(raw);
  if (!parsed.ok) return reply(parsed.code);

  const limits = await readAuthLimits(db);
  const hits = await Promise.all([
    throttleHit(db, "brief_ip", throttleKey(secret, "brief_ip", requestIp(request)), limits.brief_ip),
    throttleHit(db, "brief_email", throttleKey(secret, "brief_email", parsed.value.email), limits.brief_email),
  ]);
  const blocked = hits.filter((h) => !h.allowed);
  if (blocked.length > 0) {
    const wait = Math.max(...blocked.map((h) => h.retryAfter));
    return reply("too_many", { "retry-after": String(wait) }, { retry_after_seconds: wait });
  }
  const base = siteBase(request);
  if (!base) {
    console.error("[brief] 사이트 주소를 정할 수 없습니다 (NEXT_PUBLIC_SITE_URL)");
    return reply("mail_down");
  }
  return reply(await subscribe(db, parsed.value, { secret, base }));
});
