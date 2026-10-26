import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/server/http";

// 지방세 통계 관리 화면 자료 (W12-h h4). service_role로 읽는다 - 관리자 화면 전용.
export interface StatsRow {
  id: number;
  series_key: string;
  version: number;
  title: string;
  base_year: number;
  checked_at: string;
  source_name: string;
  status: "draft" | "approved" | "superseded" | "withdrawn";
  created_at: string;
}
export interface StatsAuditRow {
  id: number;
  at: string;
  target_id: number | null;
  action: string;
  outcome: string;
  code: string;
  actor: string;
}
export interface ChartLinkRow {
  id: number;
  article_id: number;
  series_id: number;
  base_year: number;
  series_key: string;
  /** 같은 시계열에 이 연결의 기준연도보다 새 승인 기준연도가 있으면 그 연도 (편집자가 기사를 다시 확인) */
  newer_base_year: number | null;
}
export interface StatsBoard {
  series: StatsRow[];
  links: ChartLinkRow[];
  audit: StatsAuditRow[];
}

export async function loadStatsBoard(db: SupabaseClient): Promise<StatsBoard> {
  const s = await db.from("stats_series").select("id, series_key, version, title, base_year, checked_at, source_name, status, created_at").order("id", { ascending: false }).limit(100);
  if (s.error) throw dbError(s.error, "stats_series 조회");
  const series = (s.data ?? []) as StatsRow[];
  const l = await db.from("article_data_charts").select("id, article_id, series_id, base_year").order("id", { ascending: false }).limit(100);
  if (l.error) throw dbError(l.error, "article_data_charts 조회");
  const all = await db.from("stats_series").select("id, series_key, base_year, status");
  if (all.error) throw dbError(all.error, "stats_series 기준연도 조회");
  const rows = (all.data ?? []) as { id: number; series_key: string; base_year: number; status: string }[];
  const keyOf = new Map(rows.map((r) => [r.id, r.series_key]));
  const links: ChartLinkRow[] = ((l.data ?? []) as { id: number; article_id: number; series_id: number; base_year: number }[]).map((c) => {
    const key = keyOf.get(c.series_id) ?? "";
    const newer = rows.filter((r) => r.series_key === key && r.status === "approved" && r.base_year > c.base_year).map((r) => r.base_year);
    return { ...c, series_key: key, newer_base_year: newer.length > 0 ? Math.max(...newer) : null };
  });
  const a = await db.from("stats_audit").select("id, at, target_id, action, outcome, code, actor").order("id", { ascending: false }).limit(40);
  if (a.error) throw dbError(a.error, "stats_audit 조회");
  return { series, links, audit: (a.data ?? []) as StatsAuditRow[] };
}
