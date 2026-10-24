// ART-01 기사 CMS 기본 — 분야·유형 필수, 취재 방식은 보도기사만, sponsored 표기, digest 회차, 예약 slug
import { finding, type Finding } from "../findings";
import type { ArticleForPublish } from "../model";
import { isBlank } from "../text";

/** `/news/` 아래 목록 경로 이름 — 기사 slug로 쓸 수 없다 */
export const RESERVED_SLUGS: readonly string[] = ["video", "photo", "popular"];

export function checkArticleBasics(article: ArticleForPublish): Finding[] {
  const out: Finding[] = [];
  const type = article.contentType;
  if (article.section === null) {
    out.push(finding("art01.section-required", "분야(지방세·부동산·부동산금융·지자체뉴스)를 골라 주세요"));
  }
  if (type === null) {
    out.push(finding("art01.content-type-required", "기사 유형을 골라 주세요 — 분류 전 이관 기사는 발행할 수 없습니다"));
  }
  if (type === "reported_news" && article.reportingMethod === null) {
    out.push(finding("art01.reporting-method-required", "보도기사는 취재 방식(정량형·정성형·혼합형)을 골라야 발행됩니다"));
  }
  if (type !== null && type !== "reported_news" && article.reportingMethod !== null) {
    out.push(finding("art01.reporting-method-not-allowed", "취재 방식은 보도기사에만 씁니다 — 이 유형에서는 비워 주세요"));
  }
  if (type === "sponsored" && article.label === "none") {
    out.push(finding("art01.sponsored-label-required", "광고·협찬 기사는 표기(공동 기획 또는 광고)를 골라야 합니다"));
  }
  if (type === "digest" && isBlank(article.digestId)) {
    out.push(finding("art01.digest-link-required", "금주 핫뉴스는 주간 회차를 연결해야 합니다"));
  }
  if (RESERVED_SLUGS.includes(article.slug.trim().toLowerCase())) {
    out.push(
      finding("art01.reserved-slug", `slug ‘${article.slug}’는 목록 경로 이름이라 쓸 수 없습니다`, { field: "slug", phrase: article.slug }),
    );
  }
  return out;
}
