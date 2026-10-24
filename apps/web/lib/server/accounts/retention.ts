import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cutoffBefore, parseRetention } from "@/lib/auth/retention";
import { purgeUnconfirmedSignups } from "./purge";

/**
 * 보존 기한 정리 (W2-e 설계 9.3, 배치 privacy-retention) — 하루 한 번.
 *  · 확인 안 된 가입 → purgeUnconfirmedSignups(계정·프로필·동의)
 *  · 확인 안 된 사전 알림 · 철회 30일 지난 사전 알림 동의 · 완료 365일 지난 문의 연락처 → DB 함수 privacy_purge_rows
 *  · 완료 365일 지난 문의 첨부 → 저장소 파일을 먼저 지우고 attachments 비움 + attachments_cleared_at
 *  · 시도 기록 24시간 → throttle_purge
 * 기준 시각(now)을 인자로 받는다. 반환은 지운 수뿐이다(이메일·경로·번호 0) — 실행 기록(agent_runs.detail)에 그대로 남는다.
 * 설정(privacy_retention)이 없거나 모양이 틀리면 던진다 — 기한을 모르는 채로 지우지 않는다
 */
const BUCKET = "inquiry-attachments";
const ATTACHMENT_BATCH = 200;

export async function purgePrivacy(db: SupabaseClient, now: Date): Promise<Record<string, unknown>> {
  const setting = await db.from("settings").select("value").eq("key", "privacy_retention").maybeSingle();
  const rules = setting.error ? null : parseRetention(setting.data?.value);
  if (!rules) throw new Error("설정 privacy_retention이 없거나 모양이 틀립니다 — 보존 기한 정리를 하지 않습니다");

  const unconfirmedSignups = await purgeUnconfirmedSignups(db, now);

  const rows = await db.rpc("privacy_purge_rows", {
    p_now: now.toISOString(),
    p_unconfirmed_prereg_days: rules.unconfirmedConsentDays,
    p_revoked_days: rules.revokedConsentDays,
    p_contact_days: rules.inquiryContactDays,
  });
  if (rows.error || typeof rows.data !== "object" || rows.data === null) throw new Error(`보존 기한 정리 함수 실패 (${rows.error?.code ?? "모양 오류"})`);
  const counts = rows.data as { unconfirmed_prereg: number; revoked_consents: number; contacts_cleared: number };

  const attachments = await clearAttachments(db, cutoffBefore(now, rules.inquiryAttachmentDays));

  const throttle = await db.rpc("throttle_purge", { p_older_than_hours: rules.throttleHours });
  if (throttle.error) throw new Error(`시도 기록 정리 실패 (${throttle.error.code})`);

  // SM 전문가 연락 요청 (W7c EXPL-21) - 보관 기간 지난 요청의 이름·연락처·요약 파기 (DB 함수 - 멱등, 건수만 남긴다)
  const purgedRequests = await db.rpc("expert_requests_purge", { p_now: now.toISOString() });
  if (purgedRequests.error) throw new Error(`전문가 연락 요청 파기 실패 (${purgedRequests.error.code})`);

  return {
    expertRequestsPurged: Number(purgedRequests.data),
    unconfirmedSignups,
    unconfirmedPrereg: counts.unconfirmed_prereg,
    revokedConsents: counts.revoked_consents,
    contactsCleared: counts.contacts_cleared,
    attachmentInquiries: attachments.inquiries,
    attachmentFiles: attachments.files,
    attachmentFailed: attachments.failed,
    throttleRows: Number(throttle.data),
  };
}

async function clearAttachments(db: SupabaseClient, cutoff: Date): Promise<{ inquiries: number; files: number; failed: number }> {
  const due = await db
    .from("inquiries")
    .select("id, attachments")
    .eq("status", "done")
    .lte("done_at", cutoff.toISOString())
    .is("attachments_cleared_at", null)
    .neq("attachments", "[]")
    .order("id")
    .limit(ATTACHMENT_BATCH);
  if (due.error) throw new Error(`첨부 기한 목록을 읽지 못했습니다 (${due.error.code})`);
  let inquiries = 0;
  let files = 0;
  let failed = 0;
  for (const row of (due.data ?? []) as { id: number; attachments: unknown }[]) {
    const paths = Array.isArray(row.attachments)
      ? row.attachments.map((a) => (typeof a === "object" && a !== null ? (a as { path?: unknown }).path : null)).filter((p): p is string => typeof p === "string" && p !== "")
      : [];
    // 파일을 먼저 지운다 — 지우기가 실패하면 칸을 비우지 않아 다음 실행이 다시 시도한다
    if (paths.length > 0) {
      const removed = await db.storage.from(BUCKET).remove(paths);
      if (removed.error) {
        failed += 1;
        console.error("[retention] 첨부 파일 삭제 실패:", removed.error.message);
        continue;
      }
    }
    const upd = await db.from("inquiries").update({ attachments: [], attachments_cleared_at: new Date().toISOString() }).eq("id", row.id);
    if (upd.error) {
      failed += 1;
      console.error("[retention] 첨부 칸 비우기 실패:", upd.error.code);
      continue;
    }
    inquiries += 1;
    files += paths.length;
  }
  return { inquiries, files, failed };
}
