// 홈 최신 인기글 (PO 2026-11-01 — 바로가기 블록 자리): 히어로 바로 뒤, 순위 순서 그대로 최대 5건, 0건이면 섹션 0, [더 보기]는 많이 본 기사 목록
import { describe, expect, test } from "vitest";
import { homeSections, type HomeInput } from "./home-logic";
import { listItem } from "./test-items";

const base: HomeInput = {
  coreMessage: "핵심 메시지",
  searchEnabled: true,
  searchChips: [],
  latestReports: [],
  weeklyHot: null,
  trackers: { items: [], source: "none" },
  stories: [],
  column: null,
  product: null,
  experts: null,
};
const keys = (i: HomeInput) => homeSections(i).map((s) => s.key);
const popularOf = (i: HomeInput) => {
  const s = homeSections(i).find((x) => x.key === "popular");
  return s && s.key === "popular" ? s : null;
};

describe("홈 최신 인기글", () => {
  test("인기글을 안 넘기거나 0건이면 섹션 0 — 홈은 hero, fields", () => {
    expect(keys(base)).toEqual(["hero", "fields"]);
    expect(keys({ ...base, popular: [] })).toEqual(["hero", "fields"]);
  });

  test("인기글이 있으면 hero 바로 뒤, fields 앞에 한 섹션 — 바로가기 블록은 없다", () => {
    expect(keys({ ...base, popular: [listItem({ id: 1 })] })).toEqual(["hero", "popular", "fields"]);
  });

  test("순위 순서를 그대로 두고 5건까지만 (6건째부터 빠진다 — 경계)", () => {
    const six = [9, 3, 7, 1, 5, 2].map((id) => listItem({ id }));
    expect(popularOf({ ...base, popular: six })?.items.map((a) => a.id)).toEqual([9, 3, 7, 1, 5]);
    expect(popularOf({ ...base, popular: six.slice(0, 5) })?.items).toHaveLength(5);
  });

  test("[더 보기]는 많이 본 기사 목록 /news/popular", () => {
    expect(popularOf({ ...base, popular: [listItem({ id: 1 })] })?.moreHref).toBe("/news/popular");
  });
});
