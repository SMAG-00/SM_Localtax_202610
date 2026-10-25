import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { casePiiProblems, parseApprove, parseCaseAdd, parseCaseNote, parseCreate, parseSign } from "./input";

// 관리 입력 규칙 - 룰셋 초안 만들기는 저장소의 실제 초안 파일(rules/2026.01.json, draft)을 붙여 넣는 경우로 확인한다. 판정표 자료는 시험용 지어낸 것.
const RULESET_TEXT = fs.readFileSync(path.resolve(__dirname, "../../../../rules/2026.01.json"), "utf8");
const TABLE = { kind: "refund", version: "2099.01", label: "시험용 환급 판정표", items: [{ id: "fixture_a", label: "시험용", rules: [{ id: "r1", when: { op: "manual" }, likelihood: "높음" }], default: "낮음" }] };

describe("초안 만들기 parseCreate", () => {
  const base = { kind: "ruleset", version: "2026.01", source_ref: "시험용 출처", basis_note: "시험용 초기 반입", body: RULESET_TEXT };

  test("저장소의 초안 룰셋 파일은 통과한다", () => {
    const r = parseCreate(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.table).toBe("rulesets");
  });

  test("본문 안 version이 다르거나 status가 draft가 아니면 거부", () => {
    expect(parseCreate({ ...base, version: "2026.02" })).toMatchObject({ ok: false });
    const active = JSON.stringify({ ...JSON.parse(RULESET_TEXT), status: "active" });
    expect(parseCreate({ ...base, body: active })).toMatchObject({ ok: false });
  });

  test("근거 개정 번호도 사유도 없으면 거부, 번호만 있어도 통과", () => {
    const r = parseCreate({ ...base, basis_note: "" });
    expect(r.ok).toBe(false);
    expect(parseCreate({ ...base, basis_note: "", basis_event_id: "12" }).ok).toBe(true);
    expect(parseCreate({ ...base, basis_note: "", basis_event_id: 12 }).ok).toBe(true);
    expect(parseCreate({ ...base, basis_event_id: "abc" }).ok).toBe(false);
  });

  test("JSON이 아니거나 룰셋 스키마에 맞지 않으면 거부", () => {
    expect(parseCreate({ ...base, body: "{not json" })).toMatchObject({ ok: false, errors: ["body: JSON 모양이 아닙니다"] });
    expect(parseCreate({ ...base, body: "{}" }).ok).toBe(false);
  });

  test("판정표는 zod 검증을 통과하고 종류 칸이 본문 kind에서 나온다", () => {
    const r = parseCreate({ ...base, kind: "determination_table", version: "2099.01", body: JSON.stringify(TABLE) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.row.kind).toBe("refund");
    expect(parseCreate({ ...base, kind: "determination_table", version: "2099.01", body: JSON.stringify({ ...TABLE, items: [] }) }).ok).toBe(false);
    expect(parseCreate({ ...base, kind: "determination_table", version: "2099.02", body: JSON.stringify(TABLE) }).ok).toBe(false);
  });

  test("달력은 비어 있지 않은 객체만", () => {
    expect(parseCreate({ ...base, kind: "tax_calendar", version: "2099.01", body: "{}" }).ok).toBe(false);
    expect(parseCreate({ ...base, kind: "tax_calendar", version: "2099.01", body: JSON.stringify({ label: "시험용" }) }).ok).toBe(true);
  });

  test("알 수 없는 종류·버전 모양 거부", () => {
    expect(parseCreate({ ...base, kind: "other" }).ok).toBe(false);
    expect(parseCreate({ ...base, version: "2026-01" }).ok).toBe(false);
  });
});

describe("서명·승인 입력", () => {
  test("감수 시트 위치가 없으면 서명 입력 거부 (RULE-04)", () => {
    expect(parseSign({ kind: "ruleset", id: 3, sheet_ref: "" })).toMatchObject({ ok: false });
    expect(parseSign({ kind: "ruleset", id: 3, sheet_ref: "시험용 시트" })).toEqual({ ok: true, value: { kind: "ruleset", id: 3, sheetRef: "시험용 시트" } });
    expect(parseSign({ kind: "ruleset", id: 0, sheet_ref: "x" }).ok).toBe(false);
  });
  test("승인 입력은 종류와 번호만", () => {
    expect(parseApprove({ kind: "tax_calendar", id: "7" })).toEqual({ ok: true, value: { kind: "tax_calendar", id: 7 } });
    expect(parseApprove({ kind: "x", id: 7 }).ok).toBe(false);
  });
});

describe("대조 사례 개인정보 차단 casePiiProblems (CALC-14)", () => {
  test.each([
    [{ ownerName: "abc" }],
    [{ nested: { 주소: "x" } }],
    [{ note: "홍길동" }],
    [{ ref: "1234567890" }],
    [{ ref: "a@example.test" }],
    [{ list: [{ phone: "x" }] }],
  ])("%j -> 막는다", (input) => {
    expect(casePiiProblems(input).length).toBeGreaterThan(0);
  });

  test("엔진 입력 칸(ownerType·propertyKind·가격·날짜·참거짓)은 통과", () => {
    expect(casePiiProblems({ ownerType: "INDIVIDUAL", propertyKind: "HOUSE", price: 123456789, acquiredOn: "2099-01-01", flags: [true], ownerAge: 60 })).toEqual([]);
  });

  test("문제 문장은 받은 값을 되풀이하지 않는다", () => {
    expect(casePiiProblems({ note: "홍길동 010-1234-5678" }).join(" ")).not.toMatch(/홍길동|1234/);
  });
});

describe("사례 추가 parseCaseAdd", () => {
  const ok = { case_key: "t-001", tax_kind: "acquisition", cause: "GIFT", sample_kind: "official", official_basis: "tax_notice", official_total: "1000", case_input: JSON.stringify({ price: 100 }) };

  test("정상", () => {
    expect(parseCaseAdd(ok)).toMatchObject({ ok: true, value: { tax_kind: "acquisition", cause: "GIFT", official_total: 1000, synthetic: false } });
  });
  test("취득세는 원인 필수, 다른 세목은 원인 금지", () => {
    expect(parseCaseAdd({ ...ok, cause: "" }).ok).toBe(false);
    expect(parseCaseAdd({ ...ok, cause: "SWAP" }).ok).toBe(false);
    expect(parseCaseAdd({ ...ok, tax_kind: "property", cause: "GIFT" }).ok).toBe(false);
    expect(parseCaseAdd({ ...ok, tax_kind: "property", cause: "" }).ok).toBe(true);
  });
  test("국세 세목 값 거부, 공식 결과와 감수 표본의 근거 종류가 서로 맞아야 함", () => {
    expect(parseCaseAdd({ ...ok, tax_kind: "other_tax", cause: "" }).ok).toBe(false);
    expect(parseCaseAdd({ ...ok, official_basis: "reviewer_calc" }).ok).toBe(false);
    expect(parseCaseAdd({ ...ok, sample_kind: "review_sample", official_basis: "reviewer_calc" }).ok).toBe(true);
    expect(parseCaseAdd({ ...ok, sample_kind: "review_sample" }).ok).toBe(false);
  });
  test("금액은 0 이상 정수, 입력에 개인정보 흔적이 있으면 거부", () => {
    expect(parseCaseAdd({ ...ok, official_total: "-1" }).ok).toBe(false);
    expect(parseCaseAdd({ ...ok, official_total: "1.5" }).ok).toBe(false);
    expect(parseCaseAdd({ ...ok, official_total: "0" }).ok).toBe(true);
    const pii = parseCaseAdd({ ...ok, case_input: JSON.stringify({ ownerName: "x" }) });
    expect(pii.ok).toBe(false);
    expect(pii.ok === false && pii.errors[0]).toMatch(/^case_input:/);
  });
});

describe("불일치 메모 parseCaseNote", () => {
  test("원인 3종만, 번호·이메일 형식 거부", () => {
    expect(parseCaseNote({ id: 1, mismatch_cause: "rounding", mismatch_note: "단수 차이" }).ok).toBe(true);
    expect(parseCaseNote({ id: 1, mismatch_cause: "other" }).ok).toBe(false);
    expect(parseCaseNote({ id: 1, mismatch_cause: "rounding", mismatch_note: "a@example.test" }).ok).toBe(false);
    expect(parseCaseNote({ id: 1, mismatch_cause: "", mismatch_note: "" })).toMatchObject({ ok: true, value: { cause: null, note: null } });
  });
});
