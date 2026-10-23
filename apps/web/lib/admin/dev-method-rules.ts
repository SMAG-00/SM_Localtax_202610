// 개발방법 비교 입력 검사·상태 (W4 18단계 — PRD-01B PR-09 · PR-10 · PR-11, docs/dev/W4_설계.md 1장 18단계 · 2.1 · 2.11 · 2.13 · 6장 · 7장 4 · 12장 #151~) — 순수 모듈.
// 관리 API(/api/admin/dev-methods)가 쓰고, DB(마이그레이션 …52 — 제약·dev_methods_guard·dev_method_compare_guard·dev_method_facts_*_guard)가 한 번 더 본다(설계 8장).
//  · 방법 7행·이름·종류·순서는 고정(씨앗) — 이 모듈은 내용(근거 법령 이름·한 줄 설명·절차 단계·「지방세로 읽기」 박스)·비교 항목 6칸·숫자 요건 사실 행만 검사한다.
//  · 글은 편집국이 공식 원문을 보고 쓰고 세무 감수위원이 서명한다 — 이 모듈은 내용·숫자 요건 값을 만들지 않는다(12장 #15).
//  · 금지 표현 사전(추천·유리 단정 — 2.11)·자리 채움 글('확인 중' — PR-09)은 칸마다 422. 숫자 요건 표현(숫자 + %·㎡·개월…)은 저장하고 경고(값은 사실 행에 — PR-10).
//  · 점수·순위·추천을 뜻하는 칸 이름(2.13 사전)을 보내면 받지 않고 422 (PR-11 — 입력 폼·점수·순위 0).
import { LENS_REVIEW_STATUSES, parseLensContent, type LensReviewStatus, type Parsed, type StageLensContent } from "./project-lens-rules";
import { idOf } from "./project-rules";

/** 2.1 dev_method.slug — 고정 편집 순서 (12장 #16) */
export const DEV_METHOD_SLUGS = ["redevelopment", "reconstruction", "small-scale", "public", "trust", "renewal", "rapid-planning"] as const;
export type DevMethodSlug = (typeof DEV_METHOD_SLUGS)[number];
/** 2.1 dev_method.kind */
export const DEV_METHOD_KINDS = ["project_type", "planning_support"] as const;
export type DevMethodKind = (typeof DEV_METHOD_KINDS)[number];
export const DEV_METHOD_KIND_LABELS: Record<DevMethodKind, string> = { project_type: "사업 유형", planning_support: "계획 지원 절차" };
/** 2.1 dev_method.compare_item — 비교 항목 6칸, 순서 고정 */
export const DEV_METHOD_ITEMS = ["legal_basis", "actor", "target", "procedure", "numeric_requirements", "tax_issues"] as const;
export type DevMethodItem = (typeof DEV_METHOD_ITEMS)[number];
/** 비교 항목 글자 — PRD-01B 3.2 화면 초안 '비교 항목' 줄 */
export const DEV_METHOD_ITEM_LABELS: Record<DevMethodItem, string> = {
  legal_basis: "근거 법령",
  actor: "사업 주체",
  target: "대상",
  procedure: "주요 절차",
  numeric_requirements: "숫자 요건",
  tax_issues: "지방세 쟁점",
};
/** 2.1 dev_method.review_status (단계 템플릿과 같은 값) */
export const DEV_METHOD_REVIEW_STATUSES = LENS_REVIEW_STATUSES;
export type DevMethodReviewStatus = LensReviewStatus;

/** 한도 — DB 제약·트리거와 같은 숫자 */
export const DEV_METHOD_LIMITS = {
  legalBasisChars: 120,
  summaryChars: 300,
  stepsMax: 15,
  stepChars: 60,
  bodyChars: 300,
  labelChars: 40,
  valueChars: 40,
  unitChars: 20,
  lawRefChars: 120,
  urlChars: 500,
  reasonChars: 200,
  payloadChars: 200_000,
} as const;
export const FACT_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

/** 2.1 dev_method.placeholder — 공백·문장부호를 빼고 같으면 자리 채움 글(DB dev_method_placeholder와 같은 목록, 빈 글 포함) */
export const PLACEHOLDER_WORDS = ["확인중", "준비중", "검토중", "미정", "추후", "추후확인", "추후입력", "입력예정", "작성중", "tbd", "tba", "todo", "na"] as const;
export function isPlaceholder(text: string): boolean {
  const t = text.normalize("NFC").replace(/[\s\p{P}\p{S}·…‐‑–—―]+/gu, "").toLowerCase();
  return t === "" || (PLACEHOLDER_WORDS as readonly string[]).includes(t);
}

/** 숫자 요건 표현 — 숫자 + 요건 단위 (DB dev_method_text_has_requirement와 같은 식). 연도만 있는 날짜는 잡지 않는다 */
export const REQUIREMENT_NUMBER_RE = /[0-9][0-9,.]*\s*(?:%|％|퍼센트|㎡|제곱미터|평(?![가균일등])|개월|세대|분의|일\s*이내|년\s*(?:이내|이상|이하|미만|초과))/;

/** 2.13 점수·순위 칸 사전 (packages/db/scripts/check-rank-fields.mjs RANK_WORDS와 같다) */
export const RANK_WORDS = ["score", "rank", "rating", "grade", "recommend", "best", "favorable", "advantage", "점수", "순위", "등급", "추천", "유리"] as const;
const fold = (s: string) => s.toLowerCase().replaceAll("_", "");
export const rankWordsIn = (value: string): string[] => RANK_WORDS.filter((w) => fold(value).includes(fold(w)));
/** 요청 본문에 점수·순위·추천 칸 — 받는 칸이 없으므로 저장하지 않고 422 (PR-11) */
export function rankKeyErrors(body: Record<string, unknown>): string[] {
  return Object.keys(body)
    .filter((k) => rankWordsIn(k).length > 0)
    .map((k) => `${k}: 점수·순위·추천 칸은 받지 않습니다 — 개발방법 비교는 같은 항목을 고정 편집 순서로만 늘어놓고 어느 방식이 좋은지 판정하지 않습니다 (PR-11)`);
}

/** 금지 표현 — 사전 낱말이 든 첫 낱말 (NFC·공백 정리, DB dev_method_forbidden_hit와 같은 방식). 없으면 null */
const squash = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();
export function forbiddenHit(texts: readonly (string | null | undefined)[], phrases: readonly string[]): string | null {
  for (const p of phrases) {
    const phrase = squash(p);
    if (phrase === "") continue;
    if (texts.some((t) => typeof t === "string" && squash(t).includes(phrase))) return phrase;
  }
  return null;
}
const forbiddenMessage = (phrase: string) => `금지 표현 ‘${phrase}’ — 어느 방식이 좋은지 추천하거나 판정하지 않습니다 (PR-11 · UX-01)`;
const PLACEHOLDER_MESSAGE = "‘확인 중’·‘준비 중’ 같은 자리 채움 글은 저장하지 않습니다 — 모르는 칸은 비워 두면 그 방법이 공개되지 않습니다 (PR-09)";

export const DEV_METHOD_OPS = ["method", "compare", "fact", "review"] as const;
export type DevMethodOp = (typeof DEV_METHOD_OPS)[number];
export const REVIEW_TARGETS = ["method", "compare", "fact"] as const;
export type ReviewTarget = (typeof REVIEW_TARGETS)[number];

const chars = (s: string) => [...s].length;
const isIsoDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
/** 모르는 칸 — 칸마다 422 (점수·순위 칸은 rankKeyErrors가 따로 말한다) */
function unknownKeyErrors(body: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(body)
    .filter((k) => !allowed.includes(k) && rankWordsIn(k).length === 0)
    .map((k) => `${k}: 모르는 칸입니다`);
}
function slugOf(body: Record<string, unknown>, errors: string[]): DevMethodSlug {
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!(DEV_METHOD_SLUGS as readonly string[]).includes(slug)) errors.push(`slug: 개발방법은 ${DEV_METHOD_SLUGS.join("·")} 중 하나입니다`);
  return slug as DevMethodSlug;
}
/** 글 칸 — 필수(required)면 빈 값 422. 한도·자리 채움·금지 표현은 칸마다 */
function textField(v: unknown, field: string, max: number, required: boolean, phrases: readonly string[], errors: string[], what: string): string | null {
  if (isEmpty(v)) {
    if (required) errors.push(`${field}: ${what}이(가) 필요합니다`);
    return null;
  }
  if (typeof v !== "string") {
    errors.push(`${field}: 글자입니다`);
    return null;
  }
  const t = v.trim();
  if (chars(t) > max) errors.push(`${field}: ${max}자 이하입니다 (지금 ${chars(t)}자)`);
  if (isPlaceholder(t)) errors.push(`${field}: ${PLACEHOLDER_MESSAGE}`);
  const hit = forbiddenHit([t], phrases);
  if (hit) errors.push(`${field}: ${forbiddenMessage(hit)}`);
  return t;
}

// ── 방법 내용 ──────────────────────────────────────────

export interface DevMethodContent {
  legal_basis_name: string | null;
  summary: string;
  steps: string[];
  lens: StageLensContent | null;
}

/** 편집 칸 글(한 줄에 하나) 또는 목록 → 절차 단계 */
const stepLines = (v: unknown): unknown[] | null =>
  Array.isArray(v)
    ? v
    : typeof v === "string"
      ? v
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l !== "")
      : null;

/** 방법 내용 초안 — { slug, legal_basis_name?, summary, steps, lens? }. errors는 "칸: 문장" (박스는 lens.topics 등) */
export function parseMethodDraft(body: Record<string, unknown>, phrases: readonly string[]): Parsed<{ slug: DevMethodSlug; content: DevMethodContent }> {
  const errors: string[] = [...rankKeyErrors(body), ...unknownKeyErrors(body, ["op", "slug", "legal_basis_name", "summary", "steps", "lens"])];
  const slug = slugOf(body, errors);
  const legal = textField(body.legal_basis_name, "legal_basis_name", DEV_METHOD_LIMITS.legalBasisChars, false, phrases, errors, "근거 법령 이름");
  const summary = textField(body.summary, "summary", DEV_METHOD_LIMITS.summaryChars, true, phrases, errors, "한 줄 설명");
  const raw = stepLines(body.steps);
  const steps: string[] = [];
  if (!raw) errors.push("steps: 절차 단계 목록이어야 합니다 (한 줄에 하나)");
  else {
    if (raw.length === 0) errors.push("steps: 절차 단계를 1개 이상 적어 주세요");
    if (raw.length > DEV_METHOD_LIMITS.stepsMax) errors.push(`steps: 절차 단계는 ${DEV_METHOD_LIMITS.stepsMax}개까지입니다 (지금 ${raw.length}개)`);
    raw.forEach((s, i) => {
      if (typeof s !== "string" || s.trim() === "") return errors.push(`steps[${i}]: 빈 단계는 저장하지 않습니다`);
      const v = s.trim();
      if (chars(v) > DEV_METHOD_LIMITS.stepChars) errors.push(`steps[${i}]: 단계 이름은 ${DEV_METHOD_LIMITS.stepChars}자 이하입니다 (지금 ${chars(v)}자)`);
      if (steps.includes(v)) errors.push(`steps[${i}]: 같은 단계 ‘${v}’가 두 번 있습니다`);
      if (isPlaceholder(v)) errors.push(`steps[${i}]: ${PLACEHOLDER_MESSAGE}`);
      const hit = forbiddenHit([v], phrases);
      if (hit) errors.push(`steps[${i}]: ${forbiddenMessage(hit)}`);
      steps.push(v);
    });
  }
  let lens: StageLensContent | null = null;
  if (body.lens !== undefined && body.lens !== null) {
    if (typeof body.lens !== "object" || Array.isArray(body.lens)) errors.push("lens: 「지방세로 읽기」 박스는 { topics, points, links, base_date } 입니다");
    else {
      const extra = Object.keys(body.lens).filter((k) => !["topics", "points", "links", "base_date"].includes(k));
      for (const k of extra) errors.push(`lens.${k}: 모르는 칸입니다`);
      const c = parseLensContent(body.lens as Record<string, unknown>, phrases, "lens.");
      if (!c.ok) errors.push(...c.errors);
      else lens = c.value;
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { slug, content: { legal_basis_name: legal, summary: summary as string, steps, lens } } };
}

/** 저장 경고 — 숫자 요건 표현 (막지 않는다 — 값은 사실 행에, DB raise warning과 같은 식) */
export function contentWarnings(field: string, texts: readonly (string | null)[]): string[] {
  return texts.some((t) => t !== null && REQUIREMENT_NUMBER_RE.test(t))
    ? [`${field}: 숫자 요건 표현이 있습니다 — 저장은 됩니다. 숫자 요건 값은 기준일·감수자와 함께 사실 행에 적습니다 (PR-10 저장 경고)`]
    : [];
}
export const methodWarnings = (c: DevMethodContent) => contentWarnings("method", [c.legal_basis_name, c.summary, ...c.steps]);

/** 같은 내용인가 (서명 칸은 보지 않는다 — 박스는 칸 순서와 상관없이 세목·포인트·링크·기준일로 비교한다) */
type StoredLens = { topics: unknown; points: unknown; links?: readonly { kind: string; label: string; url: string }[]; base_date: unknown };
export function sameMethodContent(row: { legal_basis_name: string | null; summary: string | null; steps: unknown; lens: StoredLens | null }, c: DevMethodContent): boolean {
  const box = (l: StoredLens | null) => (l ? [l.topics, l.points, (l.links ?? []).map((x) => [x.kind, x.label, x.url]), l.base_date] : null);
  return JSON.stringify([row.legal_basis_name, row.summary, row.steps, box(row.lens)]) === JSON.stringify([c.legal_basis_name, c.summary, c.steps, box(c.lens)]);
}

// ── 비교 항목 ──────────────────────────────────────────

/** 비교 항목 한 칸 — { slug, item, body } */
export function parseCompareDraft(body: Record<string, unknown>, phrases: readonly string[]): Parsed<{ slug: DevMethodSlug; item: DevMethodItem; body: string }> {
  const errors: string[] = [...rankKeyErrors(body), ...unknownKeyErrors(body, ["op", "slug", "item", "body"])];
  const slug = slugOf(body, errors);
  const item = typeof body.item === "string" ? body.item.trim() : "";
  if (!(DEV_METHOD_ITEMS as readonly string[]).includes(item)) errors.push(`item: 비교 항목은 ${DEV_METHOD_ITEMS.join("·")} 중 하나입니다`);
  const text = textField(body.body, "body", DEV_METHOD_LIMITS.bodyChars, true, phrases, errors, "비교 항목 글");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { slug, item: item as DevMethodItem, body: text as string } };
}

// ── 숫자 요건 사실 행 ──────────────────────────────────

export interface DevMethodFactInput {
  slug: DevMethodSlug;
  fact_key: string;
  label: string;
  value: string;
  unit: string | null;
  law_ref: string;
  reference_date: string;
  source_url: string;
  snapshot_id: number | null;
  snapshot_payload: string | null;
  supersedes_id: number | null;
  reason: string | null;
}

/**
 * 사실 행 — 첫 판 또는 새 판(supersedes_id + reason). 기준일·근거 원문(주소 + 스냅샷 번호 또는 원문 글자)은 필수(PR-10).
 * 값·단위·근거 조문은 편집국이 공식 원문을 보고 적는다 — 이 함수는 모양만 본다
 */
export function parseFactInput(body: Record<string, unknown>, phrases: readonly string[]): Parsed<DevMethodFactInput> {
  const errors: string[] = [
    ...rankKeyErrors(body),
    ...unknownKeyErrors(body, ["op", "slug", "fact_key", "label", "value", "unit", "law_ref", "reference_date", "source_url", "snapshot_id", "snapshot_payload", "supersedes_id", "reason"]),
  ];
  const slug = slugOf(body, errors);
  const key = typeof body.fact_key === "string" ? body.fact_key.trim() : "";
  if (!FACT_KEY_RE.test(key)) errors.push("fact_key: 요건 열쇠는 영문 소문자로 시작하는 2~40자(소문자·숫자·밑줄)입니다");
  const label = textField(body.label, "label", DEV_METHOD_LIMITS.labelChars, true, phrases, errors, "요건 이름");
  const value = textField(body.value, "value", DEV_METHOD_LIMITS.valueChars, true, phrases, errors, "값");
  let unit: string | null = null;
  if (!isEmpty(body.unit)) {
    if (typeof body.unit !== "string") errors.push("unit: 글자입니다");
    else {
      unit = body.unit.trim();
      if (chars(unit) > DEV_METHOD_LIMITS.unitChars) errors.push(`unit: ${DEV_METHOD_LIMITS.unitChars}자 이하입니다`);
      const hit = forbiddenHit([unit], phrases);
      if (hit) errors.push(`unit: ${forbiddenMessage(hit)}`);
    }
  }
  const lawRef = textField(body.law_ref, "law_ref", DEV_METHOD_LIMITS.lawRefChars, true, phrases, errors, "근거 조문");
  if (!isIsoDate(body.reference_date)) errors.push("reference_date: 기준일(YYYY-MM-DD)이 필요합니다 — 기준일 없는 숫자 요건은 공개되지 않습니다 (PR-10)");
  const url = typeof body.source_url === "string" ? body.source_url.trim() : "";
  if (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > DEV_METHOD_LIMITS.urlChars) errors.push(`source_url: 근거 원문 주소(http(s), ${DEV_METHOD_LIMITS.urlChars}자까지)가 필요합니다`);
  const snapshotId = isEmpty(body.snapshot_id) ? null : idOf(body.snapshot_id);
  if (!isEmpty(body.snapshot_id) && snapshotId === null) errors.push("snapshot_id: 원본 스냅샷 번호(1 이상 정수)입니다");
  const payload = typeof body.snapshot_payload === "string" && body.snapshot_payload.trim() ? body.snapshot_payload : null;
  if (body.snapshot_payload !== undefined && body.snapshot_payload !== null && typeof body.snapshot_payload !== "string") errors.push("snapshot_payload: 원문 글자입니다");
  if (payload !== null && payload.length > DEV_METHOD_LIMITS.payloadChars) errors.push(`snapshot_payload: 원문 글자는 ${DEV_METHOD_LIMITS.payloadChars}자까지입니다`);
  if (snapshotId !== null && payload !== null) errors.push("snapshot_payload: 원본 스냅샷 번호와 원문 글자 중 하나만 넣으세요");
  if (snapshotId === null && payload === null && isEmpty(body.snapshot_id)) errors.push("snapshot_payload: 근거 원본 스냅샷(원문 글자 붙여 넣기 또는 스냅샷 번호)이 필요합니다 (PR-10)");
  const supersedes = isEmpty(body.supersedes_id) ? null : idOf(body.supersedes_id);
  if (!isEmpty(body.supersedes_id) && supersedes === null) errors.push("supersedes_id: 고치는 앞 판 번호(1 이상 정수)입니다");
  let reason: string | null = null;
  if (!isEmpty(body.reason)) {
    if (typeof body.reason !== "string") errors.push("reason: 글자입니다");
    else reason = body.reason.trim();
  }
  if (supersedes !== null && reason === null) errors.push("reason: 고친 사유가 필요합니다 — 사실 행은 덮어쓰지 않고 새 판 + 사유로 남깁니다 (PR-10)");
  if (supersedes === null && reason !== null && isEmpty(body.supersedes_id)) errors.push("reason: 사유는 고치는 판(supersedes_id)에만 적습니다 — 첫 판은 사유 없이");
  if (reason !== null && chars(reason) > DEV_METHOD_LIMITS.reasonChars) errors.push(`reason: ${DEV_METHOD_LIMITS.reasonChars}자 이하입니다`);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      slug,
      fact_key: key,
      label: label as string,
      value: value as string,
      unit,
      law_ref: lawRef as string,
      reference_date: body.reference_date as string,
      source_url: url,
      snapshot_id: snapshotId,
      snapshot_payload: payload,
      supersedes_id: supersedes,
      reason,
    },
  };
}

/** 사실 행 표 줄 (dev_method_facts) */
export interface DevMethodFactRow {
  id: number;
  method_id: number;
  fact_key: string;
  label: string;
  value: string;
  unit: string | null;
  law_ref: string;
  reference_date: string | null;
  source_url: string;
  snapshot_id: number;
  version: number;
  supersedes_id: number | null;
  reason: string | null;
  recorded_by: string;
  recorded_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}
export const FACT_COLUMNS =
  "id, method_id, fact_key, label, value, unit, law_ref, reference_date, source_url, snapshot_id, version, supersedes_id, reason, recorded_by, recorded_at, reviewed_by, reviewed_at";

/** 새 판이 최신 판과 같은 내용인가 (스냅샷은 같은 번호 — 원문 글자를 새로 붙였으면 해시로 따로 본다) */
export function sameFactContent(latest: DevMethodFactRow, input: DevMethodFactInput): boolean {
  return (
    latest.label === input.label &&
    latest.value === input.value &&
    (latest.unit ?? null) === input.unit &&
    latest.law_ref === input.law_ref &&
    latest.reference_date === input.reference_date &&
    latest.source_url === input.source_url
  );
}

// ── 서명 ──────────────────────────────────────────────

export type ReviewRequest =
  | { target: "method"; slug: DevMethodSlug; draftedAt: string }
  | { target: "compare"; slug: DevMethodSlug; item: DevMethodItem; draftedAt: string }
  | { target: "fact"; slug: DevMethodSlug; factId: number };

/** 서명 요청 — 방법·비교 항목은 화면이 읽은 초안 시각(그 사이 고쳐졌으면 409), 사실 행은 판 번호(id — 판은 바뀌지 않는다) */
export function parseReview(body: Record<string, unknown>): Parsed<ReviewRequest> {
  const errors: string[] = [...rankKeyErrors(body), ...unknownKeyErrors(body, ["op", "target", "slug", "item", "drafted_at", "fact_id"])];
  const target = typeof body.target === "string" ? body.target : "";
  if (!(REVIEW_TARGETS as readonly string[]).includes(target)) errors.push(`target: 서명 대상은 ${REVIEW_TARGETS.join("·")} 중 하나입니다`);
  const slug = slugOf(body, errors);
  const at = typeof body.drafted_at === "string" ? body.drafted_at : "";
  const needAt = target === "method" || target === "compare";
  if (needAt && (!at || Number.isNaN(Date.parse(at)))) errors.push("drafted_at: 화면이 읽은 초안 시각이 필요합니다 — 새로 불러온 뒤 서명하세요");
  const item = typeof body.item === "string" ? body.item.trim() : "";
  if (target === "compare" && !(DEV_METHOD_ITEMS as readonly string[]).includes(item)) errors.push(`item: 비교 항목은 ${DEV_METHOD_ITEMS.join("·")} 중 하나입니다`);
  const factId = idOf(body.fact_id);
  if (target === "fact" && factId === null) errors.push("fact_id: 서명할 사실 행 번호가 필요합니다");
  if (errors.length) return { ok: false, errors };
  if (target === "method") return { ok: true, value: { target, slug, draftedAt: at } };
  if (target === "compare") return { ok: true, value: { target, slug, item: item as DevMethodItem, draftedAt: at } };
  return { ok: true, value: { target: "fact", slug, factId: factId as number } };
}

// ── 공개 준비 · 기능 키 ────────────────────────────────

/** dev_method_readiness 뷰 한 줄 */
export interface DevMethodReadiness {
  slug: string;
  sort: number;
  method_signed: boolean;
  compare_unsigned: string[];
  ready: boolean;
}

/** 기능 키 dev_methods를 새로 켤 때 — 7개 방법이 모두 공개 준비가 아니면 방법마다 사유 (DB settings_dev_methods_flag_guard와 같은 조건, 2.4) */
export function devMethodsEnableErrors(rows: readonly DevMethodReadiness[]): string[] {
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const errors: string[] = [];
  for (const slug of DEV_METHOD_SLUGS) {
    const r = bySlug.get(slug);
    if (!r) {
      errors.push(`feature_flags.dev_methods: ${slug} — 방법 행이 없습니다`);
      continue;
    }
    if (r.ready) continue;
    const why: string[] = [];
    if (!r.method_signed) why.push("방법 내용 세무 감수 서명 없음");
    const items = (r.compare_unsigned ?? []).filter((i): i is DevMethodItem => (DEV_METHOD_ITEMS as readonly string[]).includes(i));
    if (items.length) why.push(`비교 항목 서명 전·빈 칸: ${items.map((i) => DEV_METHOD_ITEM_LABELS[i]).join("·")}`);
    errors.push(`feature_flags.dev_methods: ${slug} — ${why.join(" · ") || "공개 준비 전"} (7개 방법의 비교 항목 6칸과 세무 감수 서명이 모두 있어야 켭니다 — 2.4)`);
  }
  return errors;
}
