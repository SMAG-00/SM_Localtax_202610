// 손계산 대조와 경계 시험 (W11-g g3) - 기준선(Python 현행 동작)과 별개로, 룰셋 값에서 직접 손으로 구한 기대값과 맞춘다
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calcGift, calcInheritance } from "../src/index";
import type { IgtRuleset } from "../src/index";

const dir = path.dirname(fileURLToPath(import.meta.url));
const RS = JSON.parse(fs.readFileSync(path.join(dir, "../../../rules-igt/2026.07.json"), "utf8")) as IgtRuleset;

const gift = (over: Record<string, unknown> = {}) => ({
  gift_date: "2026-08-10",
  donor_relationship: "lineal_ascendant",
  recipient_is_minor: false,
  recipient_is_resident: true,
  gift_value: 500_000_000,
  ...over,
});
const inh = (over: Record<string, unknown> = {}) => ({
  death_date: "2026-03-15",
  assets: { real_estate: 2_000_000_000 },
  heirs: { spouse_exists: false, children_count: 1 },
  ...over,
});

describe("증여세 손계산", () => {
  it("성인 자녀 5억 증여: 공제 5천만, 과세표준 4.5억, 산출 8천만, 신고공제 3% → 77,600,000원", () => {
    const r = calcGift(gift(), RS);
    expect(r.tax_base).toBe(450_000_000);
    expect(r.output_tax).toBe(80_000_000);
    expect(r.final_tax).toBe(77_600_000);
    expect(r.filing_due).toBe("2026-11-30");
    expect(r.payment.installment_limit).toBe(38_800_000);
    expect(r.payment.annual_installment_schedule?.years).toBe(5);
    expect(r.payment.annual_installment_schedule?.rows.reduce((a, x) => a + x.principal, 0)).toBe(77_600_000);
  });
  it("세율 구간 경계: 과세표준 1억 → 1천만원, 1억+1원 → 1천만원(원 미만 버림)", () => {
    // 공제 5천만 + 증여 1.5억 = 과세표준 1억
    expect(calcGift(gift({ gift_value: 150_000_000, filed_on_time: false }), RS).output_tax).toBe(10_000_000);
    expect(calcGift(gift({ gift_value: 150_000_001, filed_on_time: false }), RS).output_tax).toBe(10_000_000);
    expect(calcGift(gift({ gift_value: 150_000_005, filed_on_time: false }), RS).output_tax).toBe(10_000_001);
  });
  it("과세표준 50만원 미만이면 산출세액 0과 경고", () => {
    const r = calcGift(gift({ gift_value: 50_100_000 }), RS);
    expect(r.tax_base).toBe(100_000);
    expect(r.output_tax).toBe(0);
    expect(r.warnings.some((w) => w.includes("50만원 미만"))).toBe(true);
  });
  it("동일인 합산 하한: 999만원은 합산 제외, 1천만원은 합산", () => {
    const prior = (value: number) => ({ prior_gifts_same_donor_10y: [{ value, output_tax: 0 }] });
    expect(calcGift(gift(prior(9_990_000)), RS).steps[0][1]).toBe(500_000_000);
    expect(calcGift(gift(prior(10_000_000)), RS).steps[0][1]).toBe(510_000_000);
  });
  it("신고기한: 증여일 +3개월의 말일 (윤년 2월 29일, 연말 넘김)", () => {
    expect(calcGift(gift({ gift_date: "2027-11-30" }), RS).filing_due).toBe("2028-02-29");
    expect(calcGift(gift({ gift_date: "2026-12-31" }), RS).filing_due).toBe("2027-03-31");
  });
  it("입력 오류는 IgtCalcError: 없는 날짜 · 0원 · 모르는 관계", () => {
    for (const bad of [{ gift_date: "2026-02-30" }, { gift_value: 0 }, { donor_relationship: "friend" }]) {
      expect(() => calcGift(gift(bad), RS)).toThrow(expect.objectContaining({ name: "IgtCalcError" }));
    }
  });
  it("너무 큰 숫자는 조용히 틀리지 않고 거부", () => {
    expect(() => calcGift(gift({ gift_value: 9_007_199_254_740_993 }), RS)).toThrow();
  });
  it("모든 단계 금액에 음의 0이 없다", () => {
    for (const s of calcGift(gift({ gift_value: 40_000_000 }), RS).steps) expect(Object.is(s[1], -0)).toBe(false);
  });
});

describe("상속세 손계산", () => {
  it("자녀 1명 · 20억: 일괄공제 5억, 과세표준 15억, 산출 4.4억, 신고공제 3% → 426,800,000원", () => {
    const r = calcInheritance(inh(), RS);
    expect(r.total_deduction).toBe(500_000_000);
    expect(r.tax_base).toBe(1_500_000_000);
    expect(r.output_tax).toBe(440_000_000);
    expect(r.final_tax).toBe(426_800_000);
    expect(r.filing_due).toBe("2026-09-30");
    expect(r.filing_months).toBe(6);
  });
  it("공제 합계가 종합한도를 넘으면 한도에서 자른다 (과세표준 0)", () => {
    const r = calcInheritance(
      inh({ assets: { real_estate: 700_000_000, financial: 300_000_000 }, heirs: { spouse_exists: true, children_count: 2 }, spouse_actual_inheritance: 400_000_000, net_financial_assets: 300_000_000 }),
      RS,
    );
    expect(r.total_deduction).toBe(1_000_000_000);
    expect(r.tax_base).toBe(0);
    expect(r.final_tax).toBe(0);
  });
  it("비거주 피상속인은 신고기한 9개월", () => {
    const r = calcInheritance(inh({ decedent_resident: false }), RS);
    expect(r.filing_months).toBe(9);
    expect(r.filing_due).toBe("2026-12-31");
  });
  it("총상속재산이 0이면 오류, generation_skip_share 범위 밖이면 오류", () => {
    expect(() => calcInheritance(inh({ assets: {} }), RS)).toThrow(expect.objectContaining({ name: "IgtCalcError" }));
    expect(() => calcInheritance(inh({ generation_skip_share: 1.5 }), RS)).toThrow(expect.objectContaining({ name: "IgtCalcError" }));
  });
  it("가업상속공제 선택 시 계산하지 않고 확인 필요 경고만 낸다", () => {
    const r = calcInheritance(inh({ family_business: { applicable: true } }), RS);
    expect(r.warnings.some((w) => w.includes("가업상속공제"))).toBe(true);
    expect(r.steps.some(([name]) => name.includes("가업"))).toBe(false);
  });
});
