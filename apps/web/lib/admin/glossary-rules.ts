// 쉬운 말 사전 — 용어사전(glossary_terms) 입력 규칙 (UX-01 ①, PRD-01A 6.1). 순수 모듈 — 서버 API와 사전 화면이 같이 쓴다.
//  · 쉬운 풀이(plain)는 60자 이하 — DB check(char_length, 공백 포함)와 같은 셈법
//  · 전문 용어(jargon)로 표시한 용어는 쉬운 풀이가 있어야 한다 — 발행 판정의 '풀이 없는 전문 용어 첫 등장' 경고가 이 사전을 쓴다
//    (풀이 없는 전문 용어는 판정에서 빠지므로 사전에 넣어도 효과가 없다)
import { SECTIONS } from "@ltr/editorial";
import { blank, splitList, type FieldErrors } from "./form-utils";

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };
type Obj = Record<string, unknown>;

export const GLOSSARY_LIMITS = { term: 100, reading: 100, definition: 1000, plain: 60, source: 300, related: 20, relatedItem: 100 } as const;
const TEXT_FIELDS = ["term", "reading", "definition", "plain", "source"] as const;
const FIELDS = new Set<string>([...TEXT_FIELDS, "jargon", "related", "section"]);
const chars = (s: string) => [...s].length;
const PLAIN_MISSING = "전문 용어로 표시하면 쉬운 풀이를 적어야 합니다 — 풀이 없는 첫 등장 검사에 씁니다";

export function parseGlossaryInput(raw: Obj, mode: "create" | "patch"): Result<Obj> {
  const errors: string[] = [];
  const out: Obj = {};
  for (const key of Object.keys(raw)) if (!FIELDS.has(key)) errors.push(`glossary.${key}: 모르는 칸입니다`);
  for (const key of TEXT_FIELDS) {
    const v = raw[key];
    const at = `glossary.${key}`;
    if (v === undefined) {
      if (key === "term" && mode === "create") errors.push(`${at}: 필요합니다`);
      continue;
    }
    if (v === null || (typeof v === "string" && v.trim() === "")) {
      if (key === "term") errors.push(`${at}: 비울 수 없습니다`);
      else out[key] = null;
      continue;
    }
    if (typeof v !== "string") {
      errors.push(`${at}: 글자여야 합니다`);
      continue;
    }
    const text = v.trim();
    if (key === "plain" && chars(text) > GLOSSARY_LIMITS.plain) errors.push(`${at}: 쉬운 풀이는 ${GLOSSARY_LIMITS.plain}자 이하여야 합니다 (지금 ${chars(text)}자)`);
    else if (chars(text) > GLOSSARY_LIMITS[key]) errors.push(`${at}: ${GLOSSARY_LIMITS[key]}자 이하여야 합니다`);
    else out[key] = text;
  }
  if (raw.jargon !== undefined) {
    if (typeof raw.jargon !== "boolean") errors.push("glossary.jargon: true/false여야 합니다");
    else out.jargon = raw.jargon;
  }
  if (raw.related !== undefined) {
    const r = raw.related;
    if (!Array.isArray(r) || r.length > GLOSSARY_LIMITS.related || !r.every((x) => typeof x === "string" && x.trim() !== "" && chars(x) <= GLOSSARY_LIMITS.relatedItem)) {
      errors.push(`glossary.related: ${GLOSSARY_LIMITS.relatedItem}자 이하 글자 ${GLOSSARY_LIMITS.related}개 이하 목록이어야 합니다`);
    } else out.related = [...new Set((r as string[]).map((x) => x.trim()))];
  }
  if (raw.section !== undefined) {
    const s = raw.section;
    if (!Array.isArray(s) || !s.every((x) => typeof x === "string" && (SECTIONS as readonly string[]).includes(x))) {
      errors.push(`glossary.section: ${SECTIONS.join("·")} 중에서 고른 목록이어야 합니다`);
    } else out.section = [...new Set(s as string[])];
  }
  if (mode === "patch" && errors.length === 0 && Object.keys(out).length === 0) errors.push("glossary: 바꿀 칸이 없습니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

/** 저장할 행 전체(기존 + 바꿀 칸)의 규칙 — 어기면 사유 */
export function glossaryConsistency(row: { jargon?: unknown; plain?: unknown }): string | null {
  const plain = typeof row.plain === "string" ? row.plain.trim() : "";
  return row.jargon === true && plain === "" ? PLAIN_MISSING : null;
}

export interface GlossaryForm {
  term: string;
  reading: string;
  definition: string;
  plain: string;
  jargon: boolean;
  relatedText: string;
  sections: string[];
  source: string;
}

const orNull = (s: string) => (blank(s) ? null : s.trim());

export function glossaryFormToBody(form: GlossaryForm, base = "glossary"): { ok: true; body: Obj } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (blank(form.term)) errors[`${base}-term`] = "용어를 적어 주세요";
  const plain = form.plain.trim();
  if (chars(plain) > GLOSSARY_LIMITS.plain) errors[`${base}-plain`] = `쉬운 풀이는 ${GLOSSARY_LIMITS.plain}자 이하로 씁니다 (지금 ${chars(plain)}자)`;
  else if (form.jargon && plain === "") errors[`${base}-plain`] = PLAIN_MISSING;
  const related = splitList(form.relatedText);
  if (related.length > GLOSSARY_LIMITS.related) errors[`${base}-related`] = `관련 용어는 ${GLOSSARY_LIMITS.related}개까지 씁니다`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    body: {
      term: form.term.trim(),
      reading: orNull(form.reading),
      definition: orNull(form.definition),
      plain: orNull(form.plain),
      jargon: form.jargon,
      related,
      section: form.sections,
      source: orNull(form.source),
    },
  };
}
