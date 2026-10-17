// NAV-11 — 정성형 필수 기록 · 인용마다 인터뷰 기록 · 익명 사유 · 세금 쟁점 · 지역 정책 쟁점 · 상속·증여 사례
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { TAX_EXPLAINER } from "../../fixtures/explainer";
import { uniqueIds, withExtraBlock } from "../../fixtures/helpers";
import { QUALITATIVE_NEWS } from "../../fixtures/qualitative";
import { QUANTITATIVE_NEWS } from "../../fixtures/quantitative";
import { evaluatePublish } from "../evaluate";
import type { ArticleForPublish, ArticleInterview, PerspectiveKey, QualitativeChecklist, QuoteBlock } from "../model";

const ql = QUALITATIVE_NEWS;
const run = (article: ArticleForPublish) => evaluatePublish(article, BASE_CONTEXT);
const blockers = (article: ArticleForPublish) => uniqueIds(run(article).blockers);
const editChecklist = (patch: Partial<QualitativeChecklist>): ArticleForPublish => ({
  ...ql,
  qualitativeChecklist: { ...ql.qualitativeChecklist!, ...patch },
});
const editInterview = (evidenceId: string, patch: Partial<ArticleInterview>): ArticleForPublish => ({
  ...ql,
  interviews: ql.interviews.map((i) => (i.evidenceId === evidenceId ? { ...i, ...patch } : i)),
});
const keepEvidence = (article: ArticleForPublish, ids: string[]): ArticleForPublish => ({
  ...article,
  evidence: article.evidence.filter((e) => ids.includes(e.id)),
});

describe("NAV-11 정성형 필수 기록", () => {
  it.each([
    ["취재 질문", { interviewQuestions: "" }, "nav11.interview-questions"],
    ["현장 확인 기록", { fieldRecord: null }, "nav11.field-record"],
    ["반대/보완 관점", { counterPerspective: " " }, "nav11.counter-perspective"],
    ["이해관계 확인", { conflictsOfInterest: null }, "nav11.conflicts-of-interest"],
  ] as const)("%s이 비면 발행 거부", (_name, patch, expected) => {
    expect(blockers(editChecklist(patch))).toEqual([expected]);
  });

  it("확인 목록이 없으면 네 기록이 모두 빈다", () => {
    expect(blockers({ ...ql, qualitativeChecklist: null })).toEqual([
      "nav11.interview-questions",
      "nav11.field-record",
      "nav11.counter-perspective",
      "nav11.conflicts-of-interest",
    ]);
  });

  it("서로 독립적인 근거(인터뷰·현장·문서)가 1건이면 거부, 2건이면 통과", () => {
    const notPolicy: ArticleForPublish = { ...ql, isLocalPolicyIssue: false };
    expect(blockers(keepEvidence(notPolicy, ["ev-doc-1"]))).toEqual(["nav11.independent-sources"]);
    expect(blockers(keepEvidence(notPolicy, ["ev-doc-1", "ev-int-gov"]))).toEqual([]);
  });

  it("문서 근거가 없으면 거부", () => {
    expect(blockers(keepEvidence(ql, ["ev-int-gov", "ev-int-res", "ev-int-exp", "ev-field-1"]))).toEqual([
      "nav11.document-evidence",
    ]);
  });
});

describe("NAV-11 인용 블록마다 article_interviews 기록(접촉일·기록 보존 위치·인용 동의)", () => {
  it.each([
    ["접촉일 없음", { contactedAt: null }],
    ["기록 보존 위치 없음", { recordLocation: "" }],
    ["인용 동의 없음(null)", { quoteConsent: null }],
    ["인용 동의 거부(none)", { quoteConsent: "none" }],
  ] as const)("%s → 그 인용 블록 위치로 거부", (_name, patch) => {
    const result = run(editInterview("ev-int-res", patch));
    expect(result.blockers).toEqual([
      expect.objectContaining({ id: "nav11.quote-record", location: { field: "blocks", blockIndex: 4, phrase: "ev-int-res" } }),
    ]);
  });

  it("인용에 연결한 기록이 없으면(refId null) 거부", () => {
    const quote = ql.blocks[2] as QuoteBlock;
    const article = { ...ql, blocks: ql.blocks.map((b, i) => (i === 2 ? { ...quote, refId: null } : b)) };
    expect(run(article).blockers).toEqual([
      expect.objectContaining({ id: "nav11.quote-record", location: { field: "blocks", blockIndex: 2 } }),
    ]);
  });

  it("부분 동의(partial)는 인용 동의로 친다", () => {
    expect(ql.interviews.find((i) => i.evidenceId === "ev-int-res")!.quoteConsent).toBe("partial");
    expect(blockers(ql)).toEqual([]);
  });

  it("해설 기사의 취재원 인용도 인터뷰 기록이 있어야 한다", () => {
    const article = withExtraBlock(TAX_EXPLAINER, {
      type: "quote",
      text: "잔금일을 먼저 확인하세요.",
      speaker: "세무사",
      origin: "interview",
      refId: "ev-int-x",
    });
    expect(blockers(article)).toEqual(["nav11.quote-record"]);
  });

  it("문서 인용은 출처 ID에 이으면 통과하고, 없는 ID면 거부", () => {
    const docQuote = (refId: string): ArticleForPublish =>
      withExtraBlock(TAX_EXPLAINER, {
        type: "quote",
        text: "취득세 과세물건을 취득한 자는 그 취득한 날부터 60일 이내에 신고하고 납부하여야 한다.",
        speaker: "지방세법 제20조 제1항",
        origin: "document",
        refId,
      });
    expect(blockers(docQuote("src-law-20"))).toEqual([]);
    expect(blockers(docQuote("src-unknown"))).toEqual(["nav11.quote-record"]);
  });
});

describe("NAV-11 익명 처리", () => {
  it("익명 취재원에 익명 사유가 없으면 거부 — 위치는 그 기록", () => {
    const result = run(editInterview("ev-int-res", { anonymityReason: null }));
    expect(result.blockers).toEqual([
      expect.objectContaining({ id: "nav11.anonymity-reason", location: { field: "interviews", phrase: "ev-int-res" } }),
    ]);
  });

  it("실명 취재원은 익명 사유가 필요 없다", () => {
    expect(ql.interviews.filter((i) => i.anonymity === "named").every((i) => i.anonymityReason === null)).toBe(true);
    expect(blockers(ql)).toEqual([]);
  });

  it("정량형 기사의 익명 인터뷰도 사유가 있어야 한다", () => {
    const q = QUANTITATIVE_NEWS;
    expect(blockers({ ...q, interviews: q.interviews.map((i) => ({ ...i, anonymityReason: "" })) })).toEqual([
      "nav11.anonymity-reason",
    ]);
  });
});

describe("NAV-11 미확인 기록", () => {
  it.each(["ev-field-1", "ev-int-gov"])("검증되지 않은 인터뷰·현장 기록(%s)은 반려", (id) => {
    const article = { ...ql, evidence: ql.evidence.map((e) => (e.id === id ? { ...e, verificationStatus: "pending" as const } : e)) };
    expect(run(article).blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "nav11.unverified-evidence", location: { field: "evidence", phrase: id } })]),
    );
  });
});

describe("NAV-11 세금 쟁점 — 법령 기준일과 세무 감수", () => {
  it.each([
    ["없음", null],
    ["형식이 다름", "2026/10/15"],
    ["없는 날짜", "2026-02-30"],
  ])("법령 기준일 %s → 거부", (_name, legalBasisDate) => {
    expect(blockers({ ...ql, legalBasisDate })).toEqual(["nav11.legal-basis-date"]);
  });

  it("세금 쟁점이 아닌 원고는 법령 기준일을 요구하지 않는다 (이 규칙에서는)", () => {
    expect(blockers({ ...ql, isTaxIssue: false, legalBasisDate: null })).toEqual([]);
  });
});

describe("NAV-11 지역 정책 쟁점 — 관점마다 취재 기록 또는 '접촉했으나 응답 없음', 원문 대조 1건 이상", () => {
  it.each(["local_gov", "residents_taxpayers", "experts"] as const)("%s 관점 기록이 없으면 거부", (key: PerspectiveKey) => {
    const result = run({ ...ql, perspectives: { ...ql.perspectives, [key]: null } });
    expect(result.blockers).toEqual([
      expect.objectContaining({ id: "nav11.perspective", location: { field: "perspectives", phrase: key } }),
    ]);
  });

  it("'접촉했으나 응답 없음'과 접촉일이 있으면 통과", () => {
    const perspectives = { ...ql.perspectives, residents_taxpayers: { status: "no_response" as const, evidenceId: null, contactedAt: "2026-10-12" } };
    expect(blockers({ ...ql, perspectives })).toEqual([]);
  });

  it("'응답 없음'인데 접촉일이 없으면 거부", () => {
    const perspectives = { ...ql.perspectives, experts: { status: "no_response" as const, evidenceId: null, contactedAt: null } };
    expect(blockers({ ...ql, perspectives })).toEqual(["nav11.perspective"]);
  });

  it("취재 기록이라면서 근거 ID가 없는 근거를 가리키면 거부", () => {
    const perspectives = { ...ql.perspectives, local_gov: { status: "interviewed" as const, evidenceId: "ev-missing", contactedAt: "2026-10-13" } };
    expect(blockers({ ...ql, perspectives })).toEqual(["nav11.perspective"]);
  });

  it.each([
    ["대조 기록 0건", []],
    ["없는 출처를 가리킴", [{ sourceId: "src-missing", checkedAt: "2026-10-14" }]],
    ["대조일 없음", [{ sourceId: "src-ordinance", checkedAt: null }]],
  ])("원문 대조 %s → 거부", (_name, originalTextChecks) => {
    expect(blockers({ ...ql, originalTextChecks })).toEqual(["nav11.original-text-check"]);
  });

  it("지역 정책 쟁점이 아니면 관점 기록을 요구하지 않는다", () => {
    expect(blockers({ ...ql, isLocalPolicyIssue: false, perspectives: { local_gov: null, residents_taxpayers: null, experts: null }, originalTextChecks: [] })).toEqual([]);
  });
});

describe("NAV-11 상속·증여 사례 — 동의·비식별 검토", () => {
  it("동의만 체크하면 비식별 검토 미확인으로 거부", () => {
    expect(blockers({ ...ql, isInheritanceGiftCase: true, inheritanceGiftChecks: { consent: true, deidentified: false } })).toEqual([
      "nav11.inheritance-deidentified",
    ]);
  });

  it("둘 다 체크하면 통과", () => {
    expect(blockers({ ...ql, isInheritanceGiftCase: true, inheritanceGiftChecks: { consent: true, deidentified: true } })).toEqual([]);
  });
});

describe("NAV-11 적용 범위", () => {
  it("혼합형(mixed)은 정성형 기록도 요구한다", () => {
    expect(blockers({ ...QUANTITATIVE_NEWS, reportingMethod: "mixed" })).toEqual([
      "nav11.interview-questions",
      "nav11.field-record",
      "nav11.independent-sources",
      "nav11.counter-perspective",
      "nav11.document-evidence",
      "nav11.conflicts-of-interest",
    ]);
  });
});
