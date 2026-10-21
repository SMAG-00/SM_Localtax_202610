// 홈 섹션 순서·내용 규칙 (HOME-01 · HOME-03 · HOME-04) — 순수 함수 (시험 home-logic.test.ts)
//  · 섹션 순서는 설계 2.3 home_sections 고정, 내용이 0건인 섹션은 빼고 돌려준다 (빈 카드·'준비 중' 0)
//  · 트래커 하이라이트: 오늘 노출 중인 지정(순서) → 지정이 0건이면 현재 단계가 가장 최근에 바뀐 공개 트래커 1건 → 공개 트래커가 없으면 섹션 숨김
//  · 해설 스토리: 지정(순서, 6장까지) → 3장 미만이면 최신 해설(explainer)로 3장까지 (지정과 겹침 0)
//  · 노출 기간이 끝난 카드는 DB(RLS)가 0행으로 주지만 여기서도 한국 날짜로 다시 거른다
import { amendmentHref, HOME_SECTION_KEYS, LIMITS, SECTION_INFO, SECTION_KEYS, type Features, type HomeSectionKey, type SectionKey } from "./constants";
import type { SignatureHomeItem } from "./signature-logic";
import type { ArticleListItem, TrackerSource, TrackerState } from "./cards";
import type { CurationRow } from "./rows";

/** 오늘(한국 날짜 YYYY-MM-DD) 보이는 배치 — 순서(sort), 같으면 번호 */
export function activeCurations(rows: readonly CurationRow[], kind: "tracker" | "story", today: string): CurationRow[] {
  return rows
    .filter((r) => r.kind === kind && r.starts_on <= today && (r.ends_on === null || r.ends_on >= today))
    .sort((a, b) => a.sort - b.sort || Number(a.id) - Number(b.id));
}

export interface TrackerCard {
  id: number;
  slug: string;
  title: string;
  lawNames: string[];
  /** 트래커 페이지 — 01B W3 전(기능 키 amendments 꺼짐)에는 null (빈 링크 0) */
  href: string | null;
  stage: TrackerState;
  /** 편집자 지정(true) · 자동 채움(false) */
  designated: boolean;
}

export interface StoryCard {
  id: number;
  slug: string;
  href: string;
  title: string;
  summary: string;
  section: SectionKey;
  sectionName: string;
  /** 하위 분야 이름 (분야 칩 "지방세 › 해석") */
  subsection: string | null;
  contentType: string | null;
  typeLabel: string | null;
  /** 형식 배지 — 일반 기사는 null (HOME-03) */
  format: string | null;
  sponsorBadge: string | null;
  /** 최초 발행일 (한국 날짜) · 기자 이름 · 지역 — 기사 카드 (PRD-00 8.6) */
  publishedOn: string;
  authorName: string | null;
  regionLabel: string | null;
  designated: boolean;
}

function trackerCard(src: TrackerSource, designated: boolean, features: Features): TrackerCard {
  return {
    id: Number(src.amendment.id),
    slug: src.amendment.slug,
    title: src.amendment.title,
    lawNames: src.amendment.law_names ?? [],
    href: features.amendments ? amendmentHref(src.amendment.slug) : null,
    stage: src.state,
    designated,
  };
}

/** 트래커 하이라이트 1~3건 — sources는 읽을 수 있는(공개) 트래커만 들어 있다 */
export function pickTrackers(
  designated: readonly CurationRow[],
  sources: ReadonlyMap<number, TrackerSource>,
  fallback: TrackerSource | null,
  features: Features,
): { items: TrackerCard[]; source: "designated" | "fallback" | "none" } {
  const picked: TrackerCard[] = [];
  for (const c of designated) {
    const src = c.amendment_id === null ? undefined : sources.get(Number(c.amendment_id));
    if (src && !picked.some((p) => p.id === Number(src.amendment.id))) picked.push(trackerCard(src, true, features));
    if (picked.length === LIMITS.trackers) break;
  }
  if (picked.length > 0) return { items: picked, source: "designated" };
  if (fallback) return { items: [trackerCard(fallback, false, features)], source: "fallback" };
  return { items: [], source: "none" };
}

const storyable = (a: ArticleListItem) => a.contentType !== "sponsored" && a.contentType !== "digest" && a.contentType !== null;

function storyCard(a: ArticleListItem, designated: boolean): StoryCard {
  return {
    id: a.id,
    slug: a.slug,
    href: a.href,
    title: a.title,
    summary: a.summary,
    section: a.section,
    sectionName: a.sectionName,
    subsection: a.subsection,
    contentType: a.contentType,
    typeLabel: a.typeLabel,
    format: a.format,
    sponsorBadge: a.sponsorBadge,
    publishedOn: a.publishedOn,
    authorName: a.authorName,
    regionLabel: a.regionLabel,
    designated,
  };
}

/** 해설 스토리 3~6장 — articles는 읽을 수 있는 기사, explainers는 최신 해설(최신순) */
export function pickStories(designated: readonly CurationRow[], articles: ReadonlyMap<number, ArticleListItem>, explainers: readonly ArticleListItem[]): StoryCard[] {
  const out: StoryCard[] = [];
  for (const c of designated) {
    const a = c.article_id === null ? undefined : articles.get(Number(c.article_id));
    if (a && storyable(a) && !out.some((s) => s.id === a.id)) out.push(storyCard(a, true));
    if (out.length === LIMITS.storiesMax) return out;
  }
  for (const a of explainers) {
    if (out.length >= LIMITS.storiesMin) break;
    if (a.contentType === "explainer" && !out.some((s) => s.id === a.id)) out.push(storyCard(a, false));
  }
  return out;
}

// ── 섹션 ───────────────────────────────────────────────

export interface HeroSection {
  key: "hero";
  coreMessage: string | null;
  /**
   * 통합 검색 폼 (HOME-01 — 4단계 이후에도 통합 검색). 검색 화면(/search, W2-d)이 공개되기 전(기능 키 search 꺼짐)에는 null —
   * 없는 화면으로 가는 폼·칩을 두지 않는다 (HOME-02 빈 링크 0, 설계 9장 #18)
   */
  search: { action: "/search"; chips: string[] } | null;
}
export interface FieldsSection {
  key: "fields";
  /** 4대 분야 카드 정확히 4장 — 이 순서 (HOME-01) */
  cards: { section: SectionKey; name: string; href: string }[];
  /** 카드마다 '이 분야의 지방세 포인트' 한 줄 (CORE-02 — 감수 서명이 있는 분야의 첫 줄만, W3 9단계) */
  points: Partial<Record<SectionKey, string>>;
}
export interface LatestReportsSection {
  key: "latest_reports";
  items: ArticleListItem[];
}
/** 금주 핫뉴스 (01B LG-01·02 — W6). 주간 페이지와 항목(편집자 요약·원문·출처) */
export interface WeeklyHotSection {
  key: "weekly_hot";
  weekHref: string;
  items: { title: string; summary: string; sourceUrl: string; issuer: string; publishedOn: string }[];
}
export interface AmendmentsSection {
  key: "amendments";
  trackers: TrackerCard[];
  stories: StoryCard[];
  trackerSource: "designated" | "fallback";
}
/**
 * 김의효 칼럼 (01C BR-04 — W3 8단계) — 시그니처 연재마다 가장 큰 공개 회차 1편(연재 제목·회차·근거 링크와 함께). 기능 키 tax_columns가 꺼졌거나
 * 회차가 0이면 섹션째 없다(빈 카드 0). 자사 상품 카드 1개 (01C BIZ-03) · 분야별 전문가 소개 (01C EXPL-01)는 01C 작업에서 채운다
 */
export interface ColumnSection {
  key: "column";
  items: SignatureHomeItem[];
}
export interface ProductSection {
  key: "product";
  product: { title: string; href: string; summary: string };
}
export interface ExpertsSection {
  key: "experts";
  items: { name: string; href: string; field: string }[];
}

export type HomeSection = HeroSection | FieldsSection | LatestReportsSection | WeeklyHotSection | AmendmentsSection | ColumnSection | ProductSection | ExpertsSection;

export interface HomeInput {
  coreMessage: string | null;
  /** 4대 분야 카드의 포인트 한 줄 (감수된 분야만) — 없으면 줄 없음 */
  fieldPoints?: Partial<Record<SectionKey, string>>;
  /** 검색 화면 공개 여부 (기능 키 search) */
  searchEnabled: boolean;
  searchChips: string[];
  latestReports: readonly ArticleListItem[];
  weeklyHot: WeeklyHotSection | null;
  trackers: { items: TrackerCard[]; source: "designated" | "fallback" | "none" };
  stories: StoryCard[];
  column: ColumnSection | null;
  product: ProductSection | null;
  experts: ExpertsSection | null;
}

/** 최신 자체 취재 — 편집 승인된 reported_news만, 최신 발행 순, 5건 (HOME-04) */
export function latestReports(items: readonly ArticleListItem[]): ArticleListItem[] {
  return items
    .filter((a) => a.contentType === "reported_news" && a.reportedApproved)
    .sort((a, b) => Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? "") || b.id - a.id)
    .slice(0, LIMITS.homeLatestReports);
}

/** 섹션 목록 — 설계 2.3 순서, 내용 0건이면 뺀다 */
export function homeSections(input: HomeInput): HomeSection[] {
  const byKey: Record<HomeSectionKey, HomeSection | null> = {
    // 핵심 메시지도 검색 폼도 없으면 히어로째 뺀다 (빈 섹션 0)
    hero:
      input.coreMessage || input.searchEnabled
        ? { key: "hero", coreMessage: input.coreMessage, search: input.searchEnabled ? { action: "/search", chips: input.searchChips } : null }
        : null,
    fields: { key: "fields", cards: SECTION_KEYS.map((s) => ({ section: s, name: SECTION_INFO[s].name, href: SECTION_INFO[s].href })), points: { ...(input.fieldPoints ?? {}) } },
    latest_reports: input.latestReports.length ? { key: "latest_reports", items: input.latestReports.slice(0, LIMITS.homeLatestReports) } : null,
    weekly_hot: input.weeklyHot && input.weeklyHot.items.length ? input.weeklyHot : null,
    // 공개 트래커가 없으면 섹션째 숨긴다 — 스토리 카드만 남기지 않는다 (HOME-03)
    amendments:
      input.trackers.items.length && input.trackers.source !== "none"
        ? { key: "amendments", trackers: input.trackers.items, stories: input.stories, trackerSource: input.trackers.source }
        : null,
    column: input.column && input.column.items.length ? input.column : null,
    product: input.product,
    experts: input.experts && input.experts.items.length ? input.experts : null,
  };
  return HOME_SECTION_KEYS.flatMap((k) => (byKey[k] ? [byKey[k]!] : []));
}

/** 닫힌 홈 — 공개 데이터를 읽지 못할 때(DB 연결 실패). DB가 필요 없는 4대 분야 카드만 (핵심 메시지·검색 폼·목록 0 — 닫힌 쪽, 설계 2.4) */
export function closedHomeSections(): HomeSection[] {
  return homeSections({
    coreMessage: null,
    searchEnabled: false,
    searchChips: [],
    latestReports: [],
    weeklyHot: null,
    trackers: { items: [], source: "none" },
    stories: [],
    column: null,
    product: null,
    experts: null,
  });
}
