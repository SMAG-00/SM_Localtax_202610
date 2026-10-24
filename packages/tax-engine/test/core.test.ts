import { describe, expect, it } from 'vitest';
import {
  applyRate,
  assertWon,
  clampNonNegative,
  floorWon,
  roundMicro,
  truncateTo,
} from '../src/money';
import { daysBetween, fullYearsBetween, parseDate } from '../src/dates';
import { pickBracket, progressive } from '../src/brackets';
import { ResultBuilder } from '../src/result';

describe('금액 유틸', () => {
  it('assertWon은 소수·비유한수·안전정수 초과를 거부한다', () => {
    expect(assertWon(1_000_000)).toBe(1_000_000);
    expect(() => assertWon(1000.5)).toThrow(/정수/);
    expect(() => assertWon(Number.NaN)).toThrow(/유한수/);
    expect(() => assertWon(Number.MAX_SAFE_INTEGER + 2)).toThrow();
  });

  it('applyRate는 부동소수점 잡음을 걷어내고 원 단위로 내림한다', () => {
    // 700,000,000 × 0.0016667 은 IEEE754에서 1,166,690.0000000002 로 나온다 → 1,166,690
    expect(applyRate(700_000_000, 0.0016667)).toBe(1_166_690);
    // 실제 소수부는 보존되어 내림된다: 1,000 × 0.0155 = 15.5 → 15
    expect(applyRate(1_000, 0.0155)).toBe(15);
  });

  it('roundMicro는 미세오차만 제거하고 실제 소수는 보존한다', () => {
    expect(roundMicro(1_166_690.0000000002)).toBe(1_166_690);
    expect(roundMicro(15.5)).toBe(15.5);
  });

  it('[회귀] floorWon은 IEEE754 오차로 세액을 1원 깎지 않는다', () => {
    // 349,500,000 × 0.7 은 IEEE754에서 244,649,999.99999997 로 나온다.
    // 보호가 없으면 244,649,999 (1원 손실). 다주택 중과 세액 계산에서 실제로 터졌던 케이스다.
    expect(349_500_000 * 0.7).toBeLessThan(244_650_000); // 오차가 실재함을 먼저 보인다
    expect(floorWon(349_500_000 * 0.7)).toBe(244_650_000);

    // 반대 방향 오차: 7억 × 1.6667% = 11,666,900.000000002
    expect(floorWon(700_000_000 * 0.016667)).toBe(11_666_900);
  });

  it('floorWon은 실제 소수부는 정직하게 버린다 (오차 보정이 반올림으로 변질되지 않는다)', () => {
    expect(floorWon(100.9)).toBe(100);
    expect(floorWon(100.000001)).toBe(100);
    // 소수 6자리까지는 "실제 값"으로 보고 보존한 뒤 내림한다 → 99
    expect(floorWon(99.999999)).toBe(99);
    // 7자리 이하(1e-7)는 IEEE754 잡음으로 보고 흡수한다 → 100
    expect(floorWon(99.9999999)).toBe(100);
  });

  it('truncateTo는 지정 단위 미만을 절사한다', () => {
    expect(truncateTo(1_234_567, 10)).toBe(1_234_560);
    expect(truncateTo(1_234_567, 1_000)).toBe(1_234_000);
    expect(() => truncateTo(100, 0)).toThrow();
  });

  it('clampNonNegative는 음수를 0으로 만든다 (세액은 음수가 될 수 없다)', () => {
    expect(clampNonNegative(-1)).toBe(0);
    expect(clampNonNegative(100.9)).toBe(100);
  });
});

describe('보유기간 계산 (달력 기준)', () => {
  it('만 1년 경계를 정확히 판정한다', () => {
    expect(fullYearsBetween('2025-01-01', '2026-01-01')).toBe(1); // 정확히 1년
    expect(fullYearsBetween('2025-01-01', '2025-12-31')).toBe(0); // 1년 − 1일
  });

  it('윤년 2/29 취득 → 평년 2/28 양도는 아직 1년이 아니다', () => {
    // 밀리초 나눗셈으로 계산하면 366일 중 365일이라 1년으로 잘못 나오는 케이스
    expect(fullYearsBetween('2024-02-29', '2025-02-28')).toBe(0);
    expect(fullYearsBetween('2024-02-29', '2025-03-01')).toBe(1);
  });

  it('양도일이 취득일보다 빠르면 예외를 던진다', () => {
    expect(() => fullYearsBetween('2026-01-01', '2025-01-01')).toThrow(/빠릅니다/);
  });

  it('존재하지 않는 날짜와 잘못된 형식을 거부한다', () => {
    expect(() => parseDate('2025-02-30')).toThrow(/존재하지 않는/);
    expect(() => parseDate('2025-2-1')).toThrow(/YYYY-MM-DD/);
  });

  it('daysBetween이 경계 테스트용 일수를 정확히 센다', () => {
    expect(daysBetween('2025-01-01', '2026-01-01')).toBe(365);
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366); // 윤년
  });
});

describe('누진 구간', () => {
  const brackets = [
    { up_to: 100, rate: 0.1, condition: '100 이하', law: '테스트법 §1' },
    { up_to: 200, rate: 0.2, deduction: 10, condition: '200 이하', law: '테스트법 §2' },
    { up_to: null, rate: 0.3, deduction: 30, condition: '초과', law: '테스트법 §3' },
  ];

  it('up_to는 "이하" 경계다 (상한값이 그 구간에 포함된다)', () => {
    expect(pickBracket(100, brackets).law).toBe('테스트법 §1');
    expect(pickBracket(101, brackets).law).toBe('테스트법 §2');
    expect(pickBracket(200, brackets).law).toBe('테스트법 §2');
    expect(pickBracket(201, brackets).law).toBe('테스트법 §3');
  });

  it('누진세액 = 과세표준 × 세율 − 누진공제', () => {
    expect(progressive(150, brackets).amount).toBe(20); // 150 × 0.2 − 10
    expect(progressive(1000, brackets).amount).toBe(270); // 1000 × 0.3 − 30
  });

  it('누진공제가 세액보다 크면 0으로 막는다', () => {
    expect(progressive(101, brackets).amount).toBe(10); // 101 × 0.2 − 10 = 10.2 → 10
    expect(progressive(0, brackets).amount).toBe(0);
  });
});

describe('결과 봉투 (불변 원칙 2)', () => {
  it('rulesVersion 없이는 결과를 만들 수 없다', () => {
    expect(() => new ResultBuilder('')).toThrow(/rulesVersion/);
  });

  it('total은 항목 세액의 합이고, rulesVersion이 각인된다', () => {
    const rb = new ResultBuilder('2026.01');
    rb.add({
      code: 'A',
      label: '세목A',
      base: 1000,
      rate: 0.1,
      amount: 100,
      law: '테스트법 §1',
      reasons: [],
    });
    rb.add({
      code: 'B',
      label: '세목B',
      base: 1000,
      rate: 0.02,
      amount: 20,
      law: '테스트법 §2',
      reasons: [],
    });
    const result = rb.build('0.2.0');
    expect(result.total).toBe(120);
    expect(result.rulesVersion).toBe('2026.01');
    expect(result.engineVersion).toBe('0.2.0');
  });

  it('warnings는 중복 제거된다', () => {
    const rb = new ResultBuilder('2026.01');
    rb.warnExpert('같은 사유');
    rb.warnExpert('같은 사유');
    expect(rb.build('0.2.0').warnings).toHaveLength(1);
  });
});
