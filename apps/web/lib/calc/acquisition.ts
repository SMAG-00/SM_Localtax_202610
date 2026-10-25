import type { AcquisitionCause, AcquisitionInput, Facts, OwnerType, PropertyKind } from "@ltr/tax-engine";
import { applicable, isAnswerValid, resolveUnknowns, type AppliedAssumption, type Assumptions, type Question } from "./shared";

// 취득세 질문 흐름 (CALC-01·11 · FAM-03) - 질문은 데이터, 입력 객체 변환은 한 함수. 질문형과 전체 폼이 같은 폼 상태(AcquisitionForm)를 채운다.
// 취득 원인은 엔진 값 4종을 그대로 쓴다(별도 매핑 0, FAM-03). 인지세·국민주택채권은 묻지 않는다(참고 표시 항목은 결과 화면이 따로 다룸).

export interface AcquisitionForm {
  ownerType?: OwnerType;
  propertyKind?: PropertyKind;
  cause?: AcquisitionCause;
  price?: number;
  /** 증여 중과 판정용 시가표준액 - 원인이 증여일 때만 묻고 그때만 계산에 들어간다 (FAM-03) */
  officialPrice?: number;
  houseCount?: number;
  isAdjustedArea?: boolean;
  exclusiveAreaSqm?: number;
  /** 감면 판정표 입력용 - 엔진 입력이 아니다 */
  firstHome?: boolean;
}

export const OWNER_OPTIONS = [
  { value: "INDIVIDUAL", label: "개인" },
  { value: "CORPORATION", label: "법인" },
] as const;

export const PROPERTY_OPTIONS = [
  { value: "HOUSE", label: "주택" },
  { value: "OFFICETEL", label: "오피스텔" },
  { value: "PRESALE_RIGHT", label: "분양권·입주권" },
  { value: "LAND", label: "토지" },
  { value: "COMMERCIAL", label: "상가·업무용 건물" },
  { value: "FARMLAND", label: "농지" },
  { value: "ETC", label: "그 밖의 부동산" },
] as const;

/** 취득 원인 4종 - 값은 엔진의 AcquisitionCause 그대로 (FAM-03) */
export const CAUSE_OPTIONS = [
  { value: "PAID", label: "유상취득(매매)" },
  { value: "INHERITANCE", label: "상속" },
  { value: "GIFT", label: "증여" },
  { value: "ORIGINAL", label: "원시취득(신축)" },
] as const;

const isHouse = (f: AcquisitionForm) => f.propertyKind === "HOUSE";

export const ACQUISITION_QUESTIONS: readonly Question<AcquisitionForm>[] = [
  { id: "ownerType", text: "취득하는 사람은 개인인가요, 법인인가요?", kind: "choice", options: OWNER_OPTIONS, required: true, canDontKnow: false, help: null, applies: () => true },
  { id: "propertyKind", text: "어떤 부동산인가요?", kind: "choice", options: PROPERTY_OPTIONS, required: true, canDontKnow: false, help: null, applies: () => true },
  { id: "cause", text: "어떻게 취득하나요?", kind: "choice", options: CAUSE_OPTIONS, required: true, canDontKnow: false, help: null, applies: () => true },
  { id: "price", text: "취득하는 가액은 얼마인가요?", kind: "won", required: true, canDontKnow: false, help: null, applies: () => true },
  { id: "officialPrice", text: "시가표준액을 알고 있나요?", kind: "won", required: false, canDontKnow: true, help: null, applies: (f) => f.cause === "GIFT" },
  { id: "houseCount", text: "취득한 뒤 가진 주택은 모두 몇 채인가요?", kind: "count", required: false, canDontKnow: true, help: null, applies: isHouse },
  { id: "isAdjustedArea", text: "조정대상지역에 있는 주택인가요?", kind: "yesno", required: false, canDontKnow: true, help: null, applies: (f) => isHouse(f) && f.cause === "PAID" },
  { id: "exclusiveAreaSqm", text: "전용면적은 몇 ㎡인가요?", kind: "area", required: false, canDontKnow: true, help: null, applies: isHouse },
  { id: "firstHome", text: "처음 집을 사는 건가요?", kind: "yesno", required: false, canDontKnow: true, help: null, applies: (f) => isHouse(f) && f.cause === "PAID" && f.ownerType === "INDIVIDUAL" },
];

export interface BuiltAcquisition {
  input: AcquisitionInput | null;
  /** 값이 없는 필수 질문 */
  missing: string[];
  assumed: AppliedAssumption[];
  /** "모르겠어요" 가정까지 반영한 폼 */
  form: AcquisitionForm;
}

/** 폼 상태 -> 엔진 입력. 질문형·전체 폼이 모두 이 함수 하나를 거친다(CALC-11 동일 입력). 필요 없는 질문의 값은 엔진 입력에 넣지 않는다 */
export function buildAcquisition(form: AcquisitionForm, unknown: ReadonlySet<string> = new Set(), assumptions: Assumptions = {}): BuiltAcquisition {
  const { assumed, patch } = resolveUnknowns(ACQUISITION_QUESTIONS, form, unknown, assumptions);
  const f: AcquisitionForm = { ...form, ...patch };
  const qs = applicable(ACQUISITION_QUESTIONS, f);
  const valid = (id: keyof AcquisitionForm) => {
    const q = qs.find((x) => x.id === id);
    return q !== undefined && isAnswerValid(q, f[id]);
  };
  const missing = qs.filter((q) => q.required && !isAnswerValid(q, f[q.id])).map((q) => q.id);
  if (missing.length > 0) return { input: null, missing, assumed, form: f };
  const input: Record<string, unknown> = { ownerType: f.ownerType, propertyKind: f.propertyKind, cause: f.cause, price: f.price };
  if (valid("officialPrice")) input.officialPrice = f.officialPrice;
  if (valid("houseCount")) input.houseCount = f.houseCount;
  if (valid("isAdjustedArea")) input.isAdjustedArea = f.isAdjustedArea;
  if (valid("exclusiveAreaSqm")) input.exclusiveAreaSqm = f.exclusiveAreaSqm;
  return { input: input as unknown as AcquisitionInput, missing: [], assumed, form: f };
}

/** 감면 판정표에 넘기는 입력(facts) - 칸 이름은 판정표 작성 규칙이다(docs/dev/W10-b_설계.md 4.3). 값이 없는 칸은 넣지 않아 "직접 확인 필요"가 된다 */
export function acquisitionFacts(form: AcquisitionForm): Facts {
  const facts: Record<string, string | number | boolean> = {};
  const put = (k: string, v: string | number | boolean | undefined) => {
    if (v !== undefined) facts[k] = v;
  };
  put("owner_type", form.ownerType);
  put("property_kind", form.propertyKind);
  put("cause", form.cause);
  put("price", form.price);
  put("house_count", form.houseCount);
  put("exclusive_area_sqm", form.exclusiveAreaSqm);
  put("is_adjusted_area", form.isAdjustedArea);
  put("first_home", form.firstHome);
  return facts;
}
