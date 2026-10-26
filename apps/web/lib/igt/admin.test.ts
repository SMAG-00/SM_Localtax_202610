import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { casePiiProblems, parseCaseAdd, parseCreate, parseId, parseSign } from "./admin";
import { lensOwnFilter } from "./gate";

const DRAFT = fs.readFileSync(path.resolve(__dirname, "../../../../rules-igt/2026.07.json"), "utf8");
const draftWith = (version: string, patch: Record<string, unknown> = {}) => JSON.stringify({ ...JSON.parse(DRAFT), version, ...patch });
const caseBody = (over: Record<string, unknown> = {}) => ({
  case_key: "case-001",
  tax_kind: "gift",
  sample_kind: "official",
  official_basis: "tax_notice",
  official_total: "77600000",
  case_input: JSON.stringify({ gift_date: "2026-08-10", donor_relationship: "lineal_ascendant", recipient_is_resident: true, gift_value: 500000000 }),
  ...over,
});

describe("초안 만들기 입력 (FAM-12)", () => {
  test("정상: 버전 일치 + draft", () => {
    const p = parseCreate({ version: "2026.07", source_ref: "rules-igt/2026.07.json", basis_note: "초기 반입", body: draftWith("2026.07") });
    expect(p.ok).toBe(true);
  });
  test("버전 모양 · 본문 버전 불일치 · 활성 상태로 만들기 · JSON 아님 · 사유 없음은 거부", () => {
    const base = { version: "2026.07", source_ref: "x", basis_note: "n", body: draftWith("2026.07") };
    for (const bad of [
      { ...base, version: "2026-07" },
      { ...base, body: draftWith("2026.08") },
      { ...base, body: draftWith("2026.07", { status: "active" }) },
      { ...base, body: "{" },
      { ...base, body: "[]" },
      { ...base, basis_note: "  " },
      { ...base, source_ref: "x".repeat(201) },
    ]) expect(parseCreate(bad).ok).toBe(false);
  });
});

describe("서명·승인 입력", () => {
  test("id는 양의 정수, 감수 시트 위치는 1~200자", () => {
    expect(parseId({ id: 5 }).ok).toBe(true);
    for (const id of [0, -1, "x", "1.5", ""]) expect(parseId({ id }).ok).toBe(false);
    expect(parseSign({ id: 3, sheet_ref: "시트 A열 3" }).ok).toBe(true);
    expect(parseSign({ id: 3, sheet_ref: " " }).ok).toBe(false);
  });
});

describe("대조 사례 입력과 개인정보 검사", () => {
  test("정상 사례: 거주 여부 칸 이름은 통과한다", () => {
    expect(parseCaseAdd(caseBody()).ok).toBe(true);
  });
  test("이름·주소·주민 칸, 문장 값, 9자리 이상 숫자 글자는 거부 (값은 되풀이하지 않는다)", () => {
    expect(casePiiProblems({ donor_name: "x" })).toHaveLength(1);
    expect(casePiiProblems({ resident_no: "x" })).toHaveLength(1);
    expect(casePiiProblems({ memo: "홍길동 서울시" })).toHaveLength(1);
    expect(casePiiProblems({ id: "123456789012" })).toHaveLength(1);
    expect(casePiiProblems({ nested: [{ phone_no: "x" }] })).toHaveLength(1);
    expect(casePiiProblems({ recipient_is_resident: true, decedent_resident: false, prior: [{ value: 1 }] })).toEqual([]);
    const p = parseCaseAdd(caseBody({ case_input: JSON.stringify({ donor_name: "홍길동" }) }));
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.errors.join(" ")).not.toContain("홍길동");
  });
  test("세목은 gift·inheritance만, 종류와 근거의 짝, 금액은 0 이상 정수", () => {
    for (const bad of [
      caseBody({ tax_kind: "acquisition" }),
      caseBody({ sample_kind: "review_sample" }),
      caseBody({ sample_kind: "official", official_basis: "reviewer_calc" }),
      caseBody({ official_total: "-1" }),
      caseBody({ official_total: "1.5" }),
      caseBody({ case_key: "한글 이름" }),
      caseBody({ case_input: "[]" }),
    ]) expect(parseCaseAdd(bad).ok).toBe(false);
    expect(parseCaseAdd(caseBody({ sample_kind: "review_sample", official_basis: "reviewer_calc" })).ok).toBe(true);
  });
});

describe("박스 옆 카드 전환 범위", () => {
  const own = (gift: boolean, inheritance: boolean) => ({ gift, inheritance });
  test("박스 세목에 나온 세목만 자체 카드, 나온 세목이 모두 자체로 바뀌면 외부 카드가 빠진다", () => {
    expect(lensOwnFilter(["증여세"], own(true, false))).toEqual({ state: own(true, false), covers: true });
    expect(lensOwnFilter(["상속세", "증여세"], own(true, false))).toEqual({ state: own(true, false), covers: false });
    expect(lensOwnFilter(["상속세", "증여세"], own(true, true)).covers).toBe(true);
  });
  test("나오지 않은 세목은 열려 있어도 보이지 않고, 아무 세목도 안 나오면 covers 거짓", () => {
    expect(lensOwnFilter(["증여세"], own(true, true)).state).toEqual(own(true, false));
    expect(lensOwnFilter(["취득세"], own(true, true))).toEqual({ state: own(false, false), covers: false });
  });
});
