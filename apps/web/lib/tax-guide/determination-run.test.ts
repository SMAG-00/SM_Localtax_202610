import { describe, expect, it } from "vitest";
import { buildFacts, PROJECT_TAX_KINDS, PROJECT_TAX_TYPES, projectTaxType, runDetermination } from "./determination-run";

// 시험용 판정표 - 지어낸 사실·결론만. 실제 요건·법령 없음
const table = (kind: string, extra: Record<string, unknown> = {}) => ({
  kind,
  version: "2000.01",
  label: `시험용 ${kind}`,
  required: [
    { id: "fact_a", label: "시험용 사실 A" },
    { id: "fact_n", label: "시험용 숫자 N" },
  ],
  rules: [
    { id: "rule_one", when: { op: "gte", field: "fact_n", value: 5 }, conclusion: "시험용 결론 갑", basis: "시험용 근거" },
    { id: "rule_two", when: { op: "eq", field: "fact_a", value: "yes" }, conclusion: "시험용 결론 을" },
  ],
  fallback: "시험용 해당 없음",
  ...extra,
});

describe("PROJECT_TAX_TYPES (PR-12 판정 종류 정비 4·신탁 2)", () => {
  it("정비 4종과 신탁 2종이고 id가 겹치지 않는다", () => {
    expect(PROJECT_TAX_TYPES.filter((t) => t.group === "redevelopment")).toHaveLength(4);
    expect(PROJECT_TAX_TYPES.filter((t) => t.group === "trust")).toHaveLength(2);
    expect(new Set(PROJECT_TAX_TYPES.map((t) => t.id)).size).toBe(6);
  });
  it("모든 판정 종류가 W11-a 판정표 종류 4개 안에 대응한다", () => {
    for (const t of PROJECT_TAX_TYPES) expect(PROJECT_TAX_KINDS).toContain(t.kind);
    expect(projectTaxType("trust_holding")?.kind).toBe("trust_taxpayer");
    expect(projectTaxType("nope")).toBeNull();
  });
});

describe("buildFacts", () => {
  it("모르겠어요(unknown)·빈 글자·null·undefined는 값 없음, false와 0은 답으로 남긴다", () => {
    expect(buildFacts({ a: "unknown", b: "", c: null, d: undefined, e: false, f: 0, g: "yes" })).toEqual({ e: false, f: 0, g: "yes" });
  });
});

describe("runDetermination", () => {
  it("필수 사실이 모두 있으면 첫 번째로 맞는 규칙의 결론과 판정표 버전을 낸다", () => {
    const run = runDetermination("trust_holding", table("trust_taxpayer"), { fact_a: "no", fact_n: 5 });
    expect(run.kind).toBe("trust_taxpayer");
    expect(run.outcome.status).toBe("결론");
    expect(run.outcome.conclusion).toMatchObject({ ruleId: "rule_one", text: "시험용 결론 갑", basis: "시험용 근거" });
    expect(run.outcome.tableVersion).toBe("2000.01");
  });

  it("경계: 기준값 바로 아래(4)는 첫 규칙에 맞지 않아 다음 규칙으로 간다", () => {
    const run = runDetermination("trust_holding", table("trust_taxpayer"), { fact_a: "yes", fact_n: 4 });
    expect(run.outcome.conclusion?.ruleId).toBe("rule_two");
  });

  it("모르겠어요 → 결론 0, '요건 확인 필요'와 빠진 항목, 기본 가정 0", () => {
    const run = runDetermination("trust_holding", table("trust_taxpayer"), { fact_a: "unknown", fact_n: 9 });
    expect(run.outcome.status).toBe("요건 확인 필요");
    expect(run.outcome.conclusion).toBeNull();
    expect(run.outcome.missing).toEqual([{ id: "fact_a", label: "시험용 사실 A" }]);
  });

  it("규칙에 맞는 것이 없으면 표의 fallback 문장(표에 없는 경우 아님)을 낸다", () => {
    const run = runDetermination("trust_holding", table("trust_taxpayer"), { fact_a: "no", fact_n: 1 });
    expect(run.outcome.conclusion?.text).toBe("시험용 해당 없음");
    expect(run.outcome.conclusion?.ruleId).toBeNull();
  });

  it("같은 사실 → 같은 결론·같은 판정표 버전 (TRU-03 화면과 PR-12 신탁 보유세 판정이 같은 함수·표)", () => {
    const tbl = table("trust_taxpayer");
    const answers = { fact_a: "yes", fact_n: 2 };
    const fromTru03 = runDetermination("trust_holding", tbl, answers);
    const fromPr12 = runDetermination("trust_holding", tbl, { ...answers });
    expect(fromPr12.outcome).toEqual(fromTru03.outcome);
  });

  it("정비 판정 종류가 같은 판정표를 공유할 때 judgment_type으로 규칙을 나눌 수 있다", () => {
    const tbl = table("redevelopment_tax", {
      required: [{ id: "fact_a", label: "시험용 사실 A" }],
      rules: [
        { id: "for_settlement", when: { op: "eq", field: "judgment_type", value: "settlement_money" }, conclusion: "시험용 청산금 결론" },
        { id: "for_land", when: { op: "eq", field: "judgment_type", value: "land_after_demolition" }, conclusion: "시험용 토지 결론" },
      ],
    });
    expect(runDetermination("settlement_money", tbl, { fact_a: "x" }).outcome.conclusion?.text).toBe("시험용 청산금 결론");
    expect(runDetermination("land_after_demolition", tbl, { fact_a: "x" }).outcome.conclusion?.text).toBe("시험용 토지 결론");
  });

  it("판정 종류와 판정표 종류가 다르면 거부한다 (상속·증여처럼 종류 혼용 차단)", () => {
    expect(() => runDetermination("trust_holding", table("trust_acquisition"), { fact_a: "x", fact_n: 1 })).toThrow();
  });

  it("입력 객체를 바꾸지 않는다", () => {
    const answers = Object.freeze({ fact_a: "yes", fact_n: 6 });
    expect(() => runDetermination("trust_holding", table("trust_taxpayer"), answers)).not.toThrow();
  });
});
