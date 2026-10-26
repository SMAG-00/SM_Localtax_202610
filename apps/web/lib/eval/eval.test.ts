import { describe, expect, test } from "vitest";
import { blindAnswer, canRecordThird, finalStatus, gradesAgree, nextSlotFor, type GradeRow } from "./grading";
import { FLOOR, evaluateMetrics, nextStage, thresholdsProblem, type Metrics, type Threshold } from "./gate";
import { fakeAnswer } from "./fake-model";

const g = (slot: GradeRow["slot"], grader: string, over: Partial<GradeRow> = {}): GradeRow => ({
  slot, grader, verdict: "correct", fatal_error: null, citations_supported: 2, clarify_missed: false, invented_answer: false, benefit_asserted: false, ...over,
});

describe("2인 블라인드 채점 (EVAL-02)", () => {
  test("두 채점이 모든 칸에서 같으면 확정", () => {
    expect(finalStatus([g("first", "u1"), g("second", "u2")]).status).toBe("confirmed");
  });
  test("판정이 갈리면 미확정이고 확정 판정이 없다", () => {
    const r = finalStatus([g("first", "u1"), g("second", "u2", { verdict: "incorrect" })]);
    expect(r).toEqual({ status: "disputed", final: null });
  });
  test("치명 오류 유형만 달라도 갈린 것으로 센다", () => {
    expect(gradesAgree(g("first", "a", { verdict: "incorrect", fatal_error: "deadline_wrong" }), g("second", "b", { verdict: "incorrect", fatal_error: null }))).toBe(false);
  });
  test("3인째가 있으면 3인째 판정이 확정", () => {
    const r = finalStatus([g("first", "u1"), g("second", "u2", { verdict: "incorrect" }), g("third", "u3", { verdict: "incorrect" })]);
    expect(r.status).toBe("confirmed_third");
    expect(r.final?.verdict).toBe("incorrect");
  });
  test("채점 한 명이면 1인 채점, 없으면 채점 전", () => {
    expect(finalStatus([g("first", "u1")]).status).toBe("one_grade");
    expect(finalStatus([]).status).toBe("ungraded");
  });
  test("같은 사람은 두 번 채점할 수 없고 자리는 첫째 -> 둘째 순서", () => {
    expect(nextSlotFor([], "u1")).toBe("first");
    expect(nextSlotFor([g("first", "u1")], "u1")).toBeNull();
    expect(nextSlotFor([g("first", "u1")], "u2")).toBe("second");
    expect(nextSlotFor([g("first", "u1"), g("second", "u2")], "u3")).toBeNull();
  });
  test("3인째는 갈린 뒤 원문 재확인 기록이 있을 때만", () => {
    const disputed = [g("first", "u1"), g("second", "u2", { verdict: "incorrect" })];
    expect(canRecordThird(disputed, false)).toBe(false);
    expect(canRecordThird(disputed, true)).toBe(true);
    expect(canRecordThird([g("first", "u1"), g("second", "u2")], true)).toBe(false);
  });
  test("채점 화면용 답변에는 모델 이름·AI 선별·다른 채점자 판정이 실리지 않는다", () => {
    const b = blindAnswer({ answer_id: 7, question: "[시험용] q", answer_text: "a", behavior: "answer", model: "secret-model", ai_pre_grade: { v: 1 }, other_verdict: "correct" });
    expect(Object.keys(b)).not.toContain("model");
    expect(Object.keys(b)).not.toContain("ai_pre_grade");
    expect(Object.keys(b)).not.toContain("other_verdict");
    expect(b.answer_id).toBe(7);
  });
});

const TH: Threshold = { accuracy_min: 0.9, citation_precision_min: 0.98, recall_min: 0.85, clarify_omission_max: 0.05, invented_max: 0, benefit_assertion_max: 0, live_without_snapshot_max: 0, fatal_max: 0, min_items: 300, min_cross: { clarify: 60, benefits: 30, live: 15 } };
const OK: Metrics = {
  set_items: 300, set_items_excl_national: 300, national_block_items: 0, national_block_correct: 0, cross_counts: { clarify: 60, benefits: 30, live: 15 }, has_test_items: false,
  answered: 300, confirmed: 300, unconfirmed: 0, ungraded: 0, accuracy: 0.9, citation_precision: 0.98, recall: 0.85, clarify_omission: 0.05, invented: 0, benefit_assertion: 0, live_without_snapshot: 0, fatal: 0,
};

describe("게이트 판정 (EVAL-04)", () => {
  test("경계값(기준과 같음)은 통과", () => {
    expect(evaluateMetrics(OK, TH)).toEqual({ passed: true, shortfalls: [] });
  });
  test("정답률이 기준보다 0.0001 낮으면 미달", () => {
    expect(evaluateMetrics({ ...OK, accuracy: 0.8999 }, TH).shortfalls).toEqual(["accuracy"]);
  });
  test("시험용 문항이 든 판은 지표가 좋아도 미달", () => {
    expect(evaluateMetrics({ ...OK, has_test_items: true }, TH).shortfalls).toEqual(["test_items"]);
  });
  test("미확정 답변이 있으면 미달", () => {
    expect(evaluateMetrics({ ...OK, unconfirmed: 1 }, TH).shortfalls).toContain("unconfirmed");
  });
  test("치명 오류 1건은 4c에서 미달, 4a(허용 2건)에서는 통과", () => {
    expect(evaluateMetrics({ ...OK, fatal: 1 }, TH).shortfalls).toEqual(["fatal"]);
    expect(evaluateMetrics({ ...OK, fatal: 1 }, { ...TH, fatal_max: 2 }).passed).toBe(true);
  });
  test("지표를 재지 못한 값(null)은 미달로 센다", () => {
    expect(evaluateMetrics({ ...OK, citation_precision: null }, TH).shortfalls).toEqual(["citation_precision"]);
  });
  test("국세 금액 차단 문항이 모자라거나 하나라도 못 막으면 범위 게이트 미달", () => {
    const sc: Threshold = { accuracy_min: 0.9, citation_precision_min: 0.98, fatal_max: 0, min_items: 30, national_block_min: 1 };
    const m: Metrics = { ...OK, set_items_excl_national: 30, national_block_items: 1, national_block_correct: 1 };
    expect(evaluateMetrics(m, sc).passed).toBe(true);
    expect(evaluateMetrics({ ...m, national_block_items: 0, national_block_correct: 0 }, sc).shortfalls).toContain("national_block");
    expect(evaluateMetrics({ ...m, national_block_correct: 0 }, sc).shortfalls).toContain("national_block");
  });
});

const GOOD = {
  stages: {
    "4a": { ...TH, accuracy_min: 0.8, citation_precision_min: 0.95, recall_min: 0.7, clarify_omission_max: 0.1, fatal_max: 2 },
    "4b": { ...TH, accuracy_min: 0.85, citation_precision_min: 0.97, recall_min: 0.8, clarify_omission_max: 0.07 },
    "4c": TH,
  },
  scopes: {
    trust_redevelopment: { accuracy_min: 0.9, citation_precision_min: 0.98, fatal_max: 0, min_items: 100, national_block_min: 0 },
    inheritance: { accuracy_min: 0.9, citation_precision_min: 0.98, fatal_max: 0, min_items: 30, national_block_min: 1 },
    gift: { accuracy_min: 0.9, citation_precision_min: 0.98, fatal_max: 0, min_items: 30, national_block_min: 1 },
  },
};
const clone = () => JSON.parse(JSON.stringify(GOOD));

describe("게이트 값 하한 (4c 기준보다 낮은 값 저장 거부)", () => {
  test("PRD 9장 값은 통과", () => expect(thresholdsProblem(GOOD)).toBeNull());
  test("4c 정답률 0.89는 거부", () => {
    const v = clone();
    v.stages["4c"].accuracy_min = 0.89;
    expect(thresholdsProblem(v)).toContain("4c 기준");
    expect(FLOOR.accuracy).toBe(0.9);
  });
  test("4c 역질문 누락 0.06은 거부", () => {
    const v = clone();
    v.stages["4c"].clarify_omission_max = 0.06;
    expect(thresholdsProblem(v)).not.toBeNull();
  });
  test("어느 단계든 지어낸 답 허용 1은 거부", () => {
    const v = clone();
    v.stages["4a"].invented_max = 1;
    expect(thresholdsProblem(v)).toContain("허용 값은 0");
  });
  test("범위 게이트가 4c보다 낮으면 거부, 상속 차단 문항 0도 거부", () => {
    const a = clone();
    a.scopes.gift.citation_precision_min = 0.97;
    expect(thresholdsProblem(a)).toContain("scopes.gift");
    const b = clone();
    b.scopes.inheritance.national_block_min = 0;
    expect(thresholdsProblem(b)).toContain("national_block_min");
  });
  test("문항 수 하한(300)보다 작으면 거부", () => {
    const v = clone();
    v.stages["4b"].min_items = 299;
    expect(thresholdsProblem(v)).toContain("문항 수 하한");
  });
  test("값이 비면 거부", () => expect(thresholdsProblem({})).not.toBeNull());
});

describe("공개 단계 순서와 가짜 모델", () => {
  test("공개 단계는 한 칸씩", () => {
    expect(nextStage("none")).toBe("4a");
    expect(nextStage("4b")).toBe("4c");
    expect(nextStage("4c")).toBeNull();
  });
  test("가짜 모델은 필수 근거를 그대로 인용하고 시험용 표시만 쓴다", () => {
    const a = fakeAnswer({ item_key: "T-1", expected_behavior: "answer", cross_types: ["clarify"], expected_clarify: "[시험용] 역질문", required_citation_ids: ["S1", "S2"] });
    expect(a.behavior).toBe("clarify");
    expect(a.cited_ids).toEqual(["S1", "S2"]);
    expect(a.answer_text.startsWith("[시험용]")).toBe(true);
  });
  test("차단 문항은 인용 없이 차단 응답", () => {
    const a = fakeAnswer({ item_key: "T-2", expected_behavior: "blocked", cross_types: [], expected_clarify: null, required_citation_ids: [] });
    expect(a).toMatchObject({ behavior: "blocked", cited_ids: [] });
  });
});
