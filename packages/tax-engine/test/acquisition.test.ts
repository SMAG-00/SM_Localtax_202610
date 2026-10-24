import { describe, expect, it } from 'vitest';
import { RULESET } from './ruleset';
import { calcAcquisition, type AcquisitionInput } from '../src/acquisition';
import type { CalcResult } from '../src/result';

const run = (input: AcquisitionInput): CalcResult => calcAcquisition(input, RULESET);

const amountOf = (r: CalcResult, code: string): number =>
  r.items.find((i) => i.code === code)?.amount ?? -1;

const baseInput: AcquisitionInput = {
  ownerType: 'INDIVIDUAL',
  propertyKind: 'HOUSE',
  cause: 'PAID',
  price: 500_000_000,
  exclusiveAreaSqm: 84,
  houseCount: 1,
  isAdjustedArea: false,
};

describe('취득세 — 주택 유상취득 (개인)', () => {
  it('5억 주택, 1주택, 전용 84㎡ → 취득세 1% + 지방교육세 0.1% + 농특세 비과세', () => {
    // 취득세  = 500,000,000 × 1%   = 5,000,000
    // 지방교육세 = 500,000,000 × 1% × 50% × 20% = 500,000,000 × 0.1% = 500,000
    // 농특세   = 전용 84㎡ ≤ 85㎡ → 국민주택규모 비과세 = 0
    const r = run(baseInput);
    expect(amountOf(r, 'ACQ_TAX')).toBe(5_000_000);
    expect(amountOf(r, 'ACQ_LOCAL_EDU')).toBe(500_000);
    expect(amountOf(r, 'ACQ_RURAL')).toBe(0);
    expect(r.total).toBe(5_500_000);
    expect(r.rulesVersion).toBe('2026.01');
  });

  it('[경계] 정확히 6억 → 1% 구간에 포함된다 (up_to는 "이하")', () => {
    // 취득세 = 600,000,000 × 1% = 6,000,000 / 지방교육세 = 600,000
    const r = run({ ...baseInput, price: 600_000_000 });
    expect(r.items[0]?.rate).toBe(0.01);
    expect(amountOf(r, 'ACQ_TAX')).toBe(6_000_000);
    expect(r.total).toBe(6_600_000);
  });

  it('[경계] 6억 + 1원 → 산식 구간으로 넘어가되 세액이 튀지 않는다', () => {
    // 세율(%) = (600,000,001 × 2 ÷ 3억) − 3 = 1.0000000066... → 반올림 1.0000% → 1%
    // 취득세 = floor(600,000,001 × 0.01) = 6,000,000  (6억일 때와 동일 — 구간 경계가 연속)
    const r = run({ ...baseInput, price: 600_000_001 });
    expect(r.items[0]?.rate).toBe(0.01);
    expect(amountOf(r, 'ACQ_TAX')).toBe(6_000_000);
  });

  it('7.5억 주택, 전용 100㎡ → 세율 2%, 농특세 과세', () => {
    // 세율   = (750,000,000 × 2 ÷ 3억) − 3 = 2%
    // 취득세  = 750,000,000 × 2%   = 15,000,000
    // 지방교육세 = 750,000,000 × 0.2% = 1,500,000
    // 농특세   = 750,000,000 × 0.2% = 1,500,000  (전용 100㎡ > 85㎡ → 과세)
    const r = run({ ...baseInput, price: 750_000_000, exclusiveAreaSqm: 100 });
    expect(r.items[0]?.rate).toBe(0.02);
    expect(amountOf(r, 'ACQ_TAX')).toBe(15_000_000);
    expect(amountOf(r, 'ACQ_LOCAL_EDU')).toBe(1_500_000);
    expect(amountOf(r, 'ACQ_RURAL')).toBe(1_500_000);
    expect(r.total).toBe(18_000_000);
  });

  it('7억 주택 → 세율 1.6667%, 세액이 원 단위로 정확하다 (부동소수점 오차 없음)', () => {
    // 세율   = (700,000,000 × 2 ÷ 3억) − 3 = 1.666666...% → 1.6667%
    // 취득세  = 700,000,000 × 0.016667 = 11,666,900
    // 지방교육세 = 700,000,000 × 0.016667 × 0.5 × 0.2 = 700,000,000 × 0.0016667 = 1,166,690
    const r = run({ ...baseInput, price: 700_000_000 });
    expect(r.items[0]?.rate).toBe(0.016667);
    expect(amountOf(r, 'ACQ_TAX')).toBe(11_666_900);
    expect(amountOf(r, 'ACQ_LOCAL_EDU')).toBe(1_166_690);
    expect(r.total).toBe(12_833_590);
  });

  it('[경계] 정확히 9억 → 산식 구간(3%)에 포함되고, 9억+1원(정율 3%)과 세액이 연속된다', () => {
    // 9억     : 세율 = (900,000,000 × 2 ÷ 3억) − 3 = 3% → 27,000,000
    // 9억+1원 : 정율 3% → floor(900,000,001 × 0.03) = 27,000,000
    const at9 = run({ ...baseInput, price: 900_000_000 });
    const over9 = run({ ...baseInput, price: 900_000_001 });
    expect(at9.items[0]?.rate).toBeCloseTo(0.03, 10);
    expect(over9.items[0]?.rate).toBe(0.03);
    expect(amountOf(at9, 'ACQ_TAX')).toBe(27_000_000);
    expect(amountOf(over9, 'ACQ_TAX')).toBe(27_000_000);
  });
});

describe('취득세 — 다주택·법인 중과 (지방세법 §13의2)', () => {
  it('법인의 주택 유상취득 10억 → 12% 중과 (주택 수 무관)', () => {
    // 취득세  = 1,000,000,000 × 12% = 120,000,000
    // 지방교육세 = 1,000,000,000 × 0.4% = 4,000,000
    // 농특세   = 1,000,000,000 × 1.0% = 10,000,000 (전용 100㎡ > 85㎡)
    const r = run({
      ...baseInput,
      ownerType: 'CORPORATION',
      price: 1_000_000_000,
      exclusiveAreaSqm: 100,
      houseCount: 1,
    });
    expect(amountOf(r, 'ACQ_TAX')).toBe(120_000_000);
    expect(amountOf(r, 'ACQ_LOCAL_EDU')).toBe(4_000_000);
    expect(amountOf(r, 'ACQ_RURAL')).toBe(10_000_000);
    expect(r.total).toBe(134_000_000);
    expect(r.warnings.join()).toMatch(/검수 대상 룰 적용/);
  });

  it('개인, 조정대상지역 2주택 8억 → 8% 중과, 전용 84㎡라 농특세는 비과세', () => {
    // 취득세  = 800,000,000 × 8%   = 64,000,000
    // 지방교육세 = 800,000,000 × 0.4% = 3,200,000
    // 농특세   = 국민주택규모 이하 → 0
    const r = run({
      ...baseInput,
      price: 800_000_000,
      houseCount: 2,
      isAdjustedArea: true,
    });
    expect(r.items[0]?.rate).toBe(0.08);
    expect(amountOf(r, 'ACQ_TAX')).toBe(64_000_000);
    expect(amountOf(r, 'ACQ_LOCAL_EDU')).toBe(3_200_000);
    expect(r.total).toBe(67_200_000);
  });

  it('[경계] 비조정지역 2주택은 중과가 아니다 (3주택부터 중과)', () => {
    // 비조정 2주택 → 일반 구간세율. 8억 → 9억 이하 산식 구간
    // 세율 = (800,000,000 × 2 ÷ 3억) − 3 = 5.3333 − 3 = 2.3333%
    const r = run({
      ...baseInput,
      price: 800_000_000,
      houseCount: 2,
      isAdjustedArea: false,
    });
    expect(r.items[0]?.rate).toBe(0.023333);
    expect(amountOf(r, 'ACQ_TAX')).toBe(18_666_400); // 800,000,000 × 0.023333
  });

  it('[경계] 비조정지역 3주택 → 8% 중과 시작', () => {
    const r = run({
      ...baseInput,
      price: 800_000_000,
      houseCount: 3,
      isAdjustedArea: false,
    });
    expect(r.items[0]?.rate).toBe(0.08);
    expect(amountOf(r, 'ACQ_TAX')).toBe(64_000_000);
  });

  it('주택 수를 모르면 중과 판정을 못 하므로 1주택으로 보되 warnings에 사유를 남긴다', () => {
    const { houseCount: _drop, ...noCount } = baseInput;
    const r = run(noCount as AcquisitionInput);
    expect(r.items[0]?.rate).toBe(0.01); // 5억 → 1%
    expect(r.warnings.join()).toContain('전문가 확인 필요');
    expect(r.warnings.join()).toContain('주택 수');
  });
});

describe('취득세 — 취득원인별 표준세율', () => {
  it('상속(주택 3억) → 2.8%, 지방교육세 0.16%, 농특세 비과세(85㎡ 이하)', () => {
    // 취득세  = 300,000,000 × 2.8%  = 8,400,000
    // 지방교육세 = 300,000,000 × 0.16% = 480,000   [(2.8% − 2%) × 20%]
    const r = run({ ...baseInput, cause: 'INHERITANCE', price: 300_000_000 });
    expect(amountOf(r, 'ACQ_TAX')).toBe(8_400_000);
    expect(amountOf(r, 'ACQ_LOCAL_EDU')).toBe(480_000);
    expect(r.total).toBe(8_880_000);
  });

  it('증여(주택 5억, 비조정) → 3.5%, 지방교육세 0.3%', () => {
    // 취득세  = 500,000,000 × 3.5% = 17,500,000
    // 지방교육세 = 500,000,000 × 0.3% = 1,500,000  [(3.5% − 2%) × 20%]
    const r = run({ ...baseInput, cause: 'GIFT' });
    expect(amountOf(r, 'ACQ_TAX')).toBe(17_500_000);
    expect(amountOf(r, 'ACQ_LOCAL_EDU')).toBe(1_500_000);
    expect(r.total).toBe(19_000_000);
  });

  it('[경계] 조정대상지역 + 시가표준액 3억 이상 주택 증여 → 12% 중과', () => {
    // 취득세  = 400,000,000 × 12%  = 48,000,000
    // 지방교육세 = 400,000,000 × 0.4% = 1,600,000
    const r = run({
      ...baseInput,
      cause: 'GIFT',
      price: 400_000_000,
      officialPrice: 400_000_000,
      isAdjustedArea: true,
    });
    expect(r.items[0]?.rate).toBe(0.12);
    expect(amountOf(r, 'ACQ_TAX')).toBe(48_000_000);
    expect(r.total).toBe(49_600_000);
  });

  it('[경계] 조정대상지역이라도 시가표준액 3억 미만이면 증여 중과가 아니다', () => {
    // 시가표준액 299,999,999원 → 3억 미만 → 일반 3.5%
    const r = run({
      ...baseInput,
      cause: 'GIFT',
      price: 400_000_000,
      officialPrice: 299_999_999,
      isAdjustedArea: true,
    });
    expect(r.items[0]?.rate).toBe(0.035);
  });

  it('원시취득(신축) → 2.8%', () => {
    const r = run({ ...baseInput, cause: 'ORIGINAL', price: 300_000_000 });
    expect(r.items[0]?.rate).toBe(0.028);
    expect(amountOf(r, 'ACQ_TAX')).toBe(8_400_000);
  });

  it('농지 유상취득 → 3% (일반 4%가 아니다)', () => {
    const r = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'FARMLAND',
      cause: 'PAID',
      price: 200_000_000,
    });
    expect(r.items[0]?.rate).toBe(0.03);
    expect(amountOf(r, 'ACQ_TAX')).toBe(6_000_000);
    // 지방교육세 = 200,000,000 × (3% − 2%) × 20% = 200,000,000 × 0.2% = 400,000
    expect(amountOf(r, 'ACQ_LOCAL_EDU')).toBe(400_000);
  });

  it('상가(비주택) 유상취득 10억 → 4%, 농특세 0.2% 과세', () => {
    // 취득세  = 1,000,000,000 × 4%   = 40,000,000
    // 지방교육세 = 1,000,000,000 × 0.4% = 4,000,000
    // 농특세   = 1,000,000,000 × 0.2% = 2,000,000  (주택이 아니므로 국민주택규모 비과세 없음)
    const r = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'COMMERCIAL',
      cause: 'PAID',
      price: 1_000_000_000,
    });
    expect(amountOf(r, 'ACQ_TAX')).toBe(40_000_000);
    expect(amountOf(r, 'ACQ_LOCAL_EDU')).toBe(4_000_000);
    expect(amountOf(r, 'ACQ_RURAL')).toBe(2_000_000);
    expect(r.total).toBe(46_000_000);
  });

  it('오피스텔은 주택 구간세율(1~3%)이 아니라 건축물 4%가 적용된다', () => {
    // 오피스텔 5억: 주택이면 1%(5,000,000)여야 하지만, 건축물이므로 4%(20,000,000)다.
    const r = run({ ...baseInput, propertyKind: 'OFFICETEL' });
    expect(r.items[0]?.rate).toBe(0.04);
    expect(amountOf(r, 'ACQ_TAX')).toBe(20_000_000);
    // 농특세도 주택이 아니므로 국민주택규모 비과세를 받지 못한다
    expect(amountOf(r, 'ACQ_RURAL')).toBe(1_000_000); // 500,000,000 × 0.2%
    expect(r.warnings.join()).toContain('오피스텔');
  });
});

describe('취득세 — 사치성재산·대도시 법인 중과', () => {
  it('고급주택(20억) 유상취득 → 표준 3% + 8%p = 11%, 농특세도 0.8%p 가산', () => {
    // 취득세  = 2,000,000,000 × 11%  = 220,000,000
    // 지방교육세 = 2,000,000,000 × 0.3% = 6,000,000   (사치성 중과분은 지방교육세 대상 아님)
    // 농특세   = 2,000,000,000 × 1.0% = 20,000,000  (0.2% + 0.8%p, 국민주택규모 비과세 배제)
    const r = run({
      ...baseInput,
      price: 2_000_000_000,
      exclusiveAreaSqm: 250,
      isLuxury: true,
    });
    expect(r.items[0]?.rate).toBe(0.11);
    expect(amountOf(r, 'ACQ_TAX')).toBe(220_000_000);
    expect(amountOf(r, 'ACQ_LOCAL_EDU')).toBe(6_000_000);
    expect(amountOf(r, 'ACQ_RURAL')).toBe(20_000_000);
    expect(r.total).toBe(246_000_000);
  });

  it('대도시 법인 중과: 상가 10억 → 8% (표준 4%×3 − 중과기준 2%×2)', () => {
    // 취득세  = 1,000,000,000 × 8%   = 80,000,000
    // 지방교육세 = 1,000,000,000 × 1.2% = 12,000,000
    const r = run({
      ownerType: 'CORPORATION',
      propertyKind: 'COMMERCIAL',
      cause: 'PAID',
      price: 1_000_000_000,
      isMetropolitanCorpHeavy: true,
    });
    expect(r.items[0]?.rate).toBe(0.08);
    expect(amountOf(r, 'ACQ_TAX')).toBe(80_000_000);
    expect(amountOf(r, 'ACQ_LOCAL_EDU')).toBe(12_000_000);
  });
});

describe('인지세 · 국민주택채권', () => {
  it('주택 5억 매매계약 → 인지세 15만원 (1억 초과 10억 이하)', () => {
    const r = run({ ...baseInput, hasContract: true });
    expect(amountOf(r, 'STAMP_TAX')).toBe(150_000);
  });

  it('[경계] 주택 1억 이하는 인지세 비과세', () => {
    const r = run({ ...baseInput, price: 100_000_000, hasContract: true });
    expect(amountOf(r, 'STAMP_TAX')).toBe(0);
  });

  it('주택 10억 초과 → 인지세 35만원', () => {
    const r = run({
      ...baseInput,
      price: 1_500_000_000,
      exclusiveAreaSqm: 100,
      hasContract: true,
    });
    expect(amountOf(r, 'STAMP_TAX')).toBe(350_000);
  });

  it('국민주택채권 실부담액 = 매입액 × 할인율, 그리고 반드시 경고를 남긴다', () => {
    // 5억 → 매입율 구간(2.6억~6억) 3.1% → 매입액 = 500,000,000 × 3.1% = 15,500,000
    // 실부담액 = 15,500,000 × 8% = 1,240,000
    const r = run({ ...baseInput, buysHousingBond: true });
    expect(amountOf(r, 'HOUSING_BOND')).toBe(1_240_000);
    expect(r.warnings.join()).toContain('할인율');
  });
});

describe('취득세 — 증여 중과의 시가표준액 (R-1)', () => {
  const gift: AcquisitionInput = {
    ownerType: 'INDIVIDUAL',
    propertyKind: 'HOUSE',
    cause: 'GIFT',
    price: 700_000_000,
    exclusiveAreaSqm: 84,
    isAdjustedArea: true,
  };

  it('시가표준액을 입력하지 않으면 취득가액으로 갈음했다는 경고를 남긴다', () => {
    const r = run(gift);
    expect(r.warnings.some((w) => w.includes('시가표준액'))).toBe(true);
  });

  it('시가표준액이 기준(3억) 미만이면 취득가액이 3억 이상이어도 중과하지 않는다', () => {
    // 시가표준액 2억 < 3억 → 표준 증여 취득 세율 3.5%
    const r = run({ ...gift, officialPrice: 200_000_000 });
    expect(amountOf(r, 'ACQ_TAX')).toBe(24_500_000);
    expect(r.warnings.some((w) => w.includes('시가표준액이 입력되지'))).toBe(false);
  });

  it('시가표준액이 3억 이상이면 중과 12%', () => {
    const r = run({ ...gift, officialPrice: 300_000_000 });
    expect(amountOf(r, 'ACQ_TAX')).toBe(84_000_000);
  });
});

describe('취득세 — 국민주택채권 할인율 (R-2)', () => {
  const bond: AcquisitionInput = {
    ownerType: 'INDIVIDUAL',
    propertyKind: 'COMMERCIAL',
    cause: 'PAID',
    price: 1_000_000_000,
    buysHousingBond: true,
  };

  it('할인율을 입력하면 그 값으로 실부담액을 계산한다', () => {
    // 매입액 = 10억 × 3.7% = 37,000,000 → 실부담 = × 5.5% = 2,035,000
    const r = run({ ...bond, bondDiscountRate: 0.055 });
    expect(amountOf(r, 'HOUSING_BOND')).toBe(2_035_000);
  });

  it('할인율 미입력 시 룰셋 자리표시자를 썼다는 경고를 남긴다', () => {
    const r = run(bond);
    expect(r.warnings.some((w) => w.includes('할인율이 입력되지 않아'))).toBe(true);
  });

  it('할인율을 입력하면 자리표시자 경고가 사라진다', () => {
    // 룰셋 자체의 검수 경고(매입율 구간표)는 남는다 — 사라지는 건 "할인율 미입력" 경고뿐이다.
    const r = run({ ...bond, bondDiscountRate: 0.055 });
    expect(r.warnings.some((w) => w.includes('할인율이 입력되지 않아'))).toBe(false);
  });

  it('할인율이 0 미만이거나 1 초과면 예외를 던진다', () => {
    expect(() => run({ ...bond, bondDiscountRate: 1.5 })).toThrow(/할인율/);
    expect(() => run({ ...bond, bondDiscountRate: -0.1 })).toThrow(/할인율/);
  });
});
