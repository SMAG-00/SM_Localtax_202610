import { describe, expect, it } from "vitest";
import { calcAcquisition, calcHolding } from "@ltr/tax-engine";
import { ACQUISITION_QUESTIONS, CAUSE_OPTIONS, buildAcquisition, acquisitionFacts, type AcquisitionForm } from "./acquisition";
import { HOLDING_QUESTIONS, buildHolding, holdingGroupOf, holdingResultFor } from "./holding";
import { QUESTION_TEXT_MAX, flowProgress, pendingQuestion, type Assumptions } from "./shared";
import { RULESET } from "./fixture.test-util";

const none = new Set<string>();

/** 질문형 화면이 하는 일을 흉내 낸다 - 지금 질문에 script의 답을 넣으며 끝까지 간다 */
function runFlow(script: Record<string, unknown>, unknown: Set<string> = new Set()): AcquisitionForm {
  let form: AcquisitionForm = {};
  const skipped = new Set<string>();
  for (let guard = 0; guard < 30; guard++) {
    const q = pendingQuestion(ACQUISITION_QUESTIONS, form, unknown, skipped);
    if (!q) return form;
    if (unknown.has(q.id)) continue;
    if (q.id in script) form = { ...form, [q.id]: script[q.id] };
    else skipped.add(q.id);
  }
  throw new Error("질문 흐름이 끝나지 않음");
}

describe("질문 문장 (CALC-11 R8)", () => {
  it("모든 질문 문장은 60자 이하이고 질문마다 id가 하나", () => {
    for (const qs of [ACQUISITION_QUESTIONS, HOLDING_QUESTIONS]) {
      expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length);
      for (const q of qs) expect(q.text.length).toBeLessThanOrEqual(QUESTION_TEXT_MAX);
    }
  });
  it("취득 원인 선택지는 엔진 값 4종과 1:1 (FAM-03)", () => {
    expect(CAUSE_OPTIONS.map((o) => o.value)).toEqual(["PAID", "INHERITANCE", "GIFT", "ORIGINAL"]);
    expect(CAUSE_OPTIONS.map((o) => o.label)).toEqual(["유상취득(매매)", "상속", "증여", "원시취득(신축)"]);
  });
  it("필수 질문에는 모르겠어요가 없다", () => {
    for (const q of [...ACQUISITION_QUESTIONS, ...HOLDING_QUESTIONS]) if (q.required) expect(q.canDontKnow).toBe(false);
  });
});

describe("질문 건너뛰기와 진행 막대", () => {
  it("토지면 주택 수·조정대상지역·전용면적·처음 사는지를 묻지 않는다", () => {
    const f: AcquisitionForm = { ownerType: "INDIVIDUAL", propertyKind: "LAND", cause: "PAID", price: 100_000_000 };
    expect(pendingQuestion(ACQUISITION_QUESTIONS, f, none, none)).toBeNull();
    expect(flowProgress(ACQUISITION_QUESTIONS, f, none, none)).toEqual({ n: 4, total: 4 });
  });
  it("개인 주택 매매면 주택 질문이 이어서 나오고 n/N이 늘어난다", () => {
    const f: AcquisitionForm = { ownerType: "INDIVIDUAL", propertyKind: "HOUSE", cause: "PAID", price: 100_000_000 };
    expect(pendingQuestion(ACQUISITION_QUESTIONS, f, none, none)?.id).toBe("houseCount");
    expect(flowProgress(ACQUISITION_QUESTIONS, f, none, none)).toEqual({ n: 5, total: 8 });
    expect(flowProgress(ACQUISITION_QUESTIONS, { ...f, houseCount: 1 }, none, none).n).toBe(6);
  });
  it("시가표준액은 증여일 때만 묻는다", () => {
    const base: AcquisitionForm = { ownerType: "INDIVIDUAL", propertyKind: "LAND", price: 100_000_000 };
    expect(pendingQuestion(ACQUISITION_QUESTIONS, { ...base, cause: "GIFT" }, none, none)?.id).toBe("officialPrice");
    expect(pendingQuestion(ACQUISITION_QUESTIONS, { ...base, cause: "PAID" }, none, none)).toBeNull();
  });
});

describe("질문형 = 전체 폼 (CALC-11 동일 입력)", () => {
  const answers = { ownerType: "INDIVIDUAL", propertyKind: "HOUSE", cause: "PAID", price: 700_000_000, houseCount: 1, isAdjustedArea: false, exclusiveAreaSqm: 84, firstHome: false };
  it("같은 답이면 엔진 입력 객체와 결과 총액이 같다", () => {
    const viaFlow = buildAcquisition(runFlow(answers));
    const viaForm = buildAcquisition({ ...(answers as AcquisitionForm) });
    expect(viaFlow.input).toEqual(viaForm.input);
    expect(viaFlow.input).not.toBeNull();
    const a = calcAcquisition(viaFlow.input!, RULESET);
    const b = calcAcquisition(viaForm.input!, RULESET);
    expect(a.total).toBe(b.total);
    expect(a.items.map((i) => i.amount)).toEqual(b.items.map((i) => i.amount));
  });
  it("증여에서 다른 원인으로 바꾸면 시가표준액이 엔진 입력에서 빠진다 (FAM-03)", () => {
    const gift = buildAcquisition({ ownerType: "INDIVIDUAL", propertyKind: "LAND", cause: "GIFT", price: 100_000_000, officialPrice: 90_000_000 });
    expect(gift.input).toMatchObject({ officialPrice: 90_000_000 });
    const paid = buildAcquisition({ ownerType: "INDIVIDUAL", propertyKind: "LAND", cause: "PAID", price: 100_000_000, officialPrice: 90_000_000 });
    expect(paid.input).not.toHaveProperty("officialPrice");
  });
  it("주택이 아니면 주택 전용 값이 남아 있어도 엔진 입력에 넣지 않는다", () => {
    const r = buildAcquisition({ ownerType: "INDIVIDUAL", propertyKind: "LAND", cause: "PAID", price: 100_000_000, houseCount: 2, exclusiveAreaSqm: 84, isAdjustedArea: true });
    expect(r.input).toEqual({ ownerType: "INDIVIDUAL", propertyKind: "LAND", cause: "PAID", price: 100_000_000 });
  });
});

describe("필수 값 경계", () => {
  const base: AcquisitionForm = { ownerType: "INDIVIDUAL", propertyKind: "LAND", cause: "PAID" };
  it.each([[0], [-1], [1.5], [Number.NaN], [Number.MAX_SAFE_INTEGER + 1]])("가액 %s 은 받지 않는다", (price) => {
    const r = buildAcquisition({ ...base, price });
    expect(r.input).toBeNull();
    expect(r.missing).toEqual(["price"]);
  });
  it("가액 1원은 받는다", () => {
    expect(buildAcquisition({ ...base, price: 1 }).input).toMatchObject({ price: 1 });
  });
  it("원인 값이 4종 밖이면 계산하지 않는다 (unsupported 경로)", () => {
    const r = buildAcquisition({ ...base, price: 5, cause: "EXCHANGE" as never });
    expect(r.input).toBeNull();
    expect(r.missing).toEqual(["cause"]);
  });
});

describe("모르겠어요와 가정 (CALC-11)", () => {
  const form: AcquisitionForm = { ownerType: "INDIVIDUAL", propertyKind: "HOUSE", cause: "PAID", price: 700_000_000 };
  it("가정 목록이 비어 있으면 값을 지어내지 않고 가정 없음 칩만 남는다", () => {
    const r = buildAcquisition(form, new Set(["exclusiveAreaSqm"]));
    expect(r.input).not.toHaveProperty("exclusiveAreaSqm");
    expect(r.assumed).toEqual([{ id: "exclusiveAreaSqm", text: expect.any(String), note: null, value: null }]);
  });
  it("감수 입력 가정이 있으면 그 값을 쓰고 내용을 칩에 싣는다 (시험용 가정)", () => {
    const assumptions: Assumptions = { exclusiveAreaSqm: { value: 60, note: "시험용 가정: 전용면적 60" } };
    const r = buildAcquisition(form, new Set(["exclusiveAreaSqm"]), assumptions);
    expect(r.input).toMatchObject({ exclusiveAreaSqm: 60 });
    expect(r.assumed[0]).toMatchObject({ id: "exclusiveAreaSqm", note: "시험용 가정: 전용면적 60", value: 60 });
  });
  it("종류가 맞지 않는 가정·설명 없는 가정은 쓰지 않는다", () => {
    const bad: Assumptions = { exclusiveAreaSqm: { value: "큼", note: "시험용" }, houseCount: { value: 1, note: " " } };
    const r = buildAcquisition(form, new Set(["exclusiveAreaSqm", "houseCount"]), bad);
    expect(r.input).not.toHaveProperty("exclusiveAreaSqm");
    expect(r.input).not.toHaveProperty("houseCount");
    expect(r.assumed.every((a) => a.note === null)).toBe(true);
  });
  it("필수 질문은 모르겠어요를 골라도 가정을 쓰지 않는다", () => {
    const r = buildAcquisition({ ...form, price: undefined }, new Set(["price"]), { price: { value: 1, note: "시험용" } });
    expect(r.input).toBeNull();
    expect(r.missing).toEqual(["price"]);
  });
  it("감면 판정표 입력에는 값이 있는 칸만 들어가 나머지는 직접 확인 필요가 된다", () => {
    expect(acquisitionFacts({ ...form, houseCount: 1 })).toEqual({ owner_type: "INDIVIDUAL", property_kind: "HOUSE", cause: "PAID", price: 700_000_000, house_count: 1 });
  });
});

describe("재산세·종합부동산세 (CALC-02)", () => {
  it("과세기준일에 소유하지 않았으면 계산하지 않는다 (납세의무 없음)", () => {
    const r = buildHolding({ ownedOnBaseDate: false });
    expect(r).toMatchObject({ liable: false, input: null, missing: [] });
  });
  it("과세기준일 질문이 맨 앞이고, 아니요면 다른 질문이 없다", () => {
    expect(pendingQuestion(HOLDING_QUESTIONS, {}, none, none)?.id).toBe("ownedOnBaseDate");
    expect(pendingQuestion(HOLDING_QUESTIONS, { ownedOnBaseDate: false }, none, none)).toBeNull();
  });
  it("공시가격이 비었거나 0이면 필수 값 부족", () => {
    expect(buildHolding({ ownedOnBaseDate: true, ownerType: "INDIVIDUAL", prices: [] }).missing).toEqual(["prices"]);
    expect(buildHolding({ ownedOnBaseDate: true, ownerType: "INDIVIDUAL", prices: [0] }).missing).toEqual(["prices"]);
  });
  it("엔진 결과의 모든 항목이 재산세/종부세 묶음으로 나뉘고, 닫힌 세목 항목은 합계에서 빠진다", () => {
    const built = buildHolding({ ownedOnBaseDate: true, ownerType: "INDIVIDUAL", prices: [3_000_000_000, 3_000_000_000] });
    const result = calcHolding(built.input!, RULESET);
    const groups = result.items.map((i) => holdingGroupOf(i.code));
    expect(groups).toContain("comprehensive");
    expect(groups).toContain("property");
    const onlyProperty = holdingResultFor(result, { property: true, comprehensive: false });
    expect(onlyProperty.items.every((i) => holdingGroupOf(i.code) === "property")).toBe(true);
    expect(onlyProperty.total).toBe(result.items.filter((i) => holdingGroupOf(i.code) === "property").reduce((s, i) => s + i.amount, 0));
    expect(holdingResultFor(result, { property: false, comprehensive: false })).toEqual({ items: [], total: 0 });
    expect(holdingResultFor(result, { property: true, comprehensive: true }).total).toBe(result.total);
  });
});
