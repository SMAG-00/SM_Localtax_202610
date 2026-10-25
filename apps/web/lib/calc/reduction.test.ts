import { describe, expect, it } from "vitest";
import { parseDeterminationTable } from "@ltr/tax-engine";
import { reductionBlock } from "./reduction";
import { acquisitionFacts } from "./acquisition";

// 시험용 감면 판정표 - 지어낸 한도 1000 (실제 감면 요건 아님)
const TABLE = parseDeterminationTable({
  kind: "reduction",
  version: "2099.01",
  label: "시험용 감면 판정표",
  items: [
    {
      id: "first_home",
      label: "시험용 감면 가",
      law: "시험용 조문",
      requirements: [
        { id: "house_count", label: "시험용: 가진 주택 한 채", check: { op: "eq", field: "house_count", value: 1 } },
        { id: "price_limit", label: "시험용: 가액 한도 이하", check: { op: "lte", field: "price", value: 1000 } },
        { id: "no_history", label: "시험용: 이력 없음", check: { op: "manual" } },
      ],
    },
  ],
});

describe("감면 점검 블록 (CALC-13)", () => {
  const base = { owner_type: "INDIVIDUAL", property_kind: "HOUSE", cause: "PAID", house_count: 1 } as const;
  it("서명된(활성) 판정표가 없으면 감면 카드를 숨긴다", () => {
    expect(reductionBlock(null, { price: 1 })).toEqual({ state: "hidden" });
  });
  it("환급 판정표를 넘겨도 감면 블록은 숨긴다", () => {
    const refund = parseDeterminationTable({ kind: "refund", version: "2099.01", label: "시험용", items: [{ id: "i1", label: "x", rules: [{ id: "r1", when: { op: "manual" }, likelihood: "낮음" }], default: "낮음" }] });
    expect(reductionBlock(refund, {})).toEqual({ state: "hidden" });
  });
  it("한도 이하면 해당될 수 있음, 한도 + 1이면 해당 안 됨 -> 0건 안내", () => {
    const at = reductionBlock(TABLE, { ...base, price: 1000 });
    expect(at).toMatchObject({ state: "found", count: 1, tableVersion: "2099.01" });
    const over = reductionBlock(TABLE, { ...base, price: 1001 });
    expect(over).toMatchObject({ state: "none", tableVersion: "2099.01", checked: ["시험용 감면 가"] });
  });
  it("주택 수 1 vs 2에서 판정이 바뀐다", () => {
    expect(reductionBlock(TABLE, { ...base, price: 5, house_count: 1 }).state).toBe("found");
    expect(reductionBlock(TABLE, { ...base, price: 5, house_count: 2 }).state).toBe("none");
  });
  it("직접 확인할 요건은 입력으로 확인됨으로 바뀌지 않는다", () => {
    const b = reductionBlock(TABLE, { ...base, price: 5 });
    if (b.state !== "found") throw new Error("state");
    expect(b.items[0]!.requirements.map((r) => [r.id, r.state])).toEqual([["house_count", "입력으로 확인"], ["price_limit", "입력으로 확인"], ["no_history", "직접 확인 필요"]]);
  });
  it("입력이 없는 칸은 직접 확인 필요이고 해당 안 됨으로 몰지 않는다", () => {
    expect(reductionBlock(TABLE, {}).state).toBe("found");
  });
  it("폼 상태에서 만든 판정표 입력으로 같은 결과가 나온다", () => {
    const facts = acquisitionFacts({ ownerType: "INDIVIDUAL", propertyKind: "HOUSE", cause: "PAID", price: 1000, houseCount: 1 });
    expect(reductionBlock(TABLE, facts).state).toBe("found");
    expect(reductionBlock(TABLE, acquisitionFacts({ ownerType: "INDIVIDUAL", propertyKind: "HOUSE", cause: "PAID", price: 1001, houseCount: 1 })).state).toBe("none");
  });
});
