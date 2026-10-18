// 검색 동의어 사전(search_synonyms) 규칙 (W2-d 설계 5장 · 2.3 synonym_limits · 2.4) — 순수 모듈. 동의어 사전 API와 /admin/dictionaries 화면이 같이 쓴다.
//  · 검색어의 낱말 하나가 '낱말'(정규형)과 같으면 동의어도 함께 찾는다 — 한쪽 방향. 낱말·동의어의 정규형은 검색과 같은 규칙(squash)
//  · 낱말 1~50자 · 동의어 1~10개 · 하나마다 50자 · 글자나 숫자가 있어야(기호만 0) · 띄어쓰기·기호만 다른 같은 말 한 번만 · 낱말 자신은 동의어 0
//  · 메모는 편집국만 본다(공개 칸 아님 — anon은 사용 중 줄의 열쇠 칸만 읽는다)
import { squash } from "@/lib/server/public/search-normalize";
import { splitList, type FieldErrors } from "./form-utils";

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };
type Obj = Record<string, unknown>;

/** 한도 — 낱말 글자·동의어 개수·동의어 글자(설계 2.3, DB 제약과 같다)·메모 글자(설계 2.4 — 화면만) */
export const SYNONYM_LIMITS = { termChars: 50, count: 10, synonymChars: 50, noteChars: 200 } as const;

export interface SynonymInput {
  term?: string;
  synonyms?: string[];
  enabled?: boolean;
  note?: string | null;
}

const FIELDS = new Set(["term", "synonyms", "enabled", "note"]);
const chars = (s: string) => [...s].length;

/** 정규형 열쇠 미리보기 — DB term_key(생성 칸)와 같은 규칙. 화면이 '이렇게 찾습니다'로 보인다 */
export const termKeyPreview = (term: string): string => squash(term);

const TERM_REQUIRED = "낱말이 필요합니다";
const TERM_EMPTY_KEY = "글자나 숫자가 있어야 합니다 — 기호만 있는 낱말은 찾을 수 없습니다";
const SYN_REQUIRED = "동의어를 1개 이상 적으세요";

function termProblem(term: string): string | null {
  if (term === "") return TERM_REQUIRED;
  if (chars(term) > SYNONYM_LIMITS.termChars) return `${SYNONYM_LIMITS.termChars}자 이하로 줄이세요`;
  if (squash(term) === "") return TERM_EMPTY_KEY;
  return null;
}

const selfMessage = (s: string) => `낱말 자신은 동의어로 넣지 않습니다 — ‘${s}’`;

/** 동의어 목록(앞뒤 공백을 지운 것)의 첫 문제 — 낱말을 알면 낱말 자신도 본다 */
function synonymsProblem(list: readonly string[], term: string | null): string | null {
  if (list.length === 0) return SYN_REQUIRED;
  if (list.length > SYNONYM_LIMITS.count) return `동의어는 ${SYNONYM_LIMITS.count}개까지입니다 — 지금 ${list.length}개`;
  const own = term === null ? null : squash(term);
  const keys = new Set<string>();
  for (const s of list) {
    if (s === "") return "빈 동의어가 있습니다";
    if (chars(s) > SYNONYM_LIMITS.synonymChars) return `동의어마다 ${SYNONYM_LIMITS.synonymChars}자 이하로 줄이세요 — ‘${s}’`;
    const key = squash(s);
    if (key === "") return `글자나 숫자가 없는 동의어는 찾을 수 없습니다 — ‘${s}’`;
    if (keys.has(key)) return `같은 동의어가 두 번 있습니다(띄어쓰기·기호만 다른 것 포함) — ‘${s}’`;
    if (own !== null && key === own) return selfMessage(s);
    keys.add(key);
  }
  return null;
}

/** 요청 본문 → 저장 값. 만들기는 낱말·동의어 필수(사용 여부 기본 켜짐), 고치기는 보낸 칸만 */
export function parseSynonymInput(raw: Obj, mode: "create" | "patch"): Result<SynonymInput> {
  const errors: string[] = [];
  const out: SynonymInput = {};
  for (const key of Object.keys(raw)) if (!FIELDS.has(key)) errors.push(`synonym.${key}: 모르는 칸입니다`);

  let term: string | null = null;
  if (raw.term !== undefined || mode === "create") {
    if (raw.term !== undefined && typeof raw.term !== "string") errors.push("synonym.term: 글자여야 합니다");
    else {
      term = typeof raw.term === "string" ? raw.term.trim() : "";
      const problem = termProblem(term);
      if (problem) errors.push(`synonym.term: ${problem}`);
      else out.term = term;
    }
  }
  if (raw.synonyms !== undefined || mode === "create") {
    const v = raw.synonyms;
    if (v === undefined) errors.push(`synonym.synonyms: ${SYN_REQUIRED}`);
    else if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) errors.push("synonym.synonyms: 글자 목록이어야 합니다");
    else {
      const list = (v as string[]).map((x) => x.trim());
      const problem = synonymsProblem(list, out.term ?? null);
      if (problem) errors.push(`synonym.synonyms: ${problem}`);
      else out.synonyms = list;
    }
  }
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
    else errors.push("synonym.enabled: 참/거짓이어야 합니다");
  } else if (mode === "create") out.enabled = true;
  if (raw.note !== undefined) {
    if (raw.note !== null && typeof raw.note !== "string") errors.push("synonym.note: 글자여야 합니다");
    else {
      const note = typeof raw.note === "string" ? raw.note.trim() : "";
      if (chars(note) > SYNONYM_LIMITS.noteChars) errors.push(`synonym.note: ${SYNONYM_LIMITS.noteChars}자 이하로 줄이세요`);
      else out.note = note === "" ? null : note;
    }
  } else if (mode === "create") out.note = null;
  if (mode === "patch" && errors.length === 0 && Object.keys(out).length === 0) errors.push("synonym: 바꿀 칸이 없습니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

/** 고친 뒤의 줄 전체(기존 + 바꿀 칸)의 규칙 — 낱말만 바꿔 동의어와 같아지면 사유 */
export function synonymConsistency(row: { term: string; synonyms: readonly string[] }): string | null {
  const own = squash(row.term);
  const same = row.synonyms.find((s) => squash(s) === own);
  return same === undefined ? null : selfMessage(same);
}

// ── 화면 폼 ───────────────────────────────────────────────

export interface SynonymForm {
  term: string;
  /** 동의어 — 쉼표나 줄바꿈으로 나눈다 */
  synonymsText: string;
  enabled: boolean;
  note: string;
}

export const emptySynonymForm = (): SynonymForm => ({ term: "", synonymsText: "", enabled: true, note: "" });

export function synonymToForm(row: { term: string; synonyms: readonly string[]; enabled: boolean; note: string | null }): SynonymForm {
  return { term: row.term, synonymsText: row.synonyms.join(", "), enabled: row.enabled, note: row.note ?? "" };
}

/** 폼 → 요청 본문. 칸 오류의 키는 `${base}-term` · `${base}-synonyms` · `${base}-note` */
export function synonymFormToBody(form: SynonymForm, base: string): { ok: true; body: Required<SynonymInput> } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const term = form.term.trim();
  const termError = termProblem(term);
  if (termError) errors[`${base}-term`] = termError;
  const synonyms = splitList(form.synonymsText);
  const synError = synonymsProblem(synonyms, termError ? null : term);
  if (synError) errors[`${base}-synonyms`] = synError;
  const note = form.note.trim();
  if (chars(note) > SYNONYM_LIMITS.noteChars) errors[`${base}-note`] = `${SYNONYM_LIMITS.noteChars}자 이하로 줄이세요`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, body: { term, synonyms, enabled: form.enabled, note: note === "" ? null : note } };
}
