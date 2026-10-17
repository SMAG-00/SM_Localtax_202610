// 허브·하위 분야 목록·뉴스 전체·상황 페이지 화면 값 (CAT-02 · UX-05)
import { describe, expect, test } from "vitest";
import { HUB_PARTS, hubParts, listRobots, pagerLinks, parsePage, regionHref, reviewedLine, situationSteps } from "./hub-view";

const hub = (over: Partial<Parameters<typeof hubParts>[0]> = {}) => ({ blocks: null, latest: [1], situations: [1], terms: [1], noindex: false, ...over });

describe("허브 골격 (CAT-02 — 네 허브 같은 순서, 0건 부분은 빠짐)", () => {
  test("모두 있으면 머리 → 분야 고유 블록 → 최신 목록 → 상황 카드 → 관련 용어, 바탕은 ivory부터 번갈아", () => {
    expect(hubParts(hub({ blocks: {} })).map((p) => `${p.key}:${p.tone}`)).toEqual(["head:ivory", "blocks:ivory-dark", "latest:ivory", "situations:ivory-dark", "terms:ivory"]);
    expect(hubParts(hub({ blocks: {} })).map((p) => p.key)).toEqual([...HUB_PARTS]);
  });

  test("분야 고유 블록이 없는 허브(지방세·부동산·개발금융 — 01B 전)는 그 자리만 빠지고 순서는 같다", () => {
    expect(hubParts(hub()).map((p) => p.key)).toEqual(["head", "latest", "situations", "terms"]);
  });

  test("상황 카드 0장이면 줄을 숨긴다 (UX-05 빈 칸 노출 0) — 기사도 용어도 없으면 머리만", () => {
    expect(hubParts(hub({ situations: [] })).map((p) => p.key)).toEqual(["head", "latest", "terms"]);
    expect(hubParts(hub({ latest: [], situations: [], terms: [] })).map((p) => p.key)).toEqual(["head"]);
  });

  test("고른 편집 분야에 기사가 0건이면 최신 목록 자리에 허브 안내를 둔다 (목록 부분은 남는다)", () => {
    expect(hubParts(hub({ latest: [], noindex: true, situations: [] })).map((p) => p.key)).toEqual(["head", "latest", "terms"]);
  });
});

describe("검색 노출 — 기사 0건 목록은 noindex (CAT-02 '빈 목록 색인 0')", () => {
  test("0건이면 noindex·nofollow, 아니면 루트 설정 그대로", () => {
    expect(listRobots(true)).toEqual({ index: false, follow: false });
    expect(listRobots(false)).toBeUndefined();
  });
});

describe("쪽 넘김", () => {
  test.each([
    [undefined, 1],
    ["1", 1],
    ["2", 2],
    [["3", "9"], 3],
    ["0", 1],
    ["-1", 1],
    ["2.5", 1],
    ["abc", 1],
    ["9999999", 1],
  ])("page=%j → %s", (raw, expected) => expect(parsePage(raw as string | string[] | undefined)).toBe(expected));

  test("이전·다음 주소 — 다른 쿼리는 그대로, 1쪽은 page를 뺀다, 마지막 쪽에는 다음이 없다", () => {
    expect(pagerLinks("/news", { section: "tax" }, 1, true)).toEqual({ prev: null, next: "/news?section=tax&page=2" });
    expect(pagerLinks("/news", { section: "tax" }, 2, true)).toEqual({ prev: "/news?section=tax", next: "/news?section=tax&page=3" });
    expect(pagerLinks("/tax/interpretations", {}, 3, false)).toEqual({ prev: "/tax/interpretations?page=2", next: null });
    expect(pagerLinks("/local", { topic: null }, 1, false)).toEqual({ prev: null, next: null });
  });
});

describe("상황 페이지 (UX-05)", () => {
  test("먼저 확인할 것 → 단계 타임라인 — 때·할 일은 있을 때만", () => {
    expect(situationSteps([{ title: "연세액 납부 여부", when: "판 날", note: "영수증을 찾아 둡니다" }, { title: "말소일" }, { title: "환급 계좌", note: "통장 사본" }])).toEqual([
      { title: "연세액 납부 여부", when: "판 날", note: "영수증을 찾아 둡니다" },
      { title: "말소일" },
      { title: "환급 계좌", note: "통장 사본" },
    ]);
  });

  test("지역 칩 주소는 이 상황 페이지 안에서 지역 쿼리만 바꾼다", () => {
    expect(regionHref("/situations/home-bought", "1100000000")).toBe("/situations/home-bought?region=1100000000");
    expect(regionHref("/situations/home-bought", null)).toBe("/situations/home-bought");
  });

  test("감수일 줄 — 감수 기록이 없으면 줄째 없다", () => {
    expect(reviewedLine("2026-10-18")).toBe("세무 감수 2026-10-18");
    expect(reviewedLine(null)).toBeNull();
  });
});
