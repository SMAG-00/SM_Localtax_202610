import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/server/http";

// 지식창고 관리 화면 자료 (W13-a a2). service_role로 읽는다 - 관리자 화면 전용. 본문은 읽지 않는다(칸 지정).
import { DIGITIZE_STAGES, type DigitizeStage, type TargetKind } from "./stages";
export { DIGITIZE_STAGES, TARGET_KINDS, nextStage } from "./stages";
export type { DigitizeStage, TargetKind } from "./stages";

export interface DigitizeJobRow {
  id: number;
  target_kind: TargetKind;
  target_id: number;
  source_file: string;
  stage: DigitizeStage;
  sample_size: number | null;
  sample_errors: number | null;
  sample_error_rate: number | null;
  approved_by: string | null;
}
export interface DigitizeAuditRow {
  id: number;
  at: string;
  job_id: number | null;
  action: string;
  outcome: string;
  code: string;
  actor: string;
}
export interface LibraryBoard {
  jobs: DigitizeJobRow[];
  audit: DigitizeAuditRow[];
  rightsLog: { id: number; at: string; item_kind: string; item_id: number; field: string; old_value: string | null; new_value: string; actor: string }[];
}

export async function loadLibraryBoard(db: SupabaseClient): Promise<LibraryBoard> {
  const j = await db.from("digitization_jobs").select("id, target_kind, target_id, source_file, stage, sample_size, sample_errors, sample_error_rate, approved_by").order("id", { ascending: false }).limit(100);
  if (j.error) throw dbError(j.error, "이관 작업 조회");
  const a = await db.from("digitization_audit").select("id, at, job_id, action, outcome, code, actor").order("id", { ascending: false }).limit(40);
  if (a.error) throw dbError(a.error, "이관 감사 조회");
  const r = await db.from("library_rights_log").select("id, at, item_kind, item_id, field, old_value, new_value, actor").order("id", { ascending: false }).limit(40);
  if (r.error) throw dbError(r.error, "권리 변경 기록 조회");
  return { jobs: (j.data ?? []) as DigitizeJobRow[], audit: (a.data ?? []) as DigitizeAuditRow[], rightsLog: (r.data ?? []) as LibraryBoard["rightsLog"] };
}
