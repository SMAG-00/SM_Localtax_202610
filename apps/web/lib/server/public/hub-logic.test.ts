// 4대 분야 허브·뉴스 전체 규칙 (CAT-02 · LG-08) — 탭(기사 0건 숨김)·지자체 허브 블록·쪽 번호·닫힌 허브
import { describe, expect, test } from "vitest";
import type { LocalTopic } from "@ltr/ui";
import { buildChrome } from "./chrome-logic";
import { SECTION_KEYS } from "./constants";
import { ALL_TAB, closedHubData, hubTabs, localBlocks, newsTabs, pageNumber } from "./hub-logic";
import type { PublicCategoryRow } from "./rows";
import { CLOSED_FEATURES } from "./settings";
import { listItem } from "./test-items";

const cat = (id: number, section: string, slug: string, name: string, sort: number): PublicCategoryRow => ({ id, section, slug, name, intro: null, sort, needs_disclaimer: false, needs_tax_lens: false });
const CATEGORIES = [
  cat(1, "tax", "amendments", "개정 트래커", 10),
  cat(2, "tax", "interpretations", "해석", 20),
  cat(3, "tax", "columns", "칼럼", 30),
  cat(4, "finance", "trust-pf", "신탁·PF 구조", 10),
  cat(5, "local", "reporting", "자체 취재", 20),
];
const NO_TOPICS = new Map<LocalTopic, number>();

describe("허브 탭 (CAT-02 — 기사 0건 하위 분야는 탭·메뉴에서 숨김)", () => {
  test("[전체] + 기사 있는 하위 분야만 분야 안 순서로 — 기사 0건(칼럼)은 없다", () => {
    const counts = new Map([
      [2, 4],
      [1, 1],
      [3, 0],
    ]);
    expect(hubTabs("tax", CATEGORIES, counts, NO_TOPICS)).toEqual([
      { id: ALL_TAB, label: "전체", href: "/tax" },
      { id: "amendments", label: "개정 트래커", href: "/tax/amendments" },
      { id: "interpretations", label: "해석", href: "/tax/interpretations" },
    ]);
  });

  test("기사 있는 하위 분야가 하나도 없으면 탭째 없다 — [전체] 하나뿐인 탭 0", () => {
    expect(hubTabs("finance", CATEGORIES, new Map([[4, 0]]), NO_TOPICS)).toEqual([]);
    expect(hubTabs("realestate", CATEGORIES, new Map(), NO_TOPICS)).toEqual([]);
  });

  test("지자체뉴스는 하위 분야(자체 취재 등) 대신 기사 있는 편집 분야를 분야 필터 순서로 — 주소 /local?topic=", () => {
    const topics = new Map<LocalTopic, number>([
      ["urban_policy", 2],
      ["local_tax", 1],
      ["local_finance", 0],
    ]);
    expect(hubTabs("local", CATEGORIES, new Map([[5, 9]]), topics)).toEqual([
      { id: ALL_TAB, label: "전체", href: "/local" },
      { id: "local_tax", label: "지방세", href: "/local?topic=local_tax" },
      { id: "urban_policy", label: "도시정책", href: "/local?topic=urban_policy" },
    ]);
  });

  test("허브 탭과 헤더 하위 메뉴는 같은 목록이다 (뉴스 전체만 메뉴에 더한다)", () => {
    const counts = new Map([
      [1, 1],
      [2, 2],
      [4, 3],
    ]);
    const topics = new Map<LocalTopic, number>([["realestate", 1]]);
    const chrome = buildChrome(CATEGORIES, counts, CLOSED_FEATURES, topics);
    for (const [i, section] of SECTION_KEYS.entries()) {
      const fromTabs = hubTabs(section, CATEGORIES, counts, topics)
        .filter((t) => t.id !== ALL_TAB)
        .map((t) => [t.label, t.href]);
      const fromMenu = chrome.sections[i]!.children.slice(0, -1).map((c) => [c.label, c.href]);
      expect(fromMenu).toEqual(fromTabs);
      expect(chrome.sections[i]!.children.at(-1)).toMatchObject({ label: "뉴스 전체", href: `/news?section=${section}` });
    }
  });
});

describe("뉴스 전체 탭 (CAT-02 '허브 탭 4개')", () => {
  test("[전체] + 4대 분야 탭 — 글자는 PRD-01A 3장 화면 표(지방세·부동산·개발금융·지자체)", () => {
    expect(newsTabs().map((t) => [t.label, t.href])).toEqual([
      ["전체", "/news"],
      ["지방세", "/news?section=tax"],
      ["부동산", "/news?section=realestate"],
      ["개발금융", "/news?section=finance"],
      ["지자체", "/news?section=local"],
    ]);
  });
});

describe("지자체 허브 블록 (LG-08 ② 지방세·지방재정 ③ 부동산·개발)", () => {
  const local = (editorialField: string | null, over = {}) => listItem({ section: "local", editorialField, ...over });

  test("블록마다 그 편집 분야 기사만 — 지방재정은 ②, 도시정책은 ③. 다른 분야·편집 분야 없는 기사는 빠진다", () => {
    const tax = [local("local_tax", { id: 1 }), local("local_finance", { id: 2 }), local("realestate", { id: 3 }), local(null, { id: 4 }), listItem({ id: 5, section: "tax", editorialField: "local_tax" })];
    const re = [local("realestate", { id: 6 }), local("urban_policy", { id: 7 }), local("local_tax", { id: 8 })];
    const blocks = localBlocks(tax, re);
    expect(blocks?.localTax.map((a) => a.id)).toEqual([1, 2]);
    expect(blocks?.realEstate.map((a) => a.id)).toEqual([6, 7]);
  });

  test("블록 한 칸은 4장까지 (PRD-00 8.10 — 기사 카드 2~4장)", () => {
    const many = Array.from({ length: 6 }, (_, i) => local("local_tax", { id: 100 + i }));
    expect(localBlocks(many, [])?.localTax.map((a) => a.id)).toEqual([100, 101, 102, 103]);
  });

  test("두 블록이 모두 0건이면 null — 블록 자리째 없다 (빈 블록 0)", () => {
    expect(localBlocks([], [])).toBeNull();
    expect(localBlocks([local(null)], [local("local_tax")])).toBeNull();
    expect(localBlocks([], [local("urban_policy")])).toMatchObject({ localTax: [], realEstate: [expect.objectContaining({ editorialField: "urban_policy" })] });
  });
});

describe("쪽 번호·닫힌 허브", () => {
  test.each([
    [undefined, 1],
    [1, 1],
    [3, 3],
    [0, 1],
    [-2, 1],
    [1.5, 1],
    [Number.NaN, 1],
  ])("%s → %s", (raw, expected) => expect(pageNumber(raw)).toBe(expected));

  test("닫힌 허브 — 머리(이름·아이브로·주소)만 있고 탭·목록·상황 카드·용어 0, noindex 아님", () => {
    const hub = closedHubData("finance");
    expect(hub).toMatchObject({ name: "부동산개발금융", eyebrow: "DEVELOPMENT FINANCE", href: "/finance", tabs: [], latest: [], situations: [], terms: [], blocks: null, noindex: false, unavailable: true });
  });
});
