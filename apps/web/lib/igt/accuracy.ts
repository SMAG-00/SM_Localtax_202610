import { calcGift, calcInheritance, type IgtRuleset } from "@ltr/igt-engine";
import type { IgtKind } from "./gate";

// 상속·증여세 공식 결과 대조 계산 (FAM-12) - 순수 함수. 사례 하나의 엔진 합계는 자진납부세액(final_tax, 원)이다.
// 하나라도 엔진이 거부하면 실행을 기록하지 않는다(부분 실행으로 게이트가 열리지 않음).

export interface IgtCaseRow {
  id: number;
  tax_kind: string;
  case_input: unknown;
  official_total: number;
}

export function igtTotalFor(kind: IgtKind, caseInput: unknown, ruleset: IgtRuleset): number {
  if (caseInput === null || typeof caseInput !== "object" || Array.isArray(caseInput)) throw new Error("사례 입력이 객체가 아닙니다");
  try {
    return (kind === "gift" ? calcGift(caseInput as Record<string, unknown>, ruleset) : calcInheritance(caseInput as Record<string, unknown>, ruleset)).final_tax;
  } catch (err) {
    throw new Error(err instanceof Error ? err.message.slice(0, 200) : "엔진 오류");
  }
}

export function computeIgtRun(cases: readonly IgtCaseRow[], ruleset: IgtRuleset) {
  const results: { case_id: number; engine_total: number }[] = [];
  const errors: { case_id: number; message: string }[] = [];
  for (const c of cases) {
    try {
      if (c.tax_kind !== "gift" && c.tax_kind !== "inheritance") throw new Error("증여·상속 사례가 아닙니다");
      results.push({ case_id: c.id, engine_total: igtTotalFor(c.tax_kind, c.case_input, ruleset) });
    } catch (err) {
      errors.push({ case_id: c.id, message: err instanceof Error ? err.message : "오류" });
    }
  }
  return { results, errors };
}
