import { formatKey, hashSecret, newSecret, PepperMissingError } from "@/lib/partner-feeds/keys";
import { actorOf } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 제휴 피드 키 발급·폐기 (W13-i PART-01). 권한 feeds.issue (관리자만).
//  · POST op=issue {partner_id, contract_id, scope} -> 키 원문은 이 응답에서 한 번만 보인다 (저장은 후추 해시뿐). 계약이 없거나 기간 밖이면 거부 409
//  · POST op=revoke {feed_id} -> 다음 요청부터 401
export const dynamic = "force-dynamic";

const posInt = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN;
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
};

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (op !== "issue" && op !== "revoke") return errorJson(422, "입력값을 확인하세요", { errors: ["op: issue 또는 revoke 입니다"] });
  const denied = await authorize(viewer, "feeds.issue", `feeds:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  if (op === "revoke") {
    const id = posInt(body.feed_id);
    if (id === null) return errorJson(422, "입력값을 확인하세요", { errors: ["feed_id: 키 번호(1 이상 정수)입니다"] });
    const { data, error } = await db.rpc("partner_feed_revoke", { p_feed: id, p_actor: actorOf(viewer) });
    if (error) throw dbError(error, "제휴 피드 키 폐기");
    const r = data as { ok: boolean; code: string };
    if (!r.ok) return errorJson(409, "키를 폐기할 수 없습니다", { code: r.code });
    return json({ revoked: { id } });
  }
  const partner = posInt(body.partner_id);
  const contract = posInt(body.contract_id);
  const scope = String(body.scope ?? "summary");
  const errors: string[] = [];
  if (partner === null) errors.push("partner_id: 제휴사 번호(1 이상 정수)입니다");
  if (contract === null) errors.push("contract_id: 계약 번호(1 이상 정수)입니다");
  if (scope !== "summary" && scope !== "full") errors.push("scope: summary 또는 full 입니다");
  if (errors.length > 0) return errorJson(422, "입력값을 확인하세요", { errors });
  const secret = newSecret();
  let hash: string;
  try {
    hash = hashSecret(secret, process.env.PARTNER_FEED_KEY_PEPPER ?? "");
  } catch (err) {
    if (err instanceof PepperMissingError) return errorJson(503, "PARTNER_FEED_KEY_PEPPER가 설정되지 않아 키를 발급하지 않습니다");
    throw err;
  }
  const { data, error } = await db.rpc("partner_feed_issue", { p_partner: partner, p_contract: contract, p_scope: scope, p_key_hash: hash, p_actor: actorOf(viewer) });
  if (error) throw dbError(error, "제휴 피드 키 발급");
  const r = data as { ok: boolean; code: string; id?: number };
  if (!r.ok || r.id === undefined) return errorJson(409, "키를 발급할 수 없습니다", { code: r.code });
  return json({ created: { id: r.id, key: formatKey(r.id, secret), notice: "이 키는 지금 한 번만 보입니다. 다시 볼 수 없습니다." } }, 201);
});
