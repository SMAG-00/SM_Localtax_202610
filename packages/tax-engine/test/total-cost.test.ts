import { describe, expect, it } from 'vitest';
import { RULESET } from './ruleset';
import { calcAcquisition, type AcquisitionInput } from '../src/acquisition';
import { calcHolding, type HoldingInput } from '../src/holding';
import { TOTAL_COST_REFERENCE_CODES, annualInterest, composeTotalCost, type TotalCostInput } from '../src/total-cost';

// 총비용 조합 시험 (RE-05). 입력 금액은 모두 시험용으로 지어낸 값이고, 세액은 같은 입력의 단독 계산 결과와의 관계로만 확인한다.

const ACQ: AcquisitionInput = { ownerType: 'INDIVIDUAL', propertyKind: 'HOUSE', cause: 'PAID', price: 500_000_000, exclusiveAreaSqm: 84, houseCount: 1, isAdjustedArea: false };
const HOLD: HoldingInput = { ownerType: 'INDIVIDUAL', propertyKind: 'HOUSE', publishedPrices: [300_000_000] };

const build = (over: Partial<TotalCostInput> = {}): TotalCostInput => {
  const n = over.holdingYears ?? 3;
  return { acquisition: ACQ, holdingYears: n, holdingByYear: Array.from({ length: n }, () => HOLD), ...over };
};

const acqSum = calcAcquisition(ACQ, RULESET).items.filter((i) => !TOTAL_COST_REFERENCE_CODES.includes(i.code)).reduce((s, i) => s + i.amount, 0);
const holdTotal = calcHolding(HOLD, RULESET).total;

describe('총비용 - 세목 금액은 단독 계산과 원 단위로 같다', () => {
  it('취득 해 소계 = 단독 취득세 계산의 참고 표시 제외 합, 보유 해 소계 = 단독 보유세 합계', () => {
    const r = composeTotalCost(build({ holdingYears: 2 }), RULESET);
    expect(r.years[0]!.acquisitionTax).toBe(acqSum);
    expect(r.years[1]!.holdingTax).toBe(holdTotal);
    expect(r.years[2]!.holdingTax).toBe(holdTotal);
  });

  it('결과에 룰셋 버전이 각인되고 단독 계산의 버전과 같다', () => {
    const r = composeTotalCost(build(), RULESET);
    expect(r.rulesVersion).toBe(calcAcquisition(ACQ, RULESET).rulesVersion);
    expect(r.rulesVersion).not.toBe('');
  });
});

describe('총비용 - 그래프 = 표 = 총액', () => {
  it('해별 소계의 합, 표 줄 금액의 합, 총액이 모두 같다', () => {
    const r = composeTotalCost(build({ holdingYears: 4, extraCosts: [{ label: '시험용 중개보수', amount: 1_234_567 }, { label: '시험용 등기비용', amount: 89_000 }], loan: { principal: 200_000_000, annualRateBp: 350 } }), RULESET);
    const byYears = r.years.reduce((s, y) => s + y.subtotal, 0);
    const byLines = r.lines.reduce((s, l) => s + l.amount, 0);
    expect(byYears).toBe(r.total);
    expect(byLines).toBe(r.total);
    for (const y of r.years) expect(y.subtotal).toBe(y.acquisitionTax + y.holdingTax + y.extra + y.interest);
  });

  it('참고 표시 항목(인지세·채권)은 합계와 표에 들어가지 않는다', () => {
    const r = composeTotalCost(build({ holdingYears: 0, acquisition: { ...ACQ, hasContract: true, buysHousingBond: true } }), RULESET);
    expect(r.lines.some((l) => TOTAL_COST_REFERENCE_CODES.includes(l.code))).toBe(false);
    expect(r.total).toBe(acqSum);
  });
});

describe('총비용 - 경계값', () => {
  it('보유 0년이면 보유세 0회, 이자 0원이다 (대출을 넣어도)', () => {
    const r = composeTotalCost(build({ holdingYears: 0, loan: { principal: 100_000_000, annualRateBp: 500 } }), RULESET);
    expect(r.years).toHaveLength(1);
    expect(r.lines.filter((l) => l.year > 0)).toEqual([]);
    expect(r.years[0]!.interest).toBe(0);
    expect(r.total).toBe(acqSum);
  });

  it('금리 0%면 이자 줄은 있어도 금액은 0원이다', () => {
    const r = composeTotalCost(build({ holdingYears: 3, loan: { principal: 100_000_000, annualRateBp: 0 } }), RULESET);
    expect(r.years.map((y) => y.interest)).toEqual([0, 0, 0, 0]);
  });

  it('연 이자는 원 미만을 버리고 해마다 같다 (만기 일시 상환)', () => {
    // 10,001원 x 3.33% = 333.0333원 -> 333원
    expect(annualInterest(10_001, 333)).toBe(333);
    // 경계: 정확히 나누어떨어지는 값과 1원 모자란 값
    expect(annualInterest(10_000, 100)).toBe(100);
    expect(annualInterest(9_999, 100)).toBe(99);
    const r = composeTotalCost(build({ holdingYears: 2, loan: { principal: 10_001, annualRateBp: 333 } }), RULESET);
    expect(r.years.slice(1).map((y) => y.interest)).toEqual([333, 333]);
  });

  it('아주 큰 원금도 정수가 어긋나지 않는다', () => {
    expect(annualInterest(900_000_000_000_000, 1)).toBe(90_000_000_000);
  });

  it('보유 1년이면 보유세 줄이 한 해뿐이다', () => {
    const r = composeTotalCost(build({ holdingYears: 1 }), RULESET);
    expect(new Set(r.lines.filter((l) => l.year > 0).map((l) => l.year))).toEqual(new Set([1]));
  });
});

describe('총비용 - 양도 단계와 거부', () => {
  it('결과의 어떤 줄에도 양도 항목이 없다', () => {
    const r = composeTotalCost(build({ holdingYears: 5, extraCosts: [{ label: '시험용 기타', amount: 10 }] }), RULESET);
    expect(r.lines.some((l) => /TRANSFER|CAPITAL|양도/i.test(`${l.code}${l.label}`))).toBe(false);
  });

  it('매매가 아닌 취득 원인은 거부한다', () => {
    expect(() => composeTotalCost(build({ acquisition: { ...ACQ, cause: 'GIFT' } }), RULESET)).toThrow('매매');
    expect(() => composeTotalCost(build({ acquisition: { ...ACQ, cause: 'INHERITANCE' } }), RULESET)).toThrow('매매');
  });

  it('보유 연수와 연도별 입력의 개수가 다르면 거부한다', () => {
    expect(() => composeTotalCost({ acquisition: ACQ, holdingYears: 3, holdingByYear: [HOLD] }, RULESET)).toThrow('개수');
  });

  it('음수·소수 보유 연수와 음수 금리·음수 비용을 거부한다', () => {
    expect(() => composeTotalCost(build({ holdingYears: -1, holdingByYear: [] }), RULESET)).toThrow();
    expect(() => composeTotalCost({ acquisition: ACQ, holdingYears: 1.5, holdingByYear: [HOLD] }, RULESET)).toThrow();
    expect(() => composeTotalCost(build({ loan: { principal: 1_000, annualRateBp: -1 } }), RULESET)).toThrow();
    expect(() => composeTotalCost(build({ extraCosts: [{ label: '시험용', amount: -5 }] }), RULESET)).toThrow();
  });

  it('게이트가 닫힌 보유 세목 항목을 뺄 수 있고, 뺀 만큼 표와 합계가 함께 줄어든다', () => {
    const all = composeTotalCost(build({ holdingYears: 2 }), RULESET);
    const none = composeTotalCost(build({ holdingYears: 2, includeHoldingItem: () => false }), RULESET);
    expect(none.years[1]!.holdingTax).toBe(0);
    expect(all.total - none.total).toBe(holdTotal * 2);
    expect(none.lines.reduce((s, l) => s + l.amount, 0)).toBe(none.total);
  });

  it('같은 입력은 같은 결과이고 결과는 바꿀 수 없다', () => {
    const a = composeTotalCost(build(), RULESET);
    const b = composeTotalCost(build(), RULESET);
    expect(a).toEqual(b);
    expect(Object.isFrozen(a)).toBe(true);
  });
});
