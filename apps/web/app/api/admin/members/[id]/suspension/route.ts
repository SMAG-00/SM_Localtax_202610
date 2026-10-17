import { parseSuspensionInput, suspendBlocked } from "@/lib/admin/member-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { loadMember, setSuspended } from "@/lib/server/admin/members";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, readJson } from "@/lib/server/http";

// 계정 정지·해제 (ADM-02 정지) — 관리자만(member.suspend). 편집 책임자 등의 시도는 403 + 감사 로그.
//  · 본문 { suspend: true | false, reason } — 사유 필수(감사 기록)
//  · 정지 = Supabase Auth ban(해제할 때까지). 정지된 계정은 로그인할 수 없고, 이미 받은 토큰·쿠키 세션도 DAL이 거부한다(401)
//  · 자기 계정·관리자 계정(ADMIN_EMAILS)은 정지하지 않는다(409). 감사 로그에 전후 정지 상태
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const rawId = (await params).id;
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const userId = UUID.test(rawId) ? rawId.toLowerCase() : null;
  const target = targetOf.member(userId ?? "invalid");
  const denied = await authorize(viewer, "member.suspend", target);
  if (denied) return denied;
  if (!userId) return errorJson(404, "그런 계정이 없습니다");
  const parsed = parseSuspensionInput(await readJson(request));
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const { suspend, reason } = parsed.value;

  const db = serviceDb();
  const before = await loadMember(db, userId);
  if (!before) return errorJson(404, "그런 계정이 없습니다");
  if (suspend) {
    const blocked = suspendBlocked({ targetId: userId, viewerId: viewer.userId, targetIsAdmin: before.isAdmin });
    if (blocked) return errorJson(409, blocked);
  }
  if (before.suspended === suspend) return json({ member: before, unchanged: true });

  const after = await setSuspended(db, userId, suspend);
  await writeAudit(db, {
    actor: actorOf(viewer),
    action: suspend ? "member.suspend" : "member.unsuspend",
    target,
    before: { suspended: before.suspended, bannedUntil: before.bannedUntil, email: before.email },
    after: { suspended: after.suspended, bannedUntil: after.bannedUntil },
    reason,
  });
  return json({ member: after });
});
