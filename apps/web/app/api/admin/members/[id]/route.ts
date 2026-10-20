import { withdrawBlocked } from "@/lib/auth/recovery";
import { loadMember } from "@/lib/server/admin/members";
import { eraseAccount } from "@/lib/server/accounts/erase";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, readJson } from "@/lib/server/http";

// 회원 계정 삭제 (W2-e 설계 5.3 · 9.3) — 관리자만(member.delete). 편집 책임자 등의 시도는 403 + 감사 로그(member.delete.denied).
//  · 본문 { reason } — 사유 필수(감사 기록)
//  · 편집국 역할·연결 인물이 있는 계정, 관리자 계정, 자기 계정은 지우지 않는다(409) — 역할 회수가 먼저
//  · 지우는 순서는 탈퇴와 같은 함수(lib/server/accounts/erase.ts): 동의 → 프로필 → Auth 계정
//  · 감사 로그 member.delete — 대상은 user:<uuid>뿐, 이메일 0
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE = handle(async (request: Request, { params }: Ctx) => {
  const rawId = (await params).id;
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const userId = UUID.test(rawId) ? rawId.toLowerCase() : null;
  const target = `user:${userId ?? "invalid"}`;
  const denied = await authorize(viewer, "member.delete", target);
  if (denied) return denied;
  if (!userId) return errorJson(404, "그런 계정이 없습니다");
  const raw = await readJson(request);
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  const extra = Object.keys(raw).filter((k) => k !== "reason");
  if (extra.length > 0 || reason === "" || reason.length > 500) {
    return errorJson(422, "입력값을 확인하세요", { errors: [...extra.map((k) => `delete.${k}: 모르는 칸입니다`), ...(reason === "" || reason.length > 500 ? ["delete.reason: 사유를 적어야 합니다 (감사 기록, 500자 이하)"] : [])] });
  }

  const db = serviceDb();
  const member = await loadMember(db, userId);
  if (!member) return errorJson(404, "그런 계정이 없습니다");
  if (userId === viewer.userId) return errorJson(409, "자기 계정은 지울 수 없습니다");
  if (withdrawBlocked(member) || member.person) return errorJson(409, "편집국 역할·연결 인물이 있거나 관리자 목록에 있는 계정은 지울 수 없습니다 — 역할 회수가 먼저입니다");

  await eraseAccount(db, userId, "member-delete", "계정을 지우지 못했습니다 — 잠시 뒤 다시 시도하세요");
  await writeAudit(db, { actor: actorOf(viewer), action: "member.delete", target, before: { suspended: member.suspended }, after: { consentsDeleted: true, profileDeleted: true, authDeleted: true }, reason });
  return json({ ok: true });
});
