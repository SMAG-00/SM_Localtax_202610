// 공개 화면 틀 — 상단 메뉴·하위 메뉴·유틸 메뉴·정책 링크 (HOME-02 · HELP-05)
import { describe, expect, test } from "vitest";
import { buildChrome, closedChrome } from "./chrome-logic";
import { isBlockedPath } from "./constants";
import type { PublicCategoryRow } from "./rows";
import { CLOSED_FEATURES } from "./settings";

const cat = (id: number, section: string, slug: string, name: string, sort: number): PublicCategoryRow => ({ id, section, slug, name, intro: null, sort, needs_disclaimer: false, needs_tax_lens: false });
const CATEGORIES = [
  cat(1, "tax", "amendments", "개정 트래커", 10),
  cat(2, "tax", "interpretations", "해석", 20),
  cat(3, "tax", "columns", "칼럼", 30),
  cat(4, "realestate", "projects", "프로젝트 트래커", 20),
  cat(5, "realestate", "development-methods", "개발방법 비교", 10),
  cat(6, "local", "reporting", "자체 취재", 20),
];

describe("헤더 메뉴 (HOME-02)", () => {
  test("상단 메뉴는 4대 분야 정확히 4개, 이 순서", () => {
    const c = buildChrome(CATEGORIES, new Map(), CLOSED_FEATURES);
    expect(c.sections.map((s) => [s.label, s.href])).toEqual([
      ["지방세", "/tax"],
      ["부동산", "/realestate"],
      ["부동산개발금융", "/finance"],
      ["지자체뉴스", "/local"],
    ]);
  });

  test("하위 메뉴는 분야 데이터에서 — 기사가 있는 하위 분야만 분야 안 순서로, 공통 '뉴스 전체'는 끝에", () => {
    const counts = new Map([
      [2, 3],
      [1, 1],
      [3, 0],
      [4, 2],
      [5, 1],
      [6, 4],
    ]);
    const c = buildChrome(CATEGORIES, counts, CLOSED_FEATURES);
    expect(c.sections[0]!.children.map((x) => [x.label, x.href])).toEqual([
      ["개정 트래커", "/tax/amendments"],
      ["해석", "/tax/interpretations"],
      ["뉴스 전체", "/news?section=tax"],
    ]);
    expect(c.sections[1]!.children.map((x) => x.label)).toEqual(["개발방법 비교", "프로젝트 트래커", "뉴스 전체"]);
    expect(c.sections[2]!.children.map((x) => x.label)).toEqual(["뉴스 전체"]);
    // 지자체뉴스 하위 경로는 01B — 하위 분야를 메뉴에 내지 않는다
    expect(c.sections[3]!.children.map((x) => x.label)).toEqual(["뉴스 전체"]);
  });

  test("편집자가 분야를 비공개로 바꾸면(목록에서 빠지면) 메뉴에서 사라진다 — 배포 없이", () => {
    const counts = new Map([
      [1, 1],
      [2, 1],
    ]);
    const before = buildChrome(CATEGORIES, counts, CLOSED_FEATURES).sections[0]!.children.map((x) => x.label);
    const after = buildChrome(CATEGORIES.filter((c) => c.id !== 2), counts, CLOSED_FEATURES).sections[0]!.children.map((x) => x.label);
    expect(before).toContain("해석");
    expect(after).not.toContain("해석");
  });

  test("유틸 메뉴 — 기능 키가 꺼지면 링크 0, 켜진 것만 HOME-02 순서로 최대 5개", () => {
    expect(buildChrome(CATEGORIES, new Map(), CLOSED_FEATURES).utilities).toEqual([]);
    const some = buildChrome(CATEGORIES, new Map(), { ...CLOSED_FEATURES, search: true, calc: true });
    expect(some.utilities.map((u) => u.label)).toEqual(["계산기", "검색"]);
    const all = buildChrome(CATEGORIES, new Map(), { ...CLOSED_FEATURES, calc: true, experts: true, store: true, edu: true, search: true });
    expect(all.utilities.map((u) => u.href)).toEqual(["/calc", "/experts", "/store", "/edu", "/search"]);
  });

  test("정책 링크 — 공개 승인(기능 키) 전 0, 켜진 것만 7종 순서로", () => {
    expect(buildChrome(CATEGORIES, new Map(), CLOSED_FEATURES).policyLinks).toEqual([]);
    const opened = buildChrome(CATEGORIES, new Map(), { ...CLOSED_FEATURES, page_privacy: true, page_about: true });
    expect(opened.policyLinks.map((p) => [p.label, p.href])).toEqual([
      ["회사 소개", "/about"],
      ["개인정보처리방침", "/about/privacy"],
    ]);
  });

  test("메뉴의 모든 링크가 숨긴 경로·v1.2 경로가 아니다", () => {
    const c = buildChrome(CATEGORIES, new Map(CATEGORIES.map((x) => [x.id, 1])), Object.fromEntries(Object.keys(CLOSED_FEATURES).map((k) => [k, true])) as typeof CLOSED_FEATURES);
    const hrefs = [...c.sections.flatMap((s) => [s.href, ...s.children.map((x) => x.href)]), ...c.utilities.map((u) => u.href), ...c.policyLinks.map((p) => p.href)];
    expect(hrefs.filter(isBlockedPath)).toEqual([]);
  });
});

describe("닫힌 화면 틀 (공개 데이터를 읽지 못할 때)", () => {
  test("상단 메뉴 4개와 공통 뉴스 전체만 — 유틸 메뉴·정책 링크 0", () => {
    const c = closedChrome();
    expect(c.sections.map((s) => s.href)).toEqual(["/tax", "/realestate", "/finance", "/local"]);
    expect(c.sections.map((s) => s.children.map((x) => x.label))).toEqual([["뉴스 전체"], ["뉴스 전체"], ["뉴스 전체"], ["뉴스 전체"]]);
    expect(c.utilities).toEqual([]);
    expect(c.policyLinks).toEqual([]);
  });
});
