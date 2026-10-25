import { describe, expect, it } from "vitest";
import { cardLikeRuns, containsCardNumber, luhnValid } from "./card-scan";

describe("카드번호 패턴 검사", () => {
  it("공개된 시험 카드 번호(Luhn 통과)는 공백·하이픈이 있어도 잡는다", () => {
    expect(cardLikeRuns("4111111111111111")).toEqual(["4111111111111111"]);
    expect(cardLikeRuns("카드 4111 1111 1111 1111 입니다")).toEqual(["4111111111111111"]);
    expect(cardLikeRuns("5555-5555-5555-4444")).toEqual(["5555555555554444"]);
  });

  it("Luhn을 통과하지 못하는 긴 숫자열(날짜·식별자 모양)은 잡지 않는다", () => {
    expect(cardLikeRuns("4111111111111112")).toEqual([]);
    expect(cardLikeRuns("2026-10-24 23:51:43.641+00")).toEqual([]);
    expect(cardLikeRuns("주문 1234567890123 번")).toEqual([]);
  });

  it("13자리 미만·20자리 이상 숫자열은 대상이 아니다", () => {
    expect(cardLikeRuns("411111111111")).toEqual([]);
    expect(cardLikeRuns("41111111111111111111")).toEqual([]);
  });

  it("객체 값도 훑고, 없음·빈 값은 false", () => {
    expect(containsCardNumber({ memo: "4111 1111 1111 1111" })).toBe(true);
    expect(containsCardNumber({ memo: "정상 메모" })).toBe(false);
    expect(containsCardNumber(null)).toBe(false);
    expect(containsCardNumber(undefined)).toBe(false);
  });

  it("Luhn 계산 자체 확인", () => {
    expect(luhnValid("79927398713")).toBe(true);
    expect(luhnValid("79927398710")).toBe(false);
  });
});
