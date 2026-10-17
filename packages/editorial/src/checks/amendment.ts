// CAT-04 진행 단계 배지 — 개정 브리핑(지방세 > 개정, `/tax/amendments`)은 연결 트래커가 있어야 발행된다.
// 배지 값은 트래커의 현재 단계에서 읽고 기사에 저장하지 않으므로, 판정은 연결 여부만 본다.
import { finding, type Finding } from "../findings";
import type { ArticleForPublish } from "../model";
import { isBlank } from "../text";

/** 개정 하위 분야 slug (CAT-01 1단계 하위 경로 `/tax/amendments`) */
export const AMENDMENT_CATEGORY_SLUG = "amendments";

export function isAmendmentBriefing(article: ArticleForPublish): boolean {
  return article.section === "tax" && article.category?.slug === AMENDMENT_CATEGORY_SLUG;
}

export function checkAmendment(article: ArticleForPublish): Finding[] {
  if (!isAmendmentBriefing(article) || !isBlank(article.amendmentId)) return [];
  return [finding("cat04.tracker-required", "개정 브리핑에 연결한 개정 트래커가 없습니다 — 트래커를 연결해야 진행 단계 배지가 보입니다")];
}
