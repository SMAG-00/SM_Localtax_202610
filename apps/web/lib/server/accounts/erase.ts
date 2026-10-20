import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "../http";

/**
 * 회원 계정 지우기 (W2-e 9.3) — 탈퇴(/api/auth/withdraw)와 관리자 삭제(DELETE /api/admin/members/[id])가 같이 쓴다.
 * 동의·프로필을 먼저 지우고 Auth 계정을 지운다(계정 삭제가 실패해도 개인정보 행은 남지 않는다). 실패하면 500.
 * 역할·관리자 확인은 부르는 쪽 책임이다.
 */
export async function eraseAccount(db: SupabaseClient, userId: string, label: string, failMessage: string): Promise<void> {
  const consents = await db.from("consents").delete().eq("user_id", userId);
  const profiles = await db.from("profiles").delete().eq("id", userId);
  if (consents.error || profiles.error) {
    console.error(`[${label}] 개인정보 행 삭제 실패:`, consents.error?.code, profiles.error?.code);
    throw new HttpError(500, failMessage);
  }
  const removed = await db.auth.admin.deleteUser(userId);
  if (removed.error) {
    console.error(`[${label}] 계정 삭제 실패:`, removed.error.code, removed.error.status);
    throw new HttpError(500, failMessage);
  }
}
