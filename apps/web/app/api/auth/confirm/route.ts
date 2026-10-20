import { isSameSiteRequest } from "@/lib/server/dal";
import { HttpError, errorJson, handle, json } from "@/lib/server/http";
import { cookieSessionClient } from "@/lib/server/session";
import { adminClient } from "@/lib/server/supabase";

// 가입 확인 (W2-e 설계 4.3) — GET /auth/confirm 화면의 [가입 확인하기] 버튼이 여기로 POST한다(링크를 미리 열어도 토큰이 소모되지 않는다).
//  verifyOtp({token_hash, type})로 확인 → 이메일 확인 + consents.signup.confirmed_at + 세션 쿠키 → /my?welcome=1
//  · 만료·사용 완료·모양이 틀린 토큰은 같은 응답(410 "링크가 만료되었습니다") — 폼이면 /auth/confirm?error=expired
//  · 2단계 앞부분에서는 가입 확인(type=signup)만 받는다 (재설정 링크는 2-B)
export const dynamic = "force-dynamic";

const EXPIRED = "링크가 만료되었습니다";
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{8,200}$/;
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
  const expired = () => (isForm ? new Response(null, { status: 303, headers: { location: "/auth/confirm?error=expired" } }) : errorJson(410, EXPIRED));
  if (type !== "signup" || typeof tokenHash !== "string" || !TOKEN_SHAPE.test(tokenHash)) return expired();

  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const client = await cookieSessionClient();
  const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: "signup" });
  if (error || !data.user || !data.session) return expired();

  const update = await db.from("consents").update({ confirmed_at: new Date().toISOString() }).eq("user_id", data.user.id).eq("kind", "signup").is("confirmed_at", null);
  if (update.error) console.error("[confirm] 동의 확인 시각 저장 실패:", update.error.code);
  return isForm ? new Response(null, { status: 303, headers: { location: NEXT } }) : json({ ok: true, next: NEXT });
});
