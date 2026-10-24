import type { Rate, Won } from './types';

/** 금액 정수(원 단위) 안전 범위 검사 */
export function assertWon(value: number, label = 'amount'): Won {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label}: 금액이 유한수가 아닙니다 (${value})`);
  }
  if (!Number.isInteger(value)) {
    throw new RangeError(`${label}: 금액은 원 단위 정수여야 합니다 (${value})`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label}: 금액이 안전 정수 범위를 벗어났습니다 (${value})`);
  }
  return value;
}

/**
 * 부동소수점 잡음 제거: 원 단위 소수 6자리에서 반올림한다.
 *
 * IEEE754에서 349,500,000 × 0.7 은 244,649,999.99999997 로, 7억 × 1.6667% 는
 * 11,666,900.000000002 로 나온다. 이대로 내림하면 세액이 1원 어긋난다.
 * 0.4원 같은 **실제** 소수부는 보존된다 — 6자리 반올림은 오차 스케일에만 작용한다.
 */
export function roundMicro(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * 원 단위 내림 (세액 계산의 기본 절사 방식).
 *
 * 내림 직전에 항상 roundMicro를 거친다. 세액을 만드는 모든 경로가 이 함수를 통과하므로,
 * 여기서 잡음을 걷어내면 개별 계산기마다 방어할 필요가 없다.
 */
export function floorWon(value: number): Won {
  return Math.floor(roundMicro(value));
}

/**
 * 원 단위 반올림 (사사오입 = round-half-up).
 *
 * 세액 산출은 내림(floorWon)이 기본이지만, 시행령이 특정 항목에 반올림을 규정한 경우
 * (예: 환산취득가액 = 양도가액 × 기준시가비율, 영 §176의2②)에 쓴다.
 * floorWon과 마찬가지로 반올림 직전 roundMicro로 부동소수점 잡음을 걷어낸다.
 *
 * ※ 의도적 선택: 정확히 X.5인 경계에서 **한국 세무 관행인 사사오입(0.5→올림)**을 따른다.
 *   Python round()의 은행가반올림(round-half-to-even, 0.5→짝수)과 이 지점에서 1원 갈릴 수 있으나,
 *   국내 반올림 규약은 사사오입이므로 half-up을 표준으로 채택한다. (참조구현 10_은 Python round 사용)
 */
export function roundWon(value: number): Won {
  return Math.round(roundMicro(value));
}

/** 지정한 자리수로 절사한다. 예: truncateTo(1_234_567, 10) → 1_234_560 (10원 미만 절사) */
export function truncateTo(value: number, unit: number): Won {
  if (!Number.isInteger(unit) || unit <= 0) {
    throw new RangeError(`truncateTo: unit은 양의 정수여야 합니다 (${unit})`);
  }
  return Math.floor(roundMicro(value / unit)) * unit;
}

/**
 * 과세표준 × 세율 → 세액(원 단위 내림).
 */
export function applyRate(base: Won, rate: Rate): Won {
  assertWon(base, 'base');
  if (!Number.isFinite(rate) || rate < 0) {
    throw new RangeError(`applyRate: 세율이 올바르지 않습니다 (${rate})`);
  }
  return floorWon(base * rate);
}

/** 0 미만이면 0으로 (과세표준·세액은 음수가 될 수 없다) */
export function clampNonNegative(value: number): Won {
  return value < 0 ? 0 : floorWon(value);
}

/** 원 단위 금액을 한국어 표기로 (예: 1234567 → "1,234,567원") */
export function formatWon(value: Won): string {
  return `${value.toLocaleString('ko-KR')}원`;
}
