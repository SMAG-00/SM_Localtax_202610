import { describe, expect, it } from 'vitest';
import { RULESET } from './ruleset';
import { calcAcquisition, type AcquisitionInput } from '../src/acquisition';
import { calcHolding, type HoldingInput } from '../src/holding';
import type { CalcResult } from '../src/result';

/**
 * 재개발·재건축 조합원 — 취득세·보유세.
 *
 * 세무본부 결정(2026-07-31):
 *  · 원조합원 납부 청산금  → 토지 유상승계세율 4%
 *  · 승계조합원 입주권 취득 → 멸실 여부와 무관하게 토지 유상승계세율 4%, 주택 수 미산입
 *  · 멸실된 재개발구역 토지 → 재산세 종합합산
 *
 * 세 결정 모두 지자체 판단이 갈릴 수 있는 항목이므로, 계산과 함께 검수 경고가 뜨는지도 검증한다.
 */

const amountOf = (r: CalcResult, code: string): number =>
  r.items.find((i) => i.code === code)?.amount ?? -1;
const hasItem = (r: CalcResult, code: string): boolean =>
  r.items.some((i) => i.code === code);
const warnText = (r: CalcResult): string => r.warnings.join(' ');

describe('취득세 — 승계조합원 입주권', () => {
  const successor: AcquisitionInput = {
    ownerType: 'INDIVIDUAL',
    propertyKind: 'PRESALE_RIGHT',
    cause: 'PAID',
    price: 600_000_000,
    houseCount: 1,
    membershipDetail: { role: 'SUCCESSOR', approvalDate: '2020-03-10' },
  };

  it('토지 유상승계세율 4% 를 적용한다 (주택 구간표 1~3% 아님)', () => {
    const r = calcAcquisition(successor, RULESET);
    // 6억 주택이었다면 1% = 600만. 토지 4% = 2,400만.
    expect(amountOf(r, 'ACQ_TAX')).toBe(24_000_000);
  });

  it('부가세도 토지 기준으로 붙는다 (지방교육세 0.4% · 농특세 0.2%)', () => {
    const r = calcAcquisition(successor, RULESET);
    expect(amountOf(r, 'ACQ_LOCAL_EDU')).toBe(2_400_000);
    expect(amountOf(r, 'ACQ_RURAL')).toBe(1_200_000);
  });

  it('보유 주택이 많아도 다주택 중과(8~12%)에 걸리지 않는다', () => {
    const heavyContext: AcquisitionInput = {
      ...successor,
      houseCount: 3,
      isAdjustedArea: true,
    };
    const r = calcAcquisition(heavyContext, RULESET);
    // 조정 3주택이면 주택 경로에서는 12%. 승계조합원은 주택이 아니므로 4% 그대로.
    expect(amountOf(r, 'ACQ_TAX')).toBe(24_000_000);
  });

  it('세무본부 결정 항목이므로 확인 경고를 남긴다', () => {
    const r = calcAcquisition(successor, RULESET);
    expect(warnText(r)).toContain('승계조합원');
    expect(warnText(r)).toContain('원시취득');
  });
});

describe('취득세 — 원조합원 납부 청산금', () => {
  const original: AcquisitionInput = {
    ownerType: 'INDIVIDUAL',
    propertyKind: 'HOUSE',
    cause: 'ORIGINAL',
    price: 300_000_000, // 신축 건물분
    exclusiveAreaSqm: 84,
    houseCount: 1,
    membershipDetail: {
      role: 'ORIGINAL',
      approvalDate: '2020-03-10',
      paidSettlement: 100_000_000,
    },
  };

  it('건물분은 원시취득 2.8%, 청산금분은 토지 4% 로 분리 과세한다', () => {
    const r = calcAcquisition(original, RULESET);
    expect(amountOf(r, 'ACQ_TAX')).toBe(8_400_000); // 3억 × 2.8%
    expect(amountOf(r, 'ACQ_TAX_SETTLEMENT')).toBe(4_000_000); // 1억 × 4%
  });

  it('청산금분 부가세는 청산금을 과세표준으로 삼는다 (건물분과 합치지 않는다)', () => {
    const r = calcAcquisition(original, RULESET);
    expect(amountOf(r, 'ACQ_LOCAL_EDU_SETTLEMENT')).toBe(400_000); // 1억 × 0.4%
    expect(amountOf(r, 'ACQ_RURAL_SETTLEMENT')).toBe(200_000); // 1억 × 0.2%
  });

  it('청산금분 농특세는 국민주택규모라도 비과세되지 않는다 (토지 승계취득분)', () => {
    const r = calcAcquisition(original, RULESET); // 전용 84㎡ = 국민주택규모
    // 건물분 농특세는 비과세(0)지만 청산금분은 과세된다
    expect(amountOf(r, 'ACQ_RURAL')).toBe(0);
    expect(amountOf(r, 'ACQ_RURAL_SETTLEMENT')).toBe(200_000);
  });

  it('청산금이 0이면 청산금 항목 자체를 만들지 않는다', () => {
    const noSettlement: AcquisitionInput = {
      ...original,
      membershipDetail: { role: 'ORIGINAL', approvalDate: '2020-03-10' },
    };
    const r = calcAcquisition(noSettlement, RULESET);
    expect(hasItem(r, 'ACQ_TAX_SETTLEMENT')).toBe(false);
    expect(amountOf(r, 'ACQ_TAX')).toBe(8_400_000);
  });

  it('원시취득이 아닌 원인으로 청산금을 넣으면 경고한다', () => {
    const wrongCause: AcquisitionInput = { ...original, cause: 'PAID' };
    const r = calcAcquisition(wrongCause, RULESET);
    expect(warnText(r)).toContain('원시취득이 아닙니다');
  });

  it('세무본부 결정 항목이므로 확인 경고를 남긴다', () => {
    const r = calcAcquisition(original, RULESET);
    expect(warnText(r)).toContain('청산금');
    expect(warnText(r)).toContain('관리처분계획');
  });
});

describe('보유세 — 재개발 멸실 토지', () => {
  const demolished: HoldingInput = {
    ownerType: 'INDIVIDUAL',
    propertyKind: 'HOUSE',
    publishedPrices: [500_000_000],
    isSingleHouseOneHousehold: true,
    isRedevelopmentDemolished: true,
  };

  it('주택분이 아니라 토지분으로 계산한다 (지방세법 §106③ 현황과세)', () => {
    const r = calcHolding(demolished, RULESET);
    const asHouse = calcHolding(
      { ...demolished, isRedevelopmentDemolished: false },
      RULESET,
    );
    expect(r.total).not.toBe(asHouse.total);
    expect(warnText(r)).toContain('멸실');
  });

  it('1세대1주택 특례·세액공제가 붙지 않는다', () => {
    const r = calcHolding(
      { ...demolished, ownerAge: 70, holdingYears: 16 },
      RULESET,
    );
    const text = r.items.flatMap((i) => i.reasons).join(' ');
    expect(text).not.toContain('고령자');
    expect(text).not.toContain('1세대1주택');
  });

  it('합산구분을 별도합산으로 넣어도 종합합산으로 계산하고 경고한다', () => {
    const r = calcHolding({ ...demolished, landType: 'SEPARATE' }, RULESET);
    const comprehensive = calcHolding(
      { ...demolished, landType: 'COMPREHENSIVE' },
      RULESET,
    );
    expect(r.total).toBe(comprehensive.total);
    expect(warnText(r)).toContain('종합합산으로 계산');
  });

  it('멸실 전(false)이면 종전대로 주택분으로 계산한다', () => {
    const before = calcHolding(
      { ...demolished, isRedevelopmentDemolished: false },
      RULESET,
    );
    expect(warnText(before)).not.toContain('멸실');
  });
});
