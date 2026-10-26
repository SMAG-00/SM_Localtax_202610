import { isoToKstDate } from "@/lib/admin/form-utils";

// 지자체 허브 3단계 블록 규칙 (W11-e e5 - PRD-03 RDV-07 ③ 정비 현황 · RDV-06/TX-13 ⑤ 조례). 순수 함수 - DB를 읽지 않는다.
//  · 항목이 0이면 블록 자체가 null (빈 상자 0, '준비 중' 0)
//  · 출처·시행일·확인일 중 하나라도 없는 항목은 방어적으로 한 번 더 뺀다 (뷰가 이미 거른 것)
//  · 조례는 원문 상자(articles)와 편집 요약 상자(summary)를 나눈다. 서명 안 된 요약은 상자 0
//  · 지도·좌표·가격 칸 없음. 시험용 자료 외에 실제 조례 문장·세율을 코드에 두지 않는다

export const ZONE_BLOCK_DISCLAIMER = "이 목록은 공개 고시를 모아 보여 주는 것이며 투자 권유나 사업 추천이 아닙니다.";

export interface ZoneRow {
  project_id: number;
  slug: string;
  name: string;
  region_code: string;
  project_type: string;
  current_stage_label: string | null;
  designation_notice_date: string | null;
  operator_name: string | null;
  source_name: string | null;
  source_url: string | null;
  verified_at: string | null;
  stale: boolean | null;
}

export interface ZoneItem {
  slug: string;
  name: string;
  projectType: string;
  typeLabel: string | null;
  stageLabel: string | null;
  designationDate: string | null;
  operator: string | null;
  sourceName: string;
  sourceUrl: string;
  verifiedOn: string;
  stale: boolean;
}

export interface ZoneBlockView {
  items: ZoneItem[];
  disclaimer: string;
}

/** 정비 현황 블록 - 이 허브 지역(시·도면 그 아래 시·군·구 포함)의 공개 구역. 0건이면 null */
export function zoneBlock(rows: readonly ZoneRow[], regionCodes: readonly string[], typeLabels: Readonly<Record<string, string>> = {}): ZoneBlockView | null {
  const codes = new Set(regionCodes);
  const items: ZoneItem[] = rows
    .filter((r) => codes.has(r.region_code) && r.source_name && r.source_url && r.verified_at)
    .sort((a, b) => a.region_code.localeCompare(b.region_code) || a.name.localeCompare(b.name, "ko"))
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      projectType: r.project_type,
      typeLabel: typeLabels[r.project_type] ?? null,
      stageLabel: r.current_stage_label,
      designationDate: r.designation_notice_date,
      operator: r.operator_name,
      sourceName: r.source_name as string,
      sourceUrl: r.source_url as string,
      verifiedOn: isoToKstDate(r.verified_at as string),
      stale: r.stale === true,
    }));
  return items.length ? { items, disclaimer: ZONE_BLOCK_DISCLAIMER } : null;
}

export type OrdinanceKindKey = "urban_redevelopment" | "tax_reduction" | "tax_rate";

export interface OrdinanceRow {
  id: number;
  region_code: string;
  region_level: string;
  kind: OrdinanceKindKey;
  ordinance_name: string;
  effective_from: string | null;
  verified_at: string | null;
  source_url: string | null;
  summary: string | null;
  summary_signed: boolean | null;
  summary_signed_at: string | null;
  stale: boolean | null;
}

export interface OrdinanceArticleRow {
  link_id: number;
  article_no: number;
  branch_no: number;
  title: string | null;
  body: string;
}

export interface OrdinanceItem {
  id: number;
  kind: OrdinanceKindKey;
  name: string;
  effectiveFrom: string;
  verifiedOn: string;
  sourceUrl: string;
  stale: boolean;
  /** 원문 상자 - 원문 DB의 조문 글자 그대로 */
  articles: { label: string; title: string | null; body: string }[];
  /** 편집 요약 상자 - 서명된 것만(감수 배지 + 기준일). 없으면 null */
  summary: { text: string; signedOn: string } | null;
}

export interface OrdinanceBlockView {
  items: OrdinanceItem[];
}

/** 허브 수준별 조례 종류 - 시·도 허브는 도시정비 조례, 시·군·구 허브는 감면·세율 조례 */
export function ordinanceKindsFor(level: "sido" | "sigungu"): OrdinanceKindKey[] {
  return level === "sido" ? ["urban_redevelopment"] : ["tax_reduction", "tax_rate"];
}

export function articleLabel(a: Pick<OrdinanceArticleRow, "article_no" | "branch_no">): string {
  return a.branch_no > 0 ? `제${a.article_no}조의${a.branch_no}` : `제${a.article_no}조`;
}

/** 조례 블록 - 이 허브 지역·수준의 공개 조례. 0건이면 null */
export function ordinanceBlock(rows: readonly OrdinanceRow[], articles: readonly OrdinanceArticleRow[], regionCode: string, level: "sido" | "sigungu"): OrdinanceBlockView | null {
  const kinds = new Set(ordinanceKindsFor(level));
  const items: OrdinanceItem[] = rows
    .filter((r) => r.region_code === regionCode && kinds.has(r.kind) && r.effective_from && r.verified_at && r.source_url)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.ordinance_name.localeCompare(b.ordinance_name, "ko"))
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.ordinance_name,
      effectiveFrom: r.effective_from as string,
      verifiedOn: isoToKstDate(r.verified_at as string),
      sourceUrl: r.source_url as string,
      stale: r.stale === true,
      articles: articles
        .filter((a) => a.link_id === r.id)
        .sort((a, b) => a.article_no - b.article_no || a.branch_no - b.branch_no)
        .map((a) => ({ label: articleLabel(a), title: a.title, body: a.body })),
      summary: r.summary_signed === true && r.summary && r.summary_signed_at ? { text: r.summary, signedOn: isoToKstDate(r.summary_signed_at) } : null,
    }));
  return items.length ? { items } : null;
}
