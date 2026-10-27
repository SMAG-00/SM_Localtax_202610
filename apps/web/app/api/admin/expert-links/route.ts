import { LINK_OPS, parseEnd, parseLink, parseRenew } from "@/lib/admin/qna-rules";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { loadLinkBoard } from "@/lib/server/qna/admin";

// SM 전문가 계정 연결 관리 (W13-g EXP-01·02) - 관리자(PO)만(권한 expert_link.edit, 거부는 감사 로그).
//  · GET - 연결 목록(계정 번호·프로필·상태·기한)과 연결할 수 있는 공개 프로필
//  · POST op=link {user_id,profile_id,expires_on} / end {id,reason} / renew {id,expires_on}
// 외부 증빙·자기 신청 경로 없음. 규칙(공개 SM 프로필만·계정당 1개·프로필당 1개)은 DB RPC가 정본이고 거부는 { ok:false, code }를 404/409/422로 옮긴다.
export const dynamic = "force-dynamic";

const CODE_STATUS: Record<string, number> = {
  no_user: 404,
  no_profile: 404,
  not_found: 404,
  profile_not_published: 422,
  bad_expiry: 422,
  reason_required: 422,
  user_already_linked: 409,
  profile_already_linked: 409,
  already_linked: 409,
  already_ended: 409,
  not_active: 409,
};

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "expert_link.edit", "expert-links:list");
  if (denied) return denied;
  return json(await loadLinkBoard(serviceDb()));
});

export const POST = handle(
  async (request: Request) => {
    const viewer = await requireViewer(request);
    if (viewer instanceof Response) return viewer;
    const body = await readJson(request);
    const op = String(body.op);
    if (!(LINK_OPS as readonly string[]).includes(op)) return errorJson(422, "입력값을 확인하세요", { errors: [`op: ${LINK_OPS.join("·")} 중 하나입니다`] });
    const denied = await authorize(viewer, "expert_link.edit", `expert-links:${op}`);
    if (denied) return denied;
    const db = serviceDb();
    const actor = actorOf(viewer);

    const rpc = async (fn: string, args: Record<string, unknown>, action: string, target: string, after: unknown, reason: string) => {
      const { data, error } = await db.rpc(fn, args);
      if (error) throw dbError(error, fn);
      const r = data as { ok: boolean; code?: string; id?: number };
      if (!r.ok) return errorJson(CODE_STATUS[r.code ?? ""] ?? 422, "처리할 수 없습니다", { code: r.code });
      await writeAudit(db, { actor, action, target, before: null, after, reason });
      return json({ ok: true, ...(r.id ? { id: r.id } : {}) }, op === "link" ? 201 : 200);
    };

    if (op === "link") {
      const p = parseLink(body);
      if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
      return rpc("expert_link_create", { p_user: p.value.userId, p_profile: p.value.profileId, p_expires_at: p.value.expiresAt, p_actor: actor }, "expert.link.create", `expert_profiles:${p.value.profileId}`, { user_id: p.value.userId, expires_at: p.value.expiresAt }, "SM 전문가 계정 연결");
    }
    if (op === "end") {
      const p = parseEnd(body);
      if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
      return rpc("expert_link_end", { p_id: p.value.id, p_reason: p.value.reason, p_actor: actor }, "expert.link.end", `expert_verifications:${p.value.id}`, { status: "revoked" }, p.value.reason);
    }
    const p = parseRenew(body);
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    return rpc("expert_link_renew", { p_id: p.value.id, p_expires_at: p.value.expiresAt, p_actor: actor }, "expert.link.renew", `expert_verifications:${p.value.id}`, { expires_at: p.value.expiresAt }, "재검증 기한 갱신");
  },
  { revalidatesPublic: true },
);
