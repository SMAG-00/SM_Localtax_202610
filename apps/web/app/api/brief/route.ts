import { checkFillToken } from "@/lib/auth/signup-input";
import { throttleKey } from "@/lib/auth/throttle-key";
import { BRIEF_MESSAGES, hashToken, newToken, parseBriefInput, type BriefCode } from "@/lib/brief/input";
import { briefOpen, readAuthLimits, requestIp, requireGuardSecret, throttleHit } from "@/lib/server/auth-guard";
import { isSameSiteRequest } from "@/lib/server/dal";
import { HttpError, errorJson, handle, json } from "@/lib/server/http";
import { sendMail } from "@/lib/server/mail";
import { siteBase } from "@/lib/server/site-base";
import { adminClient } from "@/lib/server/supabase";

// 브리핑 사전 알림 신청 (W2-e 설계 7.5 · HOME-06) — 닫혀 있으면(brief 기능 키 꺼짐·처리방침 게시본 없음·메일 설정 없음) 404
//  · 순서: 같은 사이트(Origin 필수) → 숨은 칸·폼 열림 토큰 → 형식·동의 검사 → brief_ip·brief_email 횟수 → 같은 이메일 확인
//  · 확정된 신청이 있으면 저장하지 않고 "이미 신청하셨습니다" · 확인 전 신청이면 토큰을 새로 만들어 확인 메일을 다시 보낸다 · 새 이메일이면 consents에 미확정 행
//  · 이메일은 consents(평문이 허용된 칸)에만 둔다 — subscribers·측정 이벤트·서버 기록에는 넣지 않는다
//  · 일반 HTML 폼(JS 없이 동작)이면 303으로 /brief에 돌아가고, JSON이면 JSON으로 답한다
export const dynamic = "force-dynamic";

const STATUS: Partial<Record<BriefCode, number>> = { bot: 422, too_many: 429, mail_down: 503, email: 422, consent: 422 };

export const POST = handle(async (request: Request) => {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const isForm = contentType.startsWith("application/x-www-form-urlencoded");
  if (!isForm && !contentType.startsWith("application/json")) return errorJson(415, "요청 본문은 application/json 또는 폼이어야 합니다");
  if (request.headers.get("origin") === null || !isSameSiteRequest(request)) return errorJson(403, "다른 사이트에서 온 요청은 받지 않습니다");

  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  if (!(await briefOpen(db))) return errorJson(404, "찾을 수 없습니다");
  const secret = requireGuardSecret();

  const reply = (code: BriefCode, headers: Record<string, string> = {}, extra: Record<string, unknown> = {}): Response => {
    if (isForm) {
      const ok = code === "sent" || code === "already";
      return new Response(null, { status: 303, headers: { location: ok ? `/brief?done=${code}` : `/brief?e=${code}`, ...headers } });
    }
    const status = STATUS[code] ?? 200;
    const response = status === 200 ? json({ ok: true, code, message: BRIEF_MESSAGES[code] }) : errorJson(status, BRIEF_MESSAGES[code], { code, ...extra });
    for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
    return response;
  };

  const text = await request.text();
  if (text.length > 4_000) throw new HttpError(413, "요청 본문이 너무 큽니다");
  let raw: Record<string, unknown>;
  if (isForm) {
    const p = new URLSearchParams(text);
    raw = { email: p.get("email") ?? "", agree: p.get("agree") ?? "", website: p.get("website") ?? "", fill: p.get("fill") ?? "" };
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

  const parsed = parseBriefInput(raw);
  if (!parsed.ok) return reply(parsed.code);
  const { email } = parsed;

  const limits = await readAuthLimits(db);
  const hits = await Promise.all([
    throttleHit(db, "brief_ip", throttleKey(secret, "brief_ip", requestIp(request)), limits.brief_ip),
    throttleHit(db, "brief_email", throttleKey(secret, "brief_email", email), limits.brief_email),
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

  const existing = await db.from("consents").select("id, confirmed_at").eq("kind", "brief_prereg").eq("email", email).is("revoked_at", null).maybeSingle();
  if (existing.error) {
    console.error("[brief] 신청 확인 실패:", existing.error.code);
    return reply("mail_down");
  }
  if (existing.data?.confirmed_at) return reply("already");

  const confirmToken = newToken();
  const revokeToken = newToken();
  const hashes = { confirm_token_hash: hashToken(confirmToken), revoke_token_hash: hashToken(revokeToken) };
  let createdId: number | null = null;
  if (existing.data) {
    const upd = await db.from("consents").update(hashes).eq("id", existing.data.id);
    if (upd.error) {
      console.error("[brief] 토큰 갱신 실패:", upd.error.code);
      return reply("mail_down");
    }
  } else {
    const versions = await db.from("policy_versions").select("id").eq("doc_key", "privacy").eq("status", "published");
    const versionRef = (versions.data ?? []).map((v: { id: number }) => v.id);
    const ins = await db.from("consents").insert({ email, kind: "brief_prereg", channel: "web_brief", version_ref: versionRef, ...hashes }).select("id").single();
    if (ins.error) {
      // 같은 이메일이 동시에 들어온 경우(철회되지 않은 행은 하나) — 먼저 들어온 쪽이 메일을 보낸다
      if (ins.error.code === "23505") return reply("sent");
      console.error("[brief] 신청 저장 실패:", ins.error.code);
      return reply("mail_down");
    }
    createdId = ins.data.id as number;
  }

  const sent = await sendMail({
    to: email,
    template: "brief_confirm",
    vars: { link: `${base}/brief/confirm?token=${confirmToken}`, unsubscribeLink: `${base}/brief/unsubscribe?token=${revokeToken}` },
  });
  if (!sent.ok) {
    if (createdId !== null) await db.from("consents").delete().eq("id", createdId);
    return reply("mail_down");
  }
  return reply("sent");
});
