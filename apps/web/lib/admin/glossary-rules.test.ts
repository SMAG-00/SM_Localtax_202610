// 쉬운 말 사전(glossary_terms) 입력 검사 시험 (UX-01 ① · GLO-01 — 전문 용어 표시와 쉬운 풀이 한 줄, 공개 상태, 저장 경고)
// 경고 기준·한도·단위·견본은 설계 문서(docs/dev/W2-d_설계.md 2.5·2.6)를 읽어 대조한다
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { GLOSSARY_GUIDE, GLOSSARY_LIMITS, GLOSSARY_NUMBER_UNITS, glossaryConsistency, glossaryFormToBody, glossaryWarnings, numberUnitHits, parseGlossaryInput } from "./glossary-rules";

const DESIGN = fs.readFileSync(path.resolve(__dirname, "../../../../docs/dev/W2-d_설계.md"), "utf8");
const sub = (no: string) => {
  const s = DESIGN.split(/^#{2,3} /m).find((x) => x.startsWith(no));
  if (!s) throw new Error(`설계 문서에 ${no}이 없다`);
  return s;
};
const ticks = (s: string) => [...s.matchAll(/`([^`]*)`/g)].map((m) => m[1]!);
const designValue = (name: string) => {
  const line = sub("2.5").split("\n").find((l) => l.startsWith(`| ${name} `));
  if (!line) throw new Error(`설계 2.5에 ${name}이 없다`);
  return ticks(line.split("|")[2]!);
};
/** 2.6 견본 — [풀이, 찾은 글 | null] */
const GOLDEN = sub("2.6")
  .split("\n")
  .filter((l) => /^\| `/.test(l))
  .map((l) => {
    const [text, hit] = l.split("|").slice(1, -1).map((c) => c.trim());
    return [ticks(text!)[0]!, hit === "—" ? null : ticks(hit!)[0]!] as const;
  });

const errorsOf = (r: { ok: boolean; errors?: string[] }) => (r.ok ? [] : (r as { errors: string[] }).errors);
const GUIDE = Number(designValue("glossary.plain_guide")[0]);
const MAX = Number(designValue("glossary.plain_max")[0]);

describe("설계 2.5 값과 같다", () => {
  test("쉬운 풀이 경고 기준·저장 한도·숫자 단위", () => {
    expect(GLOSSARY_GUIDE.plainChars).toBe(GUIDE);
    expect(GLOSSARY_LIMITS.plain).toBe(MAX);
    expect([...GLOSSARY_NUMBER_UNITS]).toEqual(designValue("glossary.number_units"));
  });
});

describe("용어 입력 (API)", () => {
  test("API 칸 → DB 칸, 글자는 앞뒤 공백을 뺀다 · 공개 상태는 true/false", () => {
    expect(
      parseGlossaryInput(
        { term: " 가짜용어갑 ", reading: "가짜 용어 갑", definition: "시험용 뜻", plain: "시험용 풀이", jargon: true, related: ["가짜용어을"], section: ["tax"], source: "시험 출처", visible: true },
        "create",
      ),
    ).toEqual({
      ok: true,
      value: { term: "가짜용어갑", reading: "가짜 용어 갑", definition: "시험용 뜻", plain: "시험용 풀이", jargon: true, related: ["가짜용어을"], section: ["tax"], source: "시험 출처", visible: true },
    });
    expect(errorsOf(parseGlossaryInput({ term: "가짜", visible: "yes" }, "create"))).toEqual(["glossary.visible: true/false여야 합니다"]);
    expect(parseGlossaryInput({ visible: false }, "patch")).toEqual({ ok: true, value: { visible: false } });
  });
  test(`쉬운 풀이 ${GUIDE + 1}자는 받는다(경고는 따로) — ${MAX}자까지 받고 ${MAX + 1}자는 거부 (공백 포함 글자 수 — DB char_length와 같다)`, () => {
    expect(parseGlossaryInput({ term: "가짜", plain: "가".repeat(GUIDE + 1) }, "create").ok).toBe(true);
    expect(parseGlossaryInput({ term: "가짜", plain: "가".repeat(MAX - 2) + " 나" }, "create").ok).toBe(true);
    expect(errorsOf(parseGlossaryInput({ term: "가짜", plain: "가".repeat(MAX - 1) + " 나" }, "create"))).toEqual([`glossary.plain: 쉬운 풀이는 ${MAX}자까지 저장됩니다 (지금 ${MAX + 1}자)`]);
  });
  test("분야는 4대 분야 값 목록만, 관련 용어는 글자 목록", () => {
    expect(errorsOf(parseGlossaryInput({ term: "가짜", section: ["tax", "tour"], related: [1] }, "create"))).toEqual([
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
    expect(glossaryConsistency({ jargon: true, plain: "시험용 풀이" })).toBeNull();
    expect(glossaryConsistency({ jargon: false, plain: null })).toBeNull();
  });
});

describe(`저장 경고 (GLO-01) — 쉬운 풀이 ${GUIDE}자 초과 · 풀이·뜻의 숫자 + 단위. 저장은 된다`, () => {
  test(`${GUIDE}자는 경고 0, ${GUIDE + 1}자는 경고 1 — 공백도 한 글자, 앞뒤 공백은 세지 않는다`, () => {
    expect(glossaryWarnings({ plain: "가".repeat(GUIDE) })).toEqual([]);
    expect(glossaryWarnings({ plain: `  ${"가".repeat(GUIDE - 2)} 나  ` })).toEqual([]);
    expect(glossaryWarnings({ plain: "가".repeat(GUIDE + 1) })).toEqual([
      { id: "glo01.plain-long", field: "plain", message: `쉬운 풀이가 ${GUIDE + 1}자입니다 (기준 ${GUIDE}자 이하) — 한 줄로 줄여 주세요` },
    ]);
  });
  test("풀이가 없으면 경고 0", () => {
    expect(glossaryWarnings({ plain: null, definition: null })).toEqual([]);
    expect(glossaryWarnings({})).toEqual([]);
  });
  test("쉬운 풀이와 뜻의 숫자 + 단위 — 칸마다 경고 하나, 찾은 글을 보여 준다(세 개까지)", () => {
    expect(glossaryWarnings({ plain: "가짜 풀이 3%와 1억 원", definition: "뜻에는 85㎡" })).toEqual([
      { id: "glo01.number-unit", field: "plain", message: "쉬운 풀이에 숫자와 단위가 있습니다 (‘3%’ · ‘1억 원’) — 세율·공제액·요건 숫자는 바뀔 수 있어 풀이에 넣지 않습니다" },
      { id: "glo01.number-unit", field: "definition", message: "뜻에 숫자와 단위가 있습니다 (‘85㎡’) — 세율·공제액·요건 숫자는 바뀔 수 있어 풀이에 넣지 않습니다" },
    ]);
    expect(glossaryWarnings({ plain: "1% 2% 3% 4%" })[0]!.message).toContain("(‘1%’ · ‘2%’ · ‘3%’ 외 1개)");
  });
  test("긴 풀이에 숫자 + 단위도 있으면 경고 둘 — 글자 수 먼저", () => {
    expect(glossaryWarnings({ plain: `${"가".repeat(GUIDE)} 3%` }).map((w) => w.id)).toEqual(["glo01.plain-long", "glo01.number-unit"]);
  });
});

describe("숫자 + 단위 찾기 — 설계 2.6 견본 표", () => {
  test.each(GOLDEN.map(([text, hit]) => [text, hit]))("%s → %s", (text, hit) => {
    expect(numberUnitHits(text)).toEqual(hit === null ? [] : [hit]);
  });
  test("견본 표에는 경고 견본과 경고 없는 견본이 함께 있다", () => {
    expect(GOLDEN.filter(([, h]) => h !== null).length).toBeGreaterThanOrEqual(10);
    expect(GOLDEN.filter(([, h]) => h === null).length).toBeGreaterThanOrEqual(8);
  });
  test("여러 개는 나온 차례대로, 같은 글은 한 번", () => {
    expect(numberUnitHits("1억 2천만 원과 3% 그리고 3%")).toEqual(["1억", "2천만 원", "3%"]);
  });
});

describe("화면 폼 → 요청 본문", () => {
  const form = { term: "가짜용어갑", reading: "", definition: "", plain: "시험용 풀이", jargon: true, relatedText: "가짜용어을, 가짜용어병", sections: ["tax"], source: "", visible: false };
  test("쉼표로 나눈 관련 용어, 빈 칸은 null, 공개 상태", () => {
    expect(glossaryFormToBody(form)).toEqual({
      ok: true,
      body: { term: "가짜용어갑", reading: null, definition: null, plain: "시험용 풀이", jargon: true, related: ["가짜용어을", "가짜용어병"], section: ["tax"], source: null, visible: false },
    });
  });
  test("고치기 폼은 공개 상태를 보내지 않는다 (공개·숨김은 따로 단추)", () => {
    const patchForm = { ...form, visible: undefined };
    const r = glossaryFormToBody(patchForm);
    expect(r.ok && "visible" in r.body).toBe(false);
  });
  test(`칸 오류 — 용어 비움, 풀이 ${MAX + 1}자(${GUIDE + 1}자는 오류가 아니다), 전문 용어인데 풀이 없음`, () => {
    expect(glossaryFormToBody({ ...form, plain: "가".repeat(GUIDE + 1) }, "g").ok).toBe(true);
    expect(glossaryFormToBody({ ...form, term: "", plain: "가".repeat(MAX + 1) }, "g")).toEqual({
      ok: false,
      errors: { "g-term": "용어를 적어 주세요", "g-plain": `쉬운 풀이는 ${MAX}자까지 저장됩니다 (지금 ${MAX + 1}자)` },
    });
    expect(glossaryFormToBody({ ...form, plain: "" }, "g")).toEqual({ ok: false, errors: { "g-plain": "전문 용어로 표시하면 쉬운 풀이를 적어야 합니다 — 풀이 없는 첫 등장 검사에 씁니다" } });
  });
});
