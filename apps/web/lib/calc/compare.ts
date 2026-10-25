import { formatWon, type ResultView } from "./result-view";

// 시나리오 비교 (CALC-05) - 열마다 같은 엔진으로 계산한 결과를 나란히 놓는다. 이 모듈은 열 관리와 차이 행 계산만 한다(계산 0, 저장 0).

export const COMPARE_MIN = 2;
export const COMPARE_MAX = 3;

export type CompareTax = "acquisition" | "property" | "comprehensive";

export interface CompareColumn {
  id: string;
  /** 열 이름 (예: A, B) */
  label: string;
  tax: CompareTax;
  view: ResultView;
  /** 재산세 열 - 과세기준일 소유 여부(납세의무). 취득세 열은 undefined */
  liable?: boolean;
}

export type AddColumnResult = { ok: true } | { ok: false; reason: "max" | "closed" | "member_only" };

/** 열을 더할 수 있나 - 비회원 불가, 3열까지, 공개 게이트를 통과하지 못한 세목은 넣지 못한다 */
export function canAddColumn(count: number, tax: CompareTax, openTaxes: readonly CompareTax[], isMember: boolean): AddColumnResult {
  if (!isMember) return { ok: false, reason: "member_only" };
  if (count >= COMPARE_MAX) return { ok: false, reason: "max" };
  if (!openTaxes.includes(tax)) return { ok: false, reason: "closed" };
  return { ok: true };
}

export interface CompareRow {
  id: string;
  label: string;
  /** 열 순서대로. 그 열에 없는 항목은 null */
  cells: (string | null)[];
  /** 열마다 값이 다르면 true (hermes-100 형광) */
  differs: boolean;
}

/** 나란히 놓을 행 - 세목 항목(처음 나온 순서), 올해 재산세 납세의무, 적용 룰셋 */
export function compareRows(columns: readonly CompareColumn[]): CompareRow[] {
  const rows: CompareRow[] = [];
  const order: { code: string; label: string }[] = [];
  for (const c of columns) for (const r of c.view.rows) if (!order.some((o) => o.code === r.code)) order.push({ code: r.code, label: r.label });
  const make = (id: string, label: string, cells: (string | null)[]): CompareRow => ({ id, label, cells, differs: new Set(cells).size > 1 });
  for (const o of order) {
    rows.push(make(o.code, o.label, columns.map((c) => { const r = c.view.rows.find((x) => x.code === o.code); return r ? formatWon(r.amount) : null; })));
  }
  if (columns.some((c) => c.liable !== undefined)) {
    rows.push(make("liability", "올해 재산세", columns.map((c) => (c.liable === undefined ? null : c.liable ? "납세의무 있음" : "납세의무 없음"))));
  }
  rows.push(make("ruleset", "적용 룰셋", columns.map((c) => c.view.rulesVersion)));
  return rows;
}

/** 모바일 차이 요약 한 줄에 쓰는 행 이름들 */
export const differingLabels = (rows: readonly CompareRow[]): string[] => rows.filter((r) => r.differs).map((r) => r.label);
