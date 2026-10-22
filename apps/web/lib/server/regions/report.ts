import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePilotRegions, pilotReport, type PilotReport, type RegionIndexRow } from "@/lib/server/public/region-index-logic";
import { dbError } from "../http";

// 시범 지역 최소선 판정 리포트 읽기 (W4 11단계 — PRD-01B 9.2 · REG-09 · REG1-12, docs/dev/W4_설계.md 1장 11단계 · 5장 관리자 `/admin/regions`)
//  · 뷰 region_index_status(…46 — service_role만) 전체 + 설정 pilot_regions·region_index_threshold → 시범 지역마다 자체 취재 수·공식 자료 수와 최소선, 시·도 분포
//  · 판정은 DB가 렌더 때 계산한다 — 기사 보류·공식 자료 대체·임계값 변경이 다음 읽기부터 그대로 보인다(캐시 0)
// 관리 API(GET /api/admin/regions?view=report)와 관리 화면(/admin/regions/report)이 같은 함수를 쓴다.

export const REPORT_COLUMNS =
  "code, level, parent_code, name, path, current, pilot, own_reported, official_sources, min_reported, min_official, reported_ok, official_ok, indexable, last_published_at";

export async function loadRegionIndexReport(db: SupabaseClient): Promise<PilotReport> {
  const [rows, settings] = await Promise.all([
    db.from("region_index_status").select(REPORT_COLUMNS).order("code"),
    db.from("settings").select("key, value").in("key", ["pilot_regions", "region_index_threshold"]),
  ]);
  if (rows.error) throw dbError(rows.error, "region_index_status 읽기");
  if (settings.error) throw dbError(settings.error, "settings 읽기");
  const value = (key: string) => ((settings.data ?? []) as { key: string; value: unknown }[]).find((s) => s.key === key)?.value;
  return pilotReport(parsePilotRegions(value("pilot_regions")), (rows.data ?? []) as RegionIndexRow[], value("region_index_threshold"));
}
