// 4대 분야 허브 공통 골격·하위 분야 목록·뉴스 전체 규칙 (CAT-02 · UX-05 · LG-08) — 순수 함수 (시험 hub-logic.test.ts)
//  · 탭 = [전체] + 기사 있는 하위 분야(지자체뉴스는 기사 있는 편집 분야). 헤더 하위 메뉴와 같은 목록(subsectionLinks)이다 — 기사 0건이면 탭·메뉴에서 숨긴다
//  · 하위 분야가 하나도 없으면 [전체] 하나뿐인 탭은 두지 않는다 (빈 탭 0)
//  · 지자체뉴스 허브의 분야 고유 블록은 LG-08 순서 — 지금 데이터가 있는 ② 지방세·지방재정 ③ 부동산·개발만 (① 금주 핫뉴스·④ 행사안내는 01B W6, ⑤ 공식 자료/해설은 01B W4 9단계).
//    블록과 편집 분야 대응은 설정 local_block_fields (W4 4단계 — region-hub-logic.ts가 지역 허브와 같은 함수로 고른다)
//  · W4 9단계 — 지자체뉴스 허브 = /local 전국 화면: 머리 뒤 시·도 카드(오늘 유효한 시·도 — region_hubs가 켜졌을 때만 링크), 블록에 ⑤ 공식 자료/해설(있을 때만),
//    맨 아래 데이터 출처 줄(REG-10 — 전국 지자체 허브도). 분야를 고르면 시·도 카드·블록 0(목록 하나), 출처 줄은 그대로
import type { LocalTopic } from "@ltr/ui";
import type { ArticleListItem } from "./cards";
import { subsectionLinks } from "./chrome-logic";
import { NEWS_TAB_LABELS, SECTION_INFO, SECTION_KEYS, type SectionKey } from "./constants";
import type { TermChip } from "./glossary-logic";
import type { LocalBlocks, RegionSourceLine } from "./region-hub-logic";
import type { SidoCard } from "./region-official-logic";
import type { RealEstateHubData } from "./realestate-hub-logic";
import type { PublicCategoryRow } from "./rows";
import type { HotBlock } from "./rankings";
import type { HubTaxPoint } from "./hub-point-logic";
import type { SituationCard } from "./situation-logic";

export interface HubTab {
  /** 탭 값 — 하위 분야 slug · 편집 분야 값 · 분야 키, [전체]는 "all" */
  id: string;
  label: string;
  href: string;
}

export const ALL_TAB = "all";

/** 허브(분야)의 탭 — [전체] + 기사 있는 하위 분야. 하위 분야가 없으면 빈 목록(탭 요소 0) */
export function hubTabs(
  section: SectionKey,
  categories: readonly PublicCategoryRow[],
  counts: ReadonlyMap<number, number>,
  topicCounts: ReadonlyMap<LocalTopic, number>,
): HubTab[] {
  const items = subsectionLinks(section, categories, counts, topicCounts).map((l) => ({ id: l.key.slice(l.key.indexOf(":") + 1), label: l.label, href: l.href }));
  return items.length ? [{ id: ALL_TAB, label: "전체", href: SECTION_INFO[section].href }, ...items] : [];
}

/** 뉴스 전체의 탭 — [전체] + 허브 탭 4개 (CAT-02 '같은 골격에 허브 탭 4개') */
export function newsTabs(): HubTab[] {
  return [{ id: ALL_TAB, label: "전체", href: "/news" }, ...SECTION_KEYS.map((key) => ({ id: key, label: NEWS_TAB_LABELS[key], href: `/news?section=${key}` }))];
}

export { localBlocks, type LocalBlocks } from "./region-hub-logic";

/** 쪽 번호 — 1 이상 정수만, 아니면 1 */
export function pageNumber(page: number | undefined): number {
  return page !== undefined && Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

/** /local 전국 화면 값 (W4 9단계) */
export interface LocalIndexView {
  /** 시·도 카드 — 분야를 골랐으면 빈 목록 */
  sido: SidoCard[];
  /** 데이터 출처 줄 (REG-10) */
  source: RegionSourceLine;
}

export interface HubData {
  section: SectionKey;
  name: string;
  eyebrow: string;
  href: string;
  /** 한 줄 소개 (settings.hub_intros) — 없으면 null */
  intro: string | null;
  /** 탭 — [전체] + 기사 있는 하위 분야 (CAT-02). 하위 분야가 없으면 빈 목록 */
  tabs: HubTab[];
  /** 지금 탭 — "all" 또는 고른 편집 분야(지자체뉴스) */
  currentTab: string;
  /** 고른 편집 분야 (지자체뉴스 `?topic=`) — 모르는 값이면 null(전체) */
  topic: LocalTopic | null;
  /** 분야 고유 블록 (01B) — 지자체뉴스 전체 보기에서 LG-08 ②·③만, 그 밖은 null */
  blocks: LocalBlocks | null;
  latest: ArticleListItem[];
  /** 상담 사례 HOT (HOME-05) — 지방세 허브만, 상담 사례 기사가 없으면 null */
  hot: HotBlock | null;
  /** 상황 카드 줄 — 0장이면 빈 목록(줄 숨김, UX-05) */
  situations: SituationCard[];
  /** 관련 용어 칩 — 공개 용어만(RLS), 용어사전이 열렸으면 용어 쪽 링크 (W2-d 3단계) */
  terms: TermChip[];
  /** 분야 지방세 포인트 (01B CORE-02 — W3 9단계) — 세무 감수 서명이 있는 분야만, 지방세 허브·감수 전은 null (블록째 숨김) */
  taxPoint: HubTaxPoint | null;
  /** 고른 편집 분야에 기사가 0건 — 허브 안내 + noindex (CAT-02 '빈 목록 색인 0') */
  noindex: boolean;
  /** /local 전국 화면 (W4 9단계) — 지자체뉴스 허브만, 다른 허브·닫힌 허브는 null */
  local: LocalIndexView | null;
  /** /realestate 허브 확장 (W4 22단계) — 부동산 허브만, 다른 허브·닫힌 허브는 null */
  estate: RealEstateHubData | null;
  /** 공개 데이터를 읽지 못해 닫힌 허브(머리만)를 보이는 중 */
  unavailable?: true;
}

/** 닫힌 허브 — 공개 데이터를 읽지 못할 때(접속값 없음·DB 꺼짐). 허브 머리(DB가 필요 없는 이름·아이브로)만, 응답 200 */
export function closedHubData(section: SectionKey): HubData {
  return {
    section,
    name: SECTION_INFO[section].name,
    eyebrow: SECTION_INFO[section].eyebrow,
    href: SECTION_INFO[section].href,
    intro: null,
    tabs: [],
    currentTab: ALL_TAB,
    topic: null,
    blocks: null,
    latest: [],
    hot: null,
    situations: [],
    terms: [],
    taxPoint: null,
    noindex: false,
    local: null,
    estate: null,
    unavailable: true,
  };
}
