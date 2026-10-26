import type { Won } from './types';
import type { Ruleset } from './schema';
import { assertWon } from './money';
import { calcAcquisition, type AcquisitionInput } from './acquisition';
import { calcHolding, type HoldingInput } from './holding';

/**
 * 총비용 조합 (RE-05) - 취득 지방세 + 해마다 보유세 + 사용자 가정 비용을 한 표로 묶는다.
 *
 *  · 새로 쓴 파일이다(SM 복사본 아님, SOURCE.json newFiles). 엔진 해시 대상이 아니다. 세율·한도·연수 상한 같은 정책 값은 이 파일에 없다 - 호출하는 쪽이 감수된 설정에서 읽어 넣는다.
 *  · 세목 금액은 calcAcquisition·calcHolding 결과 그대로다. 같은 입력의 단독 계산기와 원 단위로 같아야 하므로 여기서 세액을 다시 계산하지 않는다.
 *  · 양도 단계 세금은 입력도 결과 줄도 없다(PRD_최종 원칙 4). 매도가 칸이 없고, 이 함수는 양도 항목을 만들지 못한다.
 *  · 이자는 사용자가 넣은 원금·연 금리로 만드는 단순 계산식이다: 연 이자 = 원금 x 연 금리, 원 미만 버림, 만기 일시 상환(원금 상환은 비용이 아니다).
 *    금리는 소수 오차를 피하려고 만분율(bp, 1bp = 0.01%) 정수로 받는다.
 *  · 결과에는 룰셋 버전이 각인된다(rulesVersion). 모든 해에 현행 룰셋을 같게 적용한다 - 세법 개정 예측은 없다.
 *  · 순수 함수: 네트워크·시계·저장소·환경변수 0.
 */

/** 합계에 넣지 않는 참고 표시 항목 - 인지세·국민주택채권 실부담액. 웹 `REFERENCE_CODES`와 같아야 한다(웹 시험이 대조) */
export const TOTAL_COST_REFERENCE_CODES: readonly string[] = ['STAMP_TAX', 'HOUSING_BOND'];

export interface ExtraCost {
  /** 사용자가 붙인 이름 (예: 중개보수) - 화면 글자 */
  readonly label: string;
  readonly amount: Won;
}

export interface LoanAssumption {
  readonly principal: Won;
  /** 연 금리 (만분율 정수, 3.5% = 350). 0 이상 */
  readonly annualRateBp: number;
}

export interface TotalCostInput {
  /** 취득 입력 - 매매(PAID)만 받는다. 상속·증여·신축은 해당 도구로 안내한다(설계 5장 #18) */
  readonly acquisition: AcquisitionInput;
  /** 보유 연수 n (0 이상 정수). 0이면 보유세 0회·이자 0원 */
  readonly holdingYears: number;
  /** 보유 1년차~n년차의 보유세 입력. 길이는 holdingYears와 같다. 공시가격은 사용자 가정(해마다 같은 값이든 직접 입력이든 호출 쪽이 펼친다) */
  readonly holdingByYear: readonly HoldingInput[];
  /** 취득 시점에 드는 부대비용 (중개보수·등기비용 등). 항목 수 상한은 호출 쪽 정책 */
  readonly extraCosts?: readonly ExtraCost[];
  readonly loan?: LoanAssumption;
  /** 보유세 항목 중 합계에 넣을 것 (게이트가 닫힌 세목 제외). 없으면 모두 */
  readonly includeHoldingItem?: (code: string) => boolean;
  /** 취득세 항목 중 합계에 넣을 것. 없으면 참고 표시 항목을 뺀 모두 */
  readonly includeAcquisitionItem?: (code: string) => boolean;
}

export type CostLineKind = 'tax' | 'assumption';
export interface CostLine {
  /** 0 = 취득 시점, 1~n = 보유 n년차 */
  readonly year: number;
  readonly kind: CostLineKind;
  readonly code: string;
  readonly label: string;
  readonly amount: Won;
  /** 세목 줄의 근거 조문 (가정 줄은 빈 글자) */
  readonly law: string;
}

export interface CostYear {
  readonly year: number;
  readonly acquisitionTax: Won;
  readonly holdingTax: Won;
  readonly extra: Won;
  readonly interest: Won;
  readonly subtotal: Won;
}

export interface TotalCostResult {
  /** 룰셋 버전 각인 - 취득·보유 모든 계산이 같은 룰셋이었다 */
  readonly rulesVersion: string;
  readonly engineVersion: string;
  readonly years: readonly CostYear[];
  readonly lines: readonly CostLine[];
  /** 해별 소계의 합 = 줄 금액의 합 = 결과 먼저 총액 */
  readonly total: Won;
  readonly holdingYears: number;
  readonly warnings: readonly string[];
}

const intOrThrow = (v: number, label: string): number => {
  if (!Number.isSafeInteger(v) || v < 0) throw new Error(`${label}은(는) 0 이상의 정수여야 합니다`);
  return v;
};

/** 연 이자 = 원금 x 만분율 금리 / 10000, 원 미만 버림. BigInt로 곱해 큰 원금에서도 정수가 어긋나지 않는다 */
export function annualInterest(principal: Won, annualRateBp: number): Won {
  intOrThrow(assertWon(principal, 'loan.principal'), 'loan.principal');
  intOrThrow(annualRateBp, 'loan.annualRateBp');
  const v = (BigInt(principal) * BigInt(annualRateBp)) / 10000n;
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('이자 금액이 너무 큽니다');
  return Number(v);
}

export function composeTotalCost(input: TotalCostInput, ruleset: Ruleset): TotalCostResult {
  if (input.acquisition.cause !== 'PAID') throw new Error('총비용은 매매(유상취득)만 받습니다');
  const n = intOrThrow(input.holdingYears, 'holdingYears');
  if (input.holdingByYear.length !== n) throw new Error('보유 연수와 연도별 보유세 입력의 개수가 다릅니다');
  const extras = input.extraCosts ?? [];
  for (const [i, e] of extras.entries()) intOrThrow(assertWon(e.amount, `extraCosts[${i}].amount`), `extraCosts[${i}].amount`);
  if (input.loan) {
    intOrThrow(assertWon(input.loan.principal, 'loan.principal'), 'loan.principal');
    intOrThrow(input.loan.annualRateBp, 'loan.annualRateBp');
  }

  const acq = calcAcquisition(input.acquisition, ruleset);
  const useAcq = input.includeAcquisitionItem ?? ((c: string) => !TOTAL_COST_REFERENCE_CODES.includes(c));
  const useHold = input.includeHoldingItem ?? (() => true);
  const lines: CostLine[] = [];
  const warnings = new Set<string>(acq.warnings);
  const years: CostYear[] = [];

  let acqTax = 0;
  for (const it of acq.items) {
    if (!useAcq(it.code)) continue;
    lines.push({ year: 0, kind: 'tax', code: it.code, label: it.label, amount: it.amount, law: it.law });
    acqTax += it.amount;
  }
  let extraSum = 0;
  for (const e of extras) {
    lines.push({ year: 0, kind: 'assumption', code: 'EXTRA_COST', label: e.label, amount: e.amount, law: '' });
    extraSum += e.amount;
  }
  years.push({ year: 0, acquisitionTax: acqTax, holdingTax: 0, extra: extraSum, interest: 0, subtotal: acqTax + extraSum });

  const yearlyInterest = input.loan ? annualInterest(input.loan.principal, input.loan.annualRateBp) : 0;
  for (let y = 1; y <= n; y += 1) {
    const hold = calcHolding(input.holdingByYear[y - 1]!, ruleset);
    if (hold.rulesVersion !== acq.rulesVersion) throw new Error('취득과 보유 계산의 룰셋 버전이 다릅니다');
    hold.warnings.forEach((w) => warnings.add(w));
    let holdTax = 0;
    for (const it of hold.items) {
      if (!useHold(it.code)) continue;
      lines.push({ year: y, kind: 'tax', code: it.code, label: it.label, amount: it.amount, law: it.law });
      holdTax += it.amount;
    }
    if (input.loan) lines.push({ year: y, kind: 'assumption', code: 'LOAN_INTEREST', label: '대출이자', amount: yearlyInterest, law: '' });
    years.push({ year: y, acquisitionTax: 0, holdingTax: holdTax, extra: 0, interest: yearlyInterest, subtotal: holdTax + yearlyInterest });
  }

  const total = years.reduce((s, r) => s + r.subtotal, 0);
  const lineTotal = lines.reduce((s, l) => s + l.amount, 0);
  // 그래프(해별 소계)·표(줄)·총액이 어긋나는 일은 코드 오류다 - 조용히 내보내지 않는다
  if (total !== lineTotal) throw new Error('총비용 합계가 일치하지 않습니다');
  assertWon(total, 'total');
  return Object.freeze({
    rulesVersion: acq.rulesVersion,
    engineVersion: acq.engineVersion,
    years,
    lines,
    total,
    holdingYears: n,
    warnings: [...warnings],
  });
}
