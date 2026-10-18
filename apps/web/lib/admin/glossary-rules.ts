// 쉬운 말 사전 — 용어사전(glossary_terms) 입력 규칙 (UX-01 ①, PRD-01A 6.1 · GLO-01, docs/dev/W2-d_설계.md 2.5·2.6). 순수 모듈 — 서버 API와 사전 화면이 같이 쓴다.
//  · 쉬운 풀이(plain)는 120자까지 저장(DB check — 공백 포함 char_length와 같은 셈법). 60자를 넘으면 저장 경고(GLO-01 '61자는 저장 경고' — 저장은 된다)
//  · 쉬운 풀이·뜻에 숫자 + 단위(%·원·㎡ 등 — 설계 2.5 glossary.number_units)가 있으면 저장 경고 (GLO-01 '세율·공제액·요건 숫자는 풀이에 넣지 않는다')
//  · 전문 용어(jargon)로 표시한 용어는 쉬운 풀이가 있어야 한다 — 발행 판정의 '풀이 없는 전문 용어 첫 등장' 경고가 이 사전을 쓴다
//    (풀이 없는 전문 용어는 판정에서 빠지므로 사전에 넣어도 효과가 없다)
//  · 공개 상태(visible) — 새 용어는 숨김(DB 기본값). 공개한 용어만 용어사전·용어 칩·본문 툴팁·검색에 나온다 (W2-d 3단계)
import { SECTIONS } from "@ltr/editorial";
import { blank, splitList, type FieldErrors } from "./form-utils";

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };
type Obj = Record<string, unknown>;

/** 저장 한도 — 넘으면 거부 (쉬운 풀이는 DB check glossary_terms_plain_max와 같다) */
export const GLOSSARY_LIMITS = { term: 100, reading: 100, definition: 1000, plain: 120, source: 300, related: 20, relatedItem: 100 } as const;
/** 저장 경고 기준 — 넘으면 경고만 (GLO-01 쉬운 풀이 60자 이하) */
export const GLOSSARY_GUIDE = { plainChars: 60 } as const;
/** 숫자 바로 뒤(띄어쓰기 허용)에 오면 경고인 단위 — 설계 2.5 glossary.number_units (원은 앞에 십·백·천·만·억·조가 붙어도) */
export const GLOSSARY_NUMBER_UNITS = ["%", "％", "퍼센트", "원", "억", "㎡", "m²", "m2", "제곱미터", "평"] as const;

const TEXT_FIELDS = ["term", "reading", "definition", "plain", "source"] as const;
const FIELDS = new Set<string>([...TEXT_FIELDS, "jargon", "related", "section", "visible"]);
const chars = (s: string) => [...s].length;
const PLAIN_MISSING = "전문 용어로 표시하면 쉬운 풀이를 적어야 합니다 — 풀이 없는 첫 등장 검사에 씁니다";
const plainTooLong = (n: number) => `쉬운 풀이는 ${GLOSSARY_LIMITS.plain}자까지 저장됩니다 (지금 ${n}자)`;

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
    if (key === "plain" && chars(text) > GLOSSARY_LIMITS.plain) errors.push(`${at}: ${plainTooLong(chars(text))}`);
    else if (chars(text) > GLOSSARY_LIMITS[key]) errors.push(`${at}: ${GLOSSARY_LIMITS[key]}자 이하여야 합니다`);
    else out[key] = text;
  }
  for (const key of ["jargon", "visible"] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "boolean") errors.push(`glossary.${key}: true/false여야 합니다`);
    else out[key] = raw[key];
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

// ── 저장 경고 (GLO-01) ───────────────────────────────────

const DIGIT = "[0-9０-９]";
const NUM = `${DIGIT}(?:[0-9０-９,.]*${DIGIT})?`;
const RANGE = `(?:\\s*[~∼～\\-–]\\s*${NUM})?`;
const HANGUL = "[가-힣]";
/** 한글이 바로 붙으면 낱말의 일부('원칙'·'원문'·'평가')로 본다 — 조사·꼬리말('원을'·'원짜리'·'억이'·'평형')만 단위로 친다 */
const notWordAfter = (allowed: string) => `(?!(?!${allowed})${HANGUL})`;
const AFTER_WON = "[을은이의에으까부씩만도과와대짜가를정미초내안어쯤]";
const AFTER_EOK = "[을은이의에으까부씩만도과와대짜가를정미초내안원쯤]";
const AFTER_PYEONG = "[을은이의에으까부씩만도과와대짜를정미초내안형쯤]";
const UNIT = [
  "%",
  "％",
  "퍼센트",
  `(?:[십백천만억조]+\\s*)?원${notWordAfter(AFTER_WON)}`,
  `억${notWordAfter(AFTER_EOK)}`,
  "㎡",
  "m²(?![0-9])",
  "m2(?![0-9])",
  "제곱미터",
  `평${notWordAfter(AFTER_PYEONG)}`,
].join("|");
const NUMBER_UNIT = new RegExp(`(?<![0-9０-９A-Za-z.,])${NUM}${RANGE}\\s*(?:${UNIT})`, "gu");

/** 글 안의 숫자 + 단위 — 나온 차례대로, 같은 글은 한 번 (설계 2.6 견본) */
export function numberUnitHits(text: string | null | undefined): string[] {
  if (typeof text !== "string" || text.trim() === "") return [];
  return [...new Set([...text.matchAll(NUMBER_UNIT)].map((m) => m[0].trim()))];
}

export type GlossaryWarningId = "glo01.plain-long" | "glo01.number-unit";
export interface GlossaryWarning {
  id: GlossaryWarningId;
  field: "plain" | "definition";
  message: string;
}

const FIELD_NAMES = { plain: "쉬운 풀이에", definition: "뜻에" } as const;
const SHOWN_HITS = 3;

/** 저장 경고 — 저장은 되고, 편집 화면(입력 중·저장 뒤)과 API 응답(warnings)이 같은 문장을 보인다 */
export function glossaryWarnings(row: { plain?: string | null; definition?: string | null }): GlossaryWarning[] {
  const out: GlossaryWarning[] = [];
  const plain = typeof row.plain === "string" ? row.plain.trim() : "";
  const n = chars(plain);
  if (n > GLOSSARY_GUIDE.plainChars) {
    out.push({ id: "glo01.plain-long", field: "plain", message: `쉬운 풀이가 ${n}자입니다 (기준 ${GLOSSARY_GUIDE.plainChars}자 이하) — 한 줄로 줄여 주세요` });
  }
  for (const field of ["plain", "definition"] as const) {
    const hits = numberUnitHits(row[field]);
    if (hits.length === 0) continue;
    const shown = hits.slice(0, SHOWN_HITS).map((h) => `‘${h}’`).join(" · ");
    const more = hits.length > SHOWN_HITS ? ` 외 ${hits.length - SHOWN_HITS}개` : "";
    out.push({
      id: "glo01.number-unit",
      field,
      message: `${FIELD_NAMES[field]} 숫자와 단위가 있습니다 (${shown}${more}) — 세율·공제액·요건 숫자는 바뀔 수 있어 풀이에 넣지 않습니다`,
    });
  }
  return out;
}

// ── 사전 화면 폼 ─────────────────────────────────────────

export interface GlossaryForm {
  term: string;
  reading: string;
  definition: string;
  plain: string;
  jargon: boolean;
  relatedText: string;
  sections: string[];
  source: string;
  /** 더하기 폼만 — 고치기 폼은 공개·숨김을 따로 단추로 바꾼다 */
  visible?: boolean;
}

const orNull = (s: string) => (blank(s) ? null : s.trim());

export function glossaryFormToBody(form: GlossaryForm, base = "glossary"): { ok: true; body: Obj } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (blank(form.term)) errors[`${base}-term`] = "용어를 적어 주세요";
  const plain = form.plain.trim();
  if (chars(plain) > GLOSSARY_LIMITS.plain) errors[`${base}-plain`] = plainTooLong(chars(plain));
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
      ...(form.visible === undefined ? {} : { visible: form.visible }),
    },
  };
}
