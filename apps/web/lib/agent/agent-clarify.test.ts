import { describe, expect, it } from "vitest";
import { planClarify, sanitizeAnswers, searchPlan, UNSURE, UNSURE_LABEL } from "./clarify";
import { TEST_DICTIONARY, TEST_LIMITS } from "./flow-fixtures";

const Q = "시험용주제 에 대해 알려줘";

describe("역질문 상한 (ASK-02)", () => {
  it("첫 라운드는 최대 3개를 묻고 선택지 끝에 [모르겠어요]가 붙는다", () => {
    const p = planClarify(Q, TEST_DICTIONARY, { rounds: 0, answers: {} }, TEST_LIMITS);
    expect(p.kind).toBe("ask");
    if (p.kind !== "ask") return;
    expect(p.round).toBe(1);
    expect(p.questions.map((x) => x.slotId)).toEqual(["slot_a", "slot_b", "slot_c"]);
    expect(p.questions[0]!.options.map((o) => o.id)).toEqual(["a1", "a2", UNSURE]);
    expect(p.questions[0]!.options.at(-1)!.label).toBe(UNSURE_LABEL);
  });
  it("둘째 라운드는 남은 1개만 묻는다", () => {
    const p = planClarify(Q, TEST_DICTIONARY, { rounds: 1, answers: { slot_a: "a1", slot_b: "b2", slot_c: UNSURE } }, TEST_LIMITS);
    expect(p.kind).toBe("ask");
    if (p.kind === "ask") expect(p.questions.map((x) => x.slotId)).toEqual(["slot_d"]);
  });
  it("3라운드째는 묻지 않고 가정을 밝힌 조건부 답변으로 간다 (모르겠어요·빈 요건 기록)", () => {
    const p = planClarify(Q, TEST_DICTIONARY, { rounds: 2, answers: { slot_a: "a1", slot_b: "b2", slot_c: UNSURE } }, TEST_LIMITS);
    expect(p.kind).toBe("proceed");
    if (p.kind !== "proceed") return;
    expect(p.unsure.map((u) => u.slotId)).toEqual(["slot_c"]);
    expect(p.missing.map((m) => m.slotId)).toEqual(["slot_d"]);
  });
  it("어떤 입력에서도 한 라운드 질문이 설정 상한을 넘지 않고, 라운드가 상한을 넘으면 질문이 없다", () => {
    for (let rounds = 0; rounds < 6; rounds++) {
      for (const per of [0, 1, 2, 3]) {
        const p = planClarify(Q, TEST_DICTIONARY, { rounds, answers: {} }, { clarifyRounds: 2, clarifyPerRound: per });
        if (p.kind === "ask") {
          expect(p.questions.length).toBeLessThanOrEqual(per);
          expect(p.round).toBeLessThanOrEqual(2);
        }
        if (rounds >= 2 || per === 0) expect(p.kind).toBe("proceed");
      }
    }
  });
  it("상한은 코드가 아니라 설정을 따른다 (라운드당 2개)", () => {
    const p = planClarify(Q, TEST_DICTIONARY, { rounds: 0, answers: {} }, { clarifyRounds: 2, clarifyPerRound: 2 });
    expect(p.kind === "ask" && p.questions.length).toBe(2);
  });
  it("질문에서 이미 말한 요건은 다시 묻지 않는다", () => {
    const p = planClarify(`${Q} 이미말함A 이미말함B 이미말함C`, TEST_DICTIONARY, { rounds: 0, answers: {} }, TEST_LIMITS);
    expect(p.kind === "ask" && p.questions.map((x) => x.slotId)).toEqual(["slot_d"]);
  });
  it("모든 요건이 찼으면 바로 진행", () => {
    const p = planClarify(Q, TEST_DICTIONARY, { rounds: 1, answers: { slot_a: "a1", slot_b: "b1", slot_c: "c1", slot_d: "d2" } }, TEST_LIMITS);
    expect(p).toMatchObject({ kind: "proceed", missing: [], unsure: [] });
  });
  it("사전에 없는 주제는 역질문 없이 진행, 사전이 비어도 마찬가지", () => {
    expect(planClarify("관계없는 질문", TEST_DICTIONARY, { rounds: 0, answers: {} }, TEST_LIMITS)).toMatchObject({ kind: "proceed", topicId: null });
    expect(planClarify(Q, { version: "x", topics: [] }, { rounds: 0, answers: {} }, TEST_LIMITS).kind).toBe("proceed");
  });
});

describe("답 검사·검색 계획", () => {
  it("사전에 없는 슬롯·선택지는 버린다", () => {
    expect(sanitizeAnswers(TEST_DICTIONARY, { slot_a: "zzz", nope: "a1", slot_b: "b2", slot_c: UNSURE })).toEqual({ slot_b: "b2", slot_c: UNSURE });
    const p = planClarify(Q, TEST_DICTIONARY, { rounds: 1, answers: { slot_a: "zzz" } }, TEST_LIMITS);
    expect(p.kind === "ask" && p.questions[0]!.slotId).toBe("slot_a");
  });
  it("검색 계획은 1~4개이고 고른 선택지 이름이 들어간다", () => {
    const plan = searchPlan(Q, TEST_DICTIONARY, { slot_a: "a1", slot_b: "b2", slot_c: "c1", slot_d: "d1" });
    expect(plan.length).toBeGreaterThanOrEqual(1);
    expect(plan.length).toBeLessThanOrEqual(4);
    expect(plan[0]).toBe(Q);
    expect(plan.some((s) => s.includes("시험용 선택 A1"))).toBe(true);
    expect(searchPlan("관계없는 질문", TEST_DICTIONARY, {})).toEqual(["관계없는 질문"]);
  });
});
