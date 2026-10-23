import "server-only";
import type { LocalTopic } from "@ltr/ui";
import type { ArticleListItem } from "./cards";
import { HOT_CATEGORY, LIMITS, POLICY_LINKS, SECTION_INFO, isLocalTopic, type SectionKey } from "./constants";
import { publicDb, rowsOf } from "./db";
import { termChip } from "./glossary-logic";
import { ALL_TAB, hubTabs, localBlocks, newsTabs, pageNumber, type HubData, type HubTab } from "./hub-logic";
import { getHotBlock, type HotBlock } from "./rankings";
import { getHubTaxPoint } from "./hub-points";
import { readLocalBlockFields } from "./region-hub";
import { readArticleList, readCategories, readCategoryCounts, readPublicSettings, readRegions, readTopicCounts } from "./reads";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { sourceLineOf } from "./region-hub-logic";
import { readIndexedSidoCodes, readPilotRegions } from "./region-index";
import { readRealEstateHub } from "./realestate-hub";
import { readRegionalOfficial } from "./region-official";
import { EMPTY_REGIONAL_OFFICIAL, sidoCards } from "./region-official-logic";
import { GLOSSARY_COLUMNS, SITUATION_COLUMNS, num, type GlossaryRow, type SituationRow } from "./rows";
import { hubSituationCards } from "./situation-logic";

// 4대 분야 허브 공통 골격 (CAT-02 · UX-05) · 하위 분야 목록 · 뉴스 전체 — 네 허브가 같은 모양의 값을 받는다 (규칙은 hub-logic.ts).
// 분야 지방세 포인트(01B CORE-02 — W3 9단계)는 감수 서명이 있는 분야만(hub-points.ts). 지방세·부동산·개발금융 허브의 분야 고유 블록(01B)은 그 작업에서 더한다.
// 상담 사례 HOT(HOME-05 — W2-c 2단계)은 지방세 허브와 상담 사례 분야 목록(HOT_CATEGORY)의 첫 쪽에 둔다 (rankings.ts).
// 지자체뉴스 허브는 분야 고유 블록 자리에 LG-08 순서의 지자체 허브 블록 중 데이터가 있는 ② 지방세·지방재정 ③ 부동산·개발을 둔다.
// 블록과 편집 분야 대응은 설정 local_block_fields(W4 4단계 — 마이그레이션 …40). 읽지 못하거나 모양이 틀리면 블록 0(닫힌 쪽)
// W4 9단계 — 지자체뉴스 허브 = /local 전국 화면: 시·도 카드(region_hubs가 켜졌을 때만 링크) · ⑤ 공식 자료/해설(전국 검수 공식 자료·감수 해설 — 있을 때만) ·
// 데이터 출처 줄. 새 표·뷰는 읽지 않는다(region-official.ts — 마이그레이션 …08·…35·…41·…42 공개 읽기)
// W4 11단계 — 시·도 카드 칩 '시범 지역'(설정 pilot_regions)·'색인 대상'(뷰 public_region_index) — 마이그레이션 …46 공개 읽기

export type { HubData, HubTab } from "./hub-logic";

export async function getHubData(section: SectionKey, opts: { topic?: string | null } = {}): Promise<HubData> {
  const db = publicDb();
  const topic: LocalTopic | null = section === "local" && isLocalTopic(opts.topic) ? opts.topic : null;
  // 지자체 허브 블록 — 전체 보기에서만 (분야를 고르면 목록 하나로 좁힌다). 대응 설정을 읽은 뒤 블록마다 그 편집 분야 기사
  const localBlockReads =
    section === "local" && !topic
      ? readLocalBlockFields().then(async (fields) => {
          if (!fields) return null;
          const [tax, realEstate] = await Promise.all([
            readArticleList(db, { section, editorialFields: fields.local_tax, limit: LIMITS.localBlock }),
            readArticleList(db, { section, editorialFields: fields.realestate, limit: LIMITS.localBlock }),
          ]);
          return { fields, tax, realEstate };
        })
      : null;
  const localOfficial = section === "local" && !topic ? readRegionalOfficial(null) : null;
  const [settings, categories, counts, topicCounts, latest, situations, terms, blockReads, hot, taxPoint, official, regions, pilots, indexedSido, estate] = await Promise.all([
    readPublicSettings(),
    readCategories(),
    readCategoryCounts(),
    readTopicCounts(),
    readArticleList(db, { section, ...(topic ? { editorialFields: [topic] } : {}), limit: LIMITS.hubLatest }),
    rowsOf<SituationRow>(db.from("situations").select(SITUATION_COLUMNS).eq("section", section).not("hub_slot", "is", null).order("hub_slot"), "허브 상황 카드"),
    rowsOf<GlossaryRow>(db.from("glossary_terms").select(GLOSSARY_COLUMNS).contains("section", [section]).order("term").limit(LIMITS.hubTerms), "관련 용어"),
    localBlockReads,
    section === HOT_CATEGORY.section ? getHotBlock() : null,
    getHubTaxPoint(section),
    localOfficial,
    section === "local" && !topic ? readRegions() : null,
    section === "local" && !topic ? readPilotRegions() : null,
    section === "local" && !topic ? readIndexedSidoCodes() : null,
    section === "realestate" ? readRealEstateHub() : null,
  ]);
  const blocks =
    section === "local" && !topic
      ? localBlocks(blockReads?.fields ?? null, blockReads?.tax.items ?? [], blockReads?.realEstate.items ?? [], official ?? EMPTY_REGIONAL_OFFICIAL)
      : null;
  return {
    section,
    name: SECTION_INFO[section].name,
    eyebrow: SECTION_INFO[section].eyebrow,
    href: SECTION_INFO[section].href,
    intro: settings.hubIntros[section] ?? null,
    tabs: hubTabs(section, categories, counts, topicCounts),
    currentTab: topic ?? ALL_TAB,
    topic,
    blocks,
    latest: latest.items,
    hot,
    situations: hubSituationCards(situations, section, settings.hubSituationLimit),
    terms: terms.map((t) => termChip(t, settings.features)),
    taxPoint,
    estate,
    noindex: topic !== null && latest.items.length === 0,
    local:
      section === "local"
        ? {
            sido: regions
              ? sidoCards(regions, isoToKstDate(new Date().toISOString()), settings.features.region_hubs, { pilots: pilots ?? [], indexed: indexedSido ?? new Set() })
              : [],
            source: sourceLineOf(blocks?.official?.cards ?? [], [...(blocks?.localTax ?? []), ...(blocks?.realEstate ?? []), ...(blocks?.official?.explainers ?? []), ...latest.items]),
          }
        : null,
  };
}

export interface CategoryListData {
  section: SectionKey;
  /** 상위 허브 — 이름·아이브로·주소 (빈 목록 안내가 이리로 보낸다) */
  hub: { name: string; eyebrow: string; href: string };
  category: { id: number; slug: string; name: string; intro: string | null; needsDisclaimer: boolean };
  /** 허브와 같은 탭 — 지금 하위 분야가 고른 탭 (기사 0건이면 탭에 없다) */
  tabs: HubTab[];
  items: ArticleListItem[];
  /** 상담 사례 HOT (HOME-05) — 상담 사례 분야 목록(HOT_CATEGORY)의 첫 쪽만, 아니면 null */
  hot: HotBlock | null;
  page: number;
  total: number;
  hasMore: boolean;
  /** 기사 0건 — 상위 허브 안내 + noindex (CAT-02 '빈 목록 색인 0') */
  noindex: boolean;
  hubHref: string;
}

/** 하위 분야 목록 — 공개 분야가 아니면 null (404). 지자체뉴스(local)는 하위 경로가 01B 몫이라 null */
export async function getCategoryList(section: SectionKey, slug: string, page = 1): Promise<CategoryListData | null> {
  if (section === "local") return null;
  const [categories, counts, topicCounts] = await Promise.all([readCategories(), readCategoryCounts(), readTopicCounts()]);
  const category = categories.find((c) => c.section === section && c.slug === slug);
  if (!category) return null;
  const current = pageNumber(page);
  const isHot = section === HOT_CATEGORY.section && slug === HOT_CATEGORY.slug && current === 1;
  const [{ items, total }, hot] = await Promise.all([
    readArticleList(publicDb(), { section, categoryId: num(category.id), limit: LIMITS.pageSize, offset: (current - 1) * LIMITS.pageSize, count: true }),
    isHot ? getHotBlock() : null,
  ]);
  const hub = SECTION_INFO[section];
  return {
    section,
    hub: { name: hub.name, eyebrow: hub.eyebrow, href: hub.href },
    category: { id: num(category.id), slug: category.slug, name: category.name, intro: category.intro, needsDisclaimer: category.needs_disclaimer },
    tabs: hubTabs(section, categories, counts, topicCounts),
    items,
    hot,
    page: current,
    total,
    hasMore: current * LIMITS.pageSize < total,
    noindex: total === 0,
    hubHref: hub.href,
  };
}

export interface NewsListData {
  /** [전체] + 허브 탭 4개 — 고른 탭은 currentTab */
  tabs: HubTab[];
  currentTab: string;
  section: SectionKey | null;
  items: ArticleListItem[];
  page: number;
  total: number;
  hasMore: boolean;
  /** 편집 원칙·정정·반론 창구 링크 (PRD-01A 3장 — 정책 페이지가 공개 승인된 것만, HELP-05) */
  policyLinks: { key: string; label: string; href: string }[];
}

const NEWS_POLICY_KEYS = new Set(["editorial_policy", "corrections"]);

/** 뉴스 전체 — 편집 승인된 취재 기사(reported_news)만 (CAT-02 · LG-04 — 해설·칼럼·광고·금주 핫뉴스 0) */
export async function getNewsList({ section = null, page = 1 }: { section?: SectionKey | null; page?: number } = {}): Promise<NewsListData> {
  const current = pageNumber(page);
  const [settings, { items, total }] = await Promise.all([
    readPublicSettings(),
    readArticleList(publicDb(), {
      ...(section ? { section } : {}),
      contentType: "reported_news",
      reportedApproved: true,
      limit: LIMITS.pageSize,
      offset: (current - 1) * LIMITS.pageSize,
      count: true,
    }),
  ]);
  return {
    tabs: newsTabs(),
    currentTab: section ?? ALL_TAB,
    section,
    items: items.filter((a) => a.contentType === "reported_news" && a.reportedApproved),
    page: current,
    total,
    hasMore: current * LIMITS.pageSize < total,
    policyLinks: POLICY_LINKS.filter((p) => NEWS_POLICY_KEYS.has(p.key) && settings.features[p.feature]).map((p) => ({ key: p.key, label: p.label, href: p.href })),
  };
}
