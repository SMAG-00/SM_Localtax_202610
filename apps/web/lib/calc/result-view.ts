import type { CalcResult, TaxItem } from "@ltr/tax-engine";

// 결과 먼저 (CALC-12) - 엔진 결과를 6블록 화면 모양으로 옮긴다. 이 모듈에는 계산이 없다: 합계는 보여 줄 명세 행 금액의 합이고, 모든 금액은 엔진이 낸 값이다.

/** 블록 순서 - DOM과 화면이 이 순서를 따른다 */
export const RESULT_BLOCKS = ["total", "deadline", "breakdown", "reduction", "basis", "next"] as const;
export type ResultBlock = (typeof RESULT_BLOCKS)[number];

/** 참고 표시 항목(합계에 넣지 않는다) - 인지세·국민주택채권 실부담액 (CALC-01) */
export const REFERENCE_CODES: ReadonlySet<string> = new Set(["STAMP_TAX", "HOUSING_BOND"]);

export function formatWon(n: number): string {
  return `${String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}원`;
}

export interface BreakdownRow {
  code: string;
  label: string;
  base: number;
  rate: number | null;
  amount: number;
  law: string;
  reasons: string[];
}

export interface ResultView {
  rulesVersion: string;
  engineVersion: string;
  /** 명세 행 금액의 합 = 총액 */
  total: number;
  totalText: string;
  zero: boolean;
  /** 총액이 0일 때 이유 한 줄 (엔진이 낸 판정 근거 첫 줄) */
  zeroReason: string | null;
  /** 기한 - 엔진 결과에 신고 기한이 있을 때만. 없으면 null (화면은 값을 지어내지 않는다) */
  deadline: { dueDate: string; note: string } | null;
  rows: BreakdownRow[];
  reference: BreakdownRow[];
  /** 근거 조문 칩 (중복 없음) */
  basis: string[];
  warnings: string[];
}

const toRow = (i: TaxItem): BreakdownRow => ({ code: i.code, label: i.label, base: i.base, rate: i.rate, amount: i.amount, law: i.law, reasons: [...i.reasons] });

/** items를 주면 그 항목만 쓴다(공개되지 않은 세목 항목을 뺀 경우) */
export function buildResultView(result: CalcResult, items: readonly TaxItem[] = result.items): ResultView {
  const rows = items.filter((i) => !REFERENCE_CODES.has(i.code)).map(toRow);
  const reference = items.filter((i) => REFERENCE_CODES.has(i.code)).map(toRow);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const basis = [...new Set([...rows, ...reference].map((r) => r.law).filter((l) => l.trim() !== ""))];
  return {
    rulesVersion: result.rulesVersion,
    engineVersion: result.engineVersion,
    total,
    totalText: formatWon(total),
    zero: total === 0,
    zeroReason: total === 0 ? (rows.find((r) => r.reasons.length > 0)?.reasons[0] ?? result.warnings[0] ?? null) : null,
    deadline: result.filing ? { dueDate: result.filing.dueDate, note: result.filing.dueNote } : null,
    rows,
    reference,
    basis,
    warnings: [...result.warnings],
  };
}
