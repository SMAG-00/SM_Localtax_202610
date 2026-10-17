// ART-05 정정·업데이트 표시 — 발행 뒤 수정은 수정 종류(실질 수정·오탈자·정정)와 사유가 있어야 저장된다.
// 실질 수정·정정만 실질 수정일(dateModified)을 바꾼다 (OPT-07).
import { finding, toSaveValidation, type Finding, type SaveValidation } from "../findings";
import { UPDATE_KINDS, type ArticleForPublish, type UpdateKind } from "../model";
import { isBlank } from "../text";

export interface RevisionInput {
  /** 편집 화면에서 고른 값 — 값 목록 밖이면 고르지 않은 것으로 본다 */
  updateKind: string | null | undefined;
  reason: string | null | undefined;
}

export function changesDateModified(kind: UpdateKind): boolean {
  return kind !== "typo";
}

function isUpdateKind(value: string | null | undefined): value is UpdateKind {
  return (UPDATE_KINDS as readonly string[]).includes(value ?? "");
}

export function validateRevisionForSave(input: RevisionInput): SaveValidation {
  const out: Finding[] = [];
  if (!isUpdateKind(input.updateKind)) out.push(finding("art05.update-kind-required", "수정 종류(실질 수정·오탈자·정정)를 골라 주세요"));
  if (isBlank(input.reason)) out.push(finding("art05.reason-required", "수정 사유(무엇을 고쳤는지)를 적어 주세요"));
  return toSaveValidation(out);
}

/** 이미 발행된 기사를 다시 발행할 때만 본다 */
export function checkRevision(article: ArticleForPublish): Finding[] {
  if (article.firstPublishedAt === null) return [];
  return validateRevisionForSave({ updateKind: article.updateKind, reason: article.updatedReason }).findings;
}
