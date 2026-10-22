// 검토 결정 (NAV-03 · NAV-10 · NAV-12) — 편집 승인(desk_edit)·세무 감수(tax_review) 폼 → POST /api/admin/articles/[id]/reviews 본문.
// 편집 승인 확인 항목은 NAV-12 "원자료·핵심 주장·제목·이미지·권리" 확인과 정량형의 '인과 단정 없음'(NAV-10, checklist.noCausalClaim)이다.
import { REGIONAL_DESK_CHECKLIST, REGIONAL_DESK_CHECKLIST_LABELS } from "@ltr/editorial";
import { can, type Viewer } from "@/lib/access";
import { blank, type FieldErrors } from "./form-utils";

export interface CheckItem {
  id: string;
  label: string;
}

const DESK_BASE: readonly CheckItem[] = [
  { id: "sourcesChecked", label: "원자료·출처를 확인했습니다" },
  { id: "claimsChecked", label: "핵심 주장마다 근거를 확인했습니다" },
  { id: "titleChecked", label: "제목이 본문 내용과 맞습니다" },
  { id: "imagesChecked", label: "이미지와 권리를 확인했습니다" },
];
const NO_CAUSAL: CheckItem = { id: "noCausalClaim", label: "인과 단정 없음 — 상관관계를 원인으로 단정하지 않았습니다" };

export const TAX_CHECKS: readonly CheckItem[] = [
  { id: "lawBasisChecked", label: "법령 기준일과 근거 조문을 확인했습니다" },
  { id: "taxStatementsChecked", label: "세금 문장과 「지방세로 읽기」 박스를 감수했습니다" },
];

/** 지역 기사 편집 승인 3항목 (REG1-17 — W4 7단계, checklist 키 evidence·relation·ad_independence = DB 트리거·편집 승인 API와 같다) */
export const REGIONAL_CHECKS: readonly CheckItem[] = REGIONAL_DESK_CHECKLIST.map((id) => ({ id, label: REGIONAL_DESK_CHECKLIST_LABELS[id] }));

export function deskChecksFor(reportingMethod: string | null, regional = false): CheckItem[] {
  const base = reportingMethod === "quantitative" || reportingMethod === "mixed" ? [...DESK_BASE, NO_CAUSAL] : [...DESK_BASE];
  return regional ? [...base, ...REGIONAL_CHECKS] : base;
}

/** 지역 기사 — 지역 태그가 있거나 지자체뉴스, 광고·협찬 제외 (발행 판정 isRegionalArticle·DB 트리거와 같다) */
export function isRegionalRow(row: { content_type: string | null; region_codes: readonly string[]; section: string }): boolean {
  return row.content_type !== "sponsored" && (row.region_codes.length > 0 || row.section === "local");
}

/** 편집 승인 API 422의 errors("칸: 문장") → 폼 칸 오류 — checklist.<키>는 확인 항목 칸, 나머지는 null(실패 문장으로) */
export function reviewErrorsFromServer(kind: ReviewKind, errors: readonly string[] | undefined): { fields: FieldErrors; rest: string[] } {
  const fields: FieldErrors = {};
  const rest: string[] = [];
  for (const raw of errors ?? []) {
    if (raw.startsWith("checklist.")) {
      const at = raw.indexOf(": ");
      const key = `review-${kind}-checks`;
      const msg = at > 0 ? raw.slice(at + 2) : raw;
      fields[key] = fields[key] ? `${fields[key]} · ${msg}` : msg;
    } else rest.push(raw.replace(/^interestDisclosure: /, ""));
  }
  return { fields, rest };
}

export type ReviewKind = "desk_edit" | "tax_review";

export interface ReviewForm {
  kind: ReviewKind;
  decision: "" | "approve" | "reject" | "hold";
  reason: string;
  checks: Record<string, boolean>;
}

export function checksFor(kind: ReviewKind, reportingMethod: string | null, regional = false): CheckItem[] {
  return kind === "desk_edit" ? deskChecksFor(reportingMethod, regional) : [...TAX_CHECKS];
}

export function reviewPayload(form: ReviewForm, reportingMethod: string | null, regional = false): { ok: true; body: Record<string, unknown> } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const prefix = `review-${form.kind}`;
  const items = checksFor(form.kind, reportingMethod, regional);
  if (form.decision === "") errors[`${prefix}-decision`] = "승인·반려·보류 중 하나를 골라 주세요";
  if (form.decision === "approve" && !items.every((c) => form.checks[c.id] === true)) {
    errors[`${prefix}-checks`] = "확인 항목을 모두 체크해야 승인할 수 있습니다";
  }
  if ((form.decision === "reject" || form.decision === "hold") && blank(form.reason)) errors[`${prefix}-reason`] = "반려·보류에는 사유가 필요합니다";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const checklist = form.decision === "approve" ? Object.fromEntries(items.map((c) => [c.id, true])) : {};
  const body: Record<string, unknown> = { kind: form.kind, decision: form.decision, checklist };
  if (!blank(form.reason)) body.reason = form.reason.trim();
  return { ok: true, body: { kind: body.kind, decision: body.decision, ...(body.reason ? { reason: body.reason } : {}), checklist } };
}

/** 이 사람이 할 수 있는 검토 — 접근 판정 한 함수로 묻는다 (편집 승인은 editor, 세무 감수는 reviewer) */
export function reviewKindsFor(viewer: Viewer): ReviewKind[] {
  const kinds: ReviewKind[] = [];
  if (can(viewer, "review.desk_edit")) kinds.push("desk_edit");
  if (can(viewer, "review.tax_review")) kinds.push("tax_review");
  return kinds;
}

/** 본인 기사의 편집 승인 막기 (NAV-12) — 작성 기자 인물 번호와 로그인한 사람의 인물 번호가 같으면 이유 문장 */
export function ownArticleNote(authorPersonId: number | null, viewerPersonId: number | null): string | null {
  if (authorPersonId === null || viewerPersonId === null || authorPersonId !== viewerPersonId) return null;
  return "본인 기사 — 다른 편집자가 승인합니다 (NAV-12)";
}
