import { describe, expect, it } from "vitest";
import { countChars, normalizeText, splitSentences } from "./text";

describe("문장 나누기 (R8 문장 수·글자 수 검사의 단위)", () => {
  it("마침표·물음표·느낌표 뒤 띄어쓰기에서 나눈다", () => {
    expect(splitSentences("취득세는 지방세다. 언제 내나요? 60일 안에 냅니다!")).toEqual([
      "취득세는 지방세다.",
      "언제 내나요?",
      "60일 안에 냅니다!",
    ]);
  });

  it("소수점(18.4%)과 보도자료식 날짜(2026. 11. 2.)에서는 나누지 않는다", () => {
    expect(splitSentences("세수가 18.4% 줄었다. 신청은 2026. 11. 2.부터 받는다.")).toEqual([
      "세수가 18.4% 줄었다.",
      "신청은 2026. 11. 2.부터 받는다.",
    ]);
  });

  it("줄바꿈은 언제나 문장을 가르고, 마침표 없는 마지막 조각도 문장이다", () => {
    expect(splitSentences("첫 줄입니다\n둘째 줄입니다. 셋째 문장")).toEqual(["첫 줄입니다", "둘째 줄입니다.", "셋째 문장"]);
  });

  it("문장 첫머리 번호(1.)는 문장 끝이 아니다", () => {
    expect(splitSentences("1. 잔금일을 확인합니다.")).toEqual(["1. 잔금일을 확인합니다."]);
  });

  it("닫는 따옴표·괄호는 앞 문장에 붙는다", () => {
    expect(splitSentences("“신청하세요.” 시는 이렇게 말했다.")).toEqual(["“신청하세요.”", "시는 이렇게 말했다."]);
  });

  it("빈 글자와 공백만 있는 글은 문장 0개", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("  \n \n")).toEqual([]);
  });
});

describe("글자 수 — 공백을 빼고 센다 (R1 글자 수 검사와 같은 셈법)", () => {
  it("한글·숫자·부호는 한 글자씩, 공백·줄바꿈은 세지 않는다", () => {
    expect(countChars("가온시 1,284억 원.")).toBe(11);
    expect(countChars(" 가 \n 나 ")).toBe(2);
  });

  it("두 단위 문자(이모지 등)도 한 글자로 센다", () => {
    expect(countChars("가😀나")).toBe(3);
  });
});

describe("표현 비교용 정리", () => {
  it("연속 공백을 하나로 줄이고 앞뒤 공백을 지운다", () => {
    expect(normalizeText("  절세   보장\n입니다 ")).toBe("절세 보장 입니다");
  });

  it("조합형(NFD) 한글을 완성형(NFC)으로 맞춘다", () => {
    expect(normalizeText("절세 보장".normalize("NFD"))).toBe("절세 보장");
  });
});
