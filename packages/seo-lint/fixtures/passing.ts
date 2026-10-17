// 통과 견본 원고 — 지방세 해설 기사 한 판 (가상 원고 · 실제 기사·인물 아님). 차단 0 + 경고 2.
// 경고 2개는 PRD-01A 편집기 점검 패널 견본과 같다 — 「내부 링크 1개 (권장 2개 이상)」 · 「질문형 소제목 없음」.
// 차단 견본 8종(blocking.ts)은 모두 이 원고에서 한 항목만 바꿔 만든다.
import type { LintSample } from "../src/types";

export const PASSING_SAMPLE: LintSample = {
  id: "pass-tax-explainer",
  description: "지방세 해설 — 생애최초 주택 취득세 감면. 차단 0, 경고 2(내부 링크 1개 · 질문형 소제목 없음)",
  violates: null,
  article: {
    id: "article-sample-0001",
    title: "생애최초 주택 취득세 감면, 신청 시기와 추징 요건 정리",
    metaTitle: "생애최초 주택 취득세 감면 — 신청 시기와 추징 요건",
    metaDescription: "생애최초로 주택을 살 때 받을 수 있는 취득세 감면의 신청 시기와, 감면 뒤 추징되는 경우를 법령 기준일과 함께 정리했습니다.",
    canonical: "https://localtaxresearch.com/news/first-home-acquisition-tax-relief",
    section: "tax",
    taxReviewTarget: true,
    hasTaxLens: false,
    lawBasisDate: "2026-10-01",
    authors: [{ peopleId: "people-sample-reporter-01", name: "견본 기자" }],
    dates: {
      data: { publishedAt: "2026-10-15T09:00:00+09:00", updatedAt: "2026-10-20T14:30:00+09:00" },
      displayed: { publishedAt: "2026-10-15T09:00:00+09:00", updatedAt: "2026-10-20T14:30:00+09:00" },
    },
    claims: [
      {
        id: "claim-1",
        text: "생애최초 주택 구입에 대한 취득세 감면은 지방세특례제한법 제36조의3에 근거한다.",
        evidenceIds: ["src-law"],
      },
      {
        id: "claim-2",
        text: "정당한 사유 없이 취득일부터 3개월 안에 상시 거주를 시작하지 않으면 감면받은 세액이 추징될 수 있다.",
        evidenceIds: ["src-law", "ev-interview-1"],
      },
    ],
    sources: [
      { id: "src-law", kind: "official_doc", title: "지방세특례제한법 제36조의3 (국가법령정보센터)" },
      { id: "src-guide", kind: "official_doc", title: "지자체 취득세 감면 신청 안내문" },
    ],
    evidence: [{ id: "ev-interview-1" }],
    structuredDataMismatches: [],
    similarity: { status: "pass" },
    sponsorship: {
      label: "없음",
      partnerName: null,
      pageBadge: null,
      structuredHeadline: "생애최초 주택 취득세 감면, 신청 시기와 추징 요건 정리",
    },
    headings: [
      { level: 2, text: "감면 요건 한눈에 보기" },
      { level: 2, text: "신청 시기와 서류" },
      { level: 2, text: "감면세액이 추징되는 경우" },
    ],
    internalLinkCount: 1,
    images: [{ alt: "생애최초 주택 취득세 감면 신청 절차 4단계 인포그래픽" }],
    summaryBoxLines: [
      "생애최초로 주택을 사면 요건을 갖춘 경우 취득세를 감면받을 수 있습니다.",
      "감면은 취득세를 신고할 때 함께 신청합니다.",
      "정해진 기간 안에 거주를 시작하지 않으면 감면세액이 추징될 수 있습니다.",
    ],
    faqs: [
      { question: "감면은 언제 신청하나요?", answer: "취득세를 신고할 때 감면 신청서를 함께 냅니다." },
      {
        question: "감면받은 뒤 바로 이사하지 못하면 어떻게 되나요?",
        answer: "정당한 사유 없이 정해진 기간 안에 거주를 시작하지 않으면 감면세액이 추징될 수 있습니다.",
      },
      { question: "이 기사로 제 상황을 판단해도 되나요?", answer: "일반 정보이므로 개인 사정은 세무 전문가와 확인하세요." },
    ],
  },
  context: {
    publishedArticles: [
      {
        id: "article-sample-0002",
        canonical: "https://localtaxresearch.com/news/acquisition-tax-rate-table",
        title: "주택 취득세율 한눈에 보기",
      },
      {
        id: "article-sample-0003",
        canonical: "https://localtaxresearch.com/news/property-tax-june-1",
        title: "재산세 과세기준일 6월 1일, 무엇이 달라지나",
      },
    ],
  },
};
