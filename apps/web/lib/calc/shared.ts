// 질문형 입력 공용 틀 (CALC-11) - 질문 흐름은 데이터다. 질문형 화면과 [한 화면에 모두 입력] 폼이 같은 질문 목록·같은 변환 함수를 쓴다.
// 이 모듈은 순수 함수만 둔다(네트워크·저장소·시계 0). 세율·기한·요건 값은 어디에도 없다.

/** 질문 문장 길이 상한 - PRD-00 8.2 R8 */
export const QUESTION_TEXT_MAX = 60;

export type QuestionKind = "choice" | "yesno" | "won" | "wonlist" | "count" | "area" | "date";
export type Option = { value: string; label: string };

export interface Question<F> {
  /** 폼 칸 이름과 같다 */
  id: keyof F & string;
  text: string;
  kind: QuestionKind;
  options?: readonly Option[];
  /** 필수 질문은 "모르겠어요"가 없다 */
  required: boolean;
  canDontKnow: boolean;
  /** 확인 방법 도움말 - 감수 입력 칸. 비어 있으면 null (AI가 쓰지 않는다) */
  help: string | null;
  applies: (form: F) => boolean;
}

/** "모르겠어요"의 기본 가정 - 목록은 감수 입력이다(PO 결정 #8). 목록이 비어 있으면 가정 없이 엔진의 기본 처리(경고 포함)를 쓴다 */
export type AssumptionValue = string | number | boolean;
export type Assumption = { value: AssumptionValue; note: string };
export type Assumptions = Readonly<Record<string, Assumption | undefined>>;

export interface AppliedAssumption {
  id: string;
  text: string;
  /** 가정 내용(감수 입력). 가정 목록에 없으면 null - 화면은 "가정 없음"만 보인다 */
  note: string | null;
  value: AssumptionValue | null;
}

const MAX_LIST = 20;
const isPositiveInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** 달력에 있는 날짜인가 (2월 30일·13월 거부) */
function isRealDate(v: string): boolean {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

/** 답이 질문 종류에 맞는가 */
export function isAnswerValid<F>(q: Question<F>, v: unknown): boolean {
  switch (q.kind) {
    case "choice":
      return typeof v === "string" && (q.options ?? []).some((o) => o.value === v);
    case "yesno":
      return typeof v === "boolean";
    case "won":
      return isPositiveInt(v);
    case "wonlist":
      return Array.isArray(v) && v.length >= 1 && v.length <= MAX_LIST && v.every(isPositiveInt);
    case "count":
      return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 999;
    case "area":
      return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1_000_000;
    case "date":
      return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && isRealDate(v);
  }
}

export const applicable = <F>(qs: readonly Question<F>[], form: F): Question<F>[] => qs.filter((q) => q.applies(form));

type Rec = Record<string, unknown>;

/** 이미 처리한 질문인가 - 값이 있거나, "모르겠어요"를 골랐거나, 건너뛰었다 */
function resolved<F>(q: Question<F>, form: F, unknown: ReadonlySet<string>, skipped: ReadonlySet<string>): boolean {
  return isAnswerValid(q, (form as Rec)[q.id]) || unknown.has(q.id) || skipped.has(q.id);
}

/** 지금 물어볼 질문 - 필요한 질문 중 처음 처리 안 된 것. 없으면 null(결과로) */
export function pendingQuestion<F>(qs: readonly Question<F>[], form: F, unknown: ReadonlySet<string>, skipped: ReadonlySet<string>): Question<F> | null {
  return applicable(qs, form).find((q) => !resolved(q, form, unknown, skipped)) ?? null;
}

/** 진행 막대 n/N - 지금 질문이 몇 번째인가 / 필요한 질문이 모두 몇 개인가 (필요 없는 질문은 세지 않는다) */
export function flowProgress<F>(qs: readonly Question<F>[], form: F, unknown: ReadonlySet<string>, skipped: ReadonlySet<string>): { n: number; total: number } {
  const list = applicable(qs, form);
  const done = list.filter((q) => resolved(q, form, unknown, skipped)).length;
  return { n: Math.min(done + 1, list.length), total: list.length };
}

/** 가정 값이 질문 종류에 맞는가 - 틀린 모양의 가정은 쓰지 않는다 */
export function assumptionFits<F>(q: Question<F>, a: Assumption | undefined): a is Assumption {
  if (!a || typeof a.note !== "string" || a.note.trim() === "") return false;
  if (q.kind === "wonlist") return false;
  return isAnswerValid(q, a.value);
}

/**
 * "모르겠어요"를 고른 질문 처리 - 필요한 질문 중 canDontKnow인 것만 인정한다. 가정 목록에 맞는 항목이 있으면 그 값을 쓰고(칩에 내용 표시),
 * 없으면 칸을 비워 엔진의 기본 처리를 따른다(칩에 "가정 없음"). 값이 이미 있는 질문은 건드리지 않는다.
 */
export function resolveUnknowns<F>(qs: readonly Question<F>[], form: F, unknown: ReadonlySet<string>, assumptions: Assumptions): { assumed: AppliedAssumption[]; patch: Rec } {
  const assumed: AppliedAssumption[] = [];
  const patch: Rec = {};
  for (const q of applicable(qs, form)) {
    if (!q.canDontKnow || !unknown.has(q.id) || isAnswerValid(q, (form as Rec)[q.id])) continue;
    const a = assumptions[q.id];
    if (assumptionFits(q, a)) {
      patch[q.id] = a.value;
      assumed.push({ id: q.id, text: q.text, note: a.note, value: a.value });
    } else {
      assumed.push({ id: q.id, text: q.text, note: null, value: null });
    }
  }
  return { assumed, patch };
}
