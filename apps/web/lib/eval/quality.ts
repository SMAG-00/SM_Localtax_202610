// 품질 콘솔 - 앱 쪽 순수 규칙 (W12-e e5, PRD-04 QUAL-01~04, docs/dev/W12-e_설계.md). 정본은 DB 함수(quality_check_*) - 여기는 같은 식의 거울과 입력 검사.
export const ALERT_LABEL: Record<string, string> = {
  block_rate: "검증기 차단율 경보 (최근 5분 20% 초과)",
  budget_warn: "예산 80% 도달",
  budget_over: "예산 100% 도달 (비회원 검색 모드)",
  sample_short: "표본 감수 부족 (하루 50건 미만)",
};
export const VERDICTS = ["good", "minor_issue", "wrong"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const VERDICT_LABEL: Record<Verdict, string> = { good: "문제 없음", minor_issue: "사소한 문제", wrong: "틀림·위험" };

/** 차단율 경보 조건 - 표본이 최소 수 이상이고 차단 비율이 20%를 넘을 때(20% 정확히는 아님) */
export function blockRateExceeds(total: number, blocked: number, minSamples = 5): boolean {
  return total >= Math.max(minSamples, 1) && blocked * 100 > total * 20;
}

export type BudgetLevel = "unset" | "ok" | "warn" | "over";
/** 예산 경보 수준 - 예산이 비었거나 0 이하면 unset(경보 0), 80% 이상 warn, 100% 이상 over */
export function budgetAlertLevel(spent: number, monthlyWon: number | null | undefined): BudgetLevel {
  if (typeof monthlyWon !== "number" || !Number.isFinite(monthlyWon) || monthlyWon <= 0) return "unset";
  if (spent * 100 >= monthlyWon * 100) return "over";
  if (spent * 100 >= monthlyWon * 80) return "warn";
  return "ok";
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };
export interface JudgeInput { message_id: number; verdict: Verdict; note: string | null; eval_candidate: boolean }
const PII = /([0-9]{9,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/;

export function parseJudge(body: Record<string, unknown>): Parsed<JudgeInput> {
  const errors: string[] = [];
  const id = Number(body.message_id);
  if (!Number.isInteger(id) || id < 1) errors.push("message_id: 답변 번호가 올바르지 않습니다");
  const verdict = String(body.verdict ?? "");
  if (!(VERDICTS as readonly string[]).includes(verdict)) errors.push(`verdict: ${VERDICTS.join("·")} 중 하나입니다`);
  const note = typeof body.note === "string" && body.note.trim() !== "" ? body.note.trim() : null;
  if (note && note.length > 500) errors.push("note: 500자 이하입니다");
  if (note && PII.test(note)) errors.push("note: 번호(9자리 이상)·이메일은 쓸 수 없습니다");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { message_id: id, verdict: verdict as Verdict, note, eval_candidate: body.eval_candidate === true || body.eval_candidate === "true" } };
}

export const QUALITY_OPS = ["judge", "ack", "run_daily", "run_set"] as const;
export type QualityOp = (typeof QUALITY_OPS)[number];
