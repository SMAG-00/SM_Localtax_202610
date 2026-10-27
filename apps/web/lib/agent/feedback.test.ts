import { describe, expect, it } from "vitest";
import { parseFeedback } from "./feedback";

const sid = "11111111-1111-4111-8111-111111111111";
describe("피드백 요청 스키마 (ASK-11)", () => {
  it("정상 입력을 받는다", () => {
    expect(parseFeedback({ sessionId: sid, turn: 2, kind: "not_helpful", reason: "wrong" })).toEqual({ ok: true, value: { sessionId: sid, turn: 2, kind: "not_helpful", reason: "wrong" } });
    expect(parseFeedback({ sessionId: sid, turn: 1, kind: "helpful" })).toMatchObject({ ok: true });
  });
  it("자유 글 칸, 모르는 사유, 0턴, 도움이 됐다와 사유 동시, 깨진 세션 값을 거부한다", () => {
    expect(parseFeedback({ sessionId: sid, turn: 1, kind: "error_report", comment: "자유 글" }).ok).toBe(false);
    expect(parseFeedback({ sessionId: sid, turn: 1, kind: "not_helpful", reason: "임의" }).ok).toBe(false);
    expect(parseFeedback({ sessionId: sid, turn: 0, kind: "helpful" }).ok).toBe(false);
    expect(parseFeedback({ sessionId: sid, turn: 1, kind: "helpful", reason: "wrong" }).ok).toBe(false);
    expect(parseFeedback({ sessionId: "x", turn: 1, kind: "helpful" }).ok).toBe(false);
  });
});
