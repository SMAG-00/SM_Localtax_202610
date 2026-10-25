import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { GATE_OFFICIAL_MIN, GATE_SAMPLE_MIN, causeGroupOf, causeOpen, evaluateGate, groupOpen, type GateRow } from "./gate";

// 공개 게이트 경계 (CALC-14 · FAM-07) - 공식 결과 29건/30건/30건 중 1건 불일치, 표본 49/50, 원인별 독립, 엔진 해시 불일치

const HASH = "a".repeat(64);
const row = (over: Partial<GateRow>): GateRow => ({
  tax_kind: "acquisition",
  cause_group: "OTHER",
  ruleset_version: "2099.01",
  last_run_id: 1,
  run_at: "2099-01-01T00:00:00Z",
  engine_hash: HASH,
  official_cases: 0,
  official_matched: 0,
  sample_cases: 0,
  sample_matched: 0,
  is_open: false,
  ...over,
});

describe("건수로 본 공개 조건 evaluateGate", () => {
  test("공식 29건 전부 일치 + 표본 50건 일치 -> 닫힘 (1건 부족을 말해 준다)", () => {
    const r = evaluateGate({ officialCases: 29, officialMatched: 29, sampleCases: 50, sampleMatched: 50 });
    expect(r.open).toBe(false);
    expect(r.shortfalls).toEqual(["공식 결과 사례 1건 부족 (29/30)"]);
  });

  test("공식 30건 전부 일치 + 표본 50건 일치 -> 열림", () => {
    expect(evaluateGate({ officialCases: 30, officialMatched: 30, sampleCases: 50, sampleMatched: 50 })).toEqual({ open: true, shortfalls: [] });
  });

  test("공식 30건 중 1건 불일치 -> 닫힘", () => {
    const r = evaluateGate({ officialCases: 30, officialMatched: 29, sampleCases: 50, sampleMatched: 50 });
    expect(r.open).toBe(false);
    expect(r.shortfalls).toEqual(["공식 결과 불일치 1건"]);
  });

  test("표본 49건 일치 -> 닫힘 / 표본 50건 중 1건 불일치 -> 닫힘", () => {
    expect(evaluateGate({ officialCases: 30, officialMatched: 30, sampleCases: 49, sampleMatched: 49 }).shortfalls).toEqual(["감수 표본 1건 부족 (49/50)"]);
    expect(evaluateGate({ officialCases: 30, officialMatched: 30, sampleCases: 50, sampleMatched: 49 }).shortfalls).toEqual(["감수 표본 불일치 1건"]);
  });

  test("사례 0건 -> 닫힘, 부족분을 모두 말한다", () => {
    const r = evaluateGate({ officialCases: 0, officialMatched: 0, sampleCases: 0, sampleMatched: 0 });
    expect(r.open).toBe(false);
    expect(r.shortfalls).toHaveLength(2);
  });

  test("기준 건수는 DB 뷰 calc_gate_status 정의와 같다 (한쪽만 바꾸면 실패)", () => {
    const sql = fs.readFileSync(path.resolve(__dirname, "../../../../packages/db/supabase/migrations/20261025000082_w10a_accuracy_gate.sql"), "utf8");
    expect(sql).toContain(`official_cases >= ${GATE_OFFICIAL_MIN}`);
    expect(sql).toContain(`sample_cases >= ${GATE_SAMPLE_MIN}`);
  });
});

describe("묶음 규칙", () => {
  test("취득세는 원인 묶음(상속·증여·그 밖 = 유상취득+원시취득), 다른 세목은 ALL", () => {
    expect(causeGroupOf("acquisition", "INHERITANCE")).toBe("INHERITANCE");
    expect(causeGroupOf("acquisition", "GIFT")).toBe("GIFT");
    expect(causeGroupOf("acquisition", "PAID")).toBe("OTHER");
    expect(causeGroupOf("acquisition", "ORIGINAL")).toBe("OTHER");
    expect(causeGroupOf("property", null)).toBe("ALL");
    expect(causeGroupOf("comprehensive", null)).toBe("ALL");
  });
});

describe("원인별 독립(FAM-07)과 엔진 해시 이중 확인", () => {
  const rows = [
    row({ cause_group: "INHERITANCE", is_open: false, official_cases: 29, official_matched: 29 }),
    row({ cause_group: "GIFT", is_open: true, official_cases: 30, official_matched: 30 }),
    row({ cause_group: "OTHER", is_open: true, official_cases: 30, official_matched: 30 }),
    row({ tax_kind: "property", cause_group: "ALL", is_open: false }),
    row({ tax_kind: "comprehensive", cause_group: "ALL", is_open: true }),
  ];

  test("상속 미통과 + 증여 통과 -> 증여·유상취득·원시취득은 열림, 상속은 닫힘", () => {
    expect(causeOpen(rows, "acquisition", "INHERITANCE", HASH)).toBe(false);
    expect(causeOpen(rows, "acquisition", "GIFT", HASH)).toBe(true);
    expect(causeOpen(rows, "acquisition", "PAID", HASH)).toBe(true);
    expect(causeOpen(rows, "acquisition", "ORIGINAL", HASH)).toBe(true);
  });

  test("다른 세목은 서로 영향 없음 - 재산세 닫힘, 종합부동산세 열림", () => {
    expect(causeOpen(rows, "property", null, HASH)).toBe(false);
    expect(causeOpen(rows, "comprehensive", null, HASH)).toBe(true);
  });

  test("뷰가 열려 있어도 실행한 엔진 해시가 배포된 엔진 해시와 다르면 닫힘", () => {
    expect(groupOpen(rows, "acquisition", "GIFT", "b".repeat(64))).toBe(false);
    expect(groupOpen([row({ cause_group: "GIFT", is_open: true, engine_hash: null })], "acquisition", "GIFT", HASH)).toBe(false);
  });

  test("뷰에 줄이 없으면 닫힘", () => {
    expect(groupOpen([], "acquisition", "GIFT", HASH)).toBe(false);
  });
});
