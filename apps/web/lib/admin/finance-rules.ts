// 개발금융 관리 입력 검사 (W5 — PRD-01B DF-01~05 · DF-09, docs/dev/W5_설계.md 2장) — 순수 함수.
// 관리 API(/api/admin/finance)와 관리 화면 폼이 같이 쓴다. 모양(칸·길이·날짜·목록)만 보고, 금지 표현·자리 채움·세액 표현·차단 도메인·반론 규칙은
// DB 트리거(마이그레이션 …60·61)가 한 번 더 본다(DB가 정본). 이 모듈은 금융·법률 내용을 만들지 않는다.
// 오류는 "칸: 문장" 모양 — 화면이 칸 옆에 보인다.

export const FINANCE_OPS = ["structure", "legal_check", "sign", "indicator", "regulation", "case", "interest_items", "legal_review"] as const;
export type FinanceOp = (typeof FINANCE_OPS)[number];

export const STRUCTURE_TYPES = ["trust", "completion_guarantee", "pf_stage", "reit"] as const;
export type StructureType = (typeof STRUCTURE_TYPES)[number];
export const STRUCTURE_TYPE_LABELS: Record<StructureType, string> = { trust: "신탁 유형", completion_guarantee: "책임준공", pf_stage: "PF 단계", reit: "리츠" };

export const REBUTTAL_METHODS = ["email", "phone", "mail", "other"] as const;
export const REBUTTAL_METHOD_LABELS: Record<(typeof REBUTTAL_METHODS)[number], string> = { email: "이메일", phone: "전화", mail: "우편", other: "그 밖" };
export const REBUTTAL_STATUSES = ["answered", "no_response", "declined"] as const;
export const REBUTTAL_STATUS_LABELS: Record<(typeof REBUTTAL_STATUSES)[number], string> = { answered: "답변", no_response: "무응답", declined: "거절" };

export const INTEREST_ITEMS = ["financial_company", "trust_company"] as const;
export const INTEREST_ITEM_LABELS: Record<(typeof INTEREST_ITEMS)[number], string> = { financial_company: "소속 금융사", trust_company: "소속 신탁사" };

/** 한도 — DB 제약과 같은 숫자 */
export const FINANCE_LIMITS = { title: 60, summary: 300, alt: 200, nodes: 12, edges: 20, nodeLabel: 30, edgeLabel: 30, notes: 10, noteChars: 400, issues: 8, issueChars: 80, outcome: 300, label: 40, definition: 200, unit: 20, provider: 60, stage: 40, payload: 200_000 } as const;

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const inRange = (s: string, max: number) => s.length >= 1 && s.length <= max;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => DATE_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NODE_KEY_RE = /^[a-z][a-z0-9_]{0,19}$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

export interface Diagram {
  alt: string;
  nodes: { key: string; label: string }[];
  edges: { from: string; to: string; label: string }[];
}

/** 폼 글자 → 구조도. 노드 줄 `key=이름`, 관계 줄 `from>to:관계 이름`(이름은 비워도 된다) */
export function diagramFromText(alt: string, nodesText: string, edgesText: string): Diagram {
  const lines = (t: string) =>
    t
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "");
  const nodes = lines(nodesText).map((l) => {
    const i = l.indexOf("=");
    return i < 0 ? { key: l, label: "" } : { key: l.slice(0, i).trim(), label: l.slice(i + 1).trim() };
  });
  const edges = lines(edgesText).map((l) => {
    const m = /^([^>:]+)>([^:]+)(?::(.*))?$/.exec(l);
    return m ? { from: m[1]!.trim(), to: m[2]!.trim(), label: (m[3] ?? "").trim() } : { from: l, to: "", label: "" };
  });
  return { alt: alt.trim(), nodes, edges };
}
export const diagramToText = (d: Diagram | null | undefined) => ({
  nodes: (d?.nodes ?? []).map((n) => `${n.key}=${n.label}`).join("\n"),
  edges: (d?.edges ?? []).map((e) => `${e.from}>${e.to}${e.label ? `:${e.label}` : ""}`).join("\n"),
});

export function parseDiagram(v: unknown, field = "diagram"): Parsed<Diagram> {
  const errors: string[] = [];
  if (!isObj(v)) return { ok: false, errors: [`${field}: 구조도는 { alt, nodes, edges } 입니다`] };
  const alt = str(v.alt);
  if (!inRange(alt, FINANCE_LIMITS.alt)) errors.push(`${field}: 대체 텍스트(alt)는 1~${FINANCE_LIMITS.alt}자입니다`);
  const nodes = Array.isArray(v.nodes) ? v.nodes : [];
  const edges = Array.isArray(v.edges) ? v.edges : [];
  if (nodes.length < 2 || nodes.length > FINANCE_LIMITS.nodes) errors.push(`${field}: 노드는 2~${FINANCE_LIMITS.nodes}개입니다`);
  if (edges.length < 1 || edges.length > FINANCE_LIMITS.edges) errors.push(`${field}: 관계는 1~${FINANCE_LIMITS.edges}개입니다 — 관계가 없으면 같은 내용의 표를 만들 수 없습니다`);
  const keys = new Set<string>();
  const outNodes: Diagram["nodes"] = [];
  for (const n of nodes) {
    const key = isObj(n) ? str(n.key) : "";
    const label = isObj(n) ? str(n.label) : "";
    if (!NODE_KEY_RE.test(key) || !inRange(label, FINANCE_LIMITS.nodeLabel)) {
      errors.push(`${field}: 노드는 key=이름 입니다 (key 영문 소문자·숫자·밑줄 20자 이하, 이름 1~${FINANCE_LIMITS.nodeLabel}자)`);
      break;
    }
    if (keys.has(key)) {
      errors.push(`${field}: 노드 key(${key})가 두 번 있습니다`);
      break;
    }
    keys.add(key);
    outNodes.push({ key, label });
  }
  const outEdges: Diagram["edges"] = [];
  for (const e of edges) {
    const from = isObj(e) ? str(e.from) : "";
    const to = isObj(e) ? str(e.to) : "";
    const label = isObj(e) ? str(e.label) : "";
    if (!keys.has(from) || !keys.has(to) || from === to || label.length > FINANCE_LIMITS.edgeLabel) {
      errors.push(`${field}: 관계는 from>to:이름 이고 from·to는 서로 다른 노드 key입니다 (이름 ${FINANCE_LIMITS.edgeLabel}자 이하)`);
      break;
    }
    outEdges.push({ from, to, label });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { alt, nodes: outNodes, edges: outEdges } };
}

export interface StructureInput {
  slug: string;
  structure_type: StructureType;
  title: string;
  summary: string | null;
  diagram: Diagram | null;
  notes: string[];
  lens: Record<string, unknown> | null;
  lens_omit_reason: string | null;
}

export function parseStructure(body: Record<string, unknown>): Parsed<StructureInput> {
  const errors: string[] = [];
  const slug = str(body.slug);
  if (!SLUG_RE.test(slug) || slug.length > 60) errors.push("slug: 영문 소문자·숫자·'-' 60자 이하입니다");
  const type = str(body.structure_type);
  if (!(STRUCTURE_TYPES as readonly string[]).includes(type)) errors.push(`structure_type: ${STRUCTURE_TYPES.join("·")} 중 하나입니다`);
  const title = str(body.title);
  if (!inRange(title, FINANCE_LIMITS.title)) errors.push(`title: 1~${FINANCE_LIMITS.title}자입니다`);
  const summary = str(body.summary);
  if (summary !== "" && summary.length > FINANCE_LIMITS.summary) errors.push(`summary: ${FINANCE_LIMITS.summary}자 이하입니다`);
  let diagram: Diagram | null = null;
  if (body.diagram !== undefined && body.diagram !== null) {
    const d = parseDiagram(body.diagram);
    if (d.ok) diagram = d.value;
    else errors.push(...d.errors);
  }
  const rawNotes = body.notes === undefined ? [] : body.notes;
  const notes: string[] = [];
  if (!Array.isArray(rawNotes) || rawNotes.length > FINANCE_LIMITS.notes) errors.push(`notes: 문단 목록은 ${FINANCE_LIMITS.notes}개까지입니다`);
  else
    for (const n of rawNotes) {
      const t = str(n);
      if (!inRange(t, FINANCE_LIMITS.noteChars)) {
        errors.push(`notes: 문단은 1~${FINANCE_LIMITS.noteChars}자입니다 (빈 문단 0)`);
        break;
      }
      notes.push(t);
    }
  const lens = body.lens === undefined || body.lens === null || body.lens === "" ? null : body.lens;
  if (lens !== null && !isObj(lens)) errors.push("lens: 「지방세로 읽기」 박스는 { topics, points, links, base_date } 객체입니다");
  const omit = str(body.lens_omit_reason);
  if (omit.length > 120) errors.push("lens_omit_reason: 120자 이하입니다");
  if (lens !== null && omit !== "") errors.push("lens_omit_reason: 박스와 생략 사유는 둘 중 하나만 적습니다");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { slug, structure_type: type as StructureType, title, summary: summary === "" ? null : summary, diagram, notes, lens: lens as Record<string, unknown> | null, lens_omit_reason: omit === "" ? null : omit },
  };
}

export function parseLegalCheck(body: Record<string, unknown>): Parsed<{ slug: string; checked_by: string; checked_on: string | null }> {
  const errors: string[] = [];
  const slug = str(body.slug);
  if (!SLUG_RE.test(slug)) errors.push("slug: 주소 이름을 확인하세요");
  const by = str(body.checked_by);
  if (!inRange(by, FINANCE_LIMITS.provider)) errors.push("checked_by: 법률 확인자 이름은 1~60자입니다");
  const on = str(body.checked_on);
  if (on !== "" && !validDate(on)) errors.push("checked_on: YYYY-MM-DD 날짜입니다 (비우면 오늘)");
  return errors.length ? { ok: false, errors } : { ok: true, value: { slug, checked_by: by, checked_on: on === "" ? null : on } };
}

export function parseSign(body: Record<string, unknown>): Parsed<{ slug: string; updated_at: string }> {
  const errors: string[] = [];
  const slug = str(body.slug);
  if (!SLUG_RE.test(slug)) errors.push("slug: 주소 이름을 확인하세요");
  const at = str(body.updated_at);
  if (at === "" || Number.isNaN(Date.parse(at))) errors.push("updated_at: 읽은 초안의 저장 시각이 필요합니다 — 새로 불러온 뒤 서명하세요");
  return errors.length ? { ok: false, errors } : { ok: true, value: { slug, updated_at: at } };
}

interface Source {
  provider: string;
  source_url: string;
  snapshot_id: number | null;
  snapshot_payload: string | null;
}
function parseSource(body: Record<string, unknown>, errors: string[]): Source {
  const provider = str(body.provider);
  if (!inRange(provider, FINANCE_LIMITS.provider)) errors.push(`provider: 제공기관은 1~${FINANCE_LIMITS.provider}자입니다`);
  const url = str(body.source_url);
  if (!URL_RE.test(url) || url.length > 500) errors.push("source_url: http(s)로 시작하는 500자 이하 원문 주소입니다");
  const idText = str(body.snapshot_id);
  const id = /^\d+$/.test(idText) ? Number(idText) : null;
  const payload = typeof body.snapshot_payload === "string" && body.snapshot_payload.trim() !== "" ? body.snapshot_payload : null;
  if (payload !== null && payload.length > FINANCE_LIMITS.payload) errors.push(`snapshot_payload: ${FINANCE_LIMITS.payload}자 이하입니다`);
  const idOk = id !== null && Number.isSafeInteger(id) && id > 0;
  if (!idOk && payload === null) errors.push("snapshot_id: 원본 스냅샷 번호 또는 원문 글자(snapshot_payload) 중 하나가 필요합니다");
  return { provider, source_url: url, snapshot_id: idOk ? id : null, snapshot_payload: payload };
}

export interface IndicatorInput extends Source {
  indicator_key: string;
  label: string;
  definition: string;
  value: number;
  unit: string;
  as_of: string;
  collected_on: string;
}
export function parseIndicator(body: Record<string, unknown>): Parsed<IndicatorInput> {
  const errors: string[] = [];
  const key = str(body.indicator_key);
  if (!KEY_RE.test(key)) errors.push("indicator_key: 영문 소문자로 시작하는 영문 소문자·숫자·밑줄 2~40자입니다");
  const label = str(body.label);
  if (!inRange(label, FINANCE_LIMITS.label)) errors.push(`label: 1~${FINANCE_LIMITS.label}자입니다`);
  const definition = str(body.definition);
  if (!inRange(definition, FINANCE_LIMITS.definition)) errors.push(`definition: 지표 정의(분모·기간)는 1~${FINANCE_LIMITS.definition}자입니다`);
  const valueText = str(body.value);
  const value = valueText === "" ? NaN : Number(valueText);
  if (!Number.isFinite(value)) errors.push("value: 숫자입니다");
  const unit = str(body.unit);
  if (!inRange(unit, FINANCE_LIMITS.unit)) errors.push(`unit: 단위는 1~${FINANCE_LIMITS.unit}자입니다`);
  const asOf = str(body.as_of);
  if (!validDate(asOf)) errors.push("as_of: 기준일은 YYYY-MM-DD 입니다");
  const collected = str(body.collected_on);
  if (!validDate(collected)) errors.push("collected_on: 수집일은 YYYY-MM-DD 입니다");
  const src = parseSource(body, errors);
  return errors.length ? { ok: false, errors } : { ok: true, value: { indicator_key: key, label, definition, value, unit, as_of: asOf, collected_on: collected, ...src } };
}

export interface RegulationInput extends Source {
  reg_key: string;
  title: string;
  stage: string;
  effective_on: string;
}
export function parseRegulation(body: Record<string, unknown>): Parsed<RegulationInput> {
  const errors: string[] = [];
  const key = str(body.reg_key);
  if (!KEY_RE.test(key)) errors.push("reg_key: 영문 소문자로 시작하는 영문 소문자·숫자·밑줄 2~40자입니다");
  const title = str(body.title);
  if (!inRange(title, FINANCE_LIMITS.title)) errors.push(`title: 1~${FINANCE_LIMITS.title}자입니다`);
  const stage = str(body.stage);
  if (!inRange(stage, FINANCE_LIMITS.stage)) errors.push(`stage: 단계는 1~${FINANCE_LIMITS.stage}자입니다`);
  const on = str(body.effective_on);
  if (!validDate(on)) errors.push("effective_on: 시행 예정일은 YYYY-MM-DD 입니다");
  const src = parseSource(body, errors);
  return errors.length ? { ok: false, errors } : { ok: true, value: { reg_key: key, title, stage, effective_on: on, ...src } };
}

export interface CaseInput {
  article_id: number;
  structure_type: StructureType;
  issues: string[];
  outcome: string | null;
  named_company: boolean;
  rebuttal_requested_at: string | null;
  rebuttal_method: string | null;
  rebuttal_status: string | null;
  rebuttal_note: string | null;
  judgment_quoted: boolean;
  anonymized_checked: boolean;
}
export function parseCase(body: Record<string, unknown>): Parsed<CaseInput> {
  const errors: string[] = [];
  const id = Number(body.article_id);
  if (!Number.isSafeInteger(id) || id <= 0) errors.push("article_id: 기사 번호입니다");
  const type = str(body.structure_type);
  if (!(STRUCTURE_TYPES as readonly string[]).includes(type)) errors.push(`structure_type: ${STRUCTURE_TYPES.join("·")} 중 하나입니다`);
  const rawIssues = Array.isArray(body.issues) ? body.issues : typeof body.issues === "string" ? body.issues.split(/\r?\n/) : [];
  const issues = rawIssues.map(str).filter((s) => s !== "");
  if (issues.length > FINANCE_LIMITS.issues || issues.some((s) => s.length > FINANCE_LIMITS.issueChars)) errors.push(`issues: 쟁점은 ${FINANCE_LIMITS.issues}개까지, 항목마다 ${FINANCE_LIMITS.issueChars}자 이하입니다`);
  const outcome = str(body.outcome);
  if (outcome.length > FINANCE_LIMITS.outcome) errors.push(`outcome: ${FINANCE_LIMITS.outcome}자 이하입니다`);
  const at = str(body.rebuttal_requested_at);
  if (at !== "" && Number.isNaN(Date.parse(at))) errors.push("rebuttal_requested_at: 날짜(시각)입니다");
  const method = str(body.rebuttal_method);
  if (method !== "" && !(REBUTTAL_METHODS as readonly string[]).includes(method)) errors.push(`rebuttal_method: ${REBUTTAL_METHODS.join("·")} 중 하나입니다`);
  const status = str(body.rebuttal_status);
  if (status !== "" && !(REBUTTAL_STATUSES as readonly string[]).includes(status)) errors.push(`rebuttal_status: ${REBUTTAL_STATUSES.join("·")} 중 하나입니다`);
  const note = str(body.rebuttal_note);
  if (note.length > 500) errors.push("rebuttal_note: 500자 이하입니다");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      article_id: id,
      structure_type: type as StructureType,
      issues,
      outcome: outcome === "" ? null : outcome,
      named_company: body.named_company === true,
      rebuttal_requested_at: at === "" ? null : new Date(at).toISOString(),
      rebuttal_method: method === "" ? null : method,
      rebuttal_status: status === "" ? null : status,
      rebuttal_note: note === "" ? null : note,
      judgment_quoted: body.judgment_quoted === true,
      anonymized_checked: body.anonymized_checked === true,
    },
  };
}

export interface InterestItemInput {
  item: (typeof INTEREST_ITEMS)[number];
  state: "declared" | "none_confirmed";
  interest_text: string | null;
  confirmed_by: string | null;
}
export function parseInterestItems(body: Record<string, unknown>): Parsed<{ article_id: number; items: InterestItemInput[] }> {
  const errors: string[] = [];
  const id = Number(body.article_id);
  if (!Number.isSafeInteger(id) || id <= 0) errors.push("article_id: 기사 번호입니다");
  const raw = Array.isArray(body.items) ? body.items : [];
  if (raw.length < 1 || raw.length > INTEREST_ITEMS.length) errors.push("items: 소속 금융사·소속 신탁사 항목 1~2개입니다");
  const items: InterestItemInput[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const it = isObj(r) ? str(r.item) : "";
    const state = isObj(r) ? str(r.state) : "";
    if (!(INTEREST_ITEMS as readonly string[]).includes(it) || seen.has(it)) {
      errors.push(`items: 항목은 ${INTEREST_ITEMS.join("·")} 중 하나씩입니다`);
      break;
    }
    seen.add(it);
    const label = INTEREST_ITEM_LABELS[it as InterestItemInput["item"]];
    const text = isObj(r) ? str(r.interest_text) : "";
    const by = isObj(r) ? str(r.confirmed_by) : "";
    if (state === "declared") {
      if (text === "" || text.length > 300) errors.push(`items: ${label} — 내용은 1~300자입니다`);
      items.push({ item: it as InterestItemInput["item"], state: "declared", interest_text: text, confirmed_by: null });
    } else if (state === "none_confirmed") {
      if (by === "" || by.length > 60) errors.push(`items: ${label} — '없음'은 필자 확인자 이름(1~60자)과 함께만 저장됩니다`);
      items.push({ item: it as InterestItemInput["item"], state: "none_confirmed", interest_text: null, confirmed_by: by });
    } else errors.push("items: state는 declared(내용) 또는 none_confirmed(없음)입니다");
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { article_id: id, items } };
}

export function parseLegalReview(body: Record<string, unknown>): Parsed<{ reviewer: string; reviewed_on: string; conclusion: "approved" | "rejected" }> {
  const errors: string[] = [];
  const reviewer = str(body.reviewer);
  if (!inRange(reviewer, 60)) errors.push("reviewer: 법률 검토자 이름은 1~60자입니다");
  const on = str(body.reviewed_on);
  if (!validDate(on)) errors.push("reviewed_on: YYYY-MM-DD 입니다");
  const c = str(body.conclusion);
  if (c !== "approved" && c !== "rejected") errors.push("conclusion: approved(승인) 또는 rejected(반려)입니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: { reviewer, reviewed_on: on, conclusion: c as "approved" | "rejected" } };
}

/** 설정 finance_legal_review 규칙 (설정 화면용 — DB finance_settings_guard와 같다) */
export function legalReviewSettingErrors(value: unknown): string[] {
  if (!isObj(value)) return ["법률 검토 기록은 { reviewer, reviewed_on, conclusion } 객체(또는 빈 객체 {})입니다"];
  if (Object.keys(value).length === 0) return [];
  const p = parseLegalReview(value);
  const extra = Object.keys(value).filter((k) => !["reviewer", "reviewed_on", "conclusion"].includes(k));
  return p.ok && extra.length === 0 ? [] : [...(p.ok ? [] : p.errors), ...(extra.length ? [`알 수 없는 칸: ${extra.join("·")}`] : [])];
}
export function blockedDomainsErrors(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) return ["차단 도메인은 100개까지의 목록입니다"];
  const re = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/;
  if (value.some((d) => typeof d !== "string" || !re.test(d))) return ["차단 도메인은 소문자 도메인 이름입니다 (예: example.test)"];
  return new Set(value).size === value.length ? [] : ["같은 차단 도메인이 두 번 있습니다"];
}
export function rebuttalWaitErrors(value: unknown): string[] {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 365 ? [] : ["반론 무응답 인정 기간은 1~365 사이 정수(일)입니다"];
}

/** 켜기 사전 검사 문장 (설정 API가 DB 트리거 전에 알린다) */
export function financeEnableErrors(review: unknown): string[] {
  if (!isObj(review) || review.conclusion !== "approved" || str(review.reviewer) === "" || str(review.reviewed_on) === "") {
    return ["법률 검토 기록(검토자·일자·결론 approved)이 없습니다 — 개발금융 관리 화면에서 먼저 남기세요 (DF-05)"];
  }
  return [];
}
