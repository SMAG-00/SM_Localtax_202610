import type { Rate, Won } from './types';
import { FORMULA_IDS, type FormulaId } from './schema';

/**
 * 명명된 수식 레지스트리.
 *
 * 룰셋 JSON의 `formula` 필드는 **수식 문자열이 아니라 여기 등록된 ID**다.
 * 문자열을 eval하지 않는 이유: 룰셋 파일이 코드 실행 경로가 되면 안 되고,
 * 엔진의 순수성(불변 원칙 1)도 깨지기 때문이다.
 */
export type RateFormula = (base: Won) => Rate;

/**
 * 주택 유상취득 6억 초과 9억 이하 구간 (지방세법 §11①8).
 *
 *   세율(%) = (취득당시가액 × 2 ÷ 3억) − 3
 *   소수점 이하 다섯째 자리에서 반올림하여 넷째 자리까지 계산한다.
 *
 * 검산: 6억 → (4 − 3) = 1%, 9억 → (6 − 3) = 3% 로 양 끝이 인접 구간과 연속된다.
 */
export const houseP6to9Linear: RateFormula = (base) => {
  const percent = (base * 2) / 300_000_000 - 3;
  const rounded = Math.round(percent * 10_000) / 10_000; // 백분율 기준 소수 4자리
  return rounded / 100;
};

const REGISTRY: Record<FormulaId, RateFormula> = {
  HOUSE_PAID_6TO9_LINEAR: houseP6to9Linear,
};

export function isFormulaId(value: string): value is FormulaId {
  return (FORMULA_IDS as readonly string[]).includes(value);
}

export function resolveFormula(id: string): RateFormula {
  if (!isFormulaId(id)) {
    throw new Error(`resolveFormula: 등록되지 않은 수식 ID입니다 (${id})`);
  }
  return REGISTRY[id];
}
