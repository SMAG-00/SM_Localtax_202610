import { describe, expect, it } from "vitest";
import { blockRateExceeds, budgetAlertLevel, parseJudge } from "./quality";

describe("차단율 경보 조건", () => {
  it("20% 정확히는 경보 아님, 넘으면 경보", () => {
    expect(blockRateExceeds(10, 2)).toBe(false);
    expect(blockRateExceeds(10, 3)).toBe(true);
    expect(blockRateExceeds(100, 20)).toBe(false);
    expect(blockRateExceeds(100, 21)).toBe(true);
  });
  it("표본이 최소 수 미만이면 판단하지 않는다", () => {
    expect(blockRateExceeds(4, 4)).toBe(false);
    expect(blockRateExceeds(5, 5)).toBe(true);
    expect(blockRateExceeds(0, 0)).toBe(false);
    expect(blockRateExceeds(2, 1, 2)).toBe(true);
  });
});

describe("예산 경보 수준", () => {
  it("79.99%는 ok, 80%는 warn, 99.99%는 warn, 100%는 over", () => {
    expect(budgetAlertLevel(7999, 10000)).toBe("ok");
    expect(budgetAlertLevel(8000, 10000)).toBe("warn");
    expect(budgetAlertLevel(9999, 10000)).toBe("warn");
    expect(budgetAlertLevel(10000, 10000)).toBe("over");
    expect(budgetAlertLevel(25000, 10000)).toBe("over");
  });
  it("예산이 비었거나 0 이하·문자열이면 unset (경보 0)", () => {
    for (const v of [null, undefined, 0, -5, Number.NaN, "100" as never]) expect(budgetAlertLevel(999999, v)).toBe("unset");
  });
});

describe("표본 판정 입력", () => {
  it("올바른 입력은 통과", () => {
    expect(parseJudge({ message_id: "12", verdict: "wrong", note: " 확인 필요 ", eval_candidate: true })).toEqual({ ok: true, value: { message_id: 12, verdict: "wrong", note: "확인 필요", eval_candidate: true } });
  });
  it("판정 값·번호가 틀리면 거부", () => {
    const r = parseJudge({ message_id: 0, verdict: "great" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(2);
  });
  it("메모에 번호(9자리 이상)·이메일이 있거나 500자를 넘으면 거부", () => {
    expect(parseJudge({ message_id: 1, verdict: "good", note: "연락 123456789" }).ok).toBe(false);
    expect(parseJudge({ message_id: 1, verdict: "good", note: "a@b.co" }).ok).toBe(false);
    expect(parseJudge({ message_id: 1, verdict: "good", note: "가".repeat(501) }).ok).toBe(false);
    expect(parseJudge({ message_id: 1, verdict: "good", note: "가".repeat(500) }).ok).toBe(true);
  });
});
