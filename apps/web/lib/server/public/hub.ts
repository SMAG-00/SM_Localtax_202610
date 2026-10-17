import "server-only";
import type { ArticleListItem } from "./cards";
import { listedCategories } from "./chrome-logic";
import { LIMITS, SECTION_INFO, SECTION_KEYS, categoryHref, type SectionKey } from "./constants";
import { publicDb, rowsOf } from "./db";
import { readArticleList, readCategories, readCategoryCounts, readPublicSettings } from "./reads";
import { GLOSSARY_COLUMNS, SITUATION_COLUMNS, num, type GlossaryRow, type PublicCategoryRow, type SituationRow } from "./rows";
import { hubSituationCards, type SituationCard } from "./situation-logic";

// 4대 분야 허브 공통 골격 (CAT-02 · UX-05) · 하위 분야 목록 · 뉴스 전체 — 네 허브가 같은 모양의 값을 받는다.
// 분야 지방세 포인트(01B CORE-02 — W3)·분야 고유 블록(01B)·상담 사례 HOT(W2-c)은 그 작업에서 더한다.

export interface HubTab {
  slug: string;
  name: string;
  href: string;
}

export interface HubData {
  section: SectionKey;
  name: string;
  eyebrow: string;
  href: string;
  /** 한 줄 소개 (settings.hub_intros) — 없으면 null */
  intro: string | null;
  /** 하위 분야 탭 — 공개 분야 중 목록 기사가 있는 것만 (CAT-02) */
  tabs: HubTab[];
  latest: ArticleListItem[];
  /** 상황 카드 줄 — 0장이면 빈 목록(줄 숨김, UX-05) */
  situations: SituationCard[];
  /** 관련 용어 칩 */
  terms: { id: number; term: string; plain: string | null }[];
  /** 분야 지방세 포인트 (01B CORE-02) — W3 전에는 null */
  taxPoint: null;
}

function tabsOf(categories: readonly PublicCategoryRow[], counts: ReadonlyMap<number, number>, section: SectionKey): HubTab[] {
  // 지자체뉴스 하위 경로는 01B가 정한다 (설계 7장) — 허브 탭도 3단계에서
  if (section === "local") return [];
  return listedCategories(categories, counts, section).map((c) => ({ slug: c.slug, name: c.name, href: categoryHref(section, c.slug) }));
}

export async function getHubData(section: SectionKey): Promise<HubData> {
  const db = publicDb();
  const [settings, categories, counts, latest, situations, terms] = await Promise.all([
    readPublicSettings(),
    readCategories(),
    readCategoryCounts(),
    readArticleList(db, { section, limit: LIMITS.hubLatest }),
    rowsOf<SituationRow>(db.from("situations").select(SITUATION_COLUMNS).eq("section", section).not("hub_slot", "is", null).order("hub_slot"), "허브 상황 카드"),
    rowsOf<GlossaryRow>(db.from("glossary_terms").select(GLOSSARY_COLUMNS).contains("section", [section]).order("term").limit(LIMITS.hubTerms), "관련 용어"),
  ]);
  return {
    section,
    name: SECTION_INFO[section].name,
    eyebrow: SECTION_INFO[section].eyebrow,
    href: SECTION_INFO[section].href,
    intro: settings.hubIntros[section] ?? null,
    tabs: tabsOf(categories, counts, section),
    latest: latest.items,
    situations: hubSituationCards(situations, section, settings.hubSituationLimit),
    terms: terms.map((t) => ({ id: num(t.id), term: t.term, plain: t.plain })),
    taxPoint: null,
  };
}

export interface CategoryListData {
  section: SectionKey;
  category: { id: number; slug: string; name: string; intro: string | null; needsDisclaimer: boolean };
  items: ArticleListItem[];
  page: number;
  total: number;
  hasMore: boolean;
  /** 기사 0건 — 상위 허브 안내 + noindex (CAT-02 '빈 목록 색인 0') */
  noindex: boolean;
  hubHref: string;
}

/** 하위 분야 목록 — 공개 분야가 아니면 null (404). 지자체뉴스(local)는 01B 경로라 null */
export async function getCategoryList(section: SectionKey, slug: string, page = 1): Promise<CategoryListData | null> {
  if (section === "local") return null;
  const category = (await readCategories()).find((c) => c.section === section && c.slug === slug);
  if (!category) return null;
  const current = Number.isInteger(page) && page >= 1 ? page : 1;
  const { items, total } = await readArticleList(publicDb(), { section, categoryId: num(category.id), limit: LIMITS.pageSize, offset: (current - 1) * LIMITS.pageSize, count: true });
  return {
    section,
    category: { id: num(category.id), slug: category.slug, name: category.name, intro: category.intro, needsDisclaimer: category.needs_disclaimer },
    items,
    page: current,
    total,
    hasMore: current * LIMITS.pageSize < total,
    noindex: total === 0,
    hubHref: SECTION_INFO[section].href,
  };
}

export interface NewsListData {
  /** 허브 탭 4개 — 고른 탭은 section */
  tabs: { key: SectionKey; name: string; href: string }[];
  section: SectionKey | null;
  items: ArticleListItem[];
  page: number;
  total: number;
  hasMore: boolean;
}

/** 뉴스 전체 — 편집 승인된 취재 기사(reported_news)만 (CAT-02 · LG-04 — 해설·칼럼·광고·금주 핫뉴스 0) */
export async function getNewsList({ section = null, page = 1 }: { section?: SectionKey | null; page?: number } = {}): Promise<NewsListData> {
  const current = Number.isInteger(page) && page >= 1 ? page : 1;
  const { items, total } = await readArticleList(publicDb(), {
    ...(section ? { section } : {}),
    contentType: "reported_news",
    reportedApproved: true,
    limit: LIMITS.pageSize,
    offset: (current - 1) * LIMITS.pageSize,
    count: true,
  });
  return {
    tabs: SECTION_KEYS.map((key) => ({ key, name: SECTION_INFO[key].name, href: `/news?section=${key}` })),
    section,
    items: items.filter((a) => a.contentType === "reported_news" && a.reportedApproved),
    page: current,
    total,
    hasMore: current * LIMITS.pageSize < total,
  };
}
