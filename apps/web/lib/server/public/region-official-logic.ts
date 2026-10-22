// 지자체 허브 ⑤ 공식 자료/해설 · 지역 세금 연결 블록 · /local 전국 화면 (W4 9단계) — 순수 모듈 (시험 region-official-logic.test.ts).
// docs/dev/W4_설계.md 1장 9단계 · 2.3 · 2.8 · 12장 #25·#64~#70, PRD-01B REG1-02 · REG1-07 · REG1-10 · REG1-13 · REG-06 · REG-10:
//  · 검수 공식 자료 = 공개 지역 기사(지역 태그 + 편집 분야, 광고·금주 핫뉴스 제외)에 쓰인 공식 자료(official_doc·dataset) 중
//    대체되지 않은 판 · 자료 종류(차단 4종 밖) · 원본 스냅샷 · 카드 칸(원문 URL·발표기관·기준일·확인일·공공누리 유형) 모두 있음 (9.2 최소선 '스냅샷이 있는 것만')
//    — 같은 원문 주소는 카드 하나(그 자료를 다룬 기사를 함께), 열린 원문 검수 항목이 있으면 '검토 중' (6단계 표시 그대로)
//  · 감수 해설 = 같은 범위의 해설·가이드 중 세무 감수 표시가 살아 있는 것(article_review_marks.state = shown). ⑤는 지방세 분야 밖,
//    지역 세금 연결 블록은 지방세 분야(지방세 해설) — 같은 해설이 두 블록에 겹치지 않게 (12장 #66)
//  · 지역 세금 연결 블록 = 상황 카드(지자체뉴스·부동산 허브 줄, 상한 hub_situation_limit) · 지방세 감수 해설 ≤ 3 · SM 취득세 카드 1(기능 키 + 주소) ·
//    공식 원문 ≤ 5(검수 공식 자료의 원문 링크). 모두 0이면 블록째 0, 줄마다 0이면 줄째 숨김 (12장 #25)
//  · 3단계 자리(정비사업 현황 — ③, 조례 원문 — ⑤)는 기능 키 자리만. W4는 키가 켜져도 그릴 내용 0 (빈 블록 금지 — 12장 #24)
//  · /local 전국 화면의 시·도 카드 — 오늘 유효한 시·도, 코드 순. region_hubs가 켜졌을 때만 지역 허브 링크(꺼지면 글자만 — 404 링크 0).
//    11단계 — 칩 '시범 지역'(pilot_regions)·'색인 대상'(public_region_index)
import { BLOCKED_OFFICIAL_SOURCE_TYPES } from "@ltr/editorial";
import { isValidOn, regionHref, type RegionRouteRow } from "@/lib/site/region-route";
import { officialCard, type OfficialSourceCard, type SourceCardInput } from "@/lib/site/source-cards";
import type { ArticleListItem } from "./cards";
import type { FeatureKey } from "./constants";
import type { OfficialLinkCard } from "./calc";
import { sidoIsPilot } from "./region-index-logic";
import { hubSituationCards, type SituationCard } from "./situation-logic";
import type { SituationRow } from "./rows";

/** 설계 2.3 한도 + 읽기 범위 */
export const REGION_OFFICIAL_LIMITS = {
  /** ⑤ 공식 자료 카드 */
  officialCards: 6,
  /** ⑤ 감수 해설 */
  explainers: 3,
  /** 지역 세금 연결 블록 — 지방세 감수 해설 */
  taxExplainers: 3,
  /** 지역 세금 연결 블록 — 공식 원문 */
  originals: 5,
  /** 카드 한 장의 '이 자료를 다룬 기사' */
  cardArticles: 3,
  /** 공식 자료를 찾는 최근 지역 기사 수 */
  articlePool: 50,
  /** 감수 표시를 보는 최근 해설·가이드 수 */
  explainerPool: 30,
} as const;

/** 감수 해설 기사 유형 (REG1-02 '감수 해설(explainer·guide)') */
export const REVIEWED_EXPLAINER_TYPES = ["explainer", "guide"] as const;
/** 지역 기사 목록에 드는 기사 유형 — 자체 기사(광고·금주 핫뉴스 제외, REG1-10) */
export const REGIONAL_ARTICLE_TYPES = ["reported_news", "explainer", "guide", "opinion"] as const;
const OFFICIAL_KINDS = new Set(["official_doc", "dataset"]);
const BLOCKED = new Set<string>(BLOCKED_OFFICIAL_SOURCE_TYPES);

/** 공개 출처 행 + 판 사슬·스냅샷 칸 */
export interface RegionSourceRow extends SourceCardInput {
  article_id: number;
  snapshot_id: number | null;
  supersedes_id: number | null;
}

export interface CardArticle {
  id: number;
  title: string;
  href: string;
}

export interface RegionOfficialCard extends OfficialSourceCard {
  /** 이 자료를 다룬 공개 지역 기사 — 해석은 기사에서 (원문 카드에 본문 글자 0) */
  articles: CardArticle[];
}

const filled = (v: string | null | undefined): v is string => typeof v === "string" && v.trim() !== "";

/** 검수 공식 자료 행인가 — 대체 여부는 따로 본다 */
export function isVerifiedOfficial(row: RegionSourceRow): boolean {
  if (!OFFICIAL_KINDS.has(row.kind) || row.snapshot_id === null || row.snapshot_id === undefined) return false;
  if (!filled(row.source_type) || BLOCKED.has(row.source_type.trim())) return false;
  return officialCard(row) !== null;
}

/** 다른 행이 대체한 판의 번호 */
export function supersededIds(rows: readonly Pick<RegionSourceRow, "supersedes_id">[]): Set<number> {
  return new Set(rows.flatMap((r) => (r.supersedes_id === null || r.supersedes_id === undefined ? [] : [Number(r.supersedes_id)])));
}

/**
 * 검수 공식 자료 카드 — 같은 원문 주소는 한 장(가장 최근 확인한 행), 다룬 기사는 함께(카드마다 3건까지). 최근 확인 순.
 * articles = 공개 지역 기사(번호 → 제목·주소) — 여기 없는 기사의 출처는 0 (비공개·다른 지역 0)
 */
export function regionOfficialCards(rows: readonly RegionSourceRow[], articles: ReadonlyMap<number, CardArticle>, reviewing: ReadonlySet<number>): RegionOfficialCard[] {
  const superseded = supersededIds(rows);
  const ordered = [...rows].sort((a, b) => (b.last_verified_at ?? "").localeCompare(a.last_verified_at ?? "") || Number(b.id) - Number(a.id));
  const byUrl = new Map<string, RegionOfficialCard>();
  for (const r of ordered) {
    const article = articles.get(Number(r.article_id));
    if (!article || superseded.has(Number(r.id)) || !isVerifiedOfficial(r)) continue;
    const card = officialCard({ ...r, under_review: reviewing.has(Number(r.id)) });
    if (!card) continue;
    const seen = byUrl.get(card.href);
    if (seen) {
      if (card.underReview) seen.underReview = true;
      if (!seen.articles.some((a) => a.id === article.id) && seen.articles.length < REGION_OFFICIAL_LIMITS.cardArticles) seen.articles.push(article);
      continue;
    }
    byUrl.set(card.href, { ...card, articles: [article] });
  }
  return [...byUrl.values()];
}

/** 출처 이름 — 발표기관 둘까지는 그대로, 셋 이상은 "○○·○○ 외 N곳" */
export function issuerSummary(cards: readonly Pick<OfficialSourceCard, "issuer">[]): string {
  const names = [...new Set(cards.map((c) => c.issuer.trim()).filter(Boolean))];
  if (names.length <= 2) return names.join("·");
  return `${names.slice(0, 2).join("·")} 외 ${names.length - 2}곳`;
}

/** 감수 해설 — 해설·가이드 + 편집 분야 + 감수 표시 살아 있음. scope official = 지방세 분야 밖(⑤), tax = 지방세 분야(세금 연결 블록) */
export function reviewedExplainers(items: readonly ArticleListItem[], shown: ReadonlySet<number>, scope: "official" | "tax", limit: number): ArticleListItem[] {
  return items
    .filter(
      (a) =>
        (REVIEWED_EXPLAINER_TYPES as readonly string[]).includes(a.contentType ?? "") &&
        a.editorialField !== null &&
        shown.has(a.id) &&
        (scope === "tax" ? a.section === "tax" : a.section !== "tax"),
    )
    .slice(0, limit);
}

export interface RegionalOfficial {
  /** ⑤ 공식 자료 카드 (≤ 6) */
  cards: RegionOfficialCard[];
  /** ⑤ 감수 해설 (≤ 3) */
  explainers: ArticleListItem[];
  /** 세금 연결 블록 공식 원문 — 같은 검수 자료의 원문 링크 (≤ 5) */
  originals: RegionOfficialCard[];
  /** 세금 연결 블록 지방세 감수 해설 (≤ 3) */
  taxExplainers: ArticleListItem[];
}

/** 읽은 행 → ⑤·세금 연결 블록 값 */
export function regionalOfficial(input: {
  sources: readonly RegionSourceRow[];
  articles: ReadonlyMap<number, CardArticle>;
  reviewing: ReadonlySet<number>;
  explainerPool: readonly ArticleListItem[];
  shown: ReadonlySet<number>;
}): RegionalOfficial {
  const all = regionOfficialCards(input.sources, input.articles, input.reviewing);
  return {
    cards: all.slice(0, REGION_OFFICIAL_LIMITS.officialCards),
    explainers: reviewedExplainers(input.explainerPool, input.shown, "official", REGION_OFFICIAL_LIMITS.explainers),
    originals: all.slice(0, REGION_OFFICIAL_LIMITS.originals),
    taxExplainers: reviewedExplainers(input.explainerPool, input.shown, "tax", REGION_OFFICIAL_LIMITS.taxExplainers),
  };
}

export const EMPTY_REGIONAL_OFFICIAL: RegionalOfficial = { cards: [], explainers: [], originals: [], taxExplainers: [] };

// ── 지역 세금 연결 블록 ─────────────────────────────

/** 블록 글자 (PRD-01B 화면 '이 지역의 세금 상황·도구') */
export const REGION_TAX_LINKS_TITLE = "이 지역의 세금 상황·도구";
/** 상황 카드를 가져오는 허브 줄 — 지자체뉴스 먼저, 다음 부동산 (12장 #25) */
export const TAX_LINK_SITUATION_SECTIONS = ["local", "realestate"] as const;
/** SM 계산기 카드 키 — 취득세 (12장 #25 'SM 취득세 카드') */
export const TAX_LINK_SM_KEY = "acquisition";

export interface RegionOriginalLink {
  id: number;
  label: string;
  issuer: string;
  typeLabel: string;
  href: string;
  underReview: boolean;
}

export interface RegionTaxLinksView {
  situations: SituationCard[];
  explainers: ArticleListItem[];
  sm: { card: OfficialLinkCard; fallbacks: OfficialLinkCard[] } | null;
  originals: RegionOriginalLink[];
}

/** 상황 카드 — 지자체뉴스 허브 줄 → 부동산 허브 줄 순, 같은 상황 한 번, 상한까지 */
export function taxLinkSituations(rows: readonly SituationRow[], limit: number): SituationCard[] {
  const seen = new Set<string>();
  return TAX_LINK_SITUATION_SECTIONS.flatMap((s) => hubSituationCards(rows, s, limit))
    .filter((c) => (seen.has(c.slug) ? false : (seen.add(c.slug), true)))
    .slice(0, limit);
}

/** 지역 세금 연결 블록 — 줄마다 0이면 줄 숨김, 모두 0이면 null(블록째 0) */
export function regionTaxLinks(input: {
  situations: readonly SituationRow[];
  situationLimit: number;
  official: RegionalOfficial;
  sm: { card: OfficialLinkCard; fallbacks: OfficialLinkCard[] } | null;
}): RegionTaxLinksView | null {
  const view: RegionTaxLinksView = {
    situations: taxLinkSituations(input.situations, input.situationLimit),
    explainers: input.official.taxExplainers.slice(0, REGION_OFFICIAL_LIMITS.taxExplainers),
    sm: input.sm,
    originals: input.official.originals.slice(0, REGION_OFFICIAL_LIMITS.originals).map((c) => ({ id: c.id, label: c.title, issuer: c.issuer, typeLabel: c.typeLabel, href: c.href, underReview: c.underReview })),
  };
  return view.situations.length || view.explainers.length || view.sm || view.originals.length ? view : null;
}

// ── 3단계 자리 ─────────────────────────────

/** 3단계(PRD-03) 자리 — 블록과 기능 키. W4는 자리만(키가 켜져도 내용 0 — 12장 #24) */
export const STAGE3_SLOTS = [
  { block: "realestate", feature: "redevelopment_status", label: "정비사업 현황" },
  { block: "official", feature: "ordinance_texts", label: "조례 원문" },
] as const satisfies ReadonlyArray<{ block: string; feature: FeatureKey; label: string }>;

/** 켜진 3단계 자리 — W4는 자리만 알고 그릴 내용은 없다(빈 블록·'준비 중' 0). 3단계(PRD-03)가 이 자리에 내용 읽기를 붙인다 */
export function openStage3Slots(features: Readonly<Partial<Record<FeatureKey, boolean>>>): (typeof STAGE3_SLOTS)[number][] {
  return STAGE3_SLOTS.filter((s) => features[s.feature] === true);
}

// ── /local 전국 화면 ─────────────────────────────

export interface SidoCard {
  code: string;
  name: string;
  /** 지역 허브 주소 — region_hubs가 꺼졌으면 null(글자만) */
  href: string | null;
  /** '시범 지역' 칩 (W4 11단계 — 설정 pilot_regions: 그 시·도 또는 그 아래 시·군·구) */
  pilot: boolean;
  /** '색인 대상' 칩 (W4 11단계 — 사이트맵 원본 public_region_index에 그 시·도가 있음 = 최소선 이상) */
  indexed: boolean;
}

/** 시·도 카드 — 오늘 유효한 시·도, 코드 순. 칩 재료(시범 지역·색인 대상)는 11단계 */
export function sidoCards(
  regions: readonly RegionRouteRow[],
  today: string,
  hubsOpen: boolean,
  marks: { pilots?: readonly string[]; indexed?: ReadonlySet<string> } = {},
): SidoCard[] {
  const pilots = marks.pilots ?? [];
  return regions
    .filter((r) => r.level === "sido" && isValidOn(r, today))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((r) => ({ code: r.code, name: r.name, href: hubsOpen ? regionHref(r.slug) : null, pilot: sidoIsPilot(r.code, pilots), indexed: marks.indexed?.has(r.code) ?? false }));
}
