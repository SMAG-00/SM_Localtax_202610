// 편집국 API 응답 → 화면 문장 시험 — 401·403·409·422·500·연결 실패를 쉬운 한국어로, 422의 칸 오류·판정 항목은 목록으로
import { describe, expect, test } from "vitest";
import { apiErrorDetails, apiErrorMessage } from "./api-client";

describe("apiErrorMessage", () => {
  test("서버 문장을 그대로 쓴다 (409 버전 충돌·DB 규칙 문장)", () => {
    expect(apiErrorMessage({ status: 409, body: { error: "다른 사람이 먼저 고쳤습니다 — 지금 버전 4", version: 4 } })).toBe("다른 사람이 먼저 고쳤습니다 — 지금 버전 4");
    expect(apiErrorMessage({ status: 403, body: { error: "편집 승인은 편집 책임자(editor) 역할이 있어야 합니다" } })).toMatch(/편집 책임자/);
  });

  test("401은 다시 로그인 안내, 연결 실패(0)는 연결 확인 안내", () => {
    expect(apiErrorMessage({ status: 401, body: { error: "로그인이 필요합니다" } })).toBe("로그인이 끝났습니다 — 다시 로그인해 주세요");
    expect(apiErrorMessage({ status: 0, body: {} })).toBe("서버에 닿지 않았습니다 — 연결을 확인하고 다시 시도하세요");
  });

  test("문장이 없는 응답은 상태별 기본 문장", () => {
    expect(apiErrorMessage({ status: 500, body: { raw: "<html>" } })).toBe("서버 오류가 났습니다 — 잠시 뒤 다시 시도하세요");
    expect(apiErrorMessage({ status: 422, body: {} })).toBe("입력값을 확인하세요");
  });
});

describe("apiErrorDetails", () => {
  test("칸 오류(errors)와 차단 판정 문장(findings)을 함께 — 경고는 빼고 겹치지 않게", () => {
    const details = apiErrorDetails({
      status: 422,
      body: {
        error: "입력값을 확인하세요",
        errors: ["title: 비울 수 없습니다"],
        findings: [
          { id: "core01.topics-required", level: "block", ruleRef: "CORE-01", message: "관련 세목을 1개 이상 골라 주세요" },
          { id: "ux01.jargon-unexplained", level: "warn", ruleRef: "UX-01", message: "풀이 없음" },
          { id: "core01.topics-required", level: "block", ruleRef: "CORE-01", message: "관련 세목을 1개 이상 골라 주세요" },
        ],
      },
    });
    expect(details).toEqual(["title: 비울 수 없습니다", "관련 세목을 1개 이상 골라 주세요"]);
  });

  test("모양이 틀린 값은 무시한다", () => {
    expect(apiErrorDetails({ status: 422, body: { errors: "x", findings: [null, 3] } })).toEqual([]);
  });
});
