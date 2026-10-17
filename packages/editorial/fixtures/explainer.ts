// 통과 견본 3 — 세법 해설(explainer, 지방세 분야, 면책 대상 하위 분야). 편집 승인 + 세무 감수 서명 둘 다 있다.
// 통과 견본 4 — 해결 사례(subtype solved_case) — 견본 3에서 만든다. 가상 사례 · 결정례 번호와 주소는 견본값(실제 결정례 아님).
import type { ArticleForPublish } from "../src/model";
import { NO_PERSPECTIVES } from "./context";

export const TAX_EXPLAINER: ArticleForPublish = {
  id: "article-ltr-2026-0103",
  slug: "acquisition-tax-filing-60-days",
  version: 4,
  title: "주택 취득세 신고, 취득일부터 60일 안에 하면 됩니다",
  summary: "주택을 사면 취득일부터 60일 안에 취득세를 신고하고 내야 합니다. 신고 전에 확인할 점을 정리했습니다.",
  blocks: [
    {
      type: "key_summary",
      lines: [
        "주택을 사면 취득일부터 60일 안에 취득세를 신고합니다.",
        "세액은 과세표준(세금을 매기는 기준 금액)에 세율을 곱해 정합니다.",
        "60일 안에 신고하면 가산세가 없습니다.",
      ],
      checklist: { actionWritten: true },
    },
    {
      type: "paragraph",
      text: "취득일은 잔금을 치른 날과 등기한 날 중 빠른 날이다. 이날부터 60일 안에 주택이 있는 시·군·구에 신고하고 세금을 낸다.",
    },
    {
      type: "paragraph",
      text: "과세표준은 원칙적으로 실제 거래 가격이다. 매매계약서에 적힌 금액이 실제와 다르면 신고 뒤 추징될 수 있다.",
    },
    {
      type: "callout",
      kind: "tip",
      title: "절세 체크포인트",
      text: "생애 첫 주택이면 감면 요건을 먼저 확인하세요. 감면은 취득세를 신고할 때 함께 신청합니다.",
    },
    {
      type: "callout",
      kind: "mistake",
      title: "자주 틀리는 점",
      text: "계약일이 아니라 잔금일이나 등기일이 취득일입니다. 계약일부터 세면 신고일을 잘못 잡기 쉽습니다.",
    },
    {
      type: "callout",
      kind: "caution",
      title: "신고를 놓쳤다면",
      text: "신고 기한을 넘겼다면 바로 신고하고 내면 됩니다. 늦을수록 가산세가 늘어나므로 위택스에서 지금 신고하세요.",
      checklist: { actionWritten: true },
    },
    {
      type: "faq",
      items: [
        { question: "취득세는 어디에 신고하나요?", answer: "주택이 있는 시·군·구청이나 위택스에 신고합니다." },
        { question: "신고와 납부를 따로 하나요?", answer: "신고하면서 함께 냅니다." },
      ],
    },
  ],
  claims: [
    {
      id: "claim-1",
      text: "취득일부터 60일 안에 신고하고 납부해야 한다.",
      kind: "legal",
      evidenceIds: ["src-law-20"],
      blockIndex: 1,
    },
    {
      id: "claim-2",
      text: "취득일은 잔금일과 등기일 중 빠른 날이다.",
      kind: "legal",
      evidenceIds: ["src-decree-20"],
      blockIndex: 1,
    },
  ],
  section: "tax",
  category: { slug: "acquisition", needsDisclaimer: true },
  contentType: "explainer",
  reportingMethod: null,
  format: "general",
  subtype: "general",
  solvedCase: null,
  label: "none",
  partner: null,
  authorUserId: "user-reporter-03",
  firstPublishedAt: null,
  updateKind: null,
  updatedReason: null,
  legalBasisDate: "2026-10-01",
  digestId: null,
  amendmentId: null,
  leadImage: { mediaId: "media-0103-lead", alt: "주택 취득세 신고 절차 4단계 그림", rightsStatus: "confirmed" },
  sources: [
    {
      id: "src-law-20",
      kind: "official_doc",
      title: "지방세법 제20조(신고 및 납부)",
      url: "https://www.law.go.kr/법령/지방세법/제20조",
      provider: "법제처 국가법령정보센터",
      accessedAt: "2026-10-10",
      rightsStatus: "confirmed",
    },
    {
      id: "src-decree-20",
      kind: "official_doc",
      title: "지방세법 시행령 제20조(취득의 시기 등)",
      url: "https://www.law.go.kr/법령/지방세법시행령/제20조",
      provider: "법제처 국가법령정보센터",
      accessedAt: "2026-10-10",
      rightsStatus: "confirmed",
    },
  ],
  evidence: [],
  datasets: [],
  interviews: [],
  reviews: [
    {
      kind: "desk_edit",
      decision: "approve",
      reviewerUserId: "user-editor-01",
      signedAt: "2026-10-14T11:00:00+09:00",
      forVersion: 4,
    },
    {
      kind: "tax_review",
      decision: "approve",
      reviewerUserId: "user-taxreviewer-01",
      signedAt: "2026-10-14T15:30:00+09:00",
      forVersion: 4,
    },
  ],
  taxLens: null,
  hasTaxOrLegalClaims: true,
  isTaxIssue: false,
  isLocalPolicyIssue: false,
  perspectives: NO_PERSPECTIVES,
  originalTextChecks: [],
  isInheritanceGiftCase: false,
  inheritanceGiftChecks: { consent: false, deidentified: false },
  quantitativeChecklist: null,
  qualitativeChecklist: null,
};

export const SOLVED_CASE: ArticleForPublish = {
  ...TAX_EXPLAINER,
  id: "article-ltr-2026-0104",
  slug: "solved-case-acquisition-date",
  title: "계약일부터 세다가 신고가 늦어진 사례 — 취득일은 언제인가",
  summary: "취득세 신고 기간을 계약일부터 센 납세자의 사례를 재구성했습니다.",
  blocks: [
    {
      type: "paragraph",
      text: "이 사례는 공개된 결정례를 바탕으로 재구성했다. 인물과 지역은 알아볼 수 없게 바꿨다.",
    },
  ],
  claims: [],
  category: { slug: "cases", needsDisclaimer: true },
  subtype: "solved_case",
  solvedCase: {
    situation: "수도권의 한 납세자는 계약일부터 60일을 세어 취득세를 신고했다.",
    issue: "취득세 신고 기간을 계약일부터 세는지, 잔금일부터 세는지가 쟁점이었다.",
    result: "심판기관은 잔금을 치른 날을 취득일로 보고 신고가 늦었다고 판단했다.",
    lesson: "취득세 신고 기간은 계약일이 아니라 잔금일과 등기일 중 빠른 날부터 셉니다.",
    resultEvidence: [
      { kind: "decision", number: "조심2025지0001", url: "https://decisions.example.kr/tt/2025-ji-0001" },
    ],
    conclusion: "rejected",
  },
};
