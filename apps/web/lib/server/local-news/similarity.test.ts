import { describe, expect, it } from "vitest";
import { INTERNAL_SIMILARITY_RULES } from "@ltr/similarity";
import { digestSimilarity, internalRules, summaryHash } from "./similarity";

// 시험용 가짜 문장 - 실제 보도자료 아님
const ORIGINAL = [
  "시험시는 시험 설명회를 다음 달에 연다고 밝혔다.",
  "설명회에서는 시험 안건 가나다를 안내한다.",
  "참석 신청은 시험 누리집에서 받는다.",
  "문의는 시험 담당 부서로 하면 된다.",
  "자세한 내용은 시험 공고문에 나와 있다.",
].join(" ");

describe("digestSimilarity (LG-03)", () => {
  it("보도자료 문장을 그대로 옮긴 요약은 차단된다", () => {
    const r = digestSimilarity({ summary: ORIGINAL, originalText: ORIGINAL, siblings: [], rules: INTERNAL_SIMILARITY_RULES });
    expect(r.status).toBe("blocked");
    expect(r.ratio).toBe(1);
    expect(r.matches.length).toBe(5);
    expect(r.matches[0]).toMatchObject({ source: "original" });
  });
  it("편집자가 다시 쓴 요약은 통과하고 유사 문장이 없다", () => {
    const r = digestSimilarity({ summary: "행사 일정과 신청 방법이 공고되었다. 담당 부서에 연락하면 된다.", originalText: ORIGINAL, siblings: [], rules: INTERNAL_SIMILARITY_RULES });
    expect(r.status).toBe("pass");
    expect(r.matches).toEqual([]);
    expect(r.rulesVersion).toBe(INTERNAL_SIMILARITY_RULES.version);
  });
  it("원문 글자가 없으면 통과가 아니라 no_sources", () => {
    expect(digestSimilarity({ summary: "아무 요약입니다.", originalText: null, siblings: [{ id: 2, summary: "다른 항목" }], rules: INTERNAL_SIMILARITY_RULES }).status).toBe("no_sources");
    expect(digestSimilarity({ summary: "아무 요약입니다.", originalText: "  ", siblings: [], rules: INTERNAL_SIMILARITY_RULES }).status).toBe("no_sources");
  });
  it("같은 주의 다른 항목 요약을 옮겨도 차단된다", () => {
    const r = digestSimilarity({ summary: ORIGINAL, originalText: "전혀 다른 원문 글자입니다.", siblings: [{ id: 9, summary: ORIGINAL }], rules: INTERNAL_SIMILARITY_RULES });
    expect(r.status).toBe("blocked");
    expect(r.matches[0]!.source).toBe("item-9");
  });
  it("요약 5문장 중 유사 3개(60%)는 통과, 4개(80%)는 차단 - 비율 기준은 초과(LG-03)", () => {
    const sentences = ORIGINAL.split(". ").map((s) => (s.endsWith(".") ? s : `${s}.`));
    const fresh = ["행사 일정이 공고되었다.", "담당 부서가 안내한다.", "신청 방법은 누리집에 있다."];
    const three = [...sentences.slice(0, 3), fresh[0]!, fresh[1]!].join(" ");
    const four = [...sentences.slice(0, 4), fresh[2]!].join(" ");
    const r3 = digestSimilarity({ summary: three, originalText: ORIGINAL, siblings: [], rules: INTERNAL_SIMILARITY_RULES });
    expect(r3.ratio).toBe(0.6);
    expect(r3.status).toBe("pass");
    const r4 = digestSimilarity({ summary: four, originalText: ORIGINAL, siblings: [], rules: INTERNAL_SIMILARITY_RULES });
    expect(r4.ratio).toBe(0.8);
    expect(r4.status).toBe("blocked");
  });
  it("기준을 바꾸면 다음 검사부터 적용된다 - 비율 기준을 0.5로 내리면 60%도 차단", () => {
    const sentences = ORIGINAL.split(". ").map((s) => (s.endsWith(".") ? s : `${s}.`));
    const three = [...sentences.slice(0, 3), "행사 일정이 공고되었다.", "담당 부서가 안내한다."].join(" ");
    const strict = internalRules({ ...INTERNAL_SIMILARITY_RULES, articleRatio: 0.5 });
    expect(digestSimilarity({ summary: three, originalText: ORIGINAL, siblings: [], rules: INTERNAL_SIMILARITY_RULES }).status).toBe("pass");
    expect(digestSimilarity({ summary: three, originalText: ORIGINAL, siblings: [], rules: strict }).status).toBe("blocked");
  });
});

describe("internalRules / summaryHash", () => {
  it("형식이 틀린 설정은 내부 초기값", () => {
    expect(internalRules(null)).toBe(INTERNAL_SIMILARITY_RULES);
    expect(internalRules({ version: "x", sentenceSimilarity: 2 })).toBe(INTERNAL_SIMILARITY_RULES);
  });
  it("요약 해시는 md5(UTF-8)와 같은 값 - DB md5(summary)와 맞춘다", () => {
    expect(summaryHash("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(summaryHash("한글 요약")).toHaveLength(32);
    expect(summaryHash("a")).not.toBe(summaryHash("b"));
  });
});
