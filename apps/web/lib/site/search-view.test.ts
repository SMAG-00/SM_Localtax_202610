// 검색 화면 값 (SRCH-01 · SRCH-02 · UX-05 · W2-c search_submitted) — 설계 문서(docs/dev/W2-d_설계.md) 2.4 표를 읽어 대조한다
//  · URL 상태 ↔ 폼(주소 만들기 → 다시 읽기가 같은 옵션) · 탭 숫자·보이는 탭 · 전체 탭 묶음 · 결과 없음(추천 검색어 3·상황 카드·도우미 링크는 꺼짐이면 0)
//  · search_submitted 속성(검색어 원문 0 — 수집 API 검사를 지난다) · 트래커 '확정 아님' · 지역 거르개 선택지
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { validateEvent } from "@/lib/analytics/events";
import { SEARCH_TABS, parseSearchParams, type SearchHit, type SearchKind, type SearchOptions, type SearchResult } from "@/lib/server/public/search-logic";
import type { RegionRow } from "@/lib/server/public/rows";
import type { SituationCard } from "@/lib/server/public/situation-logic";
import {
  OPEN_TABS,
  SEARCH_EVENT_PROPS,
  SEARCH_SCREEN,
  SEARCH_TAB_LABELS,
  clearFiltersHref,
  filterSummary,
  hasFilters,
  hitGroups,
  noResultView,
  regionGroups,
  screenOptions,
  searchEventProps,
  searchHref,
  searchPager,
  searchTabs,
  searchTitle,
  startSuggestions,
  tabCount,
  trackerStageView,
  classifiedLine,
  regionSuggestView,
} from "./search-view";

const MD = fs.readFileSync(path.resolve(__dirname, "../../../../docs/dev/W2-d_설계.md"), "utf8");
const ticks = (s: string) => [...s.matchAll(/`([^`]*)`/g)].map((m) => m[1]!);
function row24(name: string): string[] {
  const sec = MD.split(/^## /m).find((s) => s.startsWith("2. 값 목록"));
  const part = sec?.split(/^### /m).find((s) => s.startsWith("2.4"));
  const line = part?.split("\n").find((l) => l.startsWith(`| ${name} `));
  if (!line) throw new Error(`설계 2.4 '${name}' 줄이 없다`);
  return ticks(line.split("|")[2]!);
}

const options = (over: Partial<SearchOptions> = {}): SearchOptions => ({ q: "취득세", tab: "all", section: null, contentType: null, region: null, from: null, to: null, page: 1, ...over });
const counts = (over: Partial<Record<SearchKind, number>> = {}) => ({ region: 0, situation: 0, tracker: 0, glossary: 0, category: 0, article: 0, person: 0, interpretation: 0, ...over });
const result = (over: Partial<SearchResult> = {}): SearchResult => ({ query: "취득세", terms: ["취득세"], total: 0, counts: counts(), items: [], page: 1, pageSize: 20, hasMore: false, ...over });
const article = (ref: string): SearchHit => ({
  kind: "article",
  ref,
  title: `기사 ${ref}`,
  snippet: null,
  href: `/news/a-${ref}`,
  typeLabel: "해설",
  tier: 2,
  section: "tax",
  sectionName: "지방세",
  contentType: "explainer",
  format: null,
  sponsor: null,
  sponsorBadge: null,
  publishedOn: "2026-10-01",
  regionCodes: [],
});
const situationHit = (ref: string): SearchHit => ({ kind: "situation", ref, title: `상황 ${ref}`, snippet: null, href: `/situations/s-${ref}`, typeLabel: "상황", tier: 1, section: "tax", sectionName: "지방세", pictogram: "car-sold" });
const card = (slug: string, section: SituationCard["section"] = "tax"): SituationCard => ({ slug, href: `/situations/${slug}`, title: `상황 ${slug}`, subtitle: "한 줄", pictogram: "car-sold", section });
const query = (href: string) => new URLSearchParams(href.includes("?") ? href.slice(href.indexOf("?") + 1) : "");

describe("설계 2.4와 같은 값", () => {
  test("탭 글자는 2.1 탭 차례 그대로, 전체 탭 묶음 수·추천 검색어 수·이벤트 속성", () => {
    expect(SEARCH_TABS.map((t) => SEARCH_TAB_LABELS[t])).toEqual(row24("screen.tab_labels"));
    expect(SEARCH_SCREEN.allPerKind).toBe(Number(row24("screen.all_per_kind")[0]));
    expect(SEARCH_SCREEN.suggestions).toBe(Number(row24("screen.suggestions")[0]));
    expect([...SEARCH_EVENT_PROPS]).toEqual(row24("event.search_submitted"));
  });

  test("열린 탭 — 종류가 있는 탭만(행사·전문가는 01B·01C 전 0)", () => {
    expect(OPEN_TABS).toEqual(["all", "article", "tracker", "region", "glossary"]);
  });
});

describe("URL 상태 ↔ 폼", () => {
  test("주소 → 다시 읽으면 같은 옵션 (모든 거르개·탭·쪽)", () => {
    const o = options({ q: "성동구 재개발", tab: "article", section: "realestate", contentType: "reported_news", region: "1120000000", from: "2026-01-01", to: "2026-10-19", page: 3 });
    const href = searchHref(o);
    expect(href.startsWith("/search?")).toBe(true);
    expect(parseSearchParams(query(href))).toEqual(o);
    expect([...query(href).keys()]).toEqual(["q", "tab", "section", "type", "region", "from", "to", "page"]);
  });

  test("기본값(전체 탭·1쪽·거르개 없음)은 주소에 쓰지 않는다 — 검색어 없으면 /search", () => {
    expect(searchHref(options({ q: "취득세" }))).toBe("/search?q=%EC%B7%A8%EB%93%9D%EC%84%B8");
    expect(searchHref(options({ q: "" }))).toBe("/search");
    expect(searchHref(options(), { tab: "glossary", page: 1 })).toBe("/search?q=%EC%B7%A8%EB%93%9D%EC%84%B8&tab=glossary");
  });

  test("화면 옵션 — 종류 없는 탭(행사·전문가)은 전체 탭으로, 전체 탭은 쪽이 없다(1쪽)", () => {
    expect(screenOptions(options({ tab: "event", page: 4 }))).toMatchObject({ tab: "all", page: 1 });
    expect(screenOptions(options({ tab: "expert" })).tab).toBe("all");
    expect(screenOptions(options({ tab: "all", page: 2 })).page).toBe(1);
    expect(screenOptions(options({ tab: "article", page: 2 }))).toMatchObject({ tab: "article", page: 2 });
  });

  test("거르개 — 있는지·글자 요약(분야·기사 유형·지역 이름·기간)·지우기 주소(검색어·탭은 그대로)", () => {
    expect(hasFilters(options())).toBe(false);
    const o = options({ tab: "article", section: "tax", contentType: "reported_news", region: "1100000000", from: "2026-10-01", page: 2 });
    expect(hasFilters(o)).toBe(true);
    expect(filterSummary(o, (code) => (code === "1100000000" ? "서울특별시" : null))).toEqual(["분야 지방세", "기사 유형 보도", "지역 서울특별시", "기간 2026-10-01부터"]);
    expect(filterSummary(options({ to: "2026-10-19" }), () => null)).toEqual(["기간 2026-10-19까지"]);
    expect(filterSummary(options({ from: "2026-10-01", to: "2026-10-19", region: "9999999999" }), () => null)).toEqual(["지역 9999999999", "기간 2026-10-01 ~ 2026-10-19"]);
    expect(parseSearchParams(query(clearFiltersHref(o)))).toEqual(options({ tab: "article" }));
  });

  test("화면 제목 — 검색어가 있으면 ‘검색어’ 검색 결과", () => {
    expect(searchTitle("취득세")).toBe("‘취득세’ 검색 결과");
    expect(searchTitle("")).toBe("검색");
  });
});

describe("탭 숫자·보이는 탭", () => {
  test("탭 숫자 = 그 탭 종류의 합, 전체 = 모든 종류의 합", () => {
    const c = counts({ article: 12, tracker: 1, situation: 2, person: 1 });
    expect(tabCount(c, "all")).toBe(16);
    expect(tabCount(c, "article")).toBe(12);
    expect(tabCount(c, "region")).toBe(0);
    expect(tabCount(c, "event")).toBe(0);
  });

  test("보이는 탭 — 전체 + 결과 있는 탭 + 지금 탭(0건이어도), 주소는 1쪽·같은 거르개", () => {
    const r = result({ counts: counts({ article: 12, glossary: 2, situation: 3 }) });
    const o = options({ tab: "region", section: "tax", page: 1 });
    const tabs = searchTabs(r, o);
    expect(tabs.map((t) => [t.id, t.label, t.count])).toEqual([
      ["all", "전체", 17],
      ["article", "기사", 12],
      ["region", "지역", 0],
      ["glossary", "용어", 2],
    ]);
    expect(parseSearchParams(query(tabs[1]!.href))).toEqual({ ...o, tab: "article" });
    expect(parseSearchParams(query(tabs[0]!.href)).tab).toBe("all");
  });
});

describe("전체 탭 묶음", () => {
  test("종류 차례대로 묶고, 탭이 있는 종류는 '모두 보기' 주소, 탭 없는 종류(상황)는 앞 몇 개만이라는 표시", () => {
    const r = result({ counts: counts({ article: 12, situation: 7 }), items: [situationHit("1"), situationHit("2"), article("10"), article("11")] });
    const groups = hitGroups(r, options({ section: "tax" }));
    expect(groups.map((g) => [g.kind, g.label, g.count, g.items.length])).toEqual([
      ["situation", "상황", 7, 2],
      ["article", "기사", 12, 2],
    ]);
    expect(groups[0]).toMatchObject({ more: null, truncated: true });
    expect(groups[1]!.more?.label).toBe("기사 12건 모두 보기");
    expect(parseSearchParams(query(groups[1]!.more!.href))).toEqual(options({ tab: "article", section: "tax" }));
  });

  test("다 보이면 모두 보기·앞 몇 개 표시 0, 빈 종류는 묶음 0", () => {
    const r = result({ counts: counts({ article: 2 }), items: [article("1"), article("2")] });
    expect(hitGroups(r, options())).toEqual([expect.objectContaining({ kind: "article", more: null, truncated: false })]);
  });
});

describe("쪽 넘김 (종류 탭)", () => {
  test("이전·다음 쪽 주소 — 같은 탭·거르개, 1쪽은 page를 뺀다", () => {
    const o = options({ tab: "article", contentType: "guide", page: 2 });
    const p = searchPager(result({ page: 2, hasMore: true }), o);
    expect(parseSearchParams(query(p.prev!))).toEqual({ ...o, page: 1 });
    expect(query(p.prev!).has("page")).toBe(false);
    expect(parseSearchParams(query(p.next!))).toEqual({ ...o, page: 3 });
    expect(searchPager(result({ page: 1, hasMore: false }), { ...o, page: 1 })).toEqual({ prev: null, next: null });
  });
});

describe("결과 없음 화면 (SRCH-02 · UX-05)", () => {
  const chips = ["취득세", "개편안", "책임준공", "재산세"];

  test("추천 검색어 3개 — 지금 검색어(띄어쓰기만 다른 것 포함)는 빼고, 주소는 거르개 없이", () => {
    const v = noResultView({ options: options({ q: "개 편안", section: "tax" }), chips, situations: [card("a")], assistantOpen: false });
    expect(v.suggestions.map((s) => s.label)).toEqual(["취득세", "책임준공", "재산세"]);
    expect(v.suggestions.map((s) => s.href)).toEqual(["취득세", "책임준공", "재산세"].map((c) => `/search?q=${encodeURIComponent(c)}`));
  });

  test("상황 카드는 받은 그대로, 거르개를 썼으면 지우기 주소", () => {
    const situations = [card("car-sold"), card("home-bought", "realestate")];
    const v = noResultView({ options: options({ q: "없는 낱말", contentType: "reported_news" }), chips, situations, assistantOpen: false });
    expect(v.situations).toEqual(situations);
    expect(v.clearFilters && parseSearchParams(query(v.clearFilters))).toEqual(options({ q: "없는 낱말" }));
    expect(noResultView({ options: options({ q: "없는 낱말" }), chips, situations, assistantOpen: false }).clearFilters).toBeNull();
  });

  test("[AI 도우미에게 묻기]는 도우미가 공개됐을 때만 — 꺼짐이면 0", () => {
    expect(noResultView({ options: options(), chips, situations: [], assistantOpen: false }).assistant).toBe(false);
    expect(noResultView({ options: options(), chips, situations: [], assistantOpen: true }).assistant).toBe(true);
  });

  test("추천 검색어 설정이 비었으면(3~6개가 아니어서 숨김) 0개 — 코드에 넣어 둔 검색어 0", () => {
    expect(noResultView({ options: options(), chips: [], situations: [], assistantOpen: false }).suggestions).toEqual([]);
  });

  test("시작 화면(검색어 없음) — 추천 검색어 칩 그대로(설정 3~6개)", () => {
    expect(startSuggestions(chips).map((s) => s.href)).toEqual(chips.map((c) => `/search?q=${encodeURIComponent(c)}`));
  });
});

describe("search_submitted 속성 (W2-c 2.2 — 검색어 원문 0)", () => {
  test("길이·결과 수·결과 유형 수·지역 분류 여부만 — 탭과 상관없이 모든 종류의 합", () => {
    const r = result({ counts: counts({ article: 12, region: 1, situation: 2 }) });
    const p = searchEventProps(r, "성동구");
    expect(p).toEqual({ query_length: 3, result_count: 15, result_type_count: 3, region_classified: true });
    expect(Object.keys(p!).sort()).toEqual([...SEARCH_EVENT_PROPS].sort());
    expect(JSON.stringify(p)).not.toContain("성동구");
  });

  test("수집 API 검사를 지난다 — 경계(결과 10,000건 넘으면 10,000·검색어 100자)", () => {
    const big = searchEventProps(result({ counts: counts({ article: 19_000 }) }), "가".repeat(100))!;
    expect(big).toMatchObject({ query_length: 100, result_count: 10_000, result_type_count: 1, region_classified: false });
    expect(validateEvent({ name: "search_submitted", props: big }).ok).toBe(true);
    expect(validateEvent({ name: "search_submitted", section: "tax", props: searchEventProps(result(), "없음")! }).ok).toBe(true);
  });

  test("이모지·한자도 글자 하나로 센다(코드 포인트) · 남는 글자 없는 검색어는 보내지 않는다(null)", () => {
    expect(searchEventProps(result(), "稅 𠀀")?.query_length).toBe(3);
    expect(searchEventProps(result({ terms: [] }), "?!·")).toBeNull();
  });
});

describe("트래커 단계 (TX-07 — 확정 전이면 '확정 아님')", () => {
  const tracker = (stage: string | null): Extract<SearchHit, { kind: "tracker" }> => ({ kind: "tracker", ref: "1", title: "개편안", snippet: null, href: null, typeLabel: "개정 트래커", tier: 1, stage, stageOn: "2026-08-01", sourceUrl: null });
  test("단계 글자와 확정 기준(설정) 앞이면 확정 아님", () => {
    expect(trackerStageView(tracker("pre_notice"), "promulgated")).toEqual({ label: "입법예고", unconfirmed: true });
    expect(trackerStageView(tracker("promulgated"), "promulgated")).toEqual({ label: "공포", unconfirmed: false });
    expect(trackerStageView(tracker("effective"), "promulgated")).toEqual({ label: "시행", unconfirmed: false });
    expect(trackerStageView(tracker(null), "promulgated")).toEqual({ label: null, unconfirmed: false });
    expect(trackerStageView(tracker("unknown"), "promulgated")).toEqual({ label: null, unconfirmed: false });
  });
});

describe("지역 거르개 선택지", () => {
  const region = (code: string, name: string, over: Partial<RegionRow> = {}): RegionRow => ({
    code,
    parent_code: code.endsWith("00000000") ? null : `${code.slice(0, 2)}00000000`,
    level: code.endsWith("00000000") ? "sido" : "sigungu",
    name,
    slug: code,
    aliases: [],
    valid_from: null,
    valid_to: null,
    ...over,
  });
  test("시·도 차례대로, 그 아래 시·군·구 — 오늘 유효한 것만", () => {
    const groups = regionGroups(
      [
        region("2600000000", "부산광역시"),
        region("1100000000", "서울특별시"),
        region("1120000000", "성동구"),
        region("1111000000", "종로구"),
        region("1199000000", "없어진 구", { valid_to: "2020-12-31" }),
        region("1198000000", "생길 구", { valid_from: "2030-01-01" }),
      ],
      "2026-10-19",
    );
    expect(groups).toEqual([
      { code: "1100000000", name: "서울특별시", children: [{ code: "1111000000", name: "종로구" }, { code: "1120000000", name: "성동구" }] },
      { code: "2600000000", name: "부산광역시", children: [] },
    ]);
  });
});

describe("지역 + 주제 분류 화면 값 (W4 10단계 — REG-08 · REG1-11, docs/dev/W4_설계.md 11.9)", () => {
  const region = (code: string, name: string, parentName: string | null) => ({ code, name, level: (parentName ? "sigungu" : "sido") as "sido" | "sigungu", parentName });
  const cls = (over = {}) => ({
    regions: [region("9901100000", "시험가람구", "시험용 분류도")],
    topics: [{ key: "redevelopment" as const, label: "재개발·재건축" }],
    ambiguous: false,
    upper: ["시험용 분류도 재개발", "재개발"],
    spellings: ["분류도 시험가람구 재개발"],
    ...over,
  });
  const card: SituationCard = { slug: "car", href: "/situations/car", section: "tax", title: "차를 팔았어요", subtitle: "한 줄", pictogram: "car-sold" } as SituationCard;

  test("분류 줄 — 시·군·구는 시·도 이름을 앞에 · 주제 글자 · 동명은 후보 모두 · 지역·주제가 없으면 null", () => {
    expect(classifiedLine(cls())).toEqual({ regions: ["시험용 분류도 시험가람구"], topics: ["재개발·재건축"], ambiguous: false });
    const two = cls({ regions: [region("9901300000", "시험고개군", "가도"), region("9901400000", "시험고개군", "나도")], ambiguous: true, topics: [] });
    expect(classifiedLine(two)).toEqual({ regions: ["가도 시험고개군", "나도 시험고개군"], topics: [], ambiguous: true });
    expect(classifiedLine(cls({ regions: [], topics: [] }))).toBeNull();
    expect(classifiedLine(undefined)).toBeNull();
  });

  test("결과 0건 제안 — 지역으로 분류됐고 지역 밖 결과가 0일 때만: 상위 지역·다른 표기 링크 + 상황 카드", () => {
    const view = regionSuggestView(result({ counts: counts({ region: 1 }), classification: cls() }), [card]);
    expect(view).toEqual({
      upper: [
        { label: "시험용 분류도 재개발", href: `/search?q=${encodeURIComponent("시험용 분류도 재개발")}` },
        { label: "재개발", href: "/search?q=%EC%9E%AC%EA%B0%9C%EB%B0%9C" },
      ],
      spellings: [{ label: "분류도 시험가람구 재개발", href: `/search?q=${encodeURIComponent("분류도 시험가람구 재개발")}` }],
      situations: [card],
    });
    expect(regionSuggestView(result({ counts: counts({ region: 1, article: 1 }), classification: cls() }), [card])).toBeNull(); // 지역 밖 결과가 있다
    expect(regionSuggestView(result({ counts: counts({ region: 0 }), classification: cls({ regions: [] }) }), [card])).toBeNull(); // 지역 없음
    expect(regionSuggestView(result({ counts: counts({ region: 1 }) }), [card])).toBeNull(); // 분류를 붙이지 못한 결과
    expect(regionSuggestView(null, [card])).toBeNull();
  });

  test("search_submitted.region_classified = 실제 분류 — 지역 결과가 있어도 후보가 없으면 거짓, 동명(후보 둘)도 참 · 속성 4칸·지역 코드·주제 0", () => {
    const none = searchEventProps(result({ counts: counts({ region: 3, article: 2 }), classification: cls({ regions: [], topics: [] }) }), "구 소식")!;
    expect(none.region_classified).toBe(false);
    const two = searchEventProps(result({ counts: counts({ region: 2 }), classification: cls({ regions: [region("1", "가", null), region("2", "가", null)], ambiguous: true }) }), "시험고개군 재산세")!;
    expect(two.region_classified).toBe(true);
    expect(Object.keys(two).sort()).toEqual([...SEARCH_EVENT_PROPS].sort());
    for (const piece of ["9901", "redevelopment", "시험", "재산세"]) expect(JSON.stringify(two)).not.toContain(piece);
    expect(validateEvent({ name: "search_submitted", props: two }).ok).toBe(true);
  });
});
