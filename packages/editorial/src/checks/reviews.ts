// NAV-03 편집 승인과 세무 감수는 서로 다른 상태 · NAV-12 작성 기자 본인 승인 거부 · 세무 감수 대상(ART-01·NAV-11·NAV-12·CAT-05)
import { finding, type Finding } from "../findings";
import type { ArticleForPublish, ReviewKind } from "../model";
import { isBlank } from "../text";

/** 세무 감수 서명이 필요한 이유 — 빈 목록이면 감수 대상이 아니다 */
export function taxReviewReasons(article: ArticleForPublish): string[] {
  const reasons: string[] = [];
  if (article.hasTaxOrLegalClaims || article.claims.some((c) => c.kind !== "fact")) reasons.push("세금 계산·법률 주장 (NAV-12)");
  if ((article.contentType === "explainer" || article.contentType === "guide") && article.category?.needsDisclaimer === true) {
    reasons.push("면책 대상 분야의 해설·가이드 (ART-01)");
  }
  if (article.isTaxIssue) reasons.push("세금 쟁점 원고 (NAV-11)");
  if (article.subtype === "solved_case") reasons.push("해결 사례의 결과·교훈 (CAT-05)");
  return reasons;
}

function signedTime(signedAt: string | null): number | null {
  if (signedAt === null) return null;
  const t = Date.parse(signedAt);
  return Number.isNaN(t) ? null : t;
}

/**
 * 현재 버전의 승인 여부 — 그 종류의 서명된 기록 중 가장 늦은 결정이 approve일 때만 승인이다.
 * 편집 승인(desk_edit)은 작성 기자 본인의 기록을 세지 않는다 (NAV-12).
 */
export function isApproved(article: ArticleForPublish, kind: ReviewKind): boolean {
  let latestTime = Number.NEGATIVE_INFINITY;
  let approved = false;
  for (const review of article.reviews) {
    if (review.kind !== kind || review.forVersion !== article.version) continue;
    if (kind === "desk_edit" && review.reviewerUserId === article.authorUserId) continue;
    const time = signedTime(review.signedAt);
    // 같은 시각이면 뒤에 적힌 기록이 최신이다
    if (time === null || time < latestTime) continue;
    latestTime = time;
    approved = review.decision === "approve";
  }
  return approved;
}

export function checkReviews(article: ArticleForPublish): Finding[] {
  const out: Finding[] = [];
  const author = article.authorUserId;
  if (isBlank(author)) {
    out.push(finding("nav03.author-required", "작성 기자가 지정되지 않았습니다"));
  } else {
    const selfApproved = article.reviews.some(
      (r) => r.kind === "desk_edit" && r.decision === "approve" && r.forVersion === article.version && r.reviewerUserId === author,
    );
    if (selfApproved) {
      out.push(
        finding("nav12.self-desk-edit", "작성 기자 본인의 편집 승인은 승인으로 치지 않습니다 — 다른 편집자가 승인해야 합니다", {
          field: "reviews",
          phrase: author!,
        }),
      );
    }
  }
  if (!isApproved(article, "desk_edit")) {
    out.push(finding("nav03.desk-edit-required", `독립 편집자의 편집 승인(현재 버전 ${article.version})이 없습니다`));
  }
  const reasons = taxReviewReasons(article);
  if (reasons.length > 0 && !isApproved(article, "tax_review")) {
    out.push(finding("nav03.tax-review-required", `세무 감수 서명이 없습니다 — 대상 이유: ${reasons.join(", ")}`));
  }
  return out;
}
