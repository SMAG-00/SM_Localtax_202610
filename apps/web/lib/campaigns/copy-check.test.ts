import { describe, expect, test } from "vitest";
import { campaignCopyProblems } from "./copy-check";

describe("캠페인 문구 검사", () => {
  test("차분한 안내 문구는 통과한다", () => {
    expect(campaignCopyProblems("취득세, 먼저 계산해 보세요", "부동산 세금 계산기로 취득세를 미리 확인할 수 있습니다.")).toEqual([]);
  });
  test("과장 표현 '무조건'은 제목·본문 위치와 함께 막는다", () => {
    const got = campaignCopyProblems("무조건 줄어드는 취득세", "안내입니다");
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((m) => m.startsWith("제목"))).toBe(true);
  });
  test("세액(숫자와 원)은 본문에서도 막는다", () => {
    expect(campaignCopyProblems("안내", "최대 3,000,000원 절세").some((m) => m.startsWith("본문") && m.includes("세액"))).toBe(true);
  });
  test.each(["AI 계산기", "AI 세금 계산", "ai 환급"])("'%s' 같은 AI 계산 표현은 막는다", (t) => {
    expect(campaignCopyProblems(`${t}로 확인`, "안내").some((m) => m.includes("AI가 하는 것처럼"))).toBe(true);
  });
  test("투자 권유 표현은 막는다", () => {
    expect(campaignCopyProblems("안내", "지금 사야 할 단지").length).toBeGreaterThan(0);
  });
  test("운영 사전의 금지 표현도 함께 본다", () => {
    expect(campaignCopyProblems("특별한 혜택", "안내", ["특별한 혜택"]).length).toBeGreaterThan(0);
  });
});
