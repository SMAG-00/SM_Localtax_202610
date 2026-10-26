import { describe, expect, it } from "vitest";
import { TOTAL_COST_REFERENCE_CODES, composeTotalCost } from "@ltr/tax-engine";
import { REFERENCE_CODES } from "@/lib/calc/result-view";
import { RULESET } from "@/lib/calc/fixture.test-util";
import { barsTotal, buildTotalCostInput, chartBars, compareScenarios, parseTotalCostPolicy, tableRows, type TotalCostForm } from "./total-cost";

// 정책 값은 모두 시험용으로 지어낸 값이다 (PO 입력 전).
const POLICY_RAW = { max_holding_years: 7, max_rate_bp: 2000, max_extra_items: 2, compare_years: [3, 5] };
const POLICY = parseTotalCostPolicy(POLICY_RAW)!;
const OPEN = { acquisition: true, property: true, comprehensive: true };
const FORM: TotalCostForm = { ownerType: "INDIVIDUAL", price: 500_000_000, exclusiveAreaSqm: 84, houseCount: 1, isAdjustedArea: false, holdingYears: 3, publishedPrice: 300_000_000 };

describe("정책 모양 (설정 total_cost_policy)", () => {
  it("빈 객체·칸 누락·모르는 칸·음수·소수·비교 연수가 상한 초과면 null(기능 닫힘)", () => {
    expect(parseTotalCostPolicy({})).toBeNull();
    expect(parseTotalCostPolicy(null)).toBeNull();
    expect(parseTotalCostPolicy({ ...POLICY_RAW, extra: 1 })).toBeNull();
    expect(parseTotalCostPolicy({ max_holding_years: 7, max_rate_bp: 2000, max_extra_items: 2 })).toBeNull();
    expect(parseTotalCostPolicy({ ...POLICY_RAW, max_rate_bp: -1 })).toBeNull();
    expect(parseTotalCostPolicy({ ...POLICY_RAW, max_extra_items: 1.5 })).toBeNull();
    expect(parseTotalCostPolicy({ ...POLICY_RAW, compare_years: [3, 8] })).toBeNull();
    expect(parseTotalCostPolicy({ ...POLICY_RAW, compare_years: [3] })).toBeNull();
  });
  it("모양이 맞으면 읽는다 (상한과 같은 비교 연수는 허용)", () => {
    expect(parseTotalCostPolicy({ ...POLICY_RAW, compare_years: [0, 7] })).toMatchObject({ maxHoldingYears: 7, compareYears: [0, 7] });
  });
});

describe("입력 변환", () => {
  it("필수 칸이 비면 입력을 만들지 않고 빠진 칸을 알린다", () => {
    const b = buildTotalCostInput({}, POLICY, OPEN);
    expect(b.input).toBeNull();
    expect(b.missing).toEqual(["ownerType", "price", "holdingYears"]);
  });

  it("보유 연수·부대비용 개수·금리 상한을 정책으로 막는다 (상한은 허용, 상한+1은 거부)", () => {
    expect(buildTotalCostInput({ ...FORM, holdingYears: 7 }, POLICY, OPEN).input).not.toBeNull();
    expect(buildTotalCostInput({ ...FORM, holdingYears: 8 }, POLICY, OPEN).outOfRange).toEqual(["holdingYears"]);
    const two = [{ label: "시험용 가", amount: 1 }, { label: "시험용 나", amount: 2 }];
    expect(buildTotalCostInput({ ...FORM, extraCosts: two }, POLICY, OPEN).input).not.toBeNull();
    expect(buildTotalCostInput({ ...FORM, extraCosts: [...two, { label: "시험용 다", amount: 3 }] }, POLICY, OPEN).outOfRange).toEqual(["extraCosts"]);
    expect(buildTotalCostInput({ ...FORM, loanPrincipal: 10, loanRateBp: 2001 }, POLICY, OPEN).outOfRange).toEqual(["loanRateBp"]);
  });

  it("공시가격을 모르겠어요로 두면 추정하지 않고 보유세를 빼며 미포함으로 알린다", () => {
    const noPrice: TotalCostForm = { ...FORM, publishedPrice: undefined };
    const b = buildTotalCostInput(noPrice, POLICY, OPEN);
    expect(b.notIncluded).toEqual(["보유세"]);
    const r = composeTotalCost(b.input!, RULESET);
    expect(r.years).toHaveLength(1);
    expect(r.years[0]!.holdingTax).toBe(0);
  });

  it("보유 0년이면 공시가격을 몰라도 미포함 표시가 없다", () => {
    const noPrice: TotalCostForm = { ...FORM, publishedPrice: undefined };
    expect(buildTotalCostInput({ ...noPrice, holdingYears: 0 }, POLICY, OPEN).notIncluded).toEqual([]);
  });

  it("금리를 모르겠어요로 두면 이자를 빼고 미포함으로 알린다", () => {
    const b = buildTotalCostInput({ ...FORM, loanPrincipal: 100_000_000 }, POLICY, OPEN);
    expect(b.notIncluded).toEqual(["대출이자"]);
    expect(b.input!.loan).toBeUndefined();
  });

  it("취득 게이트가 닫혀 있으면 입력을 만들지 않는다", () => {
    expect(buildTotalCostInput(FORM, POLICY, { ...OPEN, acquisition: false }).input).toBeNull();
  });

  it("보유세 묶음이 닫혀 있으면 그 묶음의 금액이 합계에 들어가지 않는다", () => {
    const all = composeTotalCost(buildTotalCostInput(FORM, POLICY, OPEN).input!, RULESET);
    const noComp = composeTotalCost(buildTotalCostInput(FORM, POLICY, { ...OPEN, comprehensive: false }).input!, RULESET);
    const noBoth = composeTotalCost(buildTotalCostInput(FORM, POLICY, { ...OPEN, comprehensive: false, property: false }).input!, RULESET);
    expect(noComp.total).toBeLessThanOrEqual(all.total);
    expect(noBoth.years.every((y) => y.holdingTax === 0)).toBe(true);
  });
});

describe("그래프 = 표 = 총액", () => {
  it("막대 합계, 표 합계, 결과 총액이 같다 (대출·부대비용 포함)", () => {
    const form: TotalCostForm = { ...FORM, holdingYears: 5, extraCosts: [{ label: "시험용 가", amount: 777_777 }], loanPrincipal: 123_456_789, loanRateBp: 333 };
    const r = composeTotalCost(buildTotalCostInput(form, POLICY, OPEN).input!, RULESET);
    expect(barsTotal(chartBars(r))).toBe(r.total);
    expect(barsTotal(tableRows(r))).toBe(r.total);
    expect(chartBars(r).map((b) => b.label)).toEqual(["취득", "1년차", "2년차", "3년차", "4년차", "5년차"]);
  });

  it("금리 0%·보유 0년 경계에서도 같다", () => {
    const zeroRate = composeTotalCost(buildTotalCostInput({ ...FORM, loanPrincipal: 50_000_000, loanRateBp: 0 }, POLICY, OPEN).input!, RULESET);
    expect(chartBars(zeroRate).every((b) => b.interest === 0)).toBe(true);
    const zeroYears = composeTotalCost(buildTotalCostInput({ ...FORM, holdingYears: 0, loanPrincipal: 50_000_000, loanRateBp: 500 }, POLICY, OPEN).input!, RULESET);
    expect(chartBars(zeroYears)).toHaveLength(1);
    expect(barsTotal(chartBars(zeroYears))).toBe(zeroYears.total);
  });

  it("엔진의 참고 표시 코드 목록은 웹의 참고 표시 목록과 같다", () => {
    expect([...TOTAL_COST_REFERENCE_CODES].sort()).toEqual([...REFERENCE_CODES].sort());
  });

  it("양도 단계: 표와 막대 어디에도 양도 줄이 없고 입력 폼에 매도가 칸이 없다", () => {
    const r = composeTotalCost(buildTotalCostInput(FORM, POLICY, OPEN).input!, RULESET);
    expect(JSON.stringify([chartBars(r), r.lines])).not.toMatch(/양도|TRANSFER|CAPITAL/i);
    const keys: (keyof TotalCostForm)[] = ["ownerType", "price", "exclusiveAreaSqm", "houseCount", "isAdjustedArea", "holdingYears", "publishedPrice", "extraCosts", "loanPrincipal", "loanRateBp"];
    expect(keys.some((k) => /sale|sell|transfer|매도/i.test(k))).toBe(false);
  });
});

describe("시나리오 2개 비교", () => {
  it("정책의 두 보유 연수로 두 결과를 만들고 차이는 뒤 - 앞이다", () => {
    const c = compareScenarios(FORM, POLICY, RULESET, OPEN)!;
    expect(c.years).toEqual([3, 5]);
    expect(c.difference).toBe(c.totals[1] - c.totals[0]);
    const direct = (n: number) => composeTotalCost(buildTotalCostInput({ ...FORM, holdingYears: n }, POLICY, OPEN).input!, RULESET).total;
    expect(c.totals).toEqual([direct(3), direct(5)]);
  });

  it("같은 보유 연수 둘이면 차이 0", () => {
    expect(compareScenarios(FORM, POLICY, RULESET, OPEN, [2, 2])!.difference).toBe(0);
  });

  it("필수 칸이 비면 비교를 만들지 않는다", () => {
    expect(compareScenarios({}, POLICY, RULESET, OPEN)).toBeNull();
  });
});
