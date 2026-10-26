import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// 조례 연결 관리 목록 (W11-e e6). 원문 글자는 싣지 않는다 - 연결·요약·상태·날짜만.
export interface OrdinanceBoardRow {
  id: number;
  region_code: string;
  kind: string;
  status: string;
  summary: string | null;
  summary_signed_by: string | null;
  summary_signed_at: string | null;
  effective_from: string | null;
  verified_at: string | null;
  source_url: string | null;
  origin: string;
  laws: { name: string } | null;
}

export interface OrdinancesBoard {
  links: OrdinanceBoardRow[];
  stale: { ordinance: number[]; zone: number[] };
}

export async function loadOrdinancesBoard(db: SupabaseClient, now: Date = new Date()): Promise<OrdinancesBoard> {
  const links = await db.from("ordinance_links").select("id, region_code, kind, status, summary, summary_signed_by, summary_signed_at, effective_from, verified_at, source_url, origin, laws(name)").order("region_code").order("id");
  if (links.error) throw new Error(`ordinance_links 조회 실패: ${links.error.code ?? ""} ${links.error.message}`.trim());
  const warn = await db.rpc("stale_check_warnings", { p_now: now.toISOString() });
  if (warn.error) throw new Error(`stale_check_warnings 실패: ${warn.error.code ?? ""} ${warn.error.message}`.trim());
  const rows = (warn.data ?? []) as { target: string; target_id: number }[];
  return {
    links: (links.data ?? []) as unknown as OrdinanceBoardRow[],
    stale: { ordinance: rows.filter((r) => r.target === "ordinance").map((r) => r.target_id), zone: rows.filter((r) => r.target === "zone").map((r) => r.target_id) },
  };
}
