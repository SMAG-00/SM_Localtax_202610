import { describe, expect, it } from "vitest";
import { CASE_STRUCTURE_TYPES, NO_MATCHING_CASES, filterCaseEntries } from "./case-filter";

const rows = [
  { id: 1, structure_type: "completion_guarantee", issues: ["시험용 쟁점 가"] },
  { id: 2, structure_type: "trust", issues: ["시험용 쟁점 나", "시험용 쟁점 가"] },
  { id: 3, structure_type: "completion_guarantee", issues: [] },
];

describe("금융 사례 DB 필터 (DF-07)", () => {
  it("구조 유형 필터를 걸면 결과가 모두 그 유형이다", () => {
    const r = filterCaseEntries(rows, { structureType: "completion_guarantee" });
    expect(r.rows.map((x) => x.id)).toEqual([1, 3]);
    expect(r.rows.every((x) => x.structure_type === "completion_guarantee")).toBe(true);
    expect(r.message).toBeNull();
    expect(r.canClear).toBe(true);
  });

  it("쟁점 필터는 쟁점이 정확히 같은 사례만 남긴다", () => {
    expect(filterCaseEntries(rows, { issue: "시험용 쟁점 가" }).rows.map((x) => x.id)).toEqual([1, 2]);
    expect(filterCaseEntries(rows, { structureType: "trust", issue: "시험용 쟁점 가" }).rows.map((x) => x.id)).toEqual([2]);
  });

  it("0건이면 안내 문구와 필터 해제를 낸다", () => {
    const r = filterCaseEntries(rows, { structureType: "reit" });
    expect(r.rows).toEqual([]);
    expect(r.message).toBe(NO_MATCHING_CASES);
    expect(r.canClear).toBe(true);
  });

  it("필터가 없으면 전부 보이고 0건이어도 안내 문구는 없다 (처음부터 비어 있는 목록)", () => {
    expect(filterCaseEntries(rows, {}).rows).toHaveLength(3);
    const empty = filterCaseEntries([], {});
    expect(empty.message).toBeNull();
    expect(empty.canClear).toBe(false);
  });

  it("목록에 없는 구조 유형 값은 필터로 치지 않는다", () => {
    expect(CASE_STRUCTURE_TYPES).toHaveLength(4);
    const r = filterCaseEntries(rows, { structureType: "없는유형" });
    expect(r.rows).toHaveLength(3);
    expect(r.canClear).toBe(false);
  });
});
