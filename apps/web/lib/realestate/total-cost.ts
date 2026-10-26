import { composeTotalCost, type AcquisitionInput, type HoldingInput, type Ruleset, type TotalCostInput, type TotalCostResult } from "@ltr/tax-engine";
import { holdingGroupOf, type HoldingGroup } from "@/lib/calc/holding";

// 총비용 시뮬레이터 화면 규칙 (RE-05 · b6) - 순수 함수만. 세액은 엔진(composeTotalCost)이 만들고 여기에는 계산이 없다:
// 입력 폼 -> 엔진 입력 변환, 정책(보유 연수 상한 등) 검사, 그래프·표 행 만들기, 시나리오 2개 비교 행.
// 정책 값(보유 연수 상한·금리 입력 상한·부대비용 항목 수)은 감수·PO 입력인 설정 `total_cost_policy`에서만 온다. 코드에 숫자 리터럴 0.
// 양도 단계: 매도가 입력 칸·양도 줄·양도 금액 모두 없다. 결과 아래 "포함되지 않습니다" 한 줄과 SM 카드는 화면이 붙인다.

/** 설정 `total_cost_policy` 모양 (마이그레이션 115가 DB에서도 같은 모양만 허용) */
export interface TotalCostPolicy {
  /** 보유 연수 상한 */
  maxHoldingYears: number;
  /** 연 금리 입력 상한 (만분율 정수) */
  maxRateBp: number;
  /** 부대비용 항목 수 상한 */
  maxExtraItems: number;
  /** 시나리오 비교의 두 보유 연수 기본값 (PO 입력) */
  compareYears: readonly [number, number];
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** 정책이 비었거나 모양이 틀리면 null - 총비용 시뮬레이터는 열리지 않는다(설계 5장 #18) */
export function parseTotalCostPolicy(raw: unknown): TotalCostPolicy | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  if (keys.join(",") !== ["compare_years", "max_extra_items", "max_holding_years", "max_rate_bp"].join(",")) return null;
  const cy = o.compare_years;
  if (!Array.isArray(cy) || cy.length !== 2 || !isInt(cy[0]) || !isInt(cy[1])) return null;
  if (!isInt(o.max_holding_years) || !isInt(o.max_rate_bp) || !isInt(o.max_extra_items)) return null;
  if (cy[0] > o.max_holding_years || cy[1] > o.max_holding_years) return null;
  return { maxHoldingYears: o.max_holding_years, maxRateBp: o.max_rate_bp, maxExtraItems: o.max_extra_items, compareYears: [cy[0], cy[1]] };
}

/** 입력 폼 - 모든 칸은 브라우저 메모리에만 있다. undefined = 모르겠어요(또는 아직 답 없음) */
export interface TotalCostForm {
  ownerType?: "INDIVIDUAL" | "CORPORATION";
  /** 취득가액(매매가) */
  price?: number;
  exclusiveAreaSqm?: number;
  /** 취득 후 보유 주택 수 (RE-04 판정 결과로 미리 채워질 수 있음) */
  houseCount?: number;
  isAdjustedArea?: boolean;
  /** 보유 연수 n */
  holdingYears?: number;
  /** 보유 기간의 공시가격(한 채, 매년 같은 값 가정) */
  publishedPrice?: number;
  extraCosts?: readonly { label: string; amount: number }[];
  loanPrincipal?: number;
  /** 연 금리 만분율. undefined면 "모르겠어요" -> 이자 미포함 */
  loanRateBp?: number;
}

export type NotIncluded = "보유세" | "대출이자";

export interface BuiltTotalCost {
  input: TotalCostInput | null;
  /** 필수 칸 중 빠진 것 */
  missing: string[];
  /** 정책 범위를 벗어난 칸 */
  outOfRange: string[];
  /** "모르겠어요"로 답해 계산에서 뺀 항목 - 추정값으로 채우지 않고 "미포함" 칩을 붙인다 */
  notIncluded: NotIncluded[];
}

export function buildTotalCostInput(form: TotalCostForm, policy: TotalCostPolicy, open: Readonly<Record<HoldingGroup | "acquisition", boolean>>): BuiltTotalCost {
  const missing: string[] = [];
  const outOfRange: string[] = [];
  if (form.ownerType === undefined) missing.push("ownerType");
  if (form.price === undefined) missing.push("price");
  if (form.holdingYears === undefined) missing.push("holdingYears");
  else if (!isInt(form.holdingYears)) missing.push("holdingYears");
  else if (form.holdingYears > policy.maxHoldingYears) outOfRange.push("holdingYears");
  const extras = form.extraCosts ?? [];
  if (extras.length > policy.maxExtraItems) outOfRange.push("extraCosts");
  if (form.loanRateBp !== undefined && form.loanRateBp > policy.maxRateBp) outOfRange.push("loanRateBp");
  if (missing.length > 0 || outOfRange.length > 0 || !open.acquisition) return { input: null, missing, outOfRange, notIncluded: [] };

  const notIncluded: NotIncluded[] = [];
  const years = form.holdingYears!;
  const acquisition: AcquisitionInput = {
    ownerType: form.ownerType!,
    propertyKind: "HOUSE",
    cause: "PAID",
    price: form.price!,
    ...(form.exclusiveAreaSqm !== undefined ? { exclusiveAreaSqm: form.exclusiveAreaSqm } : {}),
    ...(form.houseCount !== undefined ? { houseCount: form.houseCount } : {}),
    ...(form.isAdjustedArea !== undefined ? { isAdjustedArea: form.isAdjustedArea } : {}),
  };
  // 공시가격을 모르면 보유세를 추정으로 채우지 않는다 - 보유 연수 0과 같게 두고 "보유세 미포함"만 알린다
  const knowsPrice = form.publishedPrice !== undefined;
  const effectiveYears = knowsPrice ? years : 0;
  if (!knowsPrice && years > 0) notIncluded.push("보유세");
  const holding: HoldingInput = { ownerType: form.ownerType!, propertyKind: "HOUSE", publishedPrices: [form.publishedPrice ?? 0] };
  let loan: TotalCostInput["loan"];
  if (form.loanPrincipal !== undefined && form.loanPrincipal > 0) {
    if (form.loanRateBp === undefined) notIncluded.push("대출이자");
    else loan = { principal: form.loanPrincipal, annualRateBp: form.loanRateBp };
  }
  const input: TotalCostInput = {
    acquisition,
    holdingYears: effectiveYears,
    holdingByYear: Array.from({ length: effectiveYears }, () => holding),
    extraCosts: extras,
    ...(loan ? { loan } : {}),
    // 게이트가 닫힌 세목의 항목은 만들지 않는다 (재산세 묶음 / 종합부동산세 묶음)
    includeHoldingItem: (code) => open[holdingGroupOf(code)],
  };
  return { input, missing: [], outOfRange: [], notIncluded };
}

/** 그래프 막대 한 칸 - 표의 한 행과 같은 값이다 */
export interface ChartBar {
  year: number;
  label: string;
  acquisitionTax: number;
  holdingTax: number;
  extra: number;
  interest: number;
  total: number;
}

const yearLabel = (y: number) => (y === 0 ? "취득" : `${y}년차`);

/** 그래프 막대와 표 행은 같은 배열에서 나온다 - 그래프 합계 = 표 합계 = 결과 먼저 총액 */
export function chartBars(r: TotalCostResult): ChartBar[] {
  return r.years.map((y) => ({ year: y.year, label: yearLabel(y.year), acquisitionTax: y.acquisitionTax, holdingTax: y.holdingTax, extra: y.extra, interest: y.interest, total: y.subtotal }));
}

export const tableRows = chartBars;
export const barsTotal = (bars: readonly ChartBar[]): number => bars.reduce((s, b) => s + b.total, 0);

/** 시나리오 2개 비교 - 같은 입력에서 보유 연수만 바꾼 두 결과의 총액 차이 행 */
export interface ScenarioCompare {
  years: [number, number];
  totals: [number, number];
  /** 뒤 시나리오 - 앞 시나리오 (음수일 수 있다). 유리/불리 표현은 화면에 없다 */
  difference: number;
}

export function compareScenarios(form: TotalCostForm, policy: TotalCostPolicy, ruleset: Ruleset, open: Readonly<Record<HoldingGroup | "acquisition", boolean>>, years: readonly [number, number] = policy.compareYears): ScenarioCompare | null {
  const results: TotalCostResult[] = [];
  for (const y of years) {
    const b = buildTotalCostInput({ ...form, holdingYears: y }, policy, open);
    if (!b.input) return null;
    results.push(composeTotalCost(b.input, ruleset));
  }
  const [a, c] = results as [TotalCostResult, TotalCostResult];
  return { years: [years[0], years[1]], totals: [a.total, c.total], difference: c.total - a.total };
}
