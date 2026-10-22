// 기사 작성·수정 계획 — 입력 → DB 칸 값. 순수 함수 (시험: plan.test.ts)
//  · 발행 전 수정: 새 버전 + 수정 이력. 편집 승인은 버전마다라 다시 받아야 한다 → 편집 승인 상태 pending, 승인됨(approved) 상태는 검토 중으로.
//  · 발행 뒤 수정: 수정 종류·사유(ART-05). 실질 수정·정정만 실질 수정일(substantive_updated_at = dateModified)을 바꾼다 (OPT-07).
//  · 「지방세로 읽기」: 박스 내용이 그대로면 감수 표시를 새 버전으로 옮기고, 바뀌면 감수 버전에 멈춰 '재감수 필요'가 된다 (CORE-01).
import { changesDateModified, type UpdateKind } from "@ltr/editorial";
import { readStoredTaxLens, sameTaxLensContent, withChecklists, type Checklists, type StoredTaxLens, type TaxLensInput } from "./content";
import type { ArticleInput } from "./input";
import type { ArticleRow } from "./rows";

/** API 칸 → DB 칸 (그대로 옮기는 것) */
const DIRECT: [keyof ArticleInput, keyof ArticleRow][] = [
  ["slug", "slug"],
  ["title", "title"],
  ["summary", "summary"],
  ["body", "body"],
  ["format", "format"],
  ["section", "section"],
  ["contentType", "content_type"],
  ["reportingMethod", "reporting_method"],
  ["categoryId", "category_id"],
  ["subtype", "subtype"],
  ["solvedCase", "solved_case"],
  ["label", "label"],
  ["partnerId", "partner_id"],
  ["storyAssignmentId", "story_assignment_id"],
  ["leadMediaId", "lead_media_id"],
  ["legalBasisDate", "legal_basis_date"],
  ["digestId", "digest_id"],
  ["amendmentId", "amendment_id"],
  ["regionCodes", "region_codes"],
  ["editorialField", "editorial_field"],
  ["publicQuestion", "public_question"],
  ["subjectKind", "subject_kind"],
  ["relationTypes", "relation_types"],
  ["coveredPartnerIds", "covered_partner_ids"],
  ["interestDisclosure", "interest_disclosure"],
  ["seriesTitle", "series_title"],
  ["seriesEpisode", "series_episode"],
];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** 입력 박스 → 저장 박스. 감수 표시는 이전 박스에서만 이어받는다(입력으로 받지 않는다) */
export function storeTaxLens(input: TaxLensInput | null, before: StoredTaxLens | null, beforeVersion: number, newVersion: number): StoredTaxLens | null {
  if (input === null) return null;
  const next: StoredTaxLens = {
    topics: input.topics,
    points: input.points,
    links: input.links,
    skip_reason: input.omissionReason,
    reviewed: false,
    reviewed_for_version: null,
    reviewed_by: null,
    reviewed_at: null,
  };
  return carryReview(next, before, beforeVersion, newVersion);
}

/** 감수 표시와 서명 기록(서명자·시각)은 함께 움직인다 — 박스가 그대로면 새 버전으로, 고쳤으면 감수한 버전에 멈춘다 */
function carryReview(next: StoredTaxLens, before: StoredTaxLens | null, beforeVersion: number, newVersion: number): StoredTaxLens {
  if (!before) return next;
  const signature = { reviewed_by: before.reviewed_by, reviewed_at: before.reviewed_at };
  if (sameTaxLensContent(before, next)) {
    const carried = before.reviewed && before.reviewed_for_version === beforeVersion ? newVersion : before.reviewed_for_version;
    return { ...next, reviewed: before.reviewed, reviewed_for_version: carried, ...signature };
  }
  // 박스를 고쳤다 — 감수 버전에 멈춘다 (재감수 필요). 감수 기록이 없던 박스는 감수 안 됨 그대로
  return { ...next, reviewed: before.reviewed, reviewed_for_version: before.reviewed_for_version, ...signature };
}

export interface CreatePlan {
  columns: Record<string, unknown>;
}

export function planCreate(input: ArticleInput, authorId: number, checklists: Checklists): CreatePlan {
  const columns: Record<string, unknown> = { origin: "new", status: "draft", version: 1, author_id: authorId };
  for (const [from, to] of DIRECT) if (input[from] !== undefined) columns[to] = input[from];
  if (input.taxLens !== undefined) columns.tax_lens = storeTaxLens(input.taxLens, null, 0, 1);
  columns.check_log = withChecklists(null, checklists);
  return { columns };
}

export interface EditPlan {
  /** 바꿀 DB 칸 (version 제외 — saveNewVersion이 올린다) */
  columns: Record<string, unknown>;
  /** 실제로 바뀐 입력 칸 이름 */
  changed: string[];
  /** 저장 뒤 모습 — 저장 전에 판정을 돌려 본다 */
  candidate: ArticleRow;
  /** 생략 사유가 새로 생기거나 바뀜 — 편집 책임자만 (CORE-01) */
  omissionReasonChanged: boolean;
  titleChanged: boolean;
}

export interface EditOptions {
  now: string;
  /** 발행 뒤 수정의 종류 — 발행 전이면 null */
  updateKind: UpdateKind | null;
  reason: string | null;
  /** 확인 목록을 바꾸면 그 값 (안 바꾸면 undefined) */
  checklists?: Checklists;
}

export function planEdit(before: ArticleRow, input: ArticleInput, opts: EditOptions): EditPlan {
  const columns: Record<string, unknown> = {};
  const changed: string[] = [];
  for (const [from, to] of DIRECT) {
    const v = input[from];
    if (v === undefined || same(v, before[to])) continue;
    columns[to] = v;
    changed.push(from);
  }

  const newVersion = before.version + 1;
  const beforeLens = readStoredTaxLens(before.tax_lens);
  const nextLens =
    input.taxLens !== undefined ? storeTaxLens(input.taxLens, beforeLens, before.version, newVersion) : beforeLens && carryReview(beforeLens, beforeLens, before.version, newVersion);
  if (!same(nextLens, beforeLens)) columns.tax_lens = nextLens;
  if (input.taxLens !== undefined && !sameTaxLensContent(beforeLens, nextLens)) changed.push("taxLens");
  const omissionReasonChanged = (nextLens?.skip_reason ?? null) !== null && (nextLens?.skip_reason ?? null) !== (beforeLens?.skip_reason ?? null);

  if (opts.checklists !== undefined) {
    const nextLog = withChecklists(before.check_log, opts.checklists);
    if (!same(nextLog, before.check_log)) {
      columns.check_log = nextLog;
      changed.push("checklists");
    }
  }

  const published = before.first_published_at !== null;
  if (published) {
    if (opts.updateKind !== null) {
      columns.update_kind = opts.updateKind;
      columns.updated_reason = opts.reason;
      if (changesDateModified(opts.updateKind)) columns.substantive_updated_at = opts.now;
    }
  } else {
    if (before.editorial_status !== "pending") columns.editorial_status = "pending";
    if (before.status === "approved") columns.status = "in_review";
  }

  const candidate = { ...before, ...columns, version: newVersion } as ArticleRow;
  return { columns, changed, candidate, omissionReasonChanged, titleChanged: "title" in columns };
}

/**
 * 세무 감수 상태 칸(표시용) — 감수 대상이면 pending, 대상이 아니면 not_required. 승인 여부 판정은 버전별 감수 기록으로 한다.
 * 발행 전 새 버전이면 이전 버전의 승인(approved)은 다시 받아야 하므로 pending으로 돌린다.
 */
export function desiredTaxReviewStatus(current: string, needsReview: boolean, newDraftVersion: boolean): string {
  if (!needsReview) return current === "pending" ? "not_required" : current;
  if (current === "not_required") return "pending";
  if (newDraftVersion && current === "approved") return "pending";
  return current;
}
