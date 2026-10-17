/**
 * 화면에서 읽은 값 견본 — 견본 화면 데이터 객체를 그린 페이지에 실제로 보이는 값을 손으로 적었다.
 * (생성기 코드로 만들지 않는다 — 같은 코드로 만들면 대조 시험이 아무것도 검사하지 않는다)
 */
import type { RenderedFacts } from "../src/compare";

/** samples.sampleArticle 화면 */
export const renderedArticle: RenderedFacts = {
  title: "취득세 감면 신청 기한, 잔금일로부터 60일 안에 해야",
  authorNames: ["한예린"],
  datePublished: "2026-10-20T09:00:00+09:00",
  dateModified: "2026-10-21T14:30:00+09:00",
  mainImageUrl: "https://news.example/images/2026/10/relief-deadline.jpg",
};

/** samples.sampleAdArticle 화면 — 제목 앞 광고 표기 */
export const renderedAdArticle: RenderedFacts = {
  title: "[광고] 지방세 신고, 앱 하나로 챙기는 법",
  authorNames: ["가상지방세신문 광고국"],
  datePublished: "2026-10-19T08:00:00+09:00",
  mainImageUrl: "https://news.example/images/2026/10/tax-app.jpg",
};

/** samples.sampleEvent 화면 */
export const renderedEvent: RenderedFacts = {
  title: "예시시 2027년도 예산안 주민설명회",
  event: {
    startDate: "2026-11-03T14:00:00+09:00",
    endDate: "2026-11-03T16:00:00+09:00",
    status: "예정",
    locationName: "예시시청 대회의실",
  },
};
