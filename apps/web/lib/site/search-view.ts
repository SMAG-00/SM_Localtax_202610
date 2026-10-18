// 검색 화면 값 (SRCH-01 · SRCH-02 · UX-05 — docs/dev/W2-d_설계.md 2.4·8장) — 순수 함수 (시험 search-view.test.ts)
//  · 화면 상태는 모두 주소(URL 쿼리)에 있다 — 탭·쪽·거르개는 링크와 GET 폼이라 JS를 꺼도 동작한다 (SRCH-02)
//  · 결과 없음 화면: 추천 검색어(설정 home_search_chips에서 3개 — 코드에 넣어 둔 검색어 0) · 상황 카드 · 도우미 링크(공개 전 0)
//  · search_submitted 속성은 길이·결과 수·결과 유형 수·지역 분류 여부뿐 — 검색어 원문을 담는 칸 0 (W2-c 2.2 · SRCH-03)
import { PROGRESS_STAGE_LABELS, PROGRESS_STAGE_ORDER, type ProgressStageKey } from "@ltr/ui";
import { CONTENT_TYPE_NAMES, SECTION_INFO } from "@/lib/server/public/constants";
import type { RegionRow } from "@/lib/server/public/rows";
import { KIND_LABELS, SEARCH_KINDS, SEARCH_SCREEN, SEARCH_TABS, TAB_KINDS, squash, type SearchHit, type SearchKind, type SearchOptions, type SearchResult, type SearchTab } from "@/lib/server/public/search-logic";
import type { SituationCard } from "@/lib/server/public/situation-logic";

/** 화면 값 (설계 2.4 — 공개 데이터 함수와 같이 쓰므로 search-logic.ts에 있다) */
export { SEARCH_SCREEN, screenOptions } from "@/lib/server/public/search-logic";

/** 탭 글자 (SRCH-02 — 전체·기사·트래커·지역·행사·용어·전문가) */
export const SEARCH_TAB_LABELS: Readonly<Record<SearchTab, string>> = {
  all: "전체",
  article: "기사",
  tracker: "트래커",
  region: "지역",
  event: "행사",
  glossary: "용어",
  expert: "전문가",
};

/** 화면에 두는 탭 — 종류가 있는 탭만 (행사 01B W6 · 전문가 01C 전에는 탭 0 — '데이터 없는 탭 0') */
export const OPEN_TABS: readonly SearchTab[] = SEARCH_TABS.filter((t) => TAB_KINDS[t].length > 0);

/** search_submitted 속성 (설계 2.4 · W2-c 2.2) */
export const SEARCH_EVENT_PROPS = ["query_length", "result_count", "result_type_count", "region_classified"] as const;
export type SearchEventProps = { query_length: number; result_count: number; result_type_count: number; region_classified: boolean };
/** 수집 API 속성 값 상한 (W2-c 2.2 — query_length 0~200 · result_count 0~10000) */
const EVENT_MAX = { queryLength: 200, resultCount: 10_000 } as const;

/** 검색 화면 주소 — 기본값(전체 탭·1쪽·거르개 없음)은 쓰지 않는다. 칸 차례: q·tab·section·type·region·from·to·page */
export function searchHref(o: SearchOptions, over: Partial<SearchOptions> = {}): string {
  const v = { ...o, ...over };
  const params = new URLSearchParams();
  if (v.q) params.set("q", v.q);
  if (v.tab !== "all") params.set("tab", v.tab);
  if (v.section) params.set("section", v.section);
  if (v.contentType) params.set("type", v.contentType);
  if (v.region) params.set("region", v.region);
  if (v.from) params.set("from", v.from);
  if (v.to) params.set("to", v.to);
  if (v.page > 1) params.set("page", String(v.page));
  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
}

export const searchTitle = (q: string): string => (q ? `‘${q}’ 검색 결과` : "검색");

export const hasFilters = (o: SearchOptions): boolean => Boolean(o.section || o.contentType || o.region || o.from || o.to);

/** 거르개를 지운 주소 — 검색어·탭은 그대로, 1쪽 */
export const clearFiltersHref = (o: SearchOptions): string => searchHref(o, { section: null, contentType: null, region: null, from: null, to: null, page: 1 });

/** 고른 거르개 글자 (결과 위 한 줄) — 지역 이름은 읽은 지역 목록에서(없으면 코드 그대로) */
export function filterSummary(o: SearchOptions, regionName: (code: string) => string | null): string[] {
  const out: string[] = [];
  if (o.section) out.push(`분야 ${SECTION_INFO[o.section].name}`);
  if (o.contentType) out.push(`기사 유형 ${CONTENT_TYPE_NAMES[o.contentType] ?? o.contentType}`);
  if (o.region) out.push(`지역 ${regionName(o.region) ?? o.region}`);
  if (o.from && o.to) out.push(`기간 ${o.from} ~ ${o.to}`);
  else if (o.from) out.push(`기간 ${o.from}부터`);
  else if (o.to) out.push(`기간 ${o.to}까지`);
  return out;
}

/** 탭 숫자 — 그 탭 종류의 결과 수 합 (탭과 상관없이 같은 거르개 안) */
export function tabCount(counts: Readonly<Record<SearchKind, number>>, tab: SearchTab): number {
  return TAB_KINDS[tab].reduce((n, k) => n + (counts[k] ?? 0), 0);
}

export interface SearchTabView {
  id: SearchTab;
  label: string;
  count: number;
  href: string;
}

/** 보이는 탭 — 전체 + 결과가 있는 탭 + 지금 탭(0건이어도 — 어디에 있는지 보인다). 주소는 같은 검색어·거르개의 1쪽 */
export function searchTabs(result: SearchResult, o: SearchOptions): SearchTabView[] {
  return OPEN_TABS.filter((t) => t === "all" || t === o.tab || tabCount(result.counts, t) > 0).map((t) => ({
    id: t,
    label: SEARCH_TAB_LABELS[t],
    count: tabCount(result.counts, t),
    href: searchHref(o, { tab: t, page: 1 }),
  }));
}

/** 종류의 탭 (전체 탭 밖) — 상황·분야·기자·필자는 탭이 없다 (설계 2.1 · 12장 #9) */
const tabOfKind = (kind: SearchKind): SearchTab | null => OPEN_TABS.find((t) => t !== "all" && TAB_KINDS[t].includes(kind)) ?? null;

export interface HitGroup {
  kind: SearchKind;
  label: string;
  count: number;
  items: SearchHit[];
  /** 그 종류 탭으로 가는 '모두 보기' — 다 보이면 null */
  more: { href: string; label: string } | null;
  /** 탭이 없는 종류인데 앞 몇 개만 보인다 */
  truncated: boolean;
}

/** 전체 탭 — 종류 차례(설계 2.1)대로 묶는다. 기사와 다른 종류(정보 목록·상황 등)는 섞지 않는다 (원칙 ⑥) */
export function hitGroups(result: SearchResult, o: SearchOptions): HitGroup[] {
  return SEARCH_KINDS.flatMap((kind) => {
    const items = result.items.filter((i) => i.kind === kind);
    if (items.length === 0) return [];
    const count = Math.max(result.counts[kind] ?? 0, items.length);
    const tab = tabOfKind(kind);
    const more = tab && count > items.length ? { href: searchHref(o, { tab, page: 1 }), label: `${SEARCH_TAB_LABELS[tab]} ${count}건 모두 보기` } : null;
    return [{ kind, label: KIND_LABELS[kind], count, items, more, truncated: !tab && count > items.length }];
  });
}

/** 종류 탭의 이전·다음 쪽 주소 */
export function searchPager(result: SearchResult, o: SearchOptions): { prev: string | null; next: string | null } {
  return {
    prev: result.page > 1 ? searchHref(o, { page: result.page - 1 }) : null,
    next: result.hasMore ? searchHref(o, { page: result.page + 1 }) : null,
  };
}

export interface SuggestionLink {
  label: string;
  href: string;
}

const suggestionLink = (label: string): SuggestionLink => ({ label, href: `/search?q=${encodeURIComponent(label)}` });

/** 시작 화면(검색어 없음)의 추천 검색어 — 설정 칩 그대로 (홈 칩과 같은 주소) */
export const startSuggestions = (chips: readonly string[]): SuggestionLink[] => chips.map(suggestionLink);

export interface NoResultView {
  /** 추천 검색어 — 설정(home_search_chips)에서 지금 검색어를 빼고 앞 3개. 주소는 거르개 없이 */
  suggestions: SuggestionLink[];
  situations: SituationCard[];
  /** 거르개를 썼으면 지우기 주소 */
  clearFilters: string | null;
  /** [AI 도우미에게 묻기] — 도우미 공개 승인 전에는 false (SRCH-02 · 01C CHAT-14) */
  assistant: boolean;
}

export function noResultView(input: { options: SearchOptions; chips: readonly string[]; situations: readonly SituationCard[]; assistantOpen: boolean }): NoResultView {
  const own = squash(input.options.q);
  return {
    suggestions: input.chips
      .filter((c) => squash(c) !== own)
      .slice(0, SEARCH_SCREEN.suggestions)
      .map(suggestionLink),
    situations: [...input.situations],
    clearFilters: hasFilters(input.options) ? clearFiltersHref(input.options) : null,
    assistant: input.assistantOpen,
  };
}

/**
 * search_submitted 속성 — 검색어 원문 0 (W2-c 2.2). 결과 수는 탭과 상관없이 모든 종류의 합(같은 거르개 안), 지역 분류 여부는
 * 지역 결과가 있는가(검색어의 낱말이 모두 지역 이름·옛 이름에 든다 — 지역 + 주제 분류는 01B W4, 설계 12장 #11). 남는 글자 없는 검색어(검색 안 함)는 null
 */
export function searchEventProps(result: SearchResult, q: string): SearchEventProps | null {
  if (result.terms.length === 0) return null;
  const total = SEARCH_KINDS.reduce((n, k) => n + (result.counts[k] ?? 0), 0);
  return {
    query_length: Math.min(Array.from(q).length, EVENT_MAX.queryLength),
    result_count: Math.min(total, EVENT_MAX.resultCount),
    result_type_count: SEARCH_KINDS.filter((k) => (result.counts[k] ?? 0) > 0).length,
    region_classified: (result.counts.region ?? 0) > 0,
  };
}

/** 트래커 결과의 단계 — 단계 글자와 '확정 아님'(확정 기준 단계 앞 — TX-07·08, 설정 amendment_confirmed_stage) */
export function trackerStageView(hit: Extract<SearchHit, { kind: "tracker" }>, confirmStage: ProgressStageKey): { label: string | null; unconfirmed: boolean } {
  const stage = hit.stage && (PROGRESS_STAGE_ORDER as readonly string[]).includes(hit.stage) ? (hit.stage as ProgressStageKey) : null;
  if (!stage) return { label: null, unconfirmed: false };
  return { label: PROGRESS_STAGE_LABELS[stage], unconfirmed: PROGRESS_STAGE_ORDER.indexOf(stage) < PROGRESS_STAGE_ORDER.indexOf(confirmStage) };
}

export interface RegionGroup {
  code: string;
  name: string;
  children: { code: string; name: string }[];
}

const validOn = (r: RegionRow, today: string) => (r.valid_from === null || r.valid_from <= today) && (r.valid_to === null || r.valid_to >= today);

/** 지역 거르개 선택지 — 오늘 유효한 시·도(코드 차례)와 그 아래 시·군·구 (JS 없이 한 목록에서 고른다) */
export function regionGroups(regions: readonly RegionRow[], today: string): RegionGroup[] {
  const live = regions.filter((r) => validOn(r, today)).sort((a, b) => a.code.localeCompare(b.code));
  return live
    .filter((r) => r.level === "sido")
    .map((s) => ({ code: s.code, name: s.name, children: live.filter((r) => r.level === "sigungu" && r.parent_code === s.code).map((r) => ({ code: r.code, name: r.name })) }));
}
