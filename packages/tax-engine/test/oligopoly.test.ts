import { describe, expect, it } from 'vitest';
import { RULESET, RULESET_RAW } from './ruleset';
import { parseRuleset } from '../src/schema';
import { calcOligopoly, type OligopolyInput } from '../src/oligopoly';
import type { CalcResult } from '../src/result';

const run = (input: OligopolyInput): CalcResult => calcOligopoly(input, RULESET);

const amountOf = (r: CalcResult, code: string): number =>
  r.items.find((i) => i.code === code)?.amount ?? -1;

const BOOK_VALUE = 1_000_000_000; // 법인 부동산등 장부가액 10억

describe('과점주주 간주취득세 — 판정 (지방세법 §7⑤)', () => {
  it('[경계] 지분 정확히 50%는 과점주주가 아니다 ("초과"여야 한다)', () => {
    const r = run({ bookValue: BOOK_VALUE, beforeRatio: 0.3, afterRatio: 0.5 });
    expect(r.total).toBe(0);
    expect(amountOf(r, 'OLIGOPOLY_DEEMED_ACQ')).toBe(0);
    expect(r.items[0]?.reasons.join()).toContain('과점주주 아님');
  });

  it('[경계] 50%를 1주라도 넘으면 과점주주가 되어 취득 후 지분율 전체가 과세된다', () => {
    // 지분 50.0001% (= 100만주 중 500,001주)
    // 과세표준 = 1,000,000,000 × 50.0001% = 500,001,000
    // 간주취득세 = 500,001,000 × 2% = 10,000,020
    // 농특세    = 500,001,000 × 0.2% = 1,000,002
    const r = run({ bookValue: BOOK_VALUE, beforeRatio: 0.3, afterRatio: 0.500001 });
    expect(amountOf(r, 'OLIGOPOLY_DEEMED_ACQ')).toBe(10_000_020);
    expect(amountOf(r, 'OLIGOPOLY_RURAL')).toBe(1_000_002);
    expect(r.total).toBe(11_000_022);
  });

  it('최초 과점주주(30% → 60%)는 증가분 30%가 아니라 취득 후 60% 전체가 과세표준이다', () => {
    // 과세표준 = 1,000,000,000 × 60% = 600,000,000
    // 간주취득세 = 600,000,000 × 2%   = 12,000,000
    // 농특세    = 600,000,000 × 0.2% = 1,200,000
    const r = run({ bookValue: BOOK_VALUE, beforeRatio: 0.3, afterRatio: 0.6 });
    expect(r.items[0]?.base).toBe(600_000_000);
    expect(amountOf(r, 'OLIGOPOLY_DEEMED_ACQ')).toBe(12_000_000);
    expect(amountOf(r, 'OLIGOPOLY_RURAL')).toBe(1_200_000);
    expect(r.total).toBe(13_200_000);
    expect(r.items[0]?.reasons.join()).toContain('최초로 과점주주');
  });

  it('이미 과점주주(60% → 80%)면 증가분 20%만 과세된다', () => {
    // 과세표준 = 1,000,000,000 × (80% − 60%) = 200,000,000
    // 간주취득세 = 200,000,000 × 2% = 4,000,000 / 농특세 = 400,000
    const r = run({ bookValue: BOOK_VALUE, beforeRatio: 0.6, afterRatio: 0.8 });
    expect(r.items[0]?.base).toBe(200_000_000);
    expect(amountOf(r, 'OLIGOPOLY_DEEMED_ACQ')).toBe(4_000_000);
    expect(r.total).toBe(4_400_000);
    expect(r.items[0]?.reasons.join()).toContain('증가분');
  });

  it('이미 과점주주이고 지분 변동이 없으면 과세하지 않는다', () => {
    const r = run({ bookValue: BOOK_VALUE, beforeRatio: 0.6, afterRatio: 0.6 });
    expect(r.total).toBe(0);
    expect(r.items[0]?.reasons.join()).toContain('증가분이 없음');
  });

  it('과점주주가 지분을 줄인 경우(70% → 60%)에도 과세하지 않는다', () => {
    const r = run({ bookValue: BOOK_VALUE, beforeRatio: 0.7, afterRatio: 0.6 });
    expect(r.total).toBe(0);
  });

  it('지분 이력이 있는 기존 과점주주에게는 "종전 최고 지분율" 경고를 남긴다', () => {
    const r = run({ bookValue: BOOK_VALUE, beforeRatio: 0.6, afterRatio: 0.8 });
    expect(r.warnings.join()).toContain('종전 최고 지분율');
  });
});

describe('과점주주 간주취득세 — 부가세', () => {
  it('지방교육세는 룰셋 플래그(applies=false)에 따라 부과하지 않고, 대신 경고를 남긴다', () => {
    const r = run({ bookValue: BOOK_VALUE, beforeRatio: 0.3, afterRatio: 0.6 });
    expect(amountOf(r, 'OLIGOPOLY_LOCAL_EDU')).toBe(-1); // 항목 없음
    expect(r.warnings.join()).toContain('지방교육세');
    expect(RULESET.oligopoly.surtax.local_education.applies).toBe(false);
  });

  it('간주취득세는 중과기준세율 2%다 (표준세율 4%가 아니다)', () => {
    const r = run({ bookValue: BOOK_VALUE, beforeRatio: 0.3, afterRatio: 0.6 });
    expect(r.items[0]?.rate).toBe(0.02);
  });

  it('지분율이 0~1 범위를 벗어나면 예외를 던진다', () => {
    expect(() =>
      run({ bookValue: BOOK_VALUE, beforeRatio: -0.1, afterRatio: 0.6 }),
    ).toThrow(/beforeRatio/);
    expect(() =>
      run({ bookValue: BOOK_VALUE, beforeRatio: 0.3, afterRatio: 1.2 }),
    ).toThrow(/afterRatio/);
  });
});

describe('과점주주 — 지방교육세 부과 설정의 함정 (R-3)', () => {
  /** 룰셋 노트대로 applies 만 true 로 뒤집은 룰셋 (rate 는 0 그대로) */
  const flipped = (): typeof RULESET => {
    const raw = structuredClone(RULESET_RAW) as Record<string, any>;
    raw.oligopoly.surtax.local_education.applies = true;
    return parseRuleset(raw);
  };

  it('applies=true 인데 세율이 0%면 설정 오류를 경고한다 (조용히 0원이 되지 않는다)', () => {
    // 룰셋 노트는 "applies=true로 바꾸면 엔진이 rate를 적용한다"고 안내하지만 rate 는 0이다.
    // 세무본부가 노트대로 뒤집으면 세액 0 · 행 없음 · 경고 없음이 되어 결정이 반영된 줄 알게 된다.
    const r = calcOligopoly(
      { bookValue: 3_000_000_000, beforeRatio: 0.3, afterRatio: 0.7 },
      flipped(),
    );
    expect(r.items.some((i) => i.code === 'OLIGOPOLY_LOCAL_EDU')).toBe(false);
    expect(r.warnings.some((w) => w.includes('세율이 0'))).toBe(true);
  });

  it('applies=false 면 미부과 경고만 남고 설정 오류 경고는 없다 (현재 룰셋)', () => {
    const r = calcOligopoly(
      { bookValue: 3_000_000_000, beforeRatio: 0.3, afterRatio: 0.7 },
      RULESET,
    );
    expect(r.warnings.some((w) => w.includes('미부과(applies=false)'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('세율이 0'))).toBe(false);
  });
});
