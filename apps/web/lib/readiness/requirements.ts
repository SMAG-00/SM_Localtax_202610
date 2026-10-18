// 제휴 규정 버전 규칙 (NAV-13 — docs/dev/W2-c_설계.md 2.8·8.5) — 순수 모듈 (시험 requirements.test.ts). 규정 화면·규정 API·대시보드가 같이 쓴다.
//  · 숫자 기준(기사 수·비율·월평균)은 담당자가 원문을 보고 요건 항목(criterion)에 적는다 — 이 파일·설정에 기준 숫자 0 (NAV-13 저장소 검사)
//  · 확정 = 원문 URL·확인일·등록 유형·적용 시작일·심사 대상 기간·요건 1개 이상 + 담당자의 '원문과 실제 등록 유형을 확인했다' 표시.
//    DB 제약(news_partner_requirements_confirm_ready)도 같은 칸을 막는다. 확정된 버전은 고칠 수 없고(DB 트리거) 바뀐 규정은 새 버전이다
//  · 대시보드가 쓰는 버전 = 그 플랫폼의 확정 버전 가운데 오늘이 적용 기간 안인 것, 여럿이면 가장 늦게 확정된 것. 없으면 '요건 미확정'
import { isValidDate } from "@/lib/admin/form-utils";
import { CONTENT_TYPE_LABELS, REPORTING_METHOD_LABELS } from "@/lib/admin/labels";
import { WINDOW_BASES, type WindowBasis } from "./windows";

export const PLATFORMS = ["naver", "kakao"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABELS: Readonly<Record<Platform, string>> = { naver: "네이버", kakao: "카카오" };

export const REQUIREMENT_METRICS = ["count", "ratio", "per_reporter"] as const;
export type RequirementMetric = (typeof REQUIREMENT_METRICS)[number];
export const CRITERION_COMPARATORS = ["gte", "gt"] as const;
export type CriterionComparator = (typeof CRITERION_COMPARATORS)[number];
export const CRITERION_PER = ["period", "month"] as const;
export type CriterionPer = (typeof CRITERION_PER)[number];

export const CONTENT_TYPES = Object.keys(CONTENT_TYPE_LABELS) as (keyof typeof CONTENT_TYPE_LABELS)[];
export const REPORTING_METHODS = Object.keys(REPORTING_METHOD_LABELS) as (keyof typeof REPORTING_METHOD_LABELS)[];
/** 기사 기획 종류 (story_assignments.kind — W2-a 값 목록) */
export const ASSIGNMENT_KINDS = ["general", "feature", "investigative"] as const;
export const ASSIGNMENT_KIND_LABELS = { general: "일반", feature: "기획", investigative: "탐사" } as const;

export interface ArticleFilter {
  contentTypes?: string[];
  reportingMethods?: string[];
  assignmentKinds?: string[];
  includeLegacy?: boolean;
}

export interface Criterion {
  comparator: CriterionComparator;
  /** 비율은 % (0~100), 기사 수·기자 1인당은 건 */
  value: number;
  per: CriterionPer;
}

export interface RequirementItem {
  key: string;
  label: string;
  metric: RequirementMetric;
  numerator: ArticleFilter;
  denominator?: ArticleFilter;
  numeratorText: string;
  denominatorText?: string;
  exclusionsText: string;
  criterion: Criterion | null;
  sourceRef?: string;
}

export interface ReviewPeriod {
  months: number;
  basis: WindowBasis;
  /** 규정 원문의 기간 글자 (예: 과거 1년 중 임의의 3개월) */
  text: string;
}

/** news_partner_requirements 한 줄 (service_role이 읽는 모양) */
export interface RequirementRow {
  id: number;
  platform: string;
  version: number;
  title: string;
  media_type: string | null;
  source_url: string | null;
  source_text_ref: string | null;
  checked_at: string | null;
  effective_from: string | null;
  effective_to: string | null;
  review_period: unknown;
  requirements: unknown;
  status: string;
  supersedes_id: number | null;
  note: string | null;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
  approved_by: string | null;
  approved_at: string | null;
}

export const REQUIREMENT_COLUMNS =
  "id, platform, version, title, media_type, source_url, source_text_ref, checked_at, effective_from, effective_to, review_period, requirements, status, supersedes_id, note, created_by, created_at, updated_by, updated_at, approved_by, approved_at";

/** 확정된 버전을 고치려 할 때 (API 409 · 화면 안내 같은 문장) */
export const CONFIRMED_IMMUTABLE = "확정된 규정 버전은 고칠 수 없습니다 — '이 버전을 바탕으로 새 버전 적기'로 새 버전을 만드세요 (NAV-13)";

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const chars = (s: string) => [...s].length;
const HTTP_URL = /^https?:\/\/[^\s]+$/i;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const ITEMS_MAX = 20;
const LIMITS = { title: 100, mediaType: 60, sourceUrl: 500, sourceTextRef: 500, note: 1000, label: 60, text: 300, sourceRef: 100, reviewText: 200 } as const;

// ── 거르개 · 요건 항목 ───────────────────────────────────

const FILTER_VALUES: Record<"contentTypes" | "reportingMethods" | "assignmentKinds", readonly string[]> = {
  contentTypes: CONTENT_TYPES,
  reportingMethods: REPORTING_METHODS,
  assignmentKinds: ASSIGNMENT_KINDS,
};

function parseFilter(raw: unknown, at: string, errors: string[]): ArticleFilter | null {
  if (!isObj(raw)) {
    errors.push(`${at}: 거르개는 JSON 객체여야 합니다`);
    return null;
  }
  const out: ArticleFilter = {};
  const before = errors.length;
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (v === undefined) continue;
    if (k === "includeLegacy") {
      if (typeof v !== "boolean") errors.push(`${at}.includeLegacy: true/false여야 합니다`);
      else out.includeLegacy = v;
      continue;
    }
    const allowed = FILTER_VALUES[k as keyof typeof FILTER_VALUES];
    if (!allowed) {
      errors.push(`${at}.${k}: 모르는 칸입니다`);
      continue;
    }
    if (!Array.isArray(v)) errors.push(`${at}.${k}: 값 목록이어야 합니다`);
    else if (v.length === 0) errors.push(`${at}.${k}: 하나 이상 고르거나 칸을 빼세요`);
    else if (!v.every((x) => typeof x === "string" && allowed.includes(x))) errors.push(`${at}.${k}: ${allowed.join("·")} 중에서 고릅니다`);
    else if (new Set(v).size !== v.length) errors.push(`${at}.${k}: 같은 값이 두 번 있습니다`);
    else out[k as keyof typeof FILTER_VALUES] = [...(v as string[])];
  }
  return errors.length === before ? out : null;
}

function requiredText(raw: Obj, key: string, at: string, message: string, errors: string[], limit: number = LIMITS.text): string | null {
  const v = raw[key];
  if (typeof v !== "string" || v.trim() === "") {
    errors.push(`${at}.${key}: ${message}`);
    return null;
  }
  if (chars(v.trim()) > limit) {
    errors.push(`${at}.${key}: ${limit}자 이하로 적습니다`);
    return null;
  }
  return v.trim();
}

const ITEM_KEYS = ["key", "label", "metric", "numerator", "denominator", "numeratorText", "denominatorText", "exclusionsText", "criterion", "sourceRef"];

function parseCriterion(raw: unknown, metric: RequirementMetric | null, at: string, errors: string[]): Criterion | null {
  if (raw === null) return null;
  if (!isObj(raw)) {
    errors.push(`${at}: 기준은 { comparator, value, per } 또는 null입니다`);
    return null;
  }
  const before = errors.length;
  for (const k of Object.keys(raw)) if (!["comparator", "value", "per"].includes(k)) errors.push(`${at}.${k}: 모르는 칸입니다`);
  if (!(CRITERION_COMPARATORS as readonly unknown[]).includes(raw.comparator)) errors.push(`${at}.comparator: gte(이상)·gt(초과) 중 하나여야 합니다`);
  const value = raw.value;
  const isRatio = metric === "ratio";
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (isRatio && value > 100)) {
    errors.push(isRatio ? `${at}.value: 비율 기준은 0~100(%) 숫자여야 합니다` : `${at}.value: 0 이상 숫자여야 합니다`);
  }
  if (!(CRITERION_PER as readonly unknown[]).includes(raw.per)) errors.push(`${at}.per: period(심사 기간 전체)·month(월평균) 중 하나여야 합니다`);
  else if (isRatio && raw.per !== "period") errors.push(`${at}.per: 비율 기준은 심사 기간 전체(period)로만 봅니다`);
  return errors.length === before ? { comparator: raw.comparator as CriterionComparator, value: value as number, per: raw.per as CriterionPer } : null;
}

function parseItem(raw: unknown, at: string, errors: string[]): RequirementItem | null {
  if (!isObj(raw)) {
    errors.push(`${at}: 요건 항목은 JSON 객체여야 합니다`);
    return null;
  }
  const before = errors.length;
  for (const k of Object.keys(raw)) if (!ITEM_KEYS.includes(k)) errors.push(`${at}.${k}: 모르는 칸입니다`);
  const key = typeof raw.key === "string" && KEY.test(raw.key) ? raw.key : null;
  if (!key) errors.push(`${at}.key: 영문 소문자로 시작하고 영문 소문자·숫자·_만 씁니다 (40자)`);
  const label = requiredText(raw, "label", at, "요건 이름이 필요합니다", errors, LIMITS.label);
  const metric = (REQUIREMENT_METRICS as readonly unknown[]).includes(raw.metric) ? (raw.metric as RequirementMetric) : null;
  if (!metric) errors.push(`${at}.metric: ${REQUIREMENT_METRICS.join("·")} 중 하나여야 합니다`);
  const numerator = raw.numerator === undefined ? (errors.push(`${at}.numerator: 분자 거르개가 필요합니다`), null) : parseFilter(raw.numerator, `${at}.numerator`, errors);
  let denominator: ArticleFilter | undefined;
  if (metric === "ratio") {
    if (raw.denominator === undefined) errors.push(`${at}.denominator: 비율 요건은 분모 거르개가 필요합니다`);
    else denominator = parseFilter(raw.denominator, `${at}.denominator`, errors) ?? undefined;
  } else if (metric !== null && raw.denominator !== undefined) {
    errors.push(`${at}.denominator: 비율 요건에만 분모 거르개를 씁니다`);
  }
  const numeratorText = requiredText(raw, "numeratorText", at, "분자 정의 글자가 필요합니다", errors);
  let denominatorText: string | undefined;
  if (metric === "ratio" || metric === "per_reporter") denominatorText = requiredText(raw, "denominatorText", at, "분모 정의 글자가 필요합니다", errors) ?? undefined;
  else if (metric !== null && raw.denominatorText !== undefined && raw.denominatorText !== null && raw.denominatorText !== "") errors.push(`${at}.denominatorText: 기사 수 요건에는 분모가 없습니다`);
  const exclusionsText = requiredText(raw, "exclusionsText", at, "제외 조건 글자가 필요합니다 (없으면 '없음')", errors);
  const criterion = raw.criterion === undefined ? null : parseCriterion(raw.criterion, metric, `${at}.criterion`, errors);
  let sourceRef: string | undefined;
  if (raw.sourceRef !== undefined && raw.sourceRef !== null && raw.sourceRef !== "") {
    if (typeof raw.sourceRef !== "string" || chars(raw.sourceRef.trim()) > LIMITS.sourceRef) errors.push(`${at}.sourceRef: ${LIMITS.sourceRef}자 이하 글자여야 합니다`);
    else sourceRef = raw.sourceRef.trim();
  }
  if (errors.length !== before) return null;
  return {
    key: key!,
    label: label!,
    metric: metric!,
    numerator: numerator!,
    ...(denominator ? { denominator } : {}),
    numeratorText: numeratorText!,
    ...(denominatorText ? { denominatorText } : {}),
    exclusionsText: exclusionsText!,
    criterion,
    ...(sourceRef ? { sourceRef } : {}),
  };
}

function parseItems(raw: unknown, at: string, errors: string[]): RequirementItem[] | null {
  if (!Array.isArray(raw)) {
    errors.push(`${at}: 목록이어야 합니다`);
    return null;
  }
  if (raw.length > ITEMS_MAX) {
    errors.push(`${at}: 요건은 ${ITEMS_MAX}개까지 적습니다`);
    return null;
  }
  const before = errors.length;
  const out: RequirementItem[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const item = parseItem(r, `${at}[${i}]`, errors);
    if (!item) return;
    if (seen.has(item.key)) return errors.push(`${at}[${i}].key: 같은 key가 앞에 있습니다 (${item.key})`);
    seen.add(item.key);
    out.push(item);
  });
  return errors.length === before ? out : null;
}

function parseReviewPeriod(raw: unknown, at: string, errors: string[]): ReviewPeriod | null {
  if (!isObj(raw)) {
    errors.push(`${at}: { months, basis, text } 또는 null입니다`);
    return null;
  }
  const before = errors.length;
  for (const k of Object.keys(raw)) if (!["months", "basis", "text"].includes(k)) errors.push(`${at}.${k}: 모르는 칸입니다`);
  if (!Number.isInteger(raw.months) || (raw.months as number) < 1 || (raw.months as number) > 12) errors.push(`${at}.months: 1~12 정수여야 합니다`);
  if (!(WINDOW_BASES as readonly unknown[]).includes(raw.basis)) errors.push(`${at}.basis: ${WINDOW_BASES.join("·")} 중 하나여야 합니다`);
  if (typeof raw.text !== "string" || raw.text.trim() === "") errors.push(`${at}.text: 규정 원문의 기간 글자가 필요합니다`);
  else if (chars(raw.text.trim()) > LIMITS.reviewText) errors.push(`${at}.text: ${LIMITS.reviewText}자 이하로 적습니다`);
  return errors.length === before ? { months: raw.months as number, basis: raw.basis as WindowBasis, text: (raw.text as string).trim() } : null;
}

// ── 버전 입력 (API 본문 → DB 칸) ─────────────────────────

const TEXT_FIELDS = [
  ["title", "title"],
  ["mediaType", "media_type"],
  ["sourceUrl", "source_url"],
  ["sourceTextRef", "source_text_ref"],
  ["note", "note"],
] as const;
const DATE_FIELDS = [
  ["checkedAt", "checked_at"],
  ["effectiveFrom", "effective_from"],
  ["effectiveTo", "effective_to"],
] as const;
const INPUT_KEYS = ["platform", "supersedesId", "reviewPeriod", "items", ...TEXT_FIELDS.map(([k]) => k), ...DATE_FIELDS.map(([k]) => k)];

/** 새 버전(create)·작성 중 버전 고치기(patch) 입력 → DB 칸. 확정 조건은 confirmProblems가 따로 본다(작성 중에는 비워도 된다) */
export function parseRequirementInput(raw: Obj, mode: "create" | "patch"): Result<Obj> {
  const errors: string[] = [];
  const out: Obj = {};
  const at = (k: string) => `requirement.${k}`;
  for (const k of Object.keys(raw)) if (!INPUT_KEYS.includes(k)) errors.push(`${at(k)}: 모르는 칸입니다`);

  if (raw.platform !== undefined) {
    if (mode === "patch") errors.push(`${at("platform")}: 플랫폼은 새 버전을 만들 때만 정합니다`);
    else if (!(PLATFORMS as readonly unknown[]).includes(raw.platform)) errors.push(`${at("platform")}: ${PLATFORMS.join("·")} 중 하나여야 합니다`);
    else out.platform = raw.platform;
  } else if (mode === "create") errors.push(`${at("platform")}: 필요합니다`);

  if (raw.supersedesId !== undefined && raw.supersedesId !== null) {
    if (mode === "patch") errors.push(`${at("supersedesId")}: 이어받는 버전은 새 버전을 만들 때만 정합니다`);
    else if (!Number.isSafeInteger(raw.supersedesId) || (raw.supersedesId as number) < 1) errors.push(`${at("supersedesId")}: 버전 번호(id)여야 합니다`);
    else out.supersedes_id = raw.supersedesId;
  }

  for (const [key, column] of TEXT_FIELDS) {
    const v = raw[key];
    if (v === undefined) {
      if (key === "title" && mode === "create") errors.push(`${at("title")}: 필요합니다`);
      continue;
    }
    const limit = LIMITS[key];
    if (key === "title") {
      if (typeof v !== "string" || v.trim() === "") errors.push(`${at("title")}: 비울 수 없습니다`);
      else if (chars(v.trim()) > limit) errors.push(`${at("title")}: ${limit}자 이하로 적습니다`);
      else out[column] = v.trim();
      continue;
    }
    if (v === null || (typeof v === "string" && v.trim() === "")) out[column] = null;
    else if (typeof v !== "string" || chars(v.trim()) > limit) errors.push(`${at(key)}: ${limit}자 이하 글자여야 합니다`);
    else if (key === "sourceUrl" && !HTTP_URL.test(v.trim())) errors.push(`${at(key)}: http:// 또는 https://로 시작하는 원문 주소여야 합니다`);
    else out[column] = v.trim();
  }

  for (const [key, column] of DATE_FIELDS) {
    const v = raw[key];
    if (v === undefined) continue;
    if (v === null || v === "") out[column] = null;
    else if (typeof v !== "string" || !isValidDate(v)) errors.push(`${at(key)}: YYYY-MM-DD 날짜여야 합니다`);
    else out[column] = v;
  }
  const from = out.effective_from as string | null | undefined;
  const to = out.effective_to as string | null | undefined;
  if (from && to && to < from) errors.push(`${at("effectiveTo")}: 적용 끝날이 시작일보다 앞입니다`);

  if (raw.reviewPeriod !== undefined) {
    if (raw.reviewPeriod === null) out.review_period = null;
    else {
      const p = parseReviewPeriod(raw.reviewPeriod, at("reviewPeriod"), errors);
      if (p) out.review_period = p;
    }
  }
  if (raw.items !== undefined) {
    const items = parseItems(raw.items, at("items"), errors);
    if (items) out.requirements = items;
  }
  if (mode === "patch" && errors.length === 0 && Object.keys(out).length === 0) errors.push("requirement: 바꿀 칸이 없습니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

/** 저장된 요건 읽기 — 모양이 틀리면 null (직접 넣은 행) */
export function readStoredItems(raw: unknown): RequirementItem[] | null {
  const errors: string[] = [];
  const items = parseItems(raw, "requirements", errors);
  return errors.length ? null : items;
}

export function readStoredReviewPeriod(raw: unknown): ReviewPeriod | null {
  const errors: string[] = [];
  const p = parseReviewPeriod(raw, "review_period", errors);
  return errors.length ? null : p;
}

// ── 확정 ──────────────────────────────────────────────────

/** 확정 전 검사 — 문제가 없으면 []. attested = 담당자가 '공식 규정 원문과 우리 매체의 실제 등록 유형을 확인했다'를 표시 (NAV-13 '담당자 승인') */
export function confirmProblems(row: RequirementRow, input: { attested: boolean }, today: string): string[] {
  if (row.status === "confirmed") return ["requirement: 이미 확정된 버전입니다 — 바뀐 규정은 새 버전으로 적으세요"];
  const problems: string[] = [];
  if (!row.source_url || !HTTP_URL.test(row.source_url)) problems.push("requirement.sourceUrl: 공식 규정 원문 주소가 필요합니다");
  if (!row.checked_at) problems.push("requirement.checkedAt: 원문을 확인한 날이 필요합니다");
  else if (row.checked_at > today) problems.push(`requirement.checkedAt: 확인일이 오늘(${today})보다 뒤입니다`);
  if (!row.media_type || row.media_type.trim() === "") problems.push("requirement.mediaType: 매체 등록 유형이 필요합니다");
  if (!row.effective_from) problems.push("requirement.effectiveFrom: 적용 시작일이 필요합니다");
  if (row.review_period === null || row.review_period === undefined) problems.push("requirement.reviewPeriod: 심사 대상 기간이 필요합니다");
  else {
    const errors: string[] = [];
    parseReviewPeriod(row.review_period, "requirement.reviewPeriod", errors);
    problems.push(...errors);
  }
  if (Array.isArray(row.requirements) && row.requirements.length === 0) problems.push("requirement.items: 요건을 하나 이상 적어야 합니다");
  else {
    const errors: string[] = [];
    parseItems(row.requirements, "requirement.items", errors);
    problems.push(...errors);
  }
  if (!input.attested) problems.push("requirement.attested: 공식 규정 원문과 우리 매체의 실제 등록 유형을 확인했다는 표시가 필요합니다");
  return problems;
}

// ── 적용 버전 · 요건 미확정 ─────────────────────────────

export type PlatformState =
  | { kind: "none"; reason: string }
  | { kind: "unconfirmed"; reason: string; drafts: number }
  | { kind: "confirmed"; row: RequirementRow; items: RequirementItem[]; reviewPeriod: ReviewPeriod; drafts: number };

const effectiveOn = (r: RequirementRow, today: string) => r.effective_from !== null && r.effective_from <= today && (r.effective_to === null || r.effective_to >= today);

/** 오늘 대시보드가 쓰는 버전 — 없으면 none·unconfirmed(이유). 이 둘은 화면에서 모두 '요건 미확정'이고 기준 비교를 하지 않는다 */
export function platformState(rows: readonly RequirementRow[], platform: Platform, today: string): PlatformState {
  const mine = rows.filter((r) => r.platform === platform);
  if (mine.length === 0) return { kind: "none", reason: "등록된 규정 버전이 없습니다" };
  const drafts = mine.filter((r) => r.status !== "confirmed").length;
  const confirmed = mine.filter((r) => r.status === "confirmed");
  if (confirmed.length === 0) return { kind: "unconfirmed", reason: "작성 중인 버전만 있고 확정된 버전이 없습니다", drafts };
  const current = confirmed
    .filter((r) => effectiveOn(r, today))
    .sort((a, b) => (b.approved_at ?? "").localeCompare(a.approved_at ?? "") || b.version - a.version)[0];
  if (!current) {
    const latest = [...confirmed].sort((a, b) => b.version - a.version)[0]!;
    const span = latest.effective_from && latest.effective_from > today ? `${latest.effective_from}부터` : `${latest.effective_to ?? "?"}까지`;
    return { kind: "unconfirmed", reason: `확정된 버전이 있지만 오늘(${today})은 적용 기간 밖입니다 — ${latest.version}번 ${span}`, drafts };
  }
  const items = readStoredItems(current.requirements);
  const reviewPeriod = readStoredReviewPeriod(current.review_period);
  if (!items || items.length === 0 || !reviewPeriod) {
    return { kind: "unconfirmed", reason: `확정된 ${current.version}번의 요건 모양이 틀려 쓸 수 없습니다 — 새 버전으로 바로 적으세요`, drafts };
  }
  return { kind: "confirmed", row: current, items, reviewPeriod, drafts };
}
