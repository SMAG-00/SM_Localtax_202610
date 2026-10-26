// 상속·증여세 감수 관리 입력 검사 (FAM-12) - 순수 함수. 서명·승인은 DB 함수(sign_igt_ruleset · approve_igt_ruleset)가 정하고, 여기서는 모양만 본다.
// 룰셋 본문은 붙여 넣은 JSON을 검사만 한다 - 이 화면이 값을 만들지 않는다(세율·공제·한도는 감수 입력).

export const IGT_OPS = ["create", "sign", "approve", "case_add", "case_confirm", "case_retire", "run"] as const;
export type IgtOp = (typeof IGT_OPS)[number];

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const fail = <T,>(errors: string[]): Parsed<T> => ({ ok: false, errors });
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

export function parseId(body: Record<string, unknown>): Parsed<number> {
  const raw = str(body.id);
  return /^\d{1,12}$/.test(raw) && Number(raw) > 0 ? { ok: true, value: Number(raw) } : fail(["id: 양의 정수입니다"]);
}

export interface CreateDraft {
  version: string;
  source_ref: string;
  basis_note: string;
  body: Record<string, unknown>;
}

export function parseCreate(body: Record<string, unknown>): Parsed<CreateDraft> {
  const errors: string[] = [];
  const version = str(body.version);
  if (!/^\d{4}\.\d{2}$/.test(version)) errors.push("version: YYYY.NN 모양입니다 (본문 안 version과 같아야 합니다)");
  const sourceRef = str(body.source_ref);
  if (sourceRef.length < 1 || sourceRef.length > 200) errors.push("source_ref: 1~200자 (파일·커밋·시트 위치)");
  const basisNote = str(body.basis_note);
  if (basisNote.length < 1 || basisNote.length > 300) errors.push("basis_note: 1~300자 (근거 사유)");
  const text = typeof body.body === "string" ? body.body : "";
  let parsed: Record<string, unknown> | null = null;
  if (text.length === 0 || text.length > 300_000) errors.push("body: 룰셋 JSON을 붙여 넣습니다 (30만자 이하)");
  else {
    try {
      const v: unknown = JSON.parse(text);
      if (v === null || typeof v !== "object" || Array.isArray(v)) errors.push("body: JSON 객체여야 합니다");
      else parsed = v as Record<string, unknown>;
    } catch {
      errors.push("body: JSON 모양이 아닙니다");
    }
  }
  if (parsed) {
    if (parsed.version !== version) errors.push("body.version: 위 version과 같아야 합니다");
    if (parsed.status !== undefined && parsed.status !== "draft") errors.push("body.status: draft만 넣을 수 있습니다 (활성화는 서명·승인 함수로만)");
  }
  return errors.length || !parsed ? fail(errors) : { ok: true, value: { version, source_ref: sourceRef, basis_note: basisNote, body: parsed } };
}

export function parseSign(body: Record<string, unknown>): Parsed<{ id: number; sheetRef: string }> {
  const id = parseId(body);
  const sheet = str(body.sheet_ref);
  const errors = [...(id.ok ? [] : id.errors), ...(sheet.length >= 1 && sheet.length <= 200 ? [] : ["sheet_ref: 감수 시트 위치 1~200자"])];
  return errors.length || !id.ok ? fail(errors) : { ok: true, value: { id: id.value, sheetRef: sheet } };
}

const PII_KEY = /(name|addr|phone|tel|mail|ssn|rrn|account|resident|taxno|tax_no|납세|성명|이름|주소|전화|이메일|계좌|주민)/i;
/** 엔진 입력의 거주 여부 참/거짓 칸 둘은 개인정보 칸이 아니다 (DB accuracy_pii_problem 과 같은 예외) */
const RESIDENT_FLAG = /^(recipient_is_resident|decedent_resident)$/;

/** 개인정보 흔적 검사 - DB 트리거와 같은 규칙. 문제 글 목록(받은 값은 되풀이하지 않는다) */
export function casePiiProblems(input: unknown, key: string | null = null): string[] {
  if (key !== null && !RESIDENT_FLAG.test(key) && PII_KEY.test(key)) return ["입력 칸 이름에 개인정보 칸으로 보이는 낱말이 있습니다"];
  if (typeof input === "string") {
    if (!/^[A-Za-z0-9_.:/-]{1,40}$/.test(input)) return ["글자 값은 영문·숫자 40자 이하 코드나 날짜만 넣을 수 있습니다 (이름·주소·문장 금지)"];
    if (/\d{9,}/.test(input)) return ["숫자가 9자리 이상 이어지는 글자 값은 넣을 수 없습니다 (번호류)"];
    return [];
  }
  if (Array.isArray(input)) return input.flatMap((x) => casePiiProblems(x, null));
  if (input !== null && typeof input === "object") return Object.entries(input).flatMap(([k, v]) => casePiiProblems(v, k));
  return [];
}

export interface IgtCaseDraft {
  case_key: string;
  tax_kind: "gift" | "inheritance";
  sample_kind: "official" | "review_sample";
  official_basis: "tax_notice" | "reviewer_calc";
  official_total: number;
  case_input: Record<string, unknown>;
  synthetic: boolean;
}

export function parseCaseAdd(body: Record<string, unknown>): Parsed<IgtCaseDraft> {
  const errors: string[] = [];
  const caseKey = str(body.case_key);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/.test(caseKey)) errors.push("case_key: 영문·숫자·_.- 60자 이하 (이름·번호를 쓰지 않는 관리 번호)");
  const taxKind = str(body.tax_kind);
  if (taxKind !== "gift" && taxKind !== "inheritance") errors.push("tax_kind: gift(증여)·inheritance(상속) 중 하나입니다");
  const sampleKind = str(body.sample_kind);
  if (sampleKind !== "official" && sampleKind !== "review_sample") errors.push("sample_kind: official(공식 결과)·review_sample(감수 표본) 중 하나입니다");
  const basis = str(body.official_basis);
  if (sampleKind === "official" && basis !== "tax_notice") errors.push("official_basis: 공식 결과는 tax_notice(고지서·홈택스 결과)입니다");
  if (sampleKind === "review_sample" && basis !== "reviewer_calc") errors.push("official_basis: 감수 표본은 reviewer_calc입니다");
  const totalRaw = str(body.official_total);
  const total = /^\d{1,15}$/.test(totalRaw) ? Number(totalRaw) : null;
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
        errors.push(...[...new Set(casePiiProblems(input))].map((p) => `case_input: ${p}`));
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
      tax_kind: taxKind as IgtCaseDraft["tax_kind"],
      sample_kind: sampleKind as IgtCaseDraft["sample_kind"],
      official_basis: basis as IgtCaseDraft["official_basis"],
      official_total: total,
      case_input: input,
      synthetic: body.synthetic === true || body.synthetic === "true",
    },
  };
}
