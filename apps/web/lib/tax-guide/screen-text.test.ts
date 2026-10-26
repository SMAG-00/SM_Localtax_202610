import { describe, expect, it } from "vitest";
import { amountHits, extraForbiddenHits, screenTextProblems } from "./screen-text";

describe("화면 문구 검사 (RDV-09 · PR-12)", () => {
  it("유망 구역·예상 수익·분담금 계산·사업성·추천 표현을 걸러낸다 (공백이 끼어도)", () => {
    expect(extraForbiddenHits("이 구역은 유망 구역입니다")).toEqual(["유망 구역"]);
    expect(extraForbiddenHits("예상  수익을 알려드립니다")).toEqual(["예상 수익"]);
    expect(extraForbiddenHits("분담금 계산 도구")).toEqual(["분담금 계산"]);
    expect(extraForbiddenHits("사업성이 높습니다")).toEqual(["사업성"]);
    expect(extraForbiddenHits("이쪽이 유리합니다")).toEqual(["유리합니다"]);
  });

  it("판정 화면의 중립 문장은 통과한다", () => {
    expect(screenTextProblems("판정은 참고용입니다. 시험용 결론 갑 - 요건 확인 필요")).toEqual([]);
  });

  it("금액 표현(숫자 + 원)을 걸러내고, 원칙·원문 같은 낱말은 금액이 아니다", () => {
    expect(amountHits("취득세 1,000원")).toEqual(["1,000원"]);
    expect(amountHits("3억 원 상당")).toHaveLength(1);
    expect(amountHits("원칙적으로 5 원칙")).toEqual([]);
    expect(amountHits("제3조 원문 보기")).toEqual([]);
  });

  it("두 종류 문제를 모두 낸다", () => {
    expect(screenTextProblems("사업성 분석 2억원").map((p) => p.kind).sort()).toEqual(["amount", "extra_forbidden"]);
  });
});
