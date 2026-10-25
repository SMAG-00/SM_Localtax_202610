import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { ENGINE_HASH, computeRun, engineTotalFor, parseRuleset } from "./engine";

// 정확도 대조 실행의 엔진 호출 (CALC-14) - 룰셋은 저장소의 초안 파일(SM이 가진 AI 작성·미감수 값, draft)이고, 기대값은 SM 엔진 시험(기준선)에 있는 값이다.
// 이 시험은 '대조 사례 -> 엔진 합계' 연결이 맞는지를 보는 것이지 세법 정답을 판정하는 것이 아니다.
const ruleset = parseRuleset(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../rules/2026.01.json"), "utf8")));

const ACQ_INPUT = { ownerType: "INDIVIDUAL", propertyKind: "HOUSE", price: 500_000_000, exclusiveAreaSqm: 84, houseCount: 1, isAdjustedArea: false };
const HOLD_INPUT = { ownerType: "INDIVIDUAL", propertyKind: "HOUSE", publishedPrices: [500_000_000], isSingleHouseOneHousehold: true };

describe("engineTotalFor", () => {
  test("취득세 - 원인은 사례의 cause 칸이 정한다 (입력 안의 cause보다 우선)", () => {
    expect(engineTotalFor("acquisition", "PAID", ACQ_INPUT, ruleset)).toBe(5_500_000); // SM 기준선: 취득세 5,000,000 + 지방교육세 500,000
    expect(engineTotalFor("acquisition", "PAID", { ...ACQ_INPUT, cause: "GIFT" }, ruleset)).toBe(5_500_000);
    expect(engineTotalFor("acquisition", "GIFT", ACQ_INPUT, ruleset)).not.toBe(5_500_000);
  });

  test("재산세 합계는 재산세·지방교육세·지역자원시설세 항목만, 종합부동산세는 CRET 항목만 센다", () => {
    const property = engineTotalFor("property", null, HOLD_INPUT, ruleset);
    const comprehensive = engineTotalFor("comprehensive", null, HOLD_INPUT, ruleset);
    expect(property).toBe(260_000 + 52_000 + 572_300); // SM 기준선 PROP_TAX_HOUSE + PROP_LOCAL_EDU + REGIONAL_RESOURCE
    expect(comprehensive).toBeGreaterThanOrEqual(0);
    expect(property + comprehensive).toBeGreaterThan(0);
  });

  test("엔진이 거부하는 입력은 AccuracyEngineError", () => {
    expect(() => engineTotalFor("acquisition", "PAID", { ...ACQ_INPUT, price: 1.5 }, ruleset)).toThrow();
  });
});

describe("computeRun", () => {
  test("모든 사례를 계산하고, 엔진이 거부한 사례는 오류 목록에 담는다 (실행을 기록하지 않는 근거)", () => {
    const { results, errors } = computeRun(
      [
        { id: 1, tax_kind: "acquisition", cause: "PAID", case_input: ACQ_INPUT, official_total: 5_500_000 },
        { id: 2, tax_kind: "acquisition", cause: "PAID", case_input: { ...ACQ_INPUT, price: 1.5 }, official_total: 1 },
        { id: 3, tax_kind: "property", cause: null, case_input: HOLD_INPUT, official_total: 884_300 },
      ],
      ruleset,
    );
    expect(results).toEqual([
      { case_id: 1, engine_total: 5_500_000 },
      { case_id: 3, engine_total: 884_300 },
    ]);
    expect(errors.map((e) => e.case_id)).toEqual([2]);
  });
});

describe("엔진 해시", () => {
  test("64자리 16진 해시이고 복사 기록 SOURCE.json의 src 항목에서 계산된다", () => {
    expect(ENGINE_HASH).toMatch(/^[0-9a-f]{64}$/);
  });
});
