import { describe, expect, it } from "vitest";
import { buildTaskMessage, decideCopilotGate, parseCopilotRequest, parseMonthlyLimit, statusOfRefusal, type GateInput } from "./logic";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `case_decision:${i + 1}`);
const open: GateInput = { featureOn: true, modelConfigured: true, stage: "4c", limit: 5, internal: false, loggedIn: true, entitled: true };

describe("입력 경계 (RES-01 2~8건)", () => {
  it.each([2, 8])("결정례 %i건은 허용", (n) => {
    const r = parseCopilotRequest({ kind: "comparison", ids: ids(n) });
    expect(r.ok).toBe(true);
  });
  it.each([0, 1, 9])("결정례 %i건은 422로 거부", (n) => {
    expect(parseCopilotRequest({ kind: "comparison", ids: ids(n) })).toEqual({ ok: false, status: 422, code: "count_out_of_range" });
  });
  it("같은 결정례를 두 번 골라도 1건으로 센다", () => {
    expect(parseCopilotRequest({ kind: "comparison", ids: ["a:1", "a:1"] })).toMatchObject({ ok: false, status: 422 });
  });
  it("번호 모양이 틀리면 400", () => {
    expect(parseCopilotRequest({ kind: "comparison", ids: ["a b", "c:2"] })).toMatchObject({ ok: false, status: 400, code: "bad_ids" });
  });
  it("연혁은 시작이 끝보다 늦으면 거부, 존재하지 않는 날짜도 거부", () => {
    expect(parseCopilotRequest({ kind: "history", ref: "시험법 제3조", from: "2024-01-02", to: "2024-01-01" })).toMatchObject({ ok: false, code: "bad_period" });
    expect(parseCopilotRequest({ kind: "history", ref: "시험법 제3조", from: "2024-02-30", to: "2024-03-01" })).toMatchObject({ ok: false, code: "bad_period" });
    expect(parseCopilotRequest({ kind: "history", ref: "시험법 제3조", from: "2020-01-01", to: "2024-01-01" }).ok).toBe(true);
  });
  it("쟁점 메모의 메모는 2000자까지", () => {
    expect(parseCopilotRequest({ kind: "issue_memo", ids: ["a:1"], note: "가".repeat(2000) }).ok).toBe(true);
    expect(parseCopilotRequest({ kind: "issue_memo", ids: ["a:1"], note: "가".repeat(2001) })).toMatchObject({ ok: false, code: "note_too_long" });
  });
  it("모르는 종류는 400", () => {
    expect(parseCopilotRequest({ kind: "x" })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("월 한도 값 (RES-05)", () => {
  it("빈 객체·0·음수·문자열은 null(실행 0)", () => {
    for (const v of [{}, 0, -1, "5", null, undefined, { per_user: 0 }]) expect(parseMonthlyLimit(v)).toBeNull();
  });
  it("양의 정수와 per_user 모양은 값으로", () => {
    expect(parseMonthlyLimit(7)).toBe(7);
    expect(parseMonthlyLimit({ per_user: 3 })).toBe(3);
  });
});

describe("공개 판정 - 기능 키 ∧ 모델 ∧ 공개 단계 ∧ 한도 ∧ 계정", () => {
  it("모두 맞으면 열림", () => expect(decideCopilotGate(open)).toEqual({ open: true }));
  it.each([
    ["feature_off", { featureOn: false }],
    ["model_unset", { modelConfigured: false }],
    ["stage_none", { stage: "none" as const }],
    ["limit_unset", { limit: null }],
    ["audience", { loggedIn: false }],
    ["entitlement_missing", { entitled: false }],
  ])("%s이면 닫힘", (reason, over) => {
    expect(decideCopilotGate({ ...open, ...over })).toEqual({ open: false, reason });
  });
  it("4b에는 내부 계정만 열리고 프리미엄 회원은 닫힘", () => {
    expect(decideCopilotGate({ ...open, stage: "4b", internal: false })).toEqual({ open: false, reason: "audience" });
    expect(decideCopilotGate({ ...open, stage: "4b", internal: true, entitled: false })).toEqual({ open: true });
  });
  it("권한만 없는 회원은 403, 그 밖은 404", () => {
    expect(statusOfRefusal("entitlement_missing")).toBe(403);
    expect(statusOfRefusal("stage_none")).toBe(404);
  });
});

describe("작업 지시문", () => {
  it("연혁 지시문은 한글 연월일을 쓰지 않아 기준일 추출에 걸리지 않는다", () => {
    const m = buildTaskMessage({ kind: "history", ref: "시험법 제3조", from: "2020-01-01", to: "2024-12-31" });
    expect(m).toContain("2020-01-01");
    expect(/\d{4}\s?년/u.test(m)).toBe(false);
  });
});
