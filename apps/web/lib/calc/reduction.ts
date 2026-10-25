import { evaluateDeterminationTable, type DeterminationTable, type Facts, type ReductionResult } from "@ltr/tax-engine";

// 감면 점검 블록 (CALC-13) - 서명된 감면 판정표를 돌린 결과를 화면 모양으로 옮긴다. 요건·한도는 판정표 데이터에만 있고 여기에는 없다.
//  · 판정표가 없거나(서명 전) 감면 판정표가 아니면 hidden - 감면 카드를 숨긴다.
//  · 적용 시 금액은 엔진이 다시 계산해야 한다 - 엔진에 감면 계산 모듈이 생기기 전에는 금액 칸을 비워 둔다(화면 쪽 계산 0).
export type ReductionBlock =
  | { state: "hidden" }
  | { state: "found"; count: number; items: ReductionResult[]; tableVersion: string; checked: string[] }
  | { state: "none"; tableVersion: string; checked: string[] };

export function reductionBlock(table: DeterminationTable | null, facts: Facts): ReductionBlock {
  if (!table || table.kind !== "reduction") return { state: "hidden" };
  const out = evaluateDeterminationTable(table, facts);
  if (out.kind !== "reduction") return { state: "hidden" };
  const checked = out.results.map((r) => r.label);
  const items = out.results.filter((r) => r.verdict === "해당될 수 있음");
  return items.length > 0 ? { state: "found", count: items.length, items, tableVersion: out.tableVersion, checked } : { state: "none", tableVersion: out.tableVersion, checked };
}
