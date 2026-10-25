import { describe, expect, it } from "vitest";
import { INTERNAL_SIMILARITY_RULES } from "@ltr/similarity";
import { plainTextOf, rightsVerdict } from "./rights";

// 시험용 원문 - 지어낸 문장이다 (실제 자료 아님)
const ORIGINAL = [
  "시험용 원문 첫째 문장은 가나다라마바사 아자차카타파하를 설명합니다.",
  "시험용 원문 둘째 문장은 하나 둘 셋 넷 다섯 여섯 일곱을 설명합니다.",
  "시험용 원문 셋째 문장은 동해물과 백두산이 마르고 닳도록을 설명합니다.",
  "시험용 원문 넷째 문장은 남산 위에 저 소나무 철갑을 두른 듯을 설명합니다.",
].join(" ");

describe("공공누리 제4유형 전재 검사 (PR-06)", () => {
  it("원문 문장을 그대로 옮긴 본문은 차단된다", () => {
    const v = rightsVerdict({ body: ORIGINAL, original: ORIGINAL, rules: INTERNAL_SIMILARITY_RULES });
    expect(v.status).toBe("blocked");
    expect(v.maxSimilarity).toBe(1);
    expect(v.similarRatio).toBe(1);
  });

  it("편집자가 다시 쓴 요지는 통과한다", () => {
    const v = rightsVerdict({ body: "편집자 요지입니다. 세부 내용은 아래 링크의 원문을 확인하세요.", original: ORIGINAL, rules: INTERNAL_SIMILARITY_RULES });
    expect(v.status).toBe("pass");
    expect(v.similarRatio).toBe(0);
  });

  it("원문이 비어 있으면 통과가 아니다 (no_sources)", () => {
    const v = rightsVerdict({ body: "편집자 요지입니다.", original: "   ", rules: INTERNAL_SIMILARITY_RULES });
    expect(v.status).toBe("no_sources");
    expect(v.maxSimilarity).toBeNull();
  });

  it("기준값은 설정을 따른다 - 4문장 중 2문장이 같으면(50%) 기본 기준은 통과, 기사 비율 기준을 0.4로 낮추면 차단", () => {
    const [s1, s2] = ORIGINAL.split(". ").map((s, i) => (i < 1 ? `${s}.` : s));
    const body = `${s1} ${s2}. 편집자가 덧붙인 첫 번째 요지는 전혀 다른 말입니다. 편집자가 덧붙인 두 번째 요지도 완전히 다른 글입니다.`;
    const normal = rightsVerdict({ body, original: ORIGINAL, rules: INTERNAL_SIMILARITY_RULES });
    expect(normal.similarRatio).toBe(0.5);
    expect(normal.status).toBe("pass");
    const strict = rightsVerdict({ body, original: ORIGINAL, rules: { ...INTERNAL_SIMILARITY_RULES, articleRatio: 0.4, version: "시험용-엄격" } });
    expect(strict.rulesVersion).toBe("시험용-엄격");
    expect(strict.status).toBe("blocked");
  });
});

describe("스냅샷 응답에서 비교용 글자 뽑기", () => {
  it("JSON 의 글자 값만 줄바꿈으로 잇고 키 이름·숫자는 빼며, JSON 이 아니면 그대로 쓴다", () => {
    expect(plainTextOf(JSON.stringify({ Items: { item: [{ nm: "가 문장", n: 3 }, { nm: "나 문장" }] } }))).toBe("가 문장\n나 문장");
    expect(plainTextOf("그냥 글자 {깨진")).toBe("그냥 글자 {깨진");
  });
});
