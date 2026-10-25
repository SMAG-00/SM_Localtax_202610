import { describe, expect, it } from "vitest";
import { parseDeterminationTable } from "@ltr/tax-engine";
import { diagnoseRefund, refundFacts, refundQuestions, refundSummary } from "./refund";
import { isAnswerValid, pendingQuestion } from "./shared";

// 시험용 판정표 - 지어낸 값이다 (실제 환급 요건 아님)
const TABLE = parseDeterminationTable({
  kind: "refund",
  version: "2099.01",
  label: "시험용 환급 판정표",
  questions: [
    { field: "paid_twice", text: "시험용: 같은 건을 두 번 냈나요?", kind: "yesno" },
    { field: "wait_days", text: "시험용: 며칠이 지났나요?", kind: "count" },
    { field: "notice_on", text: "시험용: 통지를 받은 날은 언제인가요?", kind: "date" },
  ],
  items: [
    { id: "double_pay", label: "시험용 이중 납부", rules: [{ id: "r1", when: { op: "eq", field: "paid_twice", value: true }, likelihood: "높음" }], default: "낮음" },
    { id: "late", label: "시험용 기간", rules: [{ id: "r2", when: { op: "lte", field: "wait_days", value: 10 }, likelihood: "확인 필요" }], default: "낮음" },
  ],
});

describe("환급 문진표 (판정표가 가진다)", () => {
  const qs = refundQuestions(TABLE);
  it("판정표의 문진 항목이 질문이 되고 모두 모르겠어요가 있다", () => {
    expect(qs.map((q) => [q.id, q.kind, q.canDontKnow, q.required])).toEqual([
      ["paid_twice", "yesno", true, false],
      ["wait_days", "count", true, false],
      ["notice_on", "date", true, false],
    ]);
  });
  it("질문은 차례로 나오고 모두 처리하면 끝", () => {
    const none = new Set<string>();
    expect(pendingQuestion(qs, {}, none, none)?.id).toBe("paid_twice");
    expect(pendingQuestion(qs, { paid_twice: true }, none, none)?.id).toBe("wait_days");
    expect(pendingQuestion(qs, { paid_twice: true, wait_days: 3 }, new Set(["notice_on"]), none)).toBeNull();
  });
  it.each([["2099-02-28", true], ["2099-02-30", false], ["2099-13-01", false], ["99-01-01", false], ["", false]])("날짜 답 %s 유효 여부 %s", (v, ok) => {
    expect(isAnswerValid(qs[2]!, v)).toBe(ok);
  });
});

describe("환급 진단 결과", () => {
  it("규칙이 맞으면 그 가능성, 안 맞으면 표의 기본값", () => {
    const out = diagnoseRefund(TABLE, { paid_twice: true, wait_days: 11 });
    if (out.kind !== "refund") throw new Error("kind");
    expect(out.results.map((r) => [r.id, r.likelihood])).toEqual([["double_pay", "높음"], ["late", "낮음"]]);
    expect(out.tableVersion).toBe("2099.01");
  });
  it("경계: 10일은 확인 필요, 11일은 낮음", () => {
    const at = (d: number) => {
      const out = diagnoseRefund(TABLE, { wait_days: d });
      return out.kind === "refund" ? out.results.find((r) => r.id === "late")!.likelihood : null;
    };
    expect(at(10)).toBe("확인 필요");
    expect(at(11)).toBe("낮음");
  });
  it("모르겠어요(답 없음)는 사실로 치지 않아 기본값이 된다", () => {
    const out = diagnoseRefund(TABLE, {});
    if (out.kind !== "refund") throw new Error("kind");
    expect(out.results.every((r) => r.likelihood === "낮음" && r.ruleId === null)).toBe(true);
  });
  it("종류가 틀린 답은 판정표 입력에서 빠진다", () => {
    expect(refundFacts(refundQuestions(TABLE), { paid_twice: "예", wait_days: -1, notice_on: "2099-01-01" })).toEqual({ notice_on: "2099-01-01" });
  });
  it("요약 개수", () => {
    expect(refundSummary(diagnoseRefund(TABLE, { paid_twice: true, wait_days: 5 }))).toEqual({ high: 1, check: 1 });
  });
  it("문진 항목의 입력 칸이 겹치면 판정표 검증에서 거부", () => {
    expect(() => parseDeterminationTable({ kind: "refund", version: "2099.01", label: "시험용", questions: [{ field: "a1", text: "x", kind: "yesno" }, { field: "a1", text: "y", kind: "count" }], items: [{ id: "i1", label: "x", rules: [{ id: "r1", when: { op: "manual" }, likelihood: "낮음" }], default: "낮음" }] })).toThrow();
  });
  it("문진 질문 문장이 60자를 넘으면 거부 (R8)", () => {
    expect(() => parseDeterminationTable({ kind: "refund", version: "2099.01", label: "시험용", questions: [{ field: "a1", text: "가".repeat(61), kind: "yesno" }], items: [{ id: "i1", label: "x", rules: [{ id: "r1", when: { op: "manual" }, likelihood: "낮음" }], default: "낮음" }] })).toThrow();
  });
});
