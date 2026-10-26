import "server-only";
import { publicDb, rowsOf } from "./db";
import { readPublicSettings, readRegions } from "./reads";
import { regionArticleCodes } from "./region-logic";
import { ordinanceBlock, ordinanceKindsFor, zoneBlock, type OrdinanceArticleRow, type OrdinanceBlockView, type OrdinanceRow, type ZoneBlockView, type ZoneRow } from "./region-stage3-logic";

// 지자체 허브 3단계 블록 읽기 (W11-e e5). 공개 데이터 함수라 anon 키로 공개 뷰만 읽는다.
//  · 정비 현황(③) - 기능 키 redevelopment_status 켜짐일 때만 뷰 redevelopment_zones를 읽는다 (꺼짐이면 요청 0)
//  · 조례(⑤) - 기능 키 ordinance_texts 켜짐일 때만 뷰 public_ordinance_links·public_ordinance_articles를 읽는다
//  · 읽기가 실패하면 그 블록만 null - 허브 화면 전체를 막지 않는다. 지도·좌표 읽기 0

export interface RegionStage3 {
  zones: ZoneBlockView | null;
  ordinances: OrdinanceBlockView | null;
}

const ZONE_COLUMNS = "project_id, slug, name, region_code, project_type, current_stage_label, designation_notice_date, operator_name, source_name, source_url, verified_at, stale";
const ORDINANCE_COLUMNS = "id, region_code, region_level, kind, ordinance_name, effective_from, verified_at, source_url, summary, summary_signed, summary_signed_at, stale";

export async function getRegionStage3(regionCode: string, level: "sido" | "sigungu"): Promise<RegionStage3> {
  const out: RegionStage3 = { zones: null, ordinances: null };
  try {
    const [settings, regions] = await Promise.all([readPublicSettings(), readRegions()]);
    const features = settings.features;
    const region = regions.find((r) => r.code === regionCode);
    if (!region) return out;
    const db = publicDb();
    if (features.redevelopment_status) {
      try {
        const codes = regionArticleCodes(region, regions);
        const rows = await rowsOf<ZoneRow>(db.from("redevelopment_zones").select(ZONE_COLUMNS).in("region_code", codes).order("name"), "정비 현황");
        const ids = rows.map((r) => r.project_id);
        const labels: Record<string, string> = {};
        if (ids.length) {
          const types = await rowsOf<{ project_type: string; project_type_label: string | null }>(db.from("public_projects").select("project_type, project_type_label").in("id", ids), "정비 사업 유형 이름");
          for (const t of types) if (t.project_type_label) labels[t.project_type] = t.project_type_label;
        }
        out.zones = zoneBlock(rows, codes, labels);
      } catch {
        out.zones = null;
      }
    }
    if (features.ordinance_texts) {
      try {
        const rows = await rowsOf<OrdinanceRow>(db.from("public_ordinance_links").select(ORDINANCE_COLUMNS).eq("region_code", regionCode).in("kind", ordinanceKindsFor(level)), "조례 연결");
        const articles = rows.length
          ? await rowsOf<OrdinanceArticleRow>(db.from("public_ordinance_articles").select("link_id, article_no, branch_no, title, body").in("link_id", rows.map((r) => r.id)), "조례 원문")
          : [];
        out.ordinances = ordinanceBlock(rows, articles, regionCode, level);
      } catch {
        out.ordinances = null;
      }
    }
  } catch {
    return { zones: null, ordinances: null };
  }
  return out;
}
