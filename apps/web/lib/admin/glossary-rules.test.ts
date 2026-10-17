// 쉬운 말 사전(glossary_terms) 입력 검사 시험 (UX-01 ① — 전문 용어 표시와 쉬운 풀이 한 줄, 풀이 60자 이하 = DB check 제약)
import { describe, expect, test } from "vitest";
import { glossaryConsistency, glossaryFormToBody, parseGlossaryInput } from "./glossary-rules";

const errorsOf = (r: { ok: boolean; errors?: string[] }) => (r.ok ? [] : (r as { errors: string[] }).errors);

describe("용어 입력 (API)", () => {
  test("API 칸 → DB 칸, 글자는 앞뒤 공백을 뺀다", () => {
    expect(
      parseGlossaryInput(
        { term: " 과세표준 ", reading: "과세 표준", definition: "세액 계산의 기준", plain: "세금을 매기는 기준 금액", jargon: true, related: ["세율"], section: ["tax"], source: "지방세법 제10조" },
        "create",
      ),
    ).toEqual({
      ok: true,
      value: { term: "과세표준", reading: "과세 표준", definition: "세액 계산의 기준", plain: "세금을 매기는 기준 금액", jargon: true, related: ["세율"], section: ["tax"], source: "지방세법 제10조" },
    });
  });
  test("쉬운 풀이 60자는 통과, 61자는 거부 (공백 포함 글자 수 — DB char_length와 같다)", () => {
    expect(parseGlossaryInput({ term: "용어", plain: "가".repeat(59) + " 나" }, "create").ok).toBe(false);
    expect(parseGlossaryInput({ term: "용어", plain: "가".repeat(58) + " 나" }, "create").ok).toBe(true);
    expect(errorsOf(parseGlossaryInput({ term: "용어", plain: "가".repeat(60) + " 나" }, "create"))).toEqual(["glossary.plain: 쉬운 풀이는 60자 이하여야 합니다 (지금 62자)"]);
  });
  test("분야는 4대 분야 값 목록만, 관련 용어는 글자 목록", () => {
    expect(errorsOf(parseGlossaryInput({ term: "용어", section: ["tax", "tour"], related: [1] }, "create"))).toEqual([
      "glossary.related: 100자 이하 글자 20개 이하 목록이어야 합니다",
      "glossary.section: tax·realestate·finance·local 중에서 고른 목록이어야 합니다",
    ]);
  });
  test("용어는 필수, 비어 있으면 거부. 모르는 칸 거부", () => {
    expect(errorsOf(parseGlossaryInput({ plain: "풀이" }, "create"))).toEqual(["glossary.term: 필요합니다"]);
    expect(errorsOf(parseGlossaryInput({ term: " " }, "create"))).toEqual(["glossary.term: 비울 수 없습니다"]);
    expect(errorsOf(parseGlossaryInput({ term: "a", entity: 3 }, "create"))).toEqual(["glossary.entity: 모르는 칸입니다"]);
  });
  test("고치기는 바꿀 칸만, 빈 글자는 null로 비운다", () => {
    expect(parseGlossaryInput({ reading: "", plain: null }, "patch")).toEqual({ ok: true, value: { reading: null, plain: null } });
    expect(errorsOf(parseGlossaryInput({}, "patch"))).toEqual(["glossary: 바꿀 칸이 없습니다"]);
  });
});

describe("전문 용어 표시에는 쉬운 풀이가 있어야 한다 — 풀이 없는 첫 등장 검사의 사전이다", () => {
  test("jargon인데 풀이가 없으면 사유", () => {
    expect(glossaryConsistency({ jargon: true, plain: null })).toMatch(/쉬운 풀이/);
    expect(glossaryConsistency({ jargon: true, plain: "  " })).toMatch(/쉬운 풀이/);
  });
  test("풀이가 있거나 전문 용어가 아니면 통과", () => {
    expect(glossaryConsistency({ jargon: true, plain: "세금을 매기는 기준 금액" })).toBeNull();
    expect(glossaryConsistency({ jargon: false, plain: null })).toBeNull();
  });
});

describe("화면 폼 → 요청 본문", () => {
  const form = { term: "과세표준", reading: "", definition: "", plain: "세금을 매기는 기준 금액", jargon: true, relatedText: "세율, 시가표준액", sections: ["tax"], source: "" };
  test("쉼표로 나눈 관련 용어, 빈 칸은 null", () => {
    expect(glossaryFormToBody(form)).toEqual({
      ok: true,
      body: { term: "과세표준", reading: null, definition: null, plain: "세금을 매기는 기준 금액", jargon: true, related: ["세율", "시가표준액"], section: ["tax"], source: null },
    });
  });
  test("칸 오류 — 용어 비움, 풀이 61자, 전문 용어인데 풀이 없음", () => {
    expect(glossaryFormToBody({ ...form, term: "", plain: "가".repeat(61) }, "g")).toEqual({
      ok: false,
      errors: { "g-term": "용어를 적어 주세요", "g-plain": "쉬운 풀이는 60자 이하로 씁니다 (지금 61자)" },
    });
    expect(glossaryFormToBody({ ...form, plain: "" }, "g")).toEqual({ ok: false, errors: { "g-plain": "전문 용어로 표시하면 쉬운 풀이를 적어야 합니다 — 풀이 없는 첫 등장 검사에 씁니다" } });
  });
});
