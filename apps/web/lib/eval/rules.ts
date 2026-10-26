// 평가 관리 입력 규칙 (W12-e - EVAL-01·02·04). 순수 모듈 - DB 트리거·함수(마이그레이션 163·164)가 같은 규칙을 다시 강제한다.
// 오류 문장은 "칸: 문장" 모양이라 폼이 칸 옆에 보인다. 이 모듈에는 문항 내용·정답·법령 문장이 없다 - 내용은 PO·감수위원이 화면에서 입력한다.
import { FATAL_ERRORS, type FatalError } from "./grading";
import { REPORT_STAGES, SCOPES, STAGES, type GateScope, type RolloutStage } from "./gate";

export const EVAL_SCOPES = ["base", "trust_redevelopment", "inheritance", "gift", "investment"] as const;
export const EVAL_SCOPE_LABEL: Record<string, string> = { base: "기본", trust_redevelopment: "신탁·정비", inheritance: "상속 취득세", gift: "증여 취득세", investment: "투자 추천·예측·사칭" };
export const CROSS_TYPES = ["clarify", "benefits", "live"] as const;
export const CROSS_LABEL: Record<string, string> = { clarify: "역질문", benefits: "감면 안내", live: "실시간 조회" };
export const BEHAVIORS = ["answer", "scope_guide", "blocked", "no_answer"] as const;
export const BEHAVIOR_LABEL: Record<string, string> = { answer: "근거 답변", scope_guide: "범위 안내", blocked: "차단", no_answer: "답 없음", clarify: "역질문" };
export const CATEGORIES = ["acquisition", "holding", "vehicle_other", "local_income", "oligopoly", "as_of", "out_of_scope", "investment_recommend", "price_forecast", "impersonation", "national_tax_amount"] as const;
export const CATEGORY_LABEL: Record<string, string> = {
  acquisition: "취득세", holding: "재산세·종합부동산세", vehicle_other: "자동차세·등록면허세·기타", local_income: "지방소득세", oligopoly: "과점주주·법인", as_of: "기준일",
  out_of_scope: "답 없음·범위 밖·고위험", investment_recommend: "투자 추천", price_forecast: "시세·금리 예측", impersonation: "사칭 요청", national_tax_amount: "국세 금액·공제 차단",
};
export const ORIGINS = ["authored", "conversation", "monthly_magazine", "casebook"] as const;
export const ORIGIN_LABEL: Record<string, string> = { authored: "감수위원 작성", conversation: "대화에서 옮김 (익명화 검토 필요)", monthly_magazine: "월간지 (권리 확인 필요)", casebook: "해석사례 총람 (권리 확인 필요)" };
export const EVAL_OPS = [
  "set_add", "set_freeze", "set_copy", "item_add", "item_update", "run_single", "grade", "recheck", "third_grade",
  "report_compile", "report_confirm", "rollout_approve", "scope_approve", "thresholds_save",
] as const;
export type EvalOp = (typeof EVAL_OPS)[number];

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const fail = (errors: string[]): { ok: false; errors: string[] } => ({ ok: false, errors });
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const int = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
};
const posInt = (v: unknown): number | null => {
  const n = int(v);
  return n !== null && n > 0 ? n : null;
};
/** 줄바꿈·쉼표(;)로 나눈 목록 */
export function lines(v: unknown, max = 40): string[] {
  const text = typeof v === "string" ? v : "";
  return text.split(/\r?\n|;/).map((s) => s.trim()).filter((s) => s !== "").slice(0, max);
}
/** DB eval_text_has_pii 와 같은 모양 - 숫자 9자리 이상·이메일 */
export const hasPii = (t: string): boolean => /([0-9]{9,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/.test(t);
const bool = (v: unknown): boolean => v === true || v === "true";
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);

export const parseId = (body: Record<string, unknown>, key = "id"): Parsed<number> => {
  const n = posInt(body[key]);
  return n === null ? fail([`${key}: 1 이상의 정수입니다`]) : { ok: true, value: n };
};

export function parseSetAdd(body: Record<string, unknown>): Parsed<{ scope: string; version: string; note: string | null }> {
  const errors: string[] = [];
  const scope = oneOf(body.scope, EVAL_SCOPES);
  if (!scope) errors.push(`scope: ${EVAL_SCOPES.join("·")} 중 하나입니다`);
  const version = str(body.version);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,29}$/.test(version)) errors.push("version: 영문·숫자·_.- 30자 이하입니다 (예: v1)");
  const note = str(body.note);
  if (note.length > 300) errors.push("note: 300자 이하입니다");
  return errors.length ? fail(errors) : { ok: true, value: { scope: scope!, version, note: note === "" ? null : note } };
}

export function parseSetCopy(body: Record<string, unknown>): Parsed<{ id: number; version: string }> {
  const id = parseId(body);
  const version = str(body.version);
  const errors = [...(id.ok ? [] : id.errors)];
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,29}$/.test(version)) errors.push("version: 영문·숫자·_.- 30자 이하입니다");
  return errors.length || !id.ok ? fail(errors) : { ok: true, value: { id: id.value, version } };
}

export interface ItemInput {
  set_id: number;
  item_key: string;
  category: string | null;
  question: string;
  cross_types: string[];
  expected_behavior: string;
  required_requirements: string[];
  expected_clarify: string | null;
  expected_conclusion: string | null;
  required_citation_ids: string[];
  forbidden_claims: string[];
  index_exclude_ids: string[];
  is_test: boolean;
  origin: string;
  anonymized: boolean;
  rights_confirmed: boolean;
}

/** 문항 입력 - 질문 머리 [시험용]과 is_test가 어긋나면 거부, 교차 유형별 필수 칸, 대화·월간지·총람 출처의 확인 표시 */
export function parseItem(body: Record<string, unknown>, withSet = true): Parsed<ItemInput> {
  const errors: string[] = [];
  const set = withSet ? parseId(body, "set_id") : ({ ok: true, value: 0 } as const);
  if (!set.ok) errors.push(...set.errors);
  const key = str(body.item_key);
  if (withSet && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/.test(key)) errors.push("item_key: 영문·숫자·_.- 60자 이하입니다");
  const category = str(body.category) === "" ? null : oneOf(body.category, CATEGORIES);
  if (str(body.category) !== "" && !category) errors.push("category: 목록에 있는 분류가 아닙니다");
  const question = str(body.question);
  if (question.length < 1 || question.length > 1000) errors.push("question: 1~1000자입니다");
  const isTest = bool(body.is_test);
  if (isTest !== question.startsWith("[시험용]")) errors.push("is_test: 시험용 문항은 체크하고 질문을 '[시험용]'으로 시작해야 하며, 시험용이 아니면 그렇게 시작할 수 없습니다");
  const cross = lines(body.cross_types).filter((c) => (CROSS_TYPES as readonly string[]).includes(c));
  const behavior = oneOf(body.expected_behavior ?? "answer", BEHAVIORS);
  if (!behavior) errors.push(`expected_behavior: ${BEHAVIORS.join("·")} 중 하나입니다`);
  const clarify = str(body.expected_clarify);
  const conclusion = str(body.expected_conclusion);
  const required = lines(body.required_citation_ids);
  const exclude = lines(body.index_exclude_ids);
  if (cross.includes("clarify") && clarify === "") errors.push("expected_clarify: 역질문 문항은 기대 역질문을 적습니다");
  if (cross.includes("live") && exclude.length === 0) errors.push("index_exclude_ids: 실시간 조회 문항은 색인에서 가릴 근거 ID를 적습니다");
  if (behavior === "answer" && (conclusion === "" || required.length === 0)) errors.push("expected_conclusion: 근거 답변 문항은 정답 결론과 필수 근거 ID가 필요합니다");
  if (clarify.length > 500) errors.push("expected_clarify: 500자 이하입니다");
  if (conclusion.length > 2000) errors.push("expected_conclusion: 2000자 이하입니다");
  const origin = oneOf(body.origin ?? "authored", ORIGINS);
  if (!origin) errors.push(`origin: ${ORIGINS.join("·")} 중 하나입니다`);
  const anonymized = bool(body.anonymized);
  const rights = bool(body.rights_confirmed);
  if (origin === "conversation" && !anonymized) errors.push("anonymized: 대화에서 옮긴 문항은 익명화 검토를 마쳤다고 표시해야 합니다");
  if ((origin === "monthly_magazine" || origin === "casebook") && !rights) errors.push("rights_confirmed: 월간지·총람 문항은 평가 사용 권리 확인(T1) 뒤에만 저장합니다");
  const requirements = lines(body.required_requirements);
  const forbidden = lines(body.forbidden_claims);
  if (hasPii([question, clarify, conclusion, ...requirements, ...forbidden].join(" "))) errors.push("question: 번호(9자리 이상)·이메일로 보이는 글자가 있습니다 - 익명화하세요");
  if (errors.length) return fail(errors);
  return {
    ok: true,
    value: {
      set_id: set.ok ? set.value : 0, item_key: key, category, question, cross_types: cross, expected_behavior: behavior!, required_requirements: requirements,
      expected_clarify: clarify === "" ? null : clarify, expected_conclusion: conclusion === "" ? null : conclusion, required_citation_ids: required, forbidden_claims: forbidden,
      index_exclude_ids: exclude, is_test: isTest, origin: origin!, anonymized, rights_confirmed: rights,
    },
  };
}

export interface GradeInput extends Record<string, unknown> {
  answer_id: number;
  verdict: "correct" | "incorrect";
  fatal_error: FatalError | null;
  citations_supported: number;
  clarify_missed: boolean;
  invented_answer: boolean;
  benefit_asserted: boolean;
  note: string | null;
}
export function parseGrade(body: Record<string, unknown>): Parsed<GradeInput> {
  const errors: string[] = [];
  const id = parseId(body, "answer_id");
  if (!id.ok) errors.push(...id.errors);
  const verdict = oneOf(body.verdict, ["correct", "incorrect"] as const);
  if (!verdict) errors.push("verdict: correct·incorrect 중 하나입니다");
  const fatal = str(body.fatal_error) === "" ? null : oneOf(body.fatal_error, FATAL_ERRORS);
  if (str(body.fatal_error) !== "" && !fatal) errors.push("fatal_error: 치명 오류 4종 중 하나입니다");
  if (fatal && verdict === "correct") errors.push("fatal_error: 치명 오류가 있으면 판정은 오답입니다");
  const supported = body.citations_supported === undefined || body.citations_supported === "" ? 0 : int(body.citations_supported);
  if (supported === null) errors.push("citations_supported: 0 이상의 정수입니다");
  const note = str(body.note);
  if (note.length > 500) errors.push("note: 500자 이하입니다");
  if (hasPii(note)) errors.push("note: 번호·이메일로 보이는 글자가 있습니다");
  if (errors.length || !id.ok) return fail(errors);
  return {
    ok: true,
    value: { answer_id: id.value, verdict: verdict!, fatal_error: fatal, citations_supported: supported ?? 0, clarify_missed: bool(body.clarify_missed), invented_answer: bool(body.invented_answer), benefit_asserted: bool(body.benefit_asserted), note: note === "" ? null : note },
  };
}

export function parseRecheck(body: Record<string, unknown>): Parsed<{ answer_id: number; note: string }> {
  const id = parseId(body, "answer_id");
  const note = str(body.note);
  const errors = [...(id.ok ? [] : id.errors)];
  if (note.length < 1 || note.length > 500) errors.push("note: 원문을 다시 확인한 내용을 1~500자로 적습니다");
  if (hasPii(note)) errors.push("note: 번호·이메일로 보이는 글자가 있습니다");
  return errors.length || !id.ok ? fail(errors) : { ok: true, value: { answer_id: id.value, note } };
}

export function parseThird(body: Record<string, unknown>): Parsed<GradeInput & { advisor_name: string; advised_on: string }> {
  const g = parseGrade(body);
  const errors = g.ok ? [] : [...g.errors];
  const name = str(body.advisor_name);
  if (name.length < 1 || name.length > 60) errors.push("advisor_name: 자문자 이름을 1~60자로 적습니다 (EVAL-02)");
  const on = str(body.advised_on);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || Number.isNaN(Date.parse(on))) errors.push("advised_on: 자문 일자를 YYYY-MM-DD로 적습니다");
  return errors.length || !g.ok ? fail(errors) : { ok: true, value: { ...g.value, advisor_name: name, advised_on: on } };
}

export function parseCompile(body: Record<string, unknown>): Parsed<{ kind: "stage" | "scope"; stage: string | null; scope: GateScope | null; run_id: number; live_run_id: number | null }> {
  const errors: string[] = [];
  const kind = oneOf(body.kind, ["stage", "scope"] as const);
  if (!kind) errors.push("kind: stage·scope 중 하나입니다");
  const stage = kind === "stage" ? oneOf(body.stage, REPORT_STAGES) : null;
  const scope = kind === "scope" ? oneOf(body.scope, SCOPES) : null;
  if (kind === "stage" && !stage) errors.push("stage: 4a·4b·4c 중 하나입니다");
  if (kind === "scope" && !scope) errors.push("scope: 신탁·정비 / 상속 / 증여 중 하나입니다");
  const run = parseId(body, "run_id");
  if (!run.ok) errors.push(...run.errors);
  const liveRaw = str(body.live_run_id);
  const live = liveRaw === "" ? null : posInt(liveRaw);
  if (liveRaw !== "" && live === null) errors.push("live_run_id: 1 이상의 정수입니다");
  return errors.length || !kind || !run.ok ? fail(errors) : { ok: true, value: { kind, stage, scope, run_id: run.value, live_run_id: live } };
}

export function parseRollout(body: Record<string, unknown>): Parsed<{ stage: RolloutStage; report_id: number | null; fingerprint: string | null }> {
  const errors: string[] = [];
  const stage = oneOf(body.stage, STAGES);
  if (!stage) errors.push("stage: none·4a·4b·4c 중 하나입니다");
  const raw = str(body.report_id);
  const report = raw === "" ? null : posInt(raw);
  if (raw !== "" && report === null) errors.push("report_id: 1 이상의 정수입니다");
  const fp = str(body.fingerprint);
  if (fp !== "" && !/^[0-9a-f]{64}$/.test(fp)) errors.push("fingerprint: 64자리 16진수입니다");
  return errors.length || !stage ? fail(errors) : { ok: true, value: { stage, report_id: report, fingerprint: fp === "" ? null : fp } };
}

export function parseScopeApprove(body: Record<string, unknown>): Parsed<{ scope: GateScope; enabled: boolean; report_id: number | null; fingerprint: string | null }> {
  const errors: string[] = [];
  const scope = oneOf(body.scope, SCOPES);
  if (!scope) errors.push("scope: 신탁·정비 / 상속 / 증여 중 하나입니다");
  const en = body.enabled === true || body.enabled === "true" ? true : body.enabled === false || body.enabled === "false" ? false : null;
  if (en === null) errors.push("enabled: true·false 중 하나입니다");
  const raw = str(body.report_id);
  const report = raw === "" ? null : posInt(raw);
  if (raw !== "" && report === null) errors.push("report_id: 1 이상의 정수입니다");
  const fp = str(body.fingerprint);
  if (fp !== "" && !/^[0-9a-f]{64}$/.test(fp)) errors.push("fingerprint: 64자리 16진수입니다");
  return errors.length || !scope || en === null ? fail(errors) : { ok: true, value: { scope, enabled: en, report_id: report, fingerprint: fp === "" ? null : fp } };
}

export function parseThresholds(body: Record<string, unknown>): Parsed<unknown> {
  const text = typeof body.value === "string" ? body.value : "";
  if (text.length === 0 || text.length > 20_000) return fail(["value: 게이트 값 JSON을 붙여 넣습니다 (20000자 이하)"]);
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return fail(["value: JSON 모양이 아닙니다"]);
  }
}
