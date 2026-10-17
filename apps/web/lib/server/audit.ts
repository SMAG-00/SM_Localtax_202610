import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Viewer } from "@/lib/access";
import { HttpError } from "./http";

// 감사 로그 쓰기 (ADM-04 · NAV-06) — 누가(actor)·무엇을(action·target)·전후(before·after)·왜(reason).
// audit_logs는 추가만 되는 표다(수정·삭제는 PO 전용 함수). service_role로만 쓴다.

export interface AuditEntry {
  actor: string;
  action: string;
  target: string;
  before?: unknown;
  after?: unknown;
  reason: string;
}

/** 사람 행위자 — user:<uuid> (audit_logs·article_revisions·article_corrections가 같은 형식) */
export function actorOf(viewer: Pick<Viewer, "userId">): string {
  return `user:${viewer.userId}`;
}

export const targetOf = {
  article: (id: number | string) => `articles:${id}`,
  assignment: (id: number | string) => `story_assignments:${id}`,
  staffRole: (userId: string) => `staff_roles:${userId}`,
};

/** 감사 로그 한 줄. 실패하면 예외 — 감사 기록 없는 변경을 성공으로 알리지 않는다 */
export async function writeAudit(db: SupabaseClient, entry: AuditEntry): Promise<void> {
  const reason = entry.reason.trim() || entry.action;
  const { error } = await db.from("audit_logs").insert({
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason,
  });
  if (error) {
    console.error("[audit] 감사 로그 쓰기 실패:", error.code, error.message);
    throw new HttpError(500, "감사 기록을 남기지 못했습니다 — 관리자에게 알려 주세요");
  }
}
