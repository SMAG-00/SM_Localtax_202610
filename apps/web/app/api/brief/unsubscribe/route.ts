import { TOKEN_SHAPE, hashToken } from "@/lib/brief/input";
import { briefOpen } from "@/lib/server/auth-guard";
import { isSameSiteRequest } from "@/lib/server/dal";
import { HttpError, errorJson, handle, json } from "@/lib/server/http";
import { adminClient } from "@/lib/server/supabase";

// 브리핑 사전 알림 철회 (W2-e 설계 7.5) — /brief/unsubscribe 화면의 버튼이 POST한다. 철회 토큰으로 revoked_at을 채운다.
//  · 확정 여부와 상관없이 철회할 수 있다. 이미 철회한 링크를 다시 눌러도 성공. 모르는 토큰·모양이 틀린 토큰은 같은 응답(410)
//  · 철회된 행은 보존 기한(privacy_retention.revoked_consent_days) 뒤 배치가 지운다
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const isForm = contentType.startsWith("application/x-www-form-urlencoded");
  if (!isForm && !contentType.startsWith("application/json")) return errorJson(415, "요청 본문은 application/json 또는 폼이어야 합니다");
  if (request.headers.get("origin") === null || !isSameSiteRequest(request)) return errorJson(403, "다른 사이트에서 온 요청은 받지 않습니다");
  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  if (!(await briefOpen(db))) return errorJson(404, "찾을 수 없습니다");

  const text = await request.text();
  if (text.length > 2_000) throw new HttpError(413, "요청 본문이 너무 큽니다");
  let token: unknown;
  if (isForm) token = new URLSearchParams(text).get("token");
  else {
    try {
      token = (JSON.parse(text) as Record<string, unknown>)?.token;
    } catch {
      throw new HttpError(400, "요청 본문이 JSON 형식이 아닙니다");
    }
  }
  const expired = () => (isForm ? new Response(null, { status: 303, headers: { location: "/brief/unsubscribe?error=expired" } }) : errorJson(410, "링크가 만료되었습니다"));
  if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) return expired();

  const found = await db.from("consents").select("id, revoked_at").in("kind", ["brief_prereg", "brief", "amendment_alert"]).eq("revoke_token_hash", hashToken(token)).maybeSingle();
  if (found.error) throw new HttpError(503, "잠시 뒤 다시 시도해 주세요");
  if (!found.data) return expired();
  if (!found.data.revoked_at) {
    const upd = await db.from("consents").update({ revoked_at: new Date().toISOString() }).eq("id", found.data.id).is("revoked_at", null);
    if (upd.error) throw new HttpError(503, "잠시 뒤 다시 시도해 주세요");
  }
  return isForm ? new Response(null, { status: 303, headers: { location: "/brief/unsubscribe?done=1" } }) : json({ ok: true });
});
