import { checkInterestInput } from "@/lib/server/public/member-feed-logic";
import { isConsentKind, saveMyProfile, setConsent } from "@/lib/server/accounts/my-data";
import { readMemberSettings } from "@/lib/server/auth-guard";
import { getViewer, isSameSiteRequest } from "@/lib/server/dal";
import { HttpError, errorJson, handle, json } from "@/lib/server/http";
import { adminClient } from "@/lib/server/supabase";

// 내 정보 저장 (W2-e 설계 5.1) — 로그인한 본인(viewer.userId)의 행만 고친다. 일반 폼(303)과 JSON 모두 받는다.
//  · intent=profile: 표시 이름·관심 분야·관심 지역 (동의 행은 만들지 않는다) / intent=consent: 수신 동의 하나 켜기·끄기
export const dynamic = "force-dynamic";

const back = (to: string): Response => new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store" } });
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export const POST = handle(async (request: Request) => {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const isForm = contentType.startsWith("application/x-www-form-urlencoded");
  if (!isForm && !contentType.startsWith("application/json")) return errorJson(415, "요청 본문은 application/json 또는 폼이어야 합니다");
  if (request.headers.get("origin") === null || !isSameSiteRequest(request)) return errorJson(403, "다른 사이트에서 온 요청은 받지 않습니다");
  const text = await request.text();
  if (text.length > 20_000) throw new HttpError(413, "요청 본문이 너무 큽니다");
  let raw: Record<string, unknown>;
  if (isForm) {
    const p = new URLSearchParams(text);
    raw = { intent: p.get("intent") ?? "", displayName: p.get("displayName") ?? "", interests: p.getAll("interests"), regionCodes: p.getAll("regionCodes"), kind: p.get("kind") ?? "", on: p.get("on") ?? "" };
  } else {
    try {
      const v: unknown = JSON.parse(text);
      if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("not object");
      raw = v as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "요청 본문이 JSON 객체가 아닙니다");
    }
  }
  const viewer = await getViewer(request);
  if (!viewer) return errorJson(401, "로그인이 필요합니다");
  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const fail = (code: string, message: string, status = 422): Response => (isForm ? back(`/my?e=${code}`) : errorJson(status, message, { code }));
  const ok = (saved: string): Response => (isForm ? back(`/my?saved=${saved}`) : json({ ok: true }));

  if (raw.intent === "consent") {
    if (!isConsentKind(raw.kind)) return fail("consent", "동의 종류가 목록 밖입니다");
    await setConsent(db, viewer.userId, raw.kind, raw.on === true || raw.on === "1" || raw.on === "on");
    return ok("consent");
  }
  if (raw.intent !== "profile") return fail("intent", "요청 종류를 알 수 없습니다", 400);

  const list = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string" && x.length <= 60) ? (v as string[]) : v === undefined ? [] : null);
  const interests = list(raw.interests);
  const regionCodes = list(raw.regionCodes);
  if (!interests || !regionCodes) return fail("interests", "관심 분야·지역 값이 맞지 않습니다");
  const member = await readMemberSettings(db);
  const checked = checkInterestInput(interests, regionCodes, { interestMax: member.interestMax, interestRegionLimit: member.interestRegionLimit });
  if (!checked.ok) return fail(checked.field === "interests" ? "interests" : "regions", checked.message);

  let displayName: string | null = null;
  if (typeof raw.displayName === "string" && raw.displayName.trim() !== "") {
    const name = raw.displayName.trim();
    if ([...name].length > member.displayNameChars || EMAIL_IN_TEXT.test(name.normalize("NFKC"))) return fail("display_name", "표시 이름은 제한 글자 수 이하로, 이메일 모양이 아니게 넣어 주세요");
    displayName = name;
  }
  const saved = await saveMyProfile(db, viewer.userId, { displayName, interests: checked.interests, regionCodes: checked.regionCodes });
  if (!saved) return fail("codes", "없거나 폐지된 분야·지역이 있습니다 — 목록에서 다시 골라 주세요");
  return ok("profile");
});
