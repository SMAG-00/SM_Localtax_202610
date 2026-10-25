import { TOKEN_SHAPE, hashToken } from "@/lib/brief/input";
import { briefOpen } from "@/lib/server/auth-guard";
import { isSameSiteRequest } from "@/lib/server/dal";
import { HttpError, errorJson, handle, json } from "@/lib/server/http";
import { adminClient } from "@/lib/server/supabase";
import { kstDate } from "@ltr/workflows/ops";

// 브리핑 사전 알림 확인 (W2-e 설계 7.5) — /brief/confirm 화면의 버튼이 여기로 POST한다(링크를 미리 열어도 확정되지 않는다).
//  · 토큰 해시로 철회되지 않은 신청을 찾아 confirmed_at을 채운다. 이미 확정이면 그대로 성공(같은 링크를 다시 눌러도 된다)
//  · 모르는·철회된 토큰·모양이 틀린 토큰은 같은 응답(410) — 폼이면 /brief/confirm?error=expired
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
  const expired = () => (isForm ? new Response(null, { status: 303, headers: { location: "/brief/confirm?error=expired" } }) : errorJson(410, "링크가 만료되었습니다"));
  if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) return expired();

  const found = await db.from("consents").select("id, kind, confirmed_at").in("kind", ["brief_prereg", "brief", "amendment_alert"]).eq("confirm_token_hash", hashToken(token)).is("revoked_at", null).maybeSingle();
  if (found.error) throw new HttpError(503, "잠시 뒤 다시 시도해 주세요");
  if (!found.data) return expired();
  // W10-e - 이미 확정된 브리핑·알림 구독이 이 링크를 다시 누르면 재확인이다(기한을 주기만큼 미룬다, BRIEF-02). 사전 알림은 그대로 성공
  if (found.data.confirmed_at && found.data.kind !== "brief_prereg") {
    const re = await db.rpc("consent_reconfirm", { p_consent_id: found.data.id, p_today: kstDate(new Date()) });
    if (re.error) throw new HttpError(503, "잠시 뒤 다시 시도해 주세요");
  }
  if (!found.data.confirmed_at) {
    const upd = await db.from("consents").update({ confirmed_at: new Date().toISOString() }).eq("id", found.data.id).is("confirmed_at", null).is("revoked_at", null);
    if (upd.error) throw new HttpError(503, "잠시 뒤 다시 시도해 주세요");
  }
  return isForm ? new Response(null, { status: 303, headers: { location: "/brief/confirm?done=1" } }) : json({ ok: true });
});
