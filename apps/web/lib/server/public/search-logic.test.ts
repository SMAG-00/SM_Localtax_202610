// 통합 검색 순수 규칙 — 설계 문서(docs/dev/W2-d_설계.md) 2장 표를 읽어 대조한다 (DB 시험 w2d-values가 같은 표를 읽는다)
//  · 2.1 종류·기사 유형·탭 · 2.2 정규화 견본(DB 함수와 같은 낱말) · 2.3 한도
//  · URL 쿼리 → 옵션(모르는 값은 닫힌 쪽) · DB 인자 · 행 → 보기 값(열린 화면만 주소 · 유형 표시 글자 · 기사 배지) · 결과(탭 숫자·다음 쪽)
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { CLOSED_FEATURES } from "./settings";
import type { Features } from "./constants";
import {
  EVENT_LABEL,
  KIND_LABELS,
  SEARCH_CONTENT_TYPES,
  SEARCH_KINDS,
  SEARCH_LIMITS,
  SEARCH_MAX_PAGE,
  SEARCH_TABS,
  TAB_KINDS,
  countArgs,
  countsMissing,
  emptySearchResult,
  parseSearchParams,
  queryTerms,
  searchArgs,
  searchHitView,
  squash,
  toSearchResult,
  withCounts,
  type SearchRow,
} from "./search-logic";

const MD = fs.readFileSync(path.resolve(__dirname, "../../../../../docs/dev/W2-d_설계.md"), "utf8");
const ticks = (s: string) => [...s.matchAll(/`([^`]*)`/g)].map((m) => m[1]!);
function sub(no: string): string {
  const sec = MD.split(/^## /m).find((s) => s.startsWith("2. 값 목록"));
  const part = sec?.split(/^### /m).find((s) => s.startsWith(no));
  if (!part) throw new Error(`설계 문서 ${no}가 없다`);
  return part;
}
const tableRows = (s: string) =>
  s
    .split("\n")
    .filter((l) => l.startsWith("|") && !/^\|\s*-/.test(l))
    .slice(1)
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
const list = (no: string, name: string) => {
  const row = tableRows(sub(no)).find((r) => r[0]!.split(/\s/)[0] === name);
  if (!row) throw new Error(`${no} '${name}' 줄이 없다`);
  return ticks(row[1]!);
};
const GOLDEN = tableRows(sub("2.2")).map(([input, terms, split]) => ({ input: ticks(input!)[0]!, terms: ticks(terms!), split: split === "—" ? null : ticks(split!) }));

const ALL_OPEN = Object.fromEntries(Object.keys(CLOSED_FEATURES).map((k) => [k, true])) as unknown as Features;
const row = (over: Partial<SearchRow>): SearchRow => ({
  kind: "article",
  ref: "1",
  slug: "a-1",
  title: "제목",
  snippet: "요약",
  section: "tax",
  content_type: "explainer",
  published_at: "2026-10-01T15:30:00Z",
  tier: 1,
  meta: { format: "general", label: "none", partner_badge_name: null, region_codes: [] },
  total_count: 1,
  kind_counts: { article: 1 },
  query_terms: ["제목"],
  ...over,
});

describe("설계 문서 2장과 같은 값", () => {
  test("2.1 결과 종류(차례까지)·기사 유형·탭", () => {
    expect([...SEARCH_KINDS]).toEqual(list("2.1", "search.kind"));
    expect([...SEARCH_CONTENT_TYPES]).toEqual(list("2.1", "search.content_type"));
    expect([...SEARCH_TABS]).toEqual(list("2.1", "search.tab"));
  });

  test("2.3 한도", () => {
    expect(SEARCH_LIMITS.queryChars).toBe(Number(list("2.3", "query_chars")[0]));
    expect(SEARCH_LIMITS.maxTerms).toBe(Number(list("2.3", "max_terms")[0]));
    expect([SEARCH_LIMITS.pageSize, SEARCH_LIMITS.maxPageSize]).toEqual(list("2.3", "page_size").map(Number));
    expect(SEARCH_LIMITS.maxOffset).toBe(Number(list("2.3", "max_offset")[0]));
    expect(SEARCH_LIMITS.maxPerKind).toBe(Number(list("2.3", "max_per_kind")[0]));
    expect(SEARCH_MAX_PAGE).toBe(51);
  });

  test("탭 → 종류: 모든 종류는 전체 탭에, 행사·전문가 탭은 뒤 작업 전 종류 0", () => {
    expect(TAB_KINDS.all).toEqual(SEARCH_KINDS);
    expect(TAB_KINDS.event).toEqual([]);
    expect(TAB_KINDS.expert).toEqual([]);
    expect(TAB_KINDS.article).toEqual(["article"]);
  });

  test("유형 표시 글자 — 종류마다 하나, 행사는 정보 목록 표시 '행사안내'", () => {
    for (const k of SEARCH_KINDS) expect(KIND_LABELS[k]).toMatch(/\S/);
    expect(EVENT_LABEL).toBe("행사안내");
  });
});

describe("2.2 정규화 견본 — DB 함수와 같은 낱말", () => {
  test("견본 표를 읽었다", () => expect(GOLDEN.length).toBeGreaterThanOrEqual(15));
  test.each(GOLDEN)("'$input'", ({ input, terms, split }) => {
    expect(queryTerms(input)).toEqual({ terms, split });
  });

  test("앞 100글자(코드 포인트)까지만 — 100번째는 들어가고 101번째는 빠진다", () => {
    expect(queryTerms(`${"a".repeat(99)}b`).terms).toEqual([`${"a".repeat(99)}b`]);
    expect(queryTerms(`${"a".repeat(100)}b`).terms).toEqual(["a".repeat(100)]);
    expect(queryTerms(`${"가".repeat(100)} 나다`).terms).toEqual(["가".repeat(100)]);
  });

  test("squash — 칸 하나의 정규형 (DB public.search_squash와 같은 규칙)", () => {
    expect(squash("취득 세·「개편안」 ＡＢＣ PF-ABS 100%")).toBe("취득세개편안abcpfabs100");
    expect(squash("\t\n  ")).toBe("");
    // NFKC는 호환 자모 ㄱ(U+3131)을 첫소리 글자 ᄀ(U+1100)로 바꾼다 — 지우지 않고 남긴다
    expect(squash("ㄱㄴ 一二")).toBe("ᄀᄂ一二");
    expect(squash("ㅊㄷㅅ")).toHaveLength(3);
  });

  test("null·빈 검색어는 낱말 0", () => {
    expect(queryTerms(null)).toEqual({ terms: [], split: null });
    expect(queryTerms("")).toEqual({ terms: [], split: null });
  });
});

describe("URL 쿼리 → 검색 옵션 (모르는 값은 닫힌 쪽)", () => {
  test("모든 칸이 맞으면 그대로", () => {
    const o = parseSearchParams(new URLSearchParams("q=+취득세+&tab=article&section=tax&type=reported_news&region=1100000000&from=2026-10-01&to=2026-10-31&page=2"));
    expect(o).toEqual({ q: "취득세", tab: "article", section: "tax", contentType: "reported_news", region: "1100000000", from: "2026-10-01", to: "2026-10-31", page: 2 });
  });

  test.each([
    ["tab=places", { tab: "all" }],
    ["section=news", { section: null }],
    ["type=digest", { contentType: null }],
    ["region=11000", { region: null }],
    ["from=2026-02-30", { from: null }],
    ["from=2026-10-31&to=2026-10-01", { from: null, to: null }],
    ["page=0", { page: 1 }],
    ["page=-3", { page: 1 }],
    ["page=abc", { page: 1 }],
    ["page=1.5", { page: 1 }],
  ])("%s → %o", (qs, expected) => {
    expect(parseSearchParams(new URLSearchParams(qs))).toMatchObject(expected);
  });

  test("Next.js searchParams 모양(배열 값)도 첫 값으로, 검색어는 앞 100글자", () => {
    const o = parseSearchParams({ q: [`${"가".repeat(120)}`, "둘째"], tab: ["glossary"] });
    expect(Array.from(o.q)).toHaveLength(100);
    expect(o.tab).toBe("glossary");
  });
});

describe("DB 인자", () => {
  const base = parseSearchParams(new URLSearchParams("q=취득세"));

  test("전체 탭 — 종류 거르개 없음, 1쪽 20개", () => {
    expect(searchArgs(base)).toEqual({
      p_query: "취득세",
      p_kinds: null,
      p_section: null,
      p_content_type: null,
      p_region: null,
      p_from: null,
      p_to: null,
      p_limit: 20,
      p_offset: 0,
      p_per_kind: null,
    });
  });

  test("탭 → 종류, 쪽 → 건너뛰기, 종류별 묶음은 건너뛰기 0", () => {
    expect(searchArgs({ ...base, tab: "tracker", page: 3 })).toMatchObject({ p_kinds: ["tracker"], p_offset: 40, p_limit: 20 });
    expect(searchArgs({ ...base, page: 3 }, { perKind: 3 })).toMatchObject({ p_kinds: null, p_offset: 0, p_per_kind: 3 });
    expect(searchArgs(base, { perKind: 99, pageSize: 999 })).toMatchObject({ p_per_kind: SEARCH_LIMITS.maxPerKind, p_limit: SEARCH_LIMITS.maxPageSize });
  });

  test("부를 것이 없으면 null — 남는 글자 없는 검색어 · 종류 없는 탭 · 건너뛰기 한도를 넘는 쪽", () => {
    expect(searchArgs({ ...base, q: "  ?!·  " })).toBeNull();
    expect(searchArgs({ ...base, tab: "event" })).toBeNull();
    expect(searchArgs({ ...base, tab: "expert" })).toBeNull();
    expect(searchArgs({ ...base, page: SEARCH_MAX_PAGE })).toMatchObject({ p_offset: SEARCH_LIMITS.maxOffset });
    expect(searchArgs({ ...base, page: SEARCH_MAX_PAGE + 1 })).toBeNull();
  });
});

describe("행 → 보기 값", () => {
  test("기사 — 주소 /news/[slug], 유형 배지 글자, 형식(일반이면 null), 한국 날짜", () => {
    const v = searchHitView(row({ meta: { format: "cardnews", label: "none", partner_badge_name: null, region_codes: ["1100000000"] } }), CLOSED_FEATURES);
    expect(v).toMatchObject({ kind: "article", href: "/news/a-1", typeLabel: "해설", format: "cardnews", publishedOn: "2026-10-02", sponsor: null, sponsorBadge: null, regionCodes: ["1100000000"], sectionName: "지방세" });
  });

  test("광고는 유형 배지 '광고', 공동 기획은 유형 배지 대신 '공동 기획 ○○' (W2-b #49), 유형 없는 이관 기사는 '기사'", () => {
    const ad = searchHitView(row({ content_type: "sponsored", meta: { label: "ad" } }), CLOSED_FEATURES);
    expect(ad).toMatchObject({ typeLabel: "광고", sponsor: { kind: "ad" } });
    const co = searchHitView(row({ content_type: "sponsored", meta: { label: "co_planned", partner_badge_name: "한빛세무법인" } }), CLOSED_FEATURES);
    expect(co?.typeLabel).toBe("공동 기획 한빛세무법인");
    expect(co).toMatchObject({ sponsor: { kind: "co_planned", partner: "한빛세무법인" } });
    expect(searchHitView(row({ content_type: null }), CLOSED_FEATURES)?.typeLabel).toBe("기사");
  });

  test("트래커 — 기능 키 amendments가 꺼지면 링크 0이고 현재 단계 원문 링크, 켜지면 트래커 주소", () => {
    const r = row({ kind: "tracker", slug: "reform-2026", section: "tax", content_type: null, meta: { stage: "announced", stage_on: "2026-08-01", source_url: "https://www.mois.go.kr/x" } });
    expect(searchHitView(r, CLOSED_FEATURES)).toMatchObject({ kind: "tracker", href: null, typeLabel: "개정 트래커", stage: "announced", stageOn: "2026-08-01", sourceUrl: "https://www.mois.go.kr/x" });
    expect(searchHitView(r, { ...CLOSED_FEATURES, amendments: true })?.href).toBe("/tax/amendments/reform-2026");
    expect(searchHitView(row({ ...r, meta: { source_url: "javascript:alert(1)" } }), CLOSED_FEATURES)).toMatchObject({ sourceUrl: null });
  });

  test("용어 — 기능 키 glossary가 꺼지면 링크 0(용어와 쉬운 풀이만), 켜지면 그 용어의 용어사전 쪽 /glossary/[번호] (3단계)", () => {
    const r = row({ kind: "glossary", ref: "7", slug: "7", title: "취득세", section: null, content_type: null, meta: { reading: null, sections: ["tax", "nope"] } });
    expect(searchHitView(r, { ...ALL_OPEN, glossary: false })).toMatchObject({ kind: "glossary", href: null, typeLabel: "용어", sections: ["tax"] });
    expect(searchHitView(r, CLOSED_FEATURES)?.href).toBeNull();
    expect(searchHitView(r, { ...CLOSED_FEATURES, glossary: true })?.href).toBe("/glossary/7");
  });

  test("지역 — region_hubs가 켜졌을 때만 /local/[sido](/[sigungu]), 시·군·구는 상위 시·도 주소가 없으면 그리지 않는다", () => {
    const gu = row({ kind: "region", ref: "1120000000", slug: "seongdong", title: "성동구", section: "local", content_type: null, meta: { level: "sigungu", parent_slug: "seoul", parent_name: "서울특별시" } });
    expect(searchHitView(gu, CLOSED_FEATURES)).toMatchObject({ href: null, code: "1120000000", level: "sigungu", parentName: "서울특별시", typeLabel: "지역" });
    expect(searchHitView(gu, { ...CLOSED_FEATURES, region_hubs: true })?.href).toBe("/local/seoul/seongdong");
    const sido = row({ kind: "region", ref: "1100000000", slug: "seoul", title: "서울특별시", section: "local", content_type: null, meta: { level: "sido", parent_slug: null } });
    expect(searchHitView(sido, { ...CLOSED_FEATURES, region_hubs: true })?.href).toBe("/local/seoul");
    expect(searchHitView({ ...gu, meta: { level: "sigungu" } }, ALL_OPEN)).toBeNull();
  });

  test("상황·분야·인물 — 열린 화면 주소, 지자체뉴스 하위 분야는 그리지 않는다", () => {
    expect(searchHitView(row({ kind: "situation", slug: "car-sold", meta: { pictogram: "car-sold" } }), CLOSED_FEATURES)).toMatchObject({ href: "/situations/car-sold", typeLabel: "상황", pictogram: "car-sold" });
    expect(searchHitView(row({ kind: "category", slug: "columns", section: "finance", content_type: null, meta: {} }), CLOSED_FEATURES)).toMatchObject({ href: "/finance/columns", typeLabel: "분야" });
    expect(searchHitView(row({ kind: "category", slug: "weekly", section: "local", meta: {} }), ALL_OPEN)).toBeNull();
    expect(searchHitView(row({ kind: "person", slug: "kim", section: null, content_type: null, meta: { roles: ["reporter"] } }), CLOSED_FEATURES)).toMatchObject({ href: "/people/kim", typeLabel: "기자·필자", roles: ["reporter"] });
  });

  test("모르는 종류(명소·맛집 등)·빈 제목·분야 없는 기사는 그리지 않는다", () => {
    expect(searchHitView(row({ kind: "place" }), ALL_OPEN)).toBeNull();
    expect(searchHitView(row({ title: " " }), ALL_OPEN)).toBeNull();
    expect(searchHitView(row({ section: null }), ALL_OPEN)).toBeNull();
  });
});

describe("결과 — 탭 숫자·전체 수·다음 쪽", () => {
  const o = { q: "취득세", page: 1 };

  test("종류별 수는 모든 종류(0 포함), 다음 쪽은 남은 결과가 있을 때만", () => {
    const rows = [row({ ref: "1", total_count: "25", kind_counts: { article: 25, glossary: 2 } }), row({ ref: "2", total_count: "25", kind_counts: { article: 25, glossary: 2 } })];
    const r = toSearchResult(rows, CLOSED_FEATURES, o, { p_limit: 2, p_offset: 0, p_per_kind: null });
    expect(r.counts).toEqual({ region: 0, situation: 0, tracker: 0, glossary: 2, category: 0, article: 25, person: 0 });
    expect(r.total).toBe(25);
    expect(r.items.map((i) => i.ref)).toEqual(["1", "2"]);
    expect(r.hasMore).toBe(true);
    expect(toSearchResult(rows, CLOSED_FEATURES, o, { p_limit: 2, p_offset: 23, p_per_kind: null }).hasMore).toBe(false);
    expect(toSearchResult(rows, CLOSED_FEATURES, o, { p_limit: 50, p_offset: 1000, p_per_kind: null }).hasMore).toBe(false);
    expect(toSearchResult(rows, CLOSED_FEATURES, o, { p_limit: 70, p_offset: 0, p_per_kind: 10 }).hasMore).toBe(false);
  });

  test("다시 찾은 낱말은 DB가 쓴 낱말 그대로, 0건이면 정규화 낱말", () => {
    expect(toSearchResult([row({ query_terms: ["차", "팔았"] })], CLOSED_FEATURES, { q: "차 팔았", page: 1 }, { p_limit: 20, p_offset: 0 }).terms).toEqual(["차", "팔았"]);
    expect(toSearchResult([], CLOSED_FEATURES, { q: "차 팔았", page: 1 }, { p_limit: 20, p_offset: 0 })).toMatchObject({ terms: ["차팔았"], total: 0, items: [], hasMore: false });
    expect(emptySearchResult({ q: "", page: 1 })).toMatchObject({ terms: [], total: 0, pageSize: 20 });
  });
});

describe("탭 숫자 다시 읽기 (2단계 — 고른 탭·쪽에 행이 없을 때)", () => {
  const base = { q: "취득세", tab: "tracker" as const, section: "tax" as const, contentType: null, region: null, from: "2026-10-01", to: null, page: 3 };

  test("countArgs — 종류 거르개 없이 같은 거르개로 한 행만 (탭·쪽은 보지 않는다), 남는 글자 없는 검색어는 null", () => {
    expect(countArgs(base)).toEqual({
      p_query: "취득세",
      p_kinds: null,
      p_section: "tax",
      p_content_type: null,
      p_region: null,
      p_from: "2026-10-01",
      p_to: null,
      p_limit: 1,
      p_offset: 0,
      p_per_kind: null,
    });
    expect(countArgs({ ...base, q: "  ?!·  " })).toBeNull();
    expect(countArgs({ ...base, tab: "event" })).toMatchObject({ p_kinds: null, p_limit: 1 });
  });

  test("countsMissing — 행이 0이고 종류 탭이거나 2쪽 이후일 때만 (전체 탭 1쪽 0건은 정말 0건)", () => {
    expect(countsMissing([], { p_kinds: ["tracker"], p_offset: 0 })).toBe(true);
    expect(countsMissing([], { p_kinds: null, p_offset: 20 })).toBe(true);
    expect(countsMissing([], { p_kinds: null, p_offset: 0 })).toBe(false);
    expect(countsMissing([row({})], { p_kinds: ["article"], p_offset: 0 })).toBe(false);
  });

  test("withCounts — 탭 숫자와 쓴 낱말만 바꾸고 결과 목록·쪽은 그대로", () => {
    const empty = toSearchResult([], CLOSED_FEATURES, { q: "차 팔았", page: 3 }, { p_limit: 20, p_offset: 40, p_per_kind: null });
    const counted = withCounts(empty, [row({ kind_counts: { situation: 1, article: 3 }, query_terms: ["차", "팔았"] })]);
    expect(counted.counts).toEqual({ region: 0, situation: 1, tracker: 0, glossary: 0, category: 0, article: 3, person: 0 });
    expect(counted).toMatchObject({ terms: ["차", "팔았"], items: [], page: 3, total: 0, hasMore: false });
    expect(withCounts(empty, [])).toEqual(empty);
  });
});
