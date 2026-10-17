// 시험용 행·카드 재료 — 공개 데이터 순수 함수 시험이 같이 쓴다 (화면 코드는 쓰지 않는다)
import type { ArticleListItem } from "./cards";
import type { AmendmentEventRow, CurationRow, RegionRow, SituationRow } from "./rows";

let seq = 1000;

export function listItem(over: Partial<ArticleListItem> = {}): ArticleListItem {
  const id = over.id ?? ++seq;
  const slug = over.slug ?? `article-${id}`;
  return {
    id,
    slug,
    href: `/news/${slug}`,
    title: `기사 ${id}`,
    summary: "요약",
    section: "tax",
    sectionName: "지방세",
    subsection: null,
    contentType: "explainer",
    typeLabel: "해설",
    format: null,
    sponsorBadge: null,
    sponsor: null,
    subtype: "general",
    publishedOn: "2026-10-01",
    modifiedOn: null,
    publishedAt: "2026-10-01T00:00:00Z",
    authorName: null,
    authorHref: null,
    regionLabel: null,
    regionCodes: [],
    editorialField: null,
    categoryId: null,
    amendmentId: null,
    reportedApproved: false,
    seriesTitle: null,
    seriesEpisode: null,
    ...over,
  };
}

export function curation(over: Partial<CurationRow> & Pick<CurationRow, "kind">): CurationRow {
  return { id: ++seq, amendment_id: null, article_id: null, sort: 0, starts_on: "2026-10-01", ends_on: null, ...over };
}

export function stageEvent(over: Partial<AmendmentEventRow> & Pick<AmendmentEventRow, "stage">): AmendmentEventRow {
  return {
    id: ++seq,
    amendment_id: 1,
    occurred_on: "2026-08-26",
    source_url: "https://www.mois.go.kr/a",
    skipped: false,
    skip_reason: null,
    correction_of: null,
    recorded_at: "2026-08-27T00:00:00Z",
    ...over,
  };
}

export function region(over: Partial<RegionRow> & Pick<RegionRow, "code" | "name">): RegionRow {
  return { parent_code: null, level: "sido", slug: over.code, aliases: [], valid_from: null, valid_to: null, ...over };
}

export function situationRow(over: Partial<SituationRow> = {}): SituationRow {
  const id = over.id ?? ++seq;
  return {
    id,
    slug: `situation-${id}`,
    section: "tax",
    title: "차를 팔았어요·폐차했어요",
    subtitle: "환급 받을 수 있는지 먼저 확인합니다",
    pictogram: "car-sold",
    checks: [{ title: "1" }, { title: "2" }, { title: "3" }],
    checklist: null,
    mistakes: [],
    external_link_id: null,
    article_ids: [],
    solved_case_ids: [],
    glossary_ids: [],
    tool_links: [],
    region_select: false,
    hub_slot: null,
    sort: 0,
    reviewed_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}
