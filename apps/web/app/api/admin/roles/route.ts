import { STAFF_ROLES, isStaffRole, type Viewer } from "@/lib/access";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { mapDbError } from "@/lib/server/db-errors";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 서비스 역할 부여·회수 (ACC-04) — 관리자(ADMIN_EMAILS)만. editor와 편집국 외 역할(ad_ops·store_ops·brand_ops·expert_ops)을
// 한 사람에게 함께 주면 DB 트리거가 거부한다(관리자도 예외 없음) → 409 + 감사 로그. 관리자가 아닌 계정의 시도는 403 + 감사 로그.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const grantedBy = (viewer: Viewer) => (viewer.email ? `admin:${viewer.email}` : actorOf(viewer));

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const raw = await readJson(request);
  const op = raw.op === undefined ? "grant" : raw.op;
  if (op !== "grant" && op !== "revoke") return errorJson(422, "op는 grant·revoke 중 하나여야 합니다");
  const userId = typeof raw.userId === "string" ? raw.userId : "";
  const target = targetOf.staffRole(UUID.test(userId) ? userId.toLowerCase() : "invalid");
  const denied = await authorize(viewer, op === "grant" ? "role.grant" : "role.revoke", target);
  if (denied) return denied;
  if (!UUID.test(userId)) return errorJson(422, "userId는 계정 UUID여야 합니다");
  if (!isStaffRole(raw.role)) return errorJson(422, `role은 ${STAFF_ROLES.join("·")} 중 하나여야 합니다`);
  const role = raw.role;
  const reason = typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : op === "grant" ? `역할 부여 ${role}` : `역할 회수 ${role}`;

  const db = serviceDb();
  const { data: currentRows, error: readError } = await db.from("staff_roles").select("role").eq("user_id", userId);
  if (readError) throw dbError(readError, "staff_roles 읽기");
  const before = (currentRows ?? []).map((r: { role: string }) => r.role).sort();

  if (op === "grant") {
    const { error } = await db.from("staff_roles").insert({ user_id: userId, role, granted_by: grantedBy(viewer) });
    if (error) {
      const mapped = mapDbError(error);
      if (mapped.status === 409 && error.code === "23514") {
        // 편집 승인 역할과 편집국 외 역할의 겸직 거부 — 거부 사실도 남긴다 (ACC-04)
        await writeAudit(db, { actor: actorOf(viewer), action: "role.grant.rejected", target, before: { roles: before }, after: { requested: role }, reason: mapped.message });
      }
      if (error.code === "23503") return errorJson(404, "그런 사용자 계정이 없습니다");
      throw dbError(error, "staff_roles 추가");
    }
  } else {
    const { data, error } = await db.from("staff_roles").delete().eq("user_id", userId).eq("role", role).select("role");
    if (error) throw dbError(error, "staff_roles 삭제");
    if (!data || data.length === 0) return errorJson(404, "그 역할은 부여되어 있지 않습니다");
  }

  const after = op === "grant" ? [...before, role].sort() : before.filter((r) => r !== role);
  await writeAudit(db, { actor: actorOf(viewer), action: op === "grant" ? "role.grant" : "role.revoke", target, before: { roles: before }, after: { roles: after }, reason });
  return json({ userId, roles: after }, op === "grant" ? 201 : 200);
});
