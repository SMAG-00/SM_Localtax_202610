import type { Rate, Won } from './types';
import { applyRate, clampNonNegative, roundMicro } from './money';
import { resolveFormula } from './formulas';

/** 누진 구간의 최소 형태 */
export interface BracketLike {
  readonly up_to: number | null;
  readonly rate?: number | undefined;
  readonly formula?: string | undefined;
  readonly deduction?: number | undefined;
  readonly condition: string;
  readonly law: string;
  readonly REVIEW_REQUIRED?: boolean | undefined;
  readonly note?: string | undefined;
}

export interface FlatBracketLike {
  readonly up_to: number | null;
  readonly amount: number;
  readonly condition: string;
  readonly law: string;
  readonly REVIEW_REQUIRED?: boolean | undefined;
  readonly note?: string | undefined;
}

/**
 * 과세표준이 속하는 구간을 고른다. up_to는 '이하' 경계다.
 * 예: up_to=600,000,000 구간은 정확히 6억원을 포함한다.
 */
export function pickBracket<T extends { up_to: number | null }>(
  base: number,
  brackets: readonly T[],
): T {
  for (const bracket of brackets) {
    if (bracket.up_to === null || base <= bracket.up_to) return bracket;
  }
  const last = brackets[brackets.length - 1];
  if (last === undefined) throw new Error('pickBracket: 구간표가 비어 있습니다.');
  return last;
}

/** 구간의 세율을 구한다. formula 구간이면 수식 레지스트리에서 해석한다. */
export function bracketRate(bracket: BracketLike, base: Won): Rate {
  if (bracket.rate !== undefined) return bracket.rate;
  if (bracket.formula !== undefined) return resolveFormula(bracket.formula)(base);
  throw new Error(`bracketRate: rate도 formula도 없는 구간입니다 [${bracket.law}]`);
}

export interface ProgressiveResult {
  readonly bracket: BracketLike;
  readonly rate: Rate;
  readonly deduction: Won;
  readonly amount: Won;
}

/**
 * 누진세액 = 과세표준 × 세율 − 누진공제 (원 단위 내림, 음수는 0)
 */
export function progressive(
  base: Won,
  brackets: readonly BracketLike[],
): ProgressiveResult {
  const bracket = pickBracket(base, brackets);
  const rate = bracketRate(bracket, base);
  const deduction = bracket.deduction ?? 0;
  const amount = clampNonNegative(roundMicro(base * rate) - deduction);
  return { bracket, rate, deduction, amount };
}

/** 정액세 구간 (인지세) */
export function flatAmount(
  base: number,
  brackets: readonly FlatBracketLike[],
): FlatBracketLike {
  return pickBracket(base, brackets);
}

/**
 * "이상" 기준 계단표에서 해당 등급을 고른다 (장기보유특별공제, 고령자 세액공제 등).
 * value가 최저 등급에 못 미치면 null.
 */
export function pickTier<T extends { rate: number }>(
  value: number,
  tiers: readonly T[],
  key: (tier: T) => number,
): T | null {
  let matched: T | null = null;
  for (const tier of tiers) {
    if (value >= key(tier)) matched = tier;
  }
  return matched;
}

/** 과세표준 × 세율 (원 단위 내림, 부동소수점 잡음 제거) */
export function taxOf(base: Won, rate: Rate): Won {
  return applyRate(base, rate);
}
