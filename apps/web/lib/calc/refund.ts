import { evaluateDeterminationTable, type DeterminationOutcome, type DeterminationTable, type Facts } from "@ltr/tax-engine";
import { isAnswerValid, type Question } from "./shared";

// 환급 자가진단 (CALC-04) - 문진표는 서명된 판정표가 스스로 가진다(questions). 질문 목록·문장·판정 규칙이 모두 감수 입력이고, 이 모듈에는 환급 요건이 없다.
export type RefundForm = Record<string, string | number | boolean | undefined>;

/** 판정표의 문진 항목 -> 질문 목록. 모두 "모르겠어요"가 있다(모르면 그 입력 없이 판정 - 맞는 규칙이 없으면 표의 기본값) */
export function refundQuestions(table: DeterminationTable): Question<RefundForm>[] {
  return (table.questions ?? []).map((q) => ({
    id: q.field,
    text: q.text,
    kind: q.kind,
    required: false,
    canDontKnow: true,
    help: q.help ?? null,
    applies: () => true,
  }));
}

/** 유효한 답만 판정표 입력으로 넘긴다 - 모르겠어요·건너뛴 질문은 빠져 "맞는 규칙 없음" 쪽으로 간다 */
export function refundFacts(questions: readonly Question<RefundForm>[], form: RefundForm): Facts {
  const facts: Record<string, string | number | boolean> = {};
  for (const q of questions) {
    const v = form[q.id];
    if (v !== undefined && isAnswerValid(q, v)) facts[q.id] = v;
  }
  return facts;
}

export function diagnoseRefund(table: DeterminationTable, form: RefundForm): DeterminationOutcome {
  return evaluateDeterminationTable(table, refundFacts(refundQuestions(table), form));
}

/** 요약 한 줄에 쓰는 개수 - 가능성이 높음/확인 필요인 항목 수 */
export function refundSummary(outcome: DeterminationOutcome): { high: number; check: number } {
  if (outcome.kind !== "refund") return { high: 0, check: 0 };
  return { high: outcome.results.filter((r) => r.likelihood === "높음").length, check: outcome.results.filter((r) => r.likelihood === "확인 필요").length };
}
