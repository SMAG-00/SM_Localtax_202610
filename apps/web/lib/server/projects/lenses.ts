import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LENS_COLUMNS, type StageLensRow } from "@/lib/admin/project-lens-rules";
import { dbError } from "@/lib/server/http";

// 단계별 「지방세로 읽기」 템플릿 읽기 (W4 16단계 — 관리 화면·API, service_role). 공개 화면은 공개 뷰 public_project_stage_lenses만 읽는다(lib/server/public/projects.ts).

/** 템플릿 전부(또는 한 사업 유형) — 유형·단계 차례 */
export async function loadLensRows(db: SupabaseClient, type?: string): Promise<StageLensRow[]> {
  let q = db.from("project_stage_lenses").select(LENS_COLUMNS).order("project_type").order("stage");
  if (type) q = q.eq("project_type", type);
  const { data, error } = await q;
  if (error) throw dbError(error, "project_stage_lenses 읽기");
  return (data ?? []) as StageLensRow[];
}

/** 템플릿 하나 */
export async function loadLensRow(db: SupabaseClient, type: string, stage: string): Promise<StageLensRow | null> {
  const { data, error } = await db.from("project_stage_lenses").select(LENS_COLUMNS).eq("project_type", type).eq("stage", stage).maybeSingle();
  if (error) throw dbError(error, "project_stage_lenses 하나");
  return (data as StageLensRow | null) ?? null;
}
