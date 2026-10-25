// 페이월 화면의 순수 로직 (W10-f, BIZ-04) - 본문 문단 나누기, 유료 콘텐츠 구조화 데이터.
//  · 유료 콘텐츠 구조화 데이터(PRD-02 12장)는 @ltr/structured-data 생성기 paywalledArticle + components/site/JsonLd.tsx 한 곳으로만 낸다(이 파일에는 JSON-LD 글자 0).
//  · 구독자에게 보여 주는 본문도 이 함수로 문단만 나눠 글자 그대로 그린다(HTML로 해석하지 않는다).

export interface PaywallPreview {
  kind: "article" | "brief" | "interpretation";
  refKey: string;
  articleId: number | null;
  slug: string | null;
  title: string;
  preview: string;
  firstPublishedAt: string | null;
}

export function paragraphsOf(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** 유료 구간 표시용 선택자 - 구조화 데이터(생성기 paywalledArticle)와 화면(PaywallArticle)이 같은 값을 쓴다 */
export const PAYWALL_SELECTOR = "[data-part='paywall-body']";
