import { cookies, headers } from "next/headers";
import { RESET_COOKIE, RESET_WINDOW_MINUTES, signResetCookie } from "@/lib/auth/recovery";
import { requireGuardSecret } from "@/lib/server/auth-guard";
import { isHttps } from "@/lib/server/cookie-options";
import { isSameSiteRequest } from "@/lib/server/dal";
import { HttpError, errorJson, handle, json } from "@/lib/server/http";
import { cookieSessionClient } from "@/lib/server/session";
import { adminClient } from "@/lib/server/supabase";

// 가입·재설정 확인 (W2-e 설계 4.2 · 4.3) — GET /auth/confirm 화면의 버튼이 여기로 POST한다(링크를 미리 열어도 토큰이 소모되지 않는다).
//  verifyOtp({token_hash, type})로 확인한다.
//  · type=signup(첫 가입 메일) · type=magiclink(확인 메일 다시 받기 — 미확인 계정의 magiclink 토큰은 magiclink 유형으로만 확인된다, 로컬 Auth로 확인함) → 이메일 확인 + consents.signup.confirmed_at + 세션 쿠키 → /my?welcome=1
//  · type=recovery(비밀번호 재설정) → 세션 쿠키 + 재설정 확인 표시 쿠키(15분) → /reset-password. 동의 기록은 건드리지 않는다
//  · 만료·사용 완료·모양이 틀린 토큰은 같은 응답(410 "링크가 만료되었습니다") — 폼이면 /auth/confirm?error=expired&type=…
export const dynamic = "force-dynamic";

const EXPIRED = "링크가 만료되었습니다";
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{8,200}$/;
const TYPES = ["signup", "magiclink", "recovery"] as const;
type ConfirmType = (typeof TYPES)[number];
const NEXT = "/my?welcome=1";

export const POST = handle(async (request: Request) => {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const isForm = contentType.startsWith("application/x-www-form-urlencoded");
  if (!isForm && !contentType.startsWith("application/json")) return errorJson(415, "요청 본문은 application/json 또는 폼이어야 합니다");
  if (request.headers.get("origin") === null || !isSameSiteRequest(request)) return errorJson(403, "다른 사이트에서 온 요청은 받지 않습니다");

  const text = await request.text();
  if (text.length > 4000) throw new HttpError(413, "요청 본문이 너무 큽니다");
  let tokenHash: unknown;
  let type: unknown;
  if (isForm) {
    const p = new URLSearchParams(text);
    tokenHash = p.get("token_hash");
    type = p.get("type");
  } else {
    try {
      const v = JSON.parse(text) as Record<string, unknown>;
      tokenHash = v?.token_hash;
      type = v?.type;
    } catch {
      throw new HttpError(400, "요청 본문이 JSON 형식이 아닙니다");
    }
  }
  const kind: ConfirmType | null = TYPES.find((t) => t === type) ?? null;
  const expired = () => (isForm ? new Response(null, { status: 303, headers: { location: `/auth/confirm?error=expired&type=${kind === "recovery" ? "recovery" : "signup"}` } }) : errorJson(410, EXPIRED));
  if (kind === null || typeof tokenHash !== "string" || !TOKEN_SHAPE.test(tokenHash)) return expired();

  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const secret = kind === "recovery" ? requireGuardSecret() : null;
  const client = await cookieSessionClient();
  const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: kind });
  if (error || !data.user || !data.session) return expired();

  if (kind === "recovery" && secret) {
    (await cookies()).set(RESET_COOKIE, signResetCookie(secret, data.user.id, Date.now()), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isHttps(await headers()),
      maxAge: RESET_WINDOW_MINUTES * 60,
    });
    return isForm ? new Response(null, { status: 303, headers: { location: "/reset-password" } }) : json({ ok: true, next: "/reset-password" });
  }

  const update = await db.from("consents").update({ confirmed_at: new Date().toISOString() }).eq("user_id", data.user.id).eq("kind", "signup").is("confirmed_at", null);
  if (update.error) console.error("[confirm] 동의 확인 시각 저장 실패:", update.error.code);
  return isForm ? new Response(null, { status: 303, headers: { location: NEXT } }) : json({ ok: true, next: NEXT });
});
