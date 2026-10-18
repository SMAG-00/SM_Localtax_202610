// 제휴 규정 버전 입력 화면(/admin/news-readiness/requirements)의 폼 값 — 순수 모듈 (시험 requirement-form.test.ts).
// 폼 → API 본문으로 바꾸고, 저장 전 검사는 규정 API와 같은 함수(lib/readiness/requirements.ts parseRequirementInput)로 한다 — 화면과 API가 같은 문장.
// 기준 숫자는 담당자가 원문을 보고 요건마다 적는다 — 이 모듈에 기본 숫자 0 (NAV-13).
import { parseRequirementInput, readStoredItems, readStoredReviewPeriod, type ArticleFilter, type RequirementItem, type RequirementRow } from "@/lib/readiness/requirements";
import type { FieldErrors } from "./form-utils";

export interface FilterFormState {
  contentTypes: string[];
  reportingMethods: string[];
  assignmentKinds: string[];
  includeLegacy: boolean;
}

export interface ItemFormState {
  key: string;
  label: string;
  metric: string;
  numerator: FilterFormState;
  denominator: FilterFormState;
  numeratorText: string;
  denominatorText: string;
  exclusionsText: string;
  hasCriterion: boolean;
  comparator: string;
  value: string;
  per: string;
  sourceRef: string;
}

export interface RequirementFormState {
  platform: string;
  title: string;
  mediaType: string;
  sourceUrl: string;
  sourceTextRef: string;
  checkedAt: string;
  effectiveFrom: string;
  effectiveTo: string;
  reviewMonths: string;
  reviewBasis: string;
  reviewText: string;
  note: string;
  items: ItemFormState[];
}

const emptyFilter = (): FilterFormState => ({ contentTypes: [], reportingMethods: [], assignmentKinds: [], includeLegacy: false });

export function emptyItemForm(): ItemFormState {
  return {
    key: "",
    label: "",
    metric: "",
    numerator: emptyFilter(),
    denominator: emptyFilter(),
    numeratorText: "",
    denominatorText: "",
    exclusionsText: "",
    hasCriterion: false,
    comparator: "gte",
    value: "",
    per: "period",
    sourceRef: "",
  };
}

export function emptyRequirementForm(): RequirementFormState {
  return {
    platform: "",
    title: "",
    mediaType: "",
    sourceUrl: "",
    sourceTextRef: "",
    checkedAt: "",
    effectiveFrom: "",
    effectiveTo: "",
    reviewMonths: "",
    reviewBasis: "",
    reviewText: "",
    note: "",
    items: [],
  };
}

const orNull = (s: string): string | null => (s.trim() === "" ? null : s.trim());

function filterOut(f: FilterFormState): ArticleFilter {
  const out: ArticleFilter = {};
  if (f.contentTypes.length) out.contentTypes = [...f.contentTypes];
  if (f.reportingMethods.length) out.reportingMethods = [...f.reportingMethods];
  if (f.assignmentKinds.length) out.assignmentKinds = [...f.assignmentKinds];
  if (f.includeLegacy) out.includeLegacy = true;
  return out;
}

/** 빈 숫자 칸은 null — API 검사가 '숫자여야 합니다'로 막는다 */
const numberOrNull = (s: string): number | null => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));

function itemOut(i: ItemFormState): Record<string, unknown> {
  const out: Record<string, unknown> = {
    key: i.key.trim(),
    label: i.label.trim(),
    metric: i.metric,
    numerator: filterOut(i.numerator),
  };
  if (i.metric === "ratio") out.denominator = filterOut(i.denominator);
  out.numeratorText = i.numeratorText.trim();
  if (i.metric === "ratio" || i.metric === "per_reporter") out.denominatorText = i.denominatorText.trim();
  out.exclusionsText = i.exclusionsText.trim();
  out.criterion = i.hasCriterion ? { comparator: i.comparator, value: numberOrNull(i.value), per: i.per } : null;
  if (i.sourceRef.trim() !== "") out.sourceRef = i.sourceRef.trim();
  return out;
}

/** API 오류 칸 경로(requirement.items[0].numeratorText) → 폼 칸 id(base-items-0-numeratorText) */
export function errorFieldId(path: string, base: string): string {
  const rest = path.replace(/^requirement\.?/, "").replace(/\[(\d+)\]/g, ".$1");
  return rest === "" ? base : `${base}-${rest.split(".").join("-")}`;
}

export type FormResult = { ok: true; body: Record<string, unknown> } | { ok: false; errors: FieldErrors; messages: string[] };

/** 폼 → API 본문 + 저장 전 검사(API와 같은 함수). 칸 오류는 칸 id → 문장, messages는 요약 */
export function requirementFormToBody(form: RequirementFormState, mode: "create" | "patch", base: string): FormResult {
  const reviewBlank = form.reviewMonths.trim() === "" && form.reviewBasis === "" && form.reviewText.trim() === "";
  const body: Record<string, unknown> = {
    ...(mode === "create" && form.platform !== "" ? { platform: form.platform } : {}),
    title: form.title.trim(),
    mediaType: orNull(form.mediaType),
    sourceUrl: orNull(form.sourceUrl),
    sourceTextRef: orNull(form.sourceTextRef),
    checkedAt: orNull(form.checkedAt),
    effectiveFrom: orNull(form.effectiveFrom),
    effectiveTo: orNull(form.effectiveTo),
    reviewPeriod: reviewBlank ? null : { months: numberOrNull(form.reviewMonths), basis: form.reviewBasis, text: form.reviewText.trim() },
    note: orNull(form.note),
    items: form.items.map(itemOut),
  };
  if (body.title === "") delete body.title; // 새 버전은 '필요합니다', 고치기는 그대로 둔다
  const checked = parseRequirementInput(body, mode);
  if (checked.ok) return { ok: true, body };
  const errors: FieldErrors = {};
  for (const m of checked.errors) {
    const at = m.indexOf(": ");
    const id = errorFieldId(at < 0 ? "requirement" : m.slice(0, at), base);
    if (!errors[id]) errors[id] = at < 0 ? m : m.slice(at + 2);
  }
  return { ok: false, errors, messages: checked.errors };
}

function filterForm(f: ArticleFilter | undefined): FilterFormState {
  return {
    contentTypes: [...(f?.contentTypes ?? [])],
    reportingMethods: [...(f?.reportingMethods ?? [])],
    assignmentKinds: [...(f?.assignmentKinds ?? [])],
    includeLegacy: f?.includeLegacy === true,
  };
}

function itemForm(i: RequirementItem): ItemFormState {
  return {
    key: i.key,
    label: i.label,
    metric: i.metric,
    numerator: filterForm(i.numerator),
    denominator: filterForm(i.denominator),
    numeratorText: i.numeratorText,
    denominatorText: i.denominatorText ?? "",
    exclusionsText: i.exclusionsText,
    hasCriterion: i.criterion !== null,
    comparator: i.criterion?.comparator ?? "gte",
    value: i.criterion ? String(i.criterion.value) : "",
    per: i.criterion?.per ?? "period",
    sourceRef: i.sourceRef ?? "",
  };
}

/** 저장된 버전 → 폼 (작성 중 버전 고치기 · 확정 버전을 바탕으로 새 버전) */
export function formFromRow(row: Pick<RequirementRow, "platform" | "title" | "media_type" | "source_url" | "source_text_ref" | "checked_at" | "effective_from" | "effective_to" | "review_period" | "requirements" | "note">): RequirementFormState {
  const period = readStoredReviewPeriod(row.review_period);
  return {
    platform: row.platform,
    title: row.title,
    mediaType: row.media_type ?? "",
    sourceUrl: row.source_url ?? "",
    sourceTextRef: row.source_text_ref ?? "",
    checkedAt: row.checked_at ?? "",
    effectiveFrom: row.effective_from ?? "",
    effectiveTo: row.effective_to ?? "",
    reviewMonths: period ? String(period.months) : "",
    reviewBasis: period?.basis ?? "",
    reviewText: period?.text ?? "",
    note: row.note ?? "",
    items: (readStoredItems(row.requirements) ?? []).map(itemForm),
  };
}
