// 룰셋·판정표·달력 / 정확도 대조 관리 입력 규칙 (W10-a a6 - RULE-02·04 · CALC-14 · FAM-07). 순수 모듈 - DB 트리거·함수(마이그레이션 81~83)가 같은 규칙을 다시 강제한다.
// 오류 문장은 "칸: 문장" 모양이라 폼이 칸 옆에 보인다. 이 모듈에는 세율·한도·법령 문장이 없다 - 룰셋·판정표 본문은 사람이 붙여 넣은 JSON을 검사만 한다.
import { detectPii } from "@ltr/editorial";
import { parseRuleset, parseTableByKind, W11_DETERMINATION_KINDS } from "@ltr/tax-engine";
import { CAUSES, TAX_KINDS, type Cause, type TaxKind } from "./gate";

export const RULE_KINDS = ["ruleset", "determination_table", "tax_calendar", "requirement_dictionary"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export const RULES_OPS = ["create", "sign", "approve"] as const;
export const ACCURACY_OPS = ["case_add", "case_confirm", "case_retire", "case_note", "run"] as const;
export const RULE_KIND_LABEL: Record<RuleKind, string> = { ruleset: "룰셋", determination_table: "판정표", tax_calendar: "지방세 달력", requirement_dictionary: "요건 사전" };
export const RULE_KIND_TABLE: Record<RuleKind, string> = { ruleset: "rulesets", determination_table: "determination_tables", tax_calendar: "tax_calendar", requirement_dictionary: "requirement_dictionary" };
export const RULE_KIND_RPC: Record<RuleKind, { sign: string; approve: string }> = {
  ruleset: { sign: "sign_ruleset", approve: "approve_ruleset" },
  determination_table: { sign: "sign_determination_table", approve: "approve_determination_table" },
  tax_calendar: { sign: "sign_tax_calendar", approve: "approve_tax_calendar" },
  requirement_dictionary: { sign: "sign_requirement_dictionary", approve: "approve_requirement_dictionary" },
};
/** 판정표 종류 화면 이름 (W11-a - 기존 환급·감면 + PRD-03 7장 7종) */
export const DETERMINATION_TABLE_KINDS = ["refund", "reduction", ...W11_DETERMINATION_KINDS] as const;
export const DETERMINATION_KIND_LABEL: Record<(typeof DETERMINATION_TABLE_KINDS)[number], string> = {
  refund: "환급 자가진단",
  reduction: "감면 점검",
  house_count: "주택 수",
  trust_taxpayer: "신탁 보유세 납세의무자",
  redevelopment_right: "입주권 판정",
  house_count_inheritance: "상속 후 주택 수",
  house_count_gift: "증여 후 주택 수",
  redevelopment_tax: "정비 세금 판정",
  trust_acquisition: "신탁 이전 취득세 판정",
};
export const STATUS_LABEL: Record<string, string> = { draft: "초안", reviewed: "서명됨(승인 대기)", active: "활성", retired: "내려감" };

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const fail = (errors: string[]): { ok: false; errors: string[] } => ({ ok: false, errors });
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const int = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
};
const VERSION = /^\d{4}\.\d{2}$/;
const MAX_BODY_CHARS = 400_000;

export function parseKind(body: Record<string, unknown>): Parsed<RuleKind> {
  const kind = str(body.kind);
  return (RULE_KINDS as readonly string[]).includes(kind) ? { ok: true, value: kind as RuleKind } : fail([`kind: ${RULE_KINDS.join("·")} 중 하나입니다`]);
}

export function parseTargetId(body: Record<string, unknown>): Parsed<number> {
  const id = int(body.id);
  return id === null ? fail(["id: 1 이상의 정수입니다"]) : { ok: true, value: id };
}

export function parseSign(body: Record<string, unknown>): Parsed<{ kind: RuleKind; id: number; sheetRef: string }> {
  const k = parseKind(body);
  const id = parseTargetId(body);
  const sheet = str(body.sheet_ref);
  const errors = [...(k.ok ? [] : k.errors), ...(id.ok ? [] : id.errors)];
  if (sheet.length < 1 || sheet.length > 200) errors.push("sheet_ref: 감수 시트 위치를 1~200자로 적습니다 (RULE-04)");
  return errors.length || !k.ok || !id.ok ? fail(errors) : { ok: true, value: { kind: k.value, id: id.value, sheetRef: sheet } };
}

export function parseApprove(body: Record<string, unknown>): Parsed<{ kind: RuleKind; id: number }> {
  const k = parseKind(body);
  const id = parseTargetId(body);
  const errors = [...(k.ok ? [] : k.errors), ...(id.ok ? [] : id.errors)];
  return errors.length || !k.ok || !id.ok ? fail(errors) : { ok: true, value: { kind: k.value, id: id.value } };
}

export interface DraftRow {
  table: string;
  row: Record<string, unknown>;
}

/** 초안 만들기 - 붙여 넣은 JSON을 룰셋(zod)·판정표(zod) 검사를 통과시켜서만 받는다. 국세 낱말·허용 밖 칸은 DB 트리거가 한 번 더 거른다 */
export function parseCreate(body: Record<string, unknown>): Parsed<DraftRow> {
  const k = parseKind(body);
  if (!k.ok) return k;
  const errors: string[] = [];
  const version = str(body.version);
  if (!VERSION.test(version)) errors.push("version: YYYY.NN 모양입니다 (예: 2099.01 - 시험용)");
  const sourceRef = str(body.source_ref);
  if (sourceRef.length < 1 || sourceRef.length > 200) errors.push("source_ref: 출처(파일·커밋·시트 위치)를 1~200자로 적습니다");
  const basisNote = str(body.basis_note);
  const rawEvent = typeof body.basis_event_id === "number" ? String(body.basis_event_id) : str(body.basis_event_id);
  const eventId = rawEvent === "" ? null : int(rawEvent);
  if (rawEvent !== "" && eventId === null) errors.push("basis_event_id: 개정 단계 기록 번호(1 이상 정수)입니다");
  if (eventId === null && basisNote === "") errors.push("basis_note: 근거 개정 번호가 없으면 사유(개정과 무관한 감수 정정 등)를 적습니다");
  if (basisNote.length > 300) errors.push("basis_note: 300자 이하입니다");

  const text = typeof body.body === "string" ? body.body : "";
  let parsedBody: unknown = null;
  if (text.length === 0 || text.length > MAX_BODY_CHARS) errors.push(`body: JSON 본문을 붙여 넣습니다 (${MAX_BODY_CHARS}자 이하)`);
  else {
    try {
      parsedBody = JSON.parse(text);
    } catch {
      errors.push("body: JSON 모양이 아닙니다");
    }
  }
  let tableKind: string | null = null;
  if (parsedBody !== null && typeof parsedBody === "object" && !Array.isArray(parsedBody)) {
    try {
      if (k.value === "ruleset") {
        const r = parseRuleset(parsedBody);
        if (r.version !== version) errors.push("body: 본문 안 version이 위 version과 다릅니다");
        if (r.status !== "draft") errors.push("body: 본문 status는 draft여야 합니다");
      } else if (k.value === "determination_table") {
        const t = parseTableByKind(String((parsedBody as { kind?: unknown }).kind ?? ""), parsedBody);
        if (t.version !== version) errors.push("body: 본문 안 version이 위 version과 다릅니다");
        tableKind = t.kind;
      } else if (k.value === "requirement_dictionary") {
        const d = parsedBody as { as_of?: unknown; fields?: unknown };
        if (typeof d.as_of !== "string" || d.as_of.trim() === "") errors.push("body: 기준일(as_of)이 필요합니다");
        if (!Array.isArray(d.fields)) errors.push("body: 필드 목록(fields)이 필요합니다");
        if (!/^[a-z][a-z0-9_]{1,39}$/.test(str(body.topic))) errors.push("topic: 영문 소문자로 시작하는 소문자·숫자·'_' 2~40자입니다");
      } else if (Object.keys(parsedBody).length === 0) errors.push("body: 빈 객체입니다");
    } catch (err) {
      errors.push(`body: 검증에 실패했습니다 - ${err instanceof Error ? err.message.slice(0, 300) : "형식 오류"}`);
    }
  } else if (parsedBody !== null) errors.push("body: JSON 객체여야 합니다");
  if (errors.length) return fail(errors);
  const row: Record<string, unknown> = { version, body: parsedBody, source_ref: sourceRef, basis_event_id: eventId, basis_note: basisNote === "" ? null : basisNote };
  if (k.value === "determination_table") row.kind = tableKind;
  if (k.value === "requirement_dictionary") row.topic = str(body.topic);
  return { ok: true, value: { table: RULE_KIND_TABLE[k.value], row } };
}

// ── 대조 사례 ─────────────────────────────────────────────

/** 개인정보 칸 이름 - DB 함수 accuracy_pii_problem과 같은 모양 */
const PII_KEY = /(name|addr|phone|tel|mail|ssn|rrn|account|resident|taxno|tax_no|납세|성명|이름|주소|전화|이메일|계좌|주민)/i;
const SAFE_STRING = /^[A-Za-z0-9_.:/-]{1,40}$/;

/** 사례 입력에서 개인정보 흔적을 찾는다 (받은 값은 문장에 되풀이하지 않는다). 빈 목록이면 통과 */
export function casePiiProblems(input: unknown): string[] {
  const out = new Set<string>();
  const walk = (value: unknown, key: string | null) => {
    if (key !== null && PII_KEY.test(key)) out.add("입력 칸 이름에 개인정보 칸으로 보이는 낱말이 있습니다");
    if (typeof value === "string") {
      if (!SAFE_STRING.test(value)) out.add("글자 값은 영문·숫자 40자 이하 코드나 날짜만 넣을 수 있습니다 (이름·주소·문장 금지)");
      else if (/[0-9]{9,}/.test(value)) out.add("숫자가 9자리 이상 이어지는 글자 값은 넣을 수 없습니다 (번호류)");
      if (detectPii(value).length > 0) out.add("개인정보 형식(이메일·전화·주민등록번호 등)이 있습니다");
    } else if (Array.isArray(value)) value.forEach((v) => walk(v, null));
    else if (value !== null && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(input, null);
  return [...out];
}

export interface CaseDraft {
  case_key: string;
  tax_kind: TaxKind;
  cause: Cause | null;
  sample_kind: "official" | "review_sample";
  official_basis: "tax_notice" | "wetax_result" | "reviewer_calc";
  official_total: number;
  case_input: Record<string, unknown>;
  synthetic: boolean;
}

export function parseCaseAdd(body: Record<string, unknown>): Parsed<CaseDraft> {
  const errors: string[] = [];
  const caseKey = str(body.case_key);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/.test(caseKey)) errors.push("case_key: 영문·숫자·_.- 60자 이하 (이름·번호를 쓰지 않는 관리 번호)");
  const taxKind = str(body.tax_kind);
  if (!(TAX_KINDS as readonly string[]).includes(taxKind)) errors.push(`tax_kind: ${TAX_KINDS.join("·")} 중 하나입니다`);
  const cause = str(body.cause);
  if (taxKind === "acquisition" && !(CAUSES as readonly string[]).includes(cause)) errors.push(`cause: 취득세는 ${CAUSES.join("·")} 중 하나입니다`);
  if (taxKind !== "acquisition" && cause !== "") errors.push("cause: 취득세만 원인을 적습니다");
  const sampleKind = str(body.sample_kind);
  if (sampleKind !== "official" && sampleKind !== "review_sample") errors.push("sample_kind: official(공식 결과)·review_sample(감수 표본) 중 하나입니다");
  const basis = str(body.official_basis);
  if (sampleKind === "official" && basis !== "tax_notice" && basis !== "wetax_result") errors.push("official_basis: 공식 결과는 tax_notice(고지서)·wetax_result(위택스 결과) 중 하나입니다");
  if (sampleKind === "review_sample" && basis !== "reviewer_calc") errors.push("official_basis: 감수 표본은 reviewer_calc입니다");
  const totalRaw = str(body.official_total);
  const total = /^\d{1,15}$/.test(totalRaw) ? Number(totalRaw) : typeof body.official_total === "number" && Number.isSafeInteger(body.official_total) && body.official_total >= 0 ? body.official_total : null;
  if (total === null) errors.push("official_total: 0 이상 정수(원)입니다");
  let input: Record<string, unknown> | null = null;
  const text = typeof body.case_input === "string" ? body.case_input : "";
  if (text.length === 0 || text.length > 20_000) errors.push("case_input: 엔진 입력 JSON을 붙여 넣습니다 (20000자 이하)");
  else {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) errors.push("case_input: JSON 객체여야 합니다");
      else {
        input = parsed as Record<string, unknown>;
        errors.push(...casePiiProblems(input).map((p) => `case_input: ${p}`));
      }
    } catch {
      errors.push("case_input: JSON 모양이 아닙니다");
    }
  }
  if (errors.length || input === null || total === null) return fail(errors);
  return {
    ok: true,
    value: {
      case_key: caseKey,
      tax_kind: taxKind as TaxKind,
      cause: taxKind === "acquisition" ? (cause as Cause) : null,
      sample_kind: sampleKind as CaseDraft["sample_kind"],
      official_basis: basis as CaseDraft["official_basis"],
      official_total: total,
      case_input: input,
      synthetic: body.synthetic === true || body.synthetic === "true",
    },
  };
}

export const MISMATCH_CAUSES = ["rounding", "ruleset_value", "input_interpretation"] as const;
export const MISMATCH_CAUSE_LABEL: Record<string, string> = { rounding: "단수 처리", ruleset_value: "룰셋 값", input_interpretation: "입력 해석" };

export function parseCaseNote(body: Record<string, unknown>): Parsed<{ id: number; cause: string | null; note: string | null }> {
  const id = parseTargetId(body);
  if (!id.ok) return id;
  const cause = str(body.mismatch_cause);
  const note = str(body.mismatch_note);
  const errors: string[] = [];
  if (cause !== "" && !(MISMATCH_CAUSES as readonly string[]).includes(cause)) errors.push(`mismatch_cause: ${MISMATCH_CAUSES.join("·")} 중 하나입니다`);
  if (note.length > 200) errors.push("mismatch_note: 200자 이하입니다");
  if (/([0-9]{6}-?[1-4][0-9]{6}|[0-9]{9,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+)/.test(note) || detectPii(note).length > 0) errors.push("mismatch_note: 번호·이메일 같은 개인정보 형식은 적을 수 없습니다");
  return errors.length ? fail(errors) : { ok: true, value: { id: id.value, cause: cause === "" ? null : cause, note: note === "" ? null : note } };
}
