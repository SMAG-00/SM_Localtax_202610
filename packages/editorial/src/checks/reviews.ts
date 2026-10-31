// NAV-03 편집 승인과 세무 감수는 서로 다른 상태 · NAV-12 작성 기자 본인 승인 거부 · 세무 감수 대상(ART-01·NAV-11·NAV-12·CAT-05)
// 본인 발행 (2026-10-31 PO 결정): 편집 책임자가 세무 감수가 필요 없는 자기 글(칼럼 제외)을 checklist.selfPublish로 승인하면 편집 승인으로 센다
import { finding, type Finding } from "../findings";
import { TAX_REVIEW_SOURCE_TYPES, type ArticleForPublish, type EditorialReview, type ReviewKind } from "../model";
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
  if (
    (article.contentType === "explainer" || article.contentType === "guide") &&
    article.sources.some((s) => (TAX_REVIEW_SOURCE_TYPES as readonly string[]).includes(s.sourceType ?? ""))
  ) {
    reasons.push("고시·조례 자료를 쓴 해설 (REG1-07)");
  }
  return reasons;
}

/**
 * 본인 발행(2026-10-31 PO 결정)을 내용 기준으로 막는 이유 — null이면 내용상 본인 발행할 수 있는 글이다.
 * 편집 책임자가 세무 감수가 필요 없는 자기 글을 승인·발행하는 경우만 허용하고, 칼럼(opinion)은 제외한다 (BR-08).
 * 작성자 본인인지·editor 역할인지·DB 세무 감수 상태(not_required)는 접근 판정(apps/web lib/access)과 서버·DB 트리거가 본다.
 */
export function selfPublishProblem(article: ArticleForPublish): string | null {
  if (article.contentType === "opinion") return "칼럼(opinion)은 본인 발행할 수 없습니다 — 다른 편집 책임자가 승인·발행합니다 (BR-08)";
  const reasons = taxReviewReasons(article);
  if (reasons.length > 0) {
    return `세금 내용이 있는 글은 본인 발행할 수 없습니다 — 세무 감수와 다른 편집자의 승인이 필요합니다 (대상 이유: ${reasons.join(", ")})`;
  }
  return null;
}

/** 본인 발행 표시가 있는 편집 승인 기록 — checklist.selfPublish가 참값(true)일 때만 */
export function isSelfPublishReview(review: EditorialReview): boolean {
  return review.kind === "desk_edit" && review.checklist?.selfPublish === true;
}

/** 작성 기자 본인의 편집 승인 중 본인 발행으로 인정하는 것 — 표시가 있고 글이 내용상 본인 발행 대상일 때 */
function countsAsSelfPublish(article: ArticleForPublish, review: EditorialReview): boolean {
  return isSelfPublishReview(review) && review.decision === "approve" && selfPublishProblem(article) === null;
}

/** 편집 승인 판정에 넣는 기록인가 — 작성 기자가 아닌 사람의 기록, 또는 인정되는 본인 발행 승인 (isApproved·지역 기사 3항목 판정 공용) */
export function countsAsDeskReview(article: ArticleForPublish, review: EditorialReview): boolean {
  return review.reviewerUserId !== article.authorUserId || countsAsSelfPublish(article, review);
}

function signedTime(signedAt: string | null): number | null {
  if (signedAt === null) return null;
  const t = Date.parse(signedAt);
  return Number.isNaN(t) ? null : t;
}

/**
 * 현재 버전의 승인 여부 — 그 종류의 서명된 기록 중 가장 늦은 결정이 approve일 때만 승인이다.
 * 편집 승인(desk_edit)은 작성 기자 본인의 기록을 세지 않는다 (NAV-12) — 본인 발행 표시가 있고 내용상 본인 발행 대상인 승인만 예외다.
 */
export function isApproved(article: ArticleForPublish, kind: ReviewKind): boolean {
  let latestTime = Number.NEGATIVE_INFINITY;
  let approved = false;
  for (const review of article.reviews) {
    if (review.kind !== kind || review.forVersion !== article.version) continue;
    if (kind === "desk_edit" && !countsAsDeskReview(article, review)) continue;
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
    const selfApproved = article.reviews.filter(
      (r) =>
        r.kind === "desk_edit" &&
        r.decision === "approve" &&
        r.forVersion === article.version &&
        r.reviewerUserId === author &&
        !countsAsSelfPublish(article, r),
    );
    if (selfApproved.length > 0) {
      // 본인 발행 표시가 있었는데 내용상 대상이 아니면(세금 내용이 생김·칼럼) 그 이유를 적는다
      const problem = selfApproved.some(isSelfPublishReview) ? selfPublishProblem(article) : null;
      out.push(
        finding("nav12.self-desk-edit", problem ?? "작성 기자 본인의 편집 승인은 승인으로 치지 않습니다 — 다른 편집자가 승인해야 합니다", {
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
