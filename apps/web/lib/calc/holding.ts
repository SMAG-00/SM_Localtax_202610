import type { CalcResult, HoldingInput, OwnerType, TaxItem } from "@ltr/tax-engine";
import { applicable, isAnswerValid, resolveUnknowns, type AppliedAssumption, type Assumptions, type Question } from "./shared";

// 재산세·종합부동산세 질문 흐름 (CALC-02·11) - 과세기준일 소유 질문이 맨 앞에 온다. 2단계 화면은 주택만 받는다(토지 구분은 감수 항목, 설계 4.2).

export interface HoldingForm {
  ownedOnBaseDate?: boolean;
  ownerType?: OwnerType;
  prices?: number[];
  isSingleHouseOneHousehold?: boolean;
  isUrbanArea?: boolean;
  ownerAge?: number;
  holdingYears?: number;
}

const single = (f: HoldingForm) => f.ownerType === "INDIVIDUAL" && f.isSingleHouseOneHousehold === true;

export const HOLDING_QUESTIONS: readonly Question<HoldingForm>[] = [
  { id: "ownedOnBaseDate", text: "과세기준일에 이 주택을 가지고 있었나요?", kind: "yesno", required: true, canDontKnow: false, help: null, applies: () => true },
  { id: "ownerType", text: "가진 사람은 개인인가요, 법인인가요?", kind: "choice", options: [{ value: "INDIVIDUAL", label: "개인" }, { value: "CORPORATION", label: "법인" }], required: true, canDontKnow: false, help: null, applies: (f) => f.ownedOnBaseDate !== false },
  { id: "prices", text: "주택마다 공시가격은 얼마인가요?", kind: "wonlist", required: true, canDontKnow: false, help: null, applies: (f) => f.ownedOnBaseDate !== false },
  { id: "isSingleHouseOneHousehold", text: "우리 집이 세대에서 가진 유일한 주택인가요?", kind: "yesno", required: false, canDontKnow: true, help: null, applies: (f) => f.ownedOnBaseDate !== false && f.ownerType === "INDIVIDUAL" },
  { id: "isUrbanArea", text: "도시지역에 있는 주택인가요?", kind: "yesno", required: false, canDontKnow: true, help: null, applies: (f) => f.ownedOnBaseDate !== false },
  { id: "ownerAge", text: "소유자의 만 나이는 몇 살인가요?", kind: "count", required: false, canDontKnow: true, help: null, applies: (f) => f.ownedOnBaseDate !== false && single(f) },
  { id: "holdingYears", text: "이 주택을 몇 년째 가지고 있나요?", kind: "count", required: false, canDontKnow: true, help: null, applies: (f) => f.ownedOnBaseDate !== false && single(f) },
];

export interface BuiltHolding {
  /** 과세기준일에 소유하지 않았으면 false - 올해 납세의무가 없어 계산하지 않는다 */
  liable: boolean;
  input: HoldingInput | null;
  missing: string[];
  assumed: AppliedAssumption[];
  form: HoldingForm;
}

export function buildHolding(form: HoldingForm, unknown: ReadonlySet<string> = new Set(), assumptions: Assumptions = {}): BuiltHolding {
  if (form.ownedOnBaseDate === false) return { liable: false, input: null, missing: [], assumed: [], form };
  const { assumed, patch } = resolveUnknowns(HOLDING_QUESTIONS, form, unknown, assumptions);
  const f: HoldingForm = { ...form, ...patch };
  const qs = applicable(HOLDING_QUESTIONS, f);
  const valid = (id: keyof HoldingForm) => {
    const q = qs.find((x) => x.id === id);
    return q !== undefined && isAnswerValid(q, f[id]);
  };
  const missing = qs.filter((q) => q.required && !isAnswerValid(q, f[q.id])).map((q) => q.id);
  if (missing.length > 0) return { liable: true, input: null, missing, assumed, form: f };
  const input: Record<string, unknown> = { ownerType: f.ownerType, propertyKind: "HOUSE", publishedPrices: f.prices };
  if (valid("isSingleHouseOneHousehold")) input.isSingleHouseOneHousehold = f.isSingleHouseOneHousehold;
  if (valid("isUrbanArea")) input.isUrbanArea = f.isUrbanArea;
  if (valid("ownerAge")) input.ownerAge = f.ownerAge;
  if (valid("holdingYears")) input.holdingYears = f.holdingYears;
  return { liable: true, input: input as unknown as HoldingInput, missing: [], assumed, form: f };
}

/** 보유세 항목 묶음 - 재산세 고지 구성(PROP_·REGIONAL_RESOURCE)과 종합부동산세 고지 구성(CRET_). W10-a 대조 합계 구성과 같다 [감수 필요] */
export type HoldingGroup = "property" | "comprehensive";
export const holdingGroupOf = (code: string): HoldingGroup => (code.startsWith("CRET_") ? "comprehensive" : "property");

/** 공개된 세목의 항목만 남긴 결과 - 게이트가 닫힌 세목의 금액은 항목도 합계도 만들지 않는다(세목별 따로 판정, CALC-02) */
export function holdingResultFor(result: CalcResult, open: Readonly<Record<HoldingGroup, boolean>>): { items: TaxItem[]; total: number } {
  const items = result.items.filter((i) => open[holdingGroupOf(i.code)]);
  return { items, total: items.reduce((s, i) => s + i.amount, 0) };
}
