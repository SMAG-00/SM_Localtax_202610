import { describe, expect, it } from 'vitest';
import {
  bracketEdgeInputs,
  calcCorporateLocalIncome,
  calcEntityLocalTaxes,
  calcOligopolyByListing,
  corporateBracketIndex,
  parseExpertRuleset,
} from '../src/expert';
import { calcAcquisition } from '../src/acquisition';
import { RULESET } from './ruleset';
import { TEST_EXPERT, TEST_EXPERT_RAW } from './expert-ruleset';

const B = TEST_EXPERT.corporate_local_income.brackets;
const oli = { bookValue: 1_000_000_000, beforeRatio: 0.2, afterRatio: 0.6 };
const clone = () => JSON.parse(JSON.stringify(TEST_EXPERT_RAW));

describe('전문가 룰셋 스키마', () => {
  it('마지막 구간이 아닌데 up_to가 null이면 거부한다', () => {
    const raw = clone();
    raw.corporate_local_income.brackets[0].up_to = null;
    expect(() => parseExpertRuleset(raw)).toThrow();
  });
  it('구간 경계가 오름차순이 아니면 거부한다', () => {
    const raw = clone();
    raw.corporate_local_income.brackets[1].up_to = 1_000_000;
    expect(() => parseExpertRuleset(raw)).toThrow();
  });
  it('근거조문이 없는 구간은 거부한다', () => {
    const raw = clone();
    delete raw.corporate_local_income.brackets[0].law;
    expect(() => parseExpertRuleset(raw)).toThrow();
  });
});

describe('CALC-19 법인지방소득세 - 구간 경계 (경계값은 룰셋에서 만든다)', () => {
  const edges = bracketEdgeInputs(TEST_EXPERT);

  it('경계 입력은 구간마다 -1원/경계/+1원 3개이고 마지막(무한) 구간에는 없다', () => {
    expect(edges).toHaveLength((B.length - 1) * 3);
  });

  for (const e of edges) {
    it(`과세표준 ${e.base.toLocaleString()}원(${e.edge}) 은 구간 ${e.bracketIndex}의 세율·누진공제로 계산한다`, () => {
      const r = calcCorporateLocalIncome({ taxBase: e.base }, TEST_EXPERT);
      const b = B[e.bracketIndex]!;
      const item = r.items[0]!;
      expect(corporateBracketIndex(e.base, TEST_EXPERT)).toBe(e.bracketIndex);
      expect(item.rate).toBe(b.rate);
      expect(item.law).toBe(b.law);
      expect(item.amount).toBe(Math.max(0, Math.floor(e.base * b.rate) - (b.deduction ?? 0)));
      expect(r.rulesVersion).toBe('2090.01');
    });
  }

  it('경계 정확히 일치하는 금액은 낮은 구간에 속한다 (이하)', () => {
    expect(calcCorporateLocalIncome({ taxBase: B[0]!.up_to! }, TEST_EXPERT).items[0]!.rate).toBe(B[0]!.rate);
  });
  it('과세표준 0은 세액 0, 음수는 거부한다', () => {
    expect(calcCorporateLocalIncome({ taxBase: 0 }, TEST_EXPERT).total).toBe(0);
    expect(() => calcCorporateLocalIncome({ taxBase: -1 }, TEST_EXPERT)).toThrow(RangeError);
  });
  it('원 단위가 아닌 금액은 거부한다', () => {
    expect(() => calcCorporateLocalIncome({ taxBase: 1000.5 }, TEST_EXPERT)).toThrow();
  });
  it('검수 대상 구간을 쓰면 경고가 남고 사유에 세무조정 미수행 고지가 들어간다', () => {
    const r = calcCorporateLocalIncome({ taxBase: B[0]!.up_to! + 1 }, TEST_EXPERT);
    expect(r.warnings.join()).toContain('검수 대상 룰 적용');
    expect(r.items[0]!.reasons.join()).toContain('세무조정은 하지 않습니다');
  });
});

describe('CALC-17 과점주주 - 상장 여부 분기', () => {
  it('상장(룰셋: 과세 범위 밖)은 세액 0이고 근거는 룰셋 조문이다', () => {
    const r = calcOligopolyByListing(oli, 'listed', RULESET, TEST_EXPERT);
    expect(r.scenarios).toHaveLength(1);
    expect(r.scenarios[0]!.result.total).toBe(0);
    expect(r.scenarios[0]!.result.items[0]!.law).toBe('시험용 조문 L');
    expect(r.scenarios[0]!.result.warnings.join()).toContain('검수 대상 룰 적용');
  });
  it('비상장은 룰셋의 기준 지분율(0.4)로 판정한다 - 0.4 정확히는 과점주주가 아니다', () => {
    const at = calcOligopolyByListing({ ...oli, beforeRatio: 0.1, afterRatio: 0.4 }, 'unlisted', RULESET, TEST_EXPERT);
    expect(at.scenarios[0]!.result.total).toBe(0);
    const over = calcOligopolyByListing({ ...oli, beforeRatio: 0.1, afterRatio: 0.400001 }, 'unlisted', RULESET, TEST_EXPERT);
    expect(over.scenarios[0]!.result.total).toBeGreaterThan(0);
  });
  it('모르겠어요(unknown)는 상장·비상장 두 시나리오를 이 순서로 나란히 낸다', () => {
    const r = calcOligopolyByListing(oli, 'unknown', RULESET, TEST_EXPERT);
    expect(r.scenarios.map((s) => s.listing)).toEqual(['listed', 'unlisted']);
    expect(r.scenarios[0]!.result.total).toBe(0);
    expect(r.scenarios[1]!.result.total).toBeGreaterThan(0);
    expect(r.expertRulesVersion).toBe('2090.01');
    expect(r.baseRulesVersion).toBe(RULESET.version);
  });
  it('입력 지분율 범위 밖은 거부한다', () => {
    expect(() => calcOligopolyByListing({ ...oli, afterRatio: 1.1 }, 'unlisted', RULESET, TEST_EXPERT)).toThrow(RangeError);
  });
});

describe('CALC-18 개인 vs 법인 - 지방세만', () => {
  const input = {
    acquisition: { propertyKind: 'COMMERCIAL' as const, cause: 'PAID' as const, price: 1_000_000_000 },
    holding: { propertyKind: 'COMMERCIAL' as const, publishedPrices: [800_000_000] },
  };
  const r = calcEntityLocalTaxes(input, RULESET);

  it('취득세 합계는 엔진 취득 결과 중 지방세 줄의 합과 일치한다', () => {
    const direct = calcAcquisition({ ...input.acquisition, ownerType: 'INDIVIDUAL' }, RULESET);
    const local = direct.items.filter((i) => /^(ACQ_TAX|ACQ_LOCAL_EDU)/.test(i.code)).reduce((s, i) => s + i.amount, 0);
    expect(r.individual.acquisitionTotal).toBe(local);
    expect(r.totalDiff).toBe(r.corporation.total - r.individual.total);
  });
  it('결과 줄에는 국세 계열 코드(종합부동산세·농어촌특별세·인지세)가 없다', () => {
    const codes = [...r.individual.acquisitionItems, ...r.individual.holdingItems, ...r.corporation.acquisitionItems, ...r.corporation.holdingItems].map((i) => i.code);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.filter((c) => /^(CRET|ACQ_RURAL|STAMP)/.test(c))).toEqual([]);
  });
  it('보유 입력이 없으면 보유세 합계는 0이다', () => {
    expect(calcEntityLocalTaxes({ acquisition: input.acquisition }, RULESET).individual.holdingTotal).toBe(0);
  });
});
