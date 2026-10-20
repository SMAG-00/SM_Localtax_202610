import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unconfirmedCutoff } from "@/lib/auth/recovery";
import { readUnconfirmedSignupDays } from "@/lib/server/auth-guard";

/**
 * 확인 안 된 가입 정리 (W2-e 9.3) — 설정 privacy_retention의 미확인 가입 일수가 지난 미확인 계정의 계정·프로필·동의를 지운다.
 * 기준 시각(now)을 인자로 받는다 — 경계 시험(하루 전 남음·당일 지움)과 배치(6단계)가 같은 함수를 쓴다. 역할이 있는 계정은 DB 함수가 처음부터 고르지 않는다.
 * 반환: 지운 계정 수
 */
export async function purgeUnconfirmedSignups(db: SupabaseClient, now: Date): Promise<number> {
  const days = await readUnconfirmedSignupDays(db);
  const { data, error } = await db.rpc("unconfirmed_account_ids", { p_before: unconfirmedCutoff(now, days).toISOString() });
  if (error || !Array.isArray(data)) throw new Error(`미확인 계정 목록을 읽지 못했습니다 (${error?.code ?? "모양 오류"})`);
  let deleted = 0;
  for (const id of data as string[]) {
    // 계정을 지우면 profiles·consents가 함께 지워진다(on delete cascade) — 계정 삭제가 실패해도 개인정보 행은 먼저 지워 둔다
    await db.from("consents").delete().eq("user_id", id);
    await db.from("profiles").delete().eq("id", id);
    const res = await db.auth.admin.deleteUser(id);
    if (res.error) console.error("[purge] 미확인 계정 삭제 실패:", res.error.code, res.error.status);
    else deleted += 1;
  }
  return deleted;
}
