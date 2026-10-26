// 2인 블라인드 채점 규칙 - 앱 쪽 순수 모듈 (PRD-04 EVAL-02, docs/dev/W12-e_설계.md). 정본은 DB(eval_grades 가드 · eval_answer_final 뷰).
// 블라인드: 채점자에게는 다른 채점자의 판정·모델 이름·AI 1차 선별을 보내지 않는다 (blindAnswer가 허용 칸만 골라 낸다).

export const FATAL_ERRORS = ["taxability_reversed", "deadline_wrong", "requirement_reversed", "nonexistent_citation"] as const;
export type FatalError = (typeof FATAL_ERRORS)[number];
export const FATAL_LABEL: Record<FatalError, string> = {
  taxability_reversed: "과세·비과세 반대 안내",
  deadline_wrong: "신고·불복 기한 오류",
  requirement_reversed: "요건 반대 안내",
  nonexistent_citation: "존재하지 않는 근거 인용",
};

export interface GradeFields {
  verdict: "correct" | "incorrect";
  fatal_error: FatalError | null;
  citations_supported: number;
  clarify_missed: boolean;
  invented_answer: boolean;
  benefit_asserted: boolean;
}
export interface GradeRow extends GradeFields {
  slot: "first" | "second" | "third";
  grader: string;
}

/** 두 채점이 같은가 - 판정·치명 오류·인용 뒷받침 수·역질문 누락·지어낸 답·감면 단정이 모두 같을 때 */
export function gradesAgree(a: GradeFields, b: GradeFields): boolean {
  return a.verdict === b.verdict && a.fatal_error === b.fatal_error && a.citations_supported === b.citations_supported && a.clarify_missed === b.clarify_missed && a.invented_answer === b.invented_answer && a.benefit_asserted === b.benefit_asserted;
}

export type FinalStatus = "ungraded" | "one_grade" | "confirmed" | "disputed" | "confirmed_third";

/** DB 뷰 eval_answer_final의 거울 - disputed는 '미확정'(집계에서 뺌) */
export function finalStatus(grades: readonly GradeRow[]): { status: FinalStatus; final: GradeFields | null } {
  const f = grades.find((g) => g.slot === "first");
  const s = grades.find((g) => g.slot === "second");
  const t = grades.find((g) => g.slot === "third");
  if (t) return { status: "confirmed_third", final: t };
  if (f && s) return gradesAgree(f, s) ? { status: "confirmed", final: f } : { status: "disputed", final: null };
  return { status: f || s ? "one_grade" : "ungraded", final: null };
}

export const STATUS_LABEL: Record<FinalStatus, string> = { ungraded: "채점 전", one_grade: "1인 채점", confirmed: "확정", disputed: "미확정 (판정 불일치)", confirmed_third: "확정 (3인째)" };

/** 지금 이 사람이 채점할 자리 - 이미 채점했거나 자리가 다 찼으면 null. 첫째가 없으면 first, 있고 다른 사람이면 second */
export function nextSlotFor(grades: readonly Pick<GradeRow, "slot" | "grader">[], grader: string): "first" | "second" | null {
  if (grades.some((g) => g.grader === grader)) return null;
  const hasFirst = grades.some((g) => g.slot === "first");
  const hasSecond = grades.some((g) => g.slot === "second");
  if (!hasFirst) return "first";
  return hasSecond ? null : "second";
}

/** 3인째로 넘길 수 있는 상태 - 둘이 갈렸고 원문 재확인 기록이 있고 3인째가 아직 없을 때 */
export function canRecordThird(grades: readonly GradeRow[], hasRecheck: boolean): boolean {
  return finalStatus(grades).status === "disputed" && hasRecheck;
}

/** 채점 화면에 보내는 답변 - 모델 이름·AI 선별·다른 채점자 칸을 싣지 않는다 */
export interface BlindAnswer {
  answer_id: number;
  question: string;
  answer_text: string;
  behavior: string;
  cited_ids: string[];
  required_citation_ids: string[];
  expected_conclusion: string | null;
  expected_clarify: string | null;
  forbidden_claims: string[];
  cross_types: string[];
  expected_behavior: string;
}
export function blindAnswer(src: Record<string, unknown>): BlindAnswer {
  return {
    answer_id: Number(src.answer_id),
    question: String(src.question ?? ""),
    answer_text: String(src.answer_text ?? ""),
    behavior: String(src.behavior ?? ""),
    cited_ids: (src.cited_ids as string[]) ?? [],
    required_citation_ids: (src.required_citation_ids as string[]) ?? [],
    expected_conclusion: (src.expected_conclusion as string | null) ?? null,
    expected_clarify: (src.expected_clarify as string | null) ?? null,
    forbidden_claims: (src.forbidden_claims as string[]) ?? [],
    cross_types: (src.cross_types as string[]) ?? [],
    expected_behavior: String(src.expected_behavior ?? ""),
  };
}
