import { describe, expect, test } from "vitest";
import { LOCAL_TAX_TYPES, classifyQuestion } from "./classify";

describe("classifyQuestion - 정규식 세목 제안", () => {
  test("본문에 나온 세목을 언급 횟수 내림차순으로 제안한다", () => {
    const p = classifyQuestion("재산세 고지서", "재산세 납부 기한과 취득세 신고 기한이 헷갈립니다. 재산세는 언제 내나요?", []);
    expect(p.taxTypes).toEqual(["재산세", "취득세"]);
    expect(p.piiSuspected).toBe(false);
  });
  test("언급 횟수가 같으면 목록 순서를 따른다", () => {
    expect(classifyQuestion("주민세 취득세", "", []).taxTypes).toEqual(["취득세", "주민세"]);
  });
  test("세목 이름이 없으면 빈 제안이다", () => {
    expect(classifyQuestion("질문입니다", "어디에 문의하나요", []).taxTypes).toEqual([]);
  });
  test("공백이 끼어도 찾는다 (취득 세 -> 취득세)", () => {
    expect(classifyQuestion("취득 세 감면", "", []).taxTypes).toEqual(["취득세"]);
  });
  test("국세는 제안하지 않는다 (종합부동산세·양도소득세)", () => {
    expect(classifyQuestion("종합부동산세 양도소득세", "부가가치세 소득세", []).taxTypes).toEqual([]);
    expect((LOCAL_TAX_TYPES as readonly string[]).includes("종합부동산세")).toBe(false);
  });
  test("후보는 최대 5개다", () => {
    expect(classifyQuestion(LOCAL_TAX_TYPES.join(" "), "", []).taxTypes).toHaveLength(5);
  });
  test("가림이 일어난 글은 개인정보 의심으로 표시한다", () => {
    expect(classifyQuestion("재산세", "", ["phone"]).piiSuspected).toBe(true);
  });
});
