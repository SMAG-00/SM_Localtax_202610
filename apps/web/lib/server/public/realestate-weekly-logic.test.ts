import { describe, expect, test } from "vitest";
import { WEEKLY_MAX_ITEMS, WEEKLY_MIN_ITEMS, groupWeekly, isoWeekKst, weekLabel, weeklyDraftProblems, type WeeklyItemRow } from "./realestate-weekly-logic";

const row = (issue: number, rank: number, extra: Partial<WeeklyItemRow> = {}): WeeklyItemRow => ({
  issue_id: issue,
  week: "2026-43",
  published_at: "2026-10-23T01:00:00Z",
  rank,
  tax_items: ["취득세"],
  point: `포인트 ${rank}`,
  article_id: 100 + rank,
  slug: `a-${rank}`,
  title: `기사 ${rank}`,
  ...extra,
});
const rows = (issue: number, n: number, extra: Partial<WeeklyItemRow> = {}) => Array.from({ length: n }, (_, i) => row(issue, n - i, extra));
const ok = (n: number) => Array.from({ length: n }, () => ({ point: "취득세 신고 기한을 확인해 둘 시기입니다", taxItems: ["취득세"] }));

describe("재테크 포인트 호 묶기", () => {
  test("3건과 7건 호는 올리고 2건과 8건 호는 뺀다 (경계)", () => {
    const got = groupWeekly([...rows(1, 3), ...rows(2, 7), ...rows(3, 2), ...rows(4, 8)]);
    expect(got.map((i) => [i.issueId, i.items.length]).sort()).toEqual([[1, 3], [2, 7]]);
  });
  test("항목은 순서(rank)대로, 기사 주소는 /news/<slug>", () => {
    const [issue] = groupWeekly(rows(1, 3));
    expect(issue!.items.map((i) => i.rank)).toEqual([1, 2, 3]);
    expect(issue!.items[0]!.href).toBe("/news/a-1");
  });
  test("가장 최근 발행한 호가 먼저 온다", () => {
    const got = groupWeekly([...rows(1, 3, { published_at: "2026-10-16T01:00:00Z", week: "2026-42" }), ...rows(2, 3)]);
    expect(got.map((i) => i.week)).toEqual(["2026-43", "2026-42"]);
  });
});

describe("주 이름", () => {
  test.each([["2026-43", "2026년 43주차"], ["2026-05", "2026년 5주차"], ["2026-5", null], ["abc", null]])("%s -> %s", (w, label) => {
    expect(weekLabel(w)).toBe(label);
  });
});

describe("발행 전 검사", () => {
  test("3건과 7건은 통과", () => {
    expect(weeklyDraftProblems(ok(WEEKLY_MIN_ITEMS))).toEqual([]);
    expect(weeklyDraftProblems(ok(WEEKLY_MAX_ITEMS))).toEqual([]);
  });
  test("2건과 8건은 건수 문제가 하나 나온다", () => {
    expect(weeklyDraftProblems(ok(2))).toEqual([expect.stringContaining("3건 이상")]);
    expect(weeklyDraftProblems(ok(8))).toEqual([expect.stringContaining("7건 이하")]);
  });
  test("투자 권유 표현은 막는다", () => {
    const items = ok(3);
    items[1] = { point: "이 단지는 투자 유망합니다", taxItems: ["취득세"] };
    const got = weeklyDraftProblems(items);
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((m) => m.startsWith("2번 항목"))).toBe(true);
  });
  test("세액(숫자와 원)은 막는다", () => {
    const items = ok(3);
    items[0] = { point: "취득세 약 3,000,000원이 듭니다", taxItems: ["취득세"] };
    expect(weeklyDraftProblems(items).some((m) => m.startsWith("1번 항목") && m.includes("세액"))).toBe(true);
  });
  test("한 줄 60자 경계: 60자는 통과, 61자는 거부", () => {
    const base = ok(3);
    expect(weeklyDraftProblems([{ point: "가".repeat(60), taxItems: ["취득세"] }, base[1]!, base[2]!])).toEqual([]);
    expect(weeklyDraftProblems([{ point: "가".repeat(61), taxItems: ["취득세"] }, base[1]!, base[2]!])).toEqual([expect.stringContaining("60자 이하")]);
  });
  test("빈 한 줄과 세목 0개는 거부", () => {
    const items = ok(3);
    items[2] = { point: "  ", taxItems: [] };
    const got = weeklyDraftProblems(items);
    expect(got).toEqual(expect.arrayContaining([expect.stringContaining("3번 항목: 세금 관점 한 줄이 비어"), expect.stringContaining("3번 항목: 관련 세목")]));
  });
  test("운영 사전의 금지 표현도 함께 본다", () => {
    const items = ok(3);
    items[0] = { point: "무조건 확인해야 합니다", taxItems: ["취득세"] };
    expect(weeklyDraftProblems(items, ["무조건"]).length).toBeGreaterThan(0);
  });
});

describe("한국 시각 ISO 주", () => {
  test.each([
    ["2026-10-26T00:00:00+09:00", "2026-44"], // 월요일 0시
    ["2026-10-25T23:59:00+09:00", "2026-43"], // 일요일 밤
    ["2026-10-25T15:00:00Z", "2026-44"], // 협정 세계시 일요일 15시 = 한국 월요일 0시
    ["2027-01-03T12:00:00+09:00", "2026-53"], // 해 넘김: 2026년은 53주
    ["2027-01-04T12:00:00+09:00", "2027-01"],
  ])("%s -> %s", (iso, week) => {
    expect(isoWeekKst(new Date(iso))).toBe(week);
  });
});
