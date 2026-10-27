// 계산·판정 도구 정의와 입력 검사 - 순수 (W12-c c1·c3, PRD-04 6.3). 감면 점검(check_benefits)은 서버가 계산 직후 자동으로 돌려 모델 도구 목록에 없다.
// 도구 목록에 양도세·상속세·증여세 계산은 없다(ASK-05·09, FAM-09). 입력은 서버 메모리에서만 쓰고 저장하지 않는다(기록은 결과 요약뿐).
import type { ToolDef } from "../assistant/anthropic";
import type { AcquisitionForm } from "../calc/acquisition";
import { ACQUISITION_QUESTIONS } from "../calc/acquisition";
import { HOLDING_QUESTIONS, type HoldingForm } from "../calc/holding";
import { isAnswerValid, type Question } from "../calc/shared";
import { PROJECT_TAX_TYPES, projectTaxType, type ProjectTaxTypeId } from "../tax-guide/determination-run";

export const CALC_TOOL_NAMES = ["run_calculator", "run_determination"] as const;
export type CalcToolName = (typeof CALC_TOOL_NAMES)[number];
/** 서버 안에서만 도는 도구 (모델에 정의를 주지 않는다) */
export const SERVER_ONLY_TOOL_NAMES = ["check_benefits"] as const;
export const isCalcToolName = (n: string): n is CalcToolName => (CALC_TOOL_NAMES as readonly string[]).includes(n);

export const CALC_TAXES = ["acquisition", "holding"] as const;
export type CalcTax = (typeof CALC_TAXES)[number];

/** 도구 입력 칸(snake_case) → 계산기 폼 칸 (질문 목록의 id와 같다) */
const ACQ_KEYS: Readonly<Record<string, keyof AcquisitionForm>> = {
  owner_type: "ownerType", property_kind: "propertyKind", cause: "cause", price: "price", official_price: "officialPrice",
  house_count: "houseCount", is_adjusted_area: "isAdjustedArea", exclusive_area_sqm: "exclusiveAreaSqm", first_home: "firstHome",
};
const HOLD_KEYS: Readonly<Record<string, keyof HoldingForm>> = {
  owned_on_base_date: "ownedOnBaseDate", owner_type: "ownerType", prices: "prices", is_single_house_one_household: "isSingleHouseOneHousehold",
  is_urban_area: "isUrbanArea", owner_age: "ownerAge", holding_years: "holdingYears",
};

export type CalcToolInput =
  | { name: "run_calculator"; tax: "acquisition"; form: AcquisitionForm }
  | { name: "run_calculator"; tax: "holding"; form: HoldingForm }
  | { name: "run_determination"; typeId: ProjectTaxTypeId; answers: Record<string, string | number | boolean> };

export interface CalcToolOptions {
  calculatorOpen: boolean;
  /** 공개된 판정표가 있는 판정 종류 */
  determinationTypes: readonly string[];
}

const prop = (t: string) => ({ type: t });
/** 요청에 넣을 계산·판정 도구 정의. 계산기가 닫혔거나 공개 판정표가 없으면 그 도구는 정의 0 */
export function buildCalcToolDefs(o: CalcToolOptions): ToolDef[] {
  const out: ToolDef[] = [];
  if (o.calculatorOpen) {
    out.push({
      name: "run_calculator",
      description: "지방세(취득세·재산세·종합부동산세) 세액을 자체 계산기 엔진으로 계산합니다. 금액은 화면 카드로만 나가므로 문장에 금액을 쓰지 않습니다",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          tax: { type: "string", enum: [...CALC_TAXES] },
          owner_type: { type: "string", enum: ["INDIVIDUAL", "CORPORATION"] },
          property_kind: prop("string"), cause: { type: "string", enum: ["PAID", "INHERITANCE", "GIFT", "ORIGINAL"] },
          price: prop("integer"), official_price: prop("integer"), house_count: prop("integer"), is_adjusted_area: prop("boolean"),
          exclusive_area_sqm: prop("number"), first_home: prop("boolean"), owned_on_base_date: prop("boolean"),
          prices: { type: "array", items: prop("integer") }, is_single_house_one_household: prop("boolean"), is_urban_area: prop("boolean"),
          owner_age: prop("integer"), holding_years: prop("integer"),
        },
        required: ["tax"],
        additionalProperties: false,
      },
    });
  }
  const types = PROJECT_TAX_TYPES.filter((t) => o.determinationTypes.includes(t.id));
  if (types.length > 0) {
    out.push({
      name: "run_determination",
      description: "공개된 판정표로 정비·신탁 세금 판정(주택 수·신탁 납세의무자 등)을 돌립니다. 결론은 판정표 문장이 카드로만 나갑니다",
      strict: false,
      input_schema: {
        type: "object",
        properties: { judgment_type: { type: "string", enum: types.map((t) => t.id) }, answers: { type: "object" } },
        required: ["judgment_type"],
        additionalProperties: false,
      },
    });
  }
  return out;
}

function pickForm<F>(o: Record<string, unknown>, keys: Readonly<Record<string, keyof F>>, qs: readonly Question<F>[]): F | null {
  const form: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === "tax" || v === undefined || v === null) continue;
    const formKey = keys[k];
    if (!formKey) return null; // 모르는 칸
    const q = qs.find((x) => x.id === formKey);
    if (!q || !isAnswerValid(q, v)) return null; // 질문 종류에 안 맞는 값
    form[formKey as string] = v;
  }
  return form as F;
}

const ANSWER_KEY = /^[a-z][a-z0-9_]{1,39}$/u;

/** 모델이 보낸 계산·판정 도구 입력 검사 - 모양이 틀리면 null */
export function parseCalcToolInput(name: string, input: unknown): CalcToolInput | null {
  const o = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  if (!o) return null;
  if (name === "run_calculator") {
    if (o.tax === "acquisition") {
      const form = pickForm<AcquisitionForm>(o, ACQ_KEYS, ACQUISITION_QUESTIONS);
      return form ? { name, tax: "acquisition", form } : null;
    }
    if (o.tax === "holding") {
      const form = pickForm<HoldingForm>(o, HOLD_KEYS, HOLDING_QUESTIONS);
      return form ? { name, tax: "holding", form } : null;
    }
    return null;
  }
  if (name === "run_determination") {
    const type = typeof o.judgment_type === "string" ? projectTaxType(o.judgment_type) : null;
    if (!type) return null;
    const raw = o.answers === undefined ? {} : o.answers;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > 20) return null;
    const answers: Record<string, string | number | boolean> = {};
    for (const [k, v] of entries) {
      if (!ANSWER_KEY.test(k)) return null;
      if (typeof v === "string" ? v.length > 40 : typeof v === "number" ? !Number.isFinite(v) : typeof v !== "boolean") return null;
      answers[k] = v as string | number | boolean;
    }
    return { name, typeId: type.id, answers };
  }
  return null;
}
