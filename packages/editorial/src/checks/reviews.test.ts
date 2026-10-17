// NAV-03 편집 승인·세무 감수는 서로 다른 상태 · NAV-12 독립 편집자 · 세무 감수 대상 (ART-01 · NAV-11 · NAV-12 · CAT-05)
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { TAX_EXPLAINER } from "../../fixtures/explainer";
import { uniqueIds } from "../../fixtures/helpers";
import { QUANTITATIVE_NEWS } from "../../fixtures/quantitative";
import { evaluatePublish } from "../evaluate";
import type { ArticleForPublish, EditorialReview } from "../model";
import { taxReviewReasons } from "./reviews";

const q = QUANTITATIVE_NEWS;
const ex = TAX_EXPLAINER;
const run = (article: ArticleForPublish) => evaluatePublish(article, BASE_CONTEXT);
const blockers = (article: ArticleForPublish) => uniqueIds(run(article).blockers);
const desk = q.reviews[0]!;
const exDesk = ex.reviews.find((r) => r.kind === "desk_edit")!;
const exTax = ex.reviews.find((r) => r.kind === "tax_review")!;

describe("NAV-03 상태 2개 — 서로를 대신하지 않는다", () => {
  it("세법 해설에 세무 감수만 있으면 편집 승인 없음으로 거부", () => {
    expect(blockers({ ...ex, reviews: [exTax] })).toEqual(["nav03.desk-edit-required"]);
  });

  it("세법 해설에 편집 승인만 있으면 세무 감수 없음으로 거부", () => {
    expect(blockers({ ...ex, reviews: [exDesk] })).toEqual(["nav03.tax-review-required"]);
  });

  it("둘 다 있으면 통과", () => {
    expect(blockers(ex)).toEqual([]);
  });

  it("승인 기록이 없으면 편집 승인·세무 감수 둘 다 없음", () => {
    expect(blockers({ ...ex, reviews: [] })).toEqual(["nav03.desk-edit-required", "nav03.tax-review-required"]);
  });

  it("작성 기자가 없으면 발행 불가", () => {
    expect(blockers({ ...ex, authorUserId: null })).toEqual(["nav03.author-required"]);
  });
});

describe("승인은 현재 버전·서명·최신 결정만 센다", () => {
  it("이전 버전(2)에 대한 승인은 현재 버전(3)의 승인이 아니다", () => {
    expect(blockers({ ...q, reviews: [{ ...desk, forVersion: 2 }] })).toEqual(["nav03.desk-edit-required"]);
  });

  it("서명 시각이 없는 승인은 세지 않는다", () => {
    expect(blockers({ ...q, reviews: [{ ...desk, signedAt: null }] })).toEqual(["nav03.desk-edit-required"]);
  });

  it.each(["reject", "hold"] as const)("승인 뒤에 같은 버전의 %s가 오면 승인 아님", (decision) => {
    const later: EditorialReview = { ...desk, decision, reviewerUserId: "user-editor-02", signedAt: "2026-10-12T17:00:00+09:00" };
    expect(blockers({ ...q, reviews: [desk, later] })).toEqual(["nav03.desk-edit-required"]);
  });

  it("반려 뒤에 다시 승인하면 승인", () => {
    const earlier: EditorialReview = { ...desk, decision: "reject", signedAt: "2026-10-12T10:00:00+09:00" };
    expect(blockers({ ...q, reviews: [desk, earlier] })).toEqual([]);
  });

  it("시간대가 다른 서명 시각도 실제 시각으로 비교한다 — 08:30Z(=17:30 KST)의 반려가 16:00 KST 승인보다 늦다", () => {
    const rejectUtc: EditorialReview = { ...desk, decision: "reject", reviewerUserId: "user-editor-02", signedAt: "2026-10-12T08:30:00Z" };
    expect(blockers({ ...q, reviews: [rejectUtc, desk] })).toEqual(["nav03.desk-edit-required"]);
  });
});

describe("NAV-12 작성 기자와 같은 계정의 편집 승인은 거부", () => {
  it("본인 승인만 있으면 편집 승인 없음 + 본인 승인 항목", () => {
    const result = run({ ...q, reviews: [{ ...desk, reviewerUserId: q.authorUserId! }] });
    expect(uniqueIds(result.blockers)).toEqual(["nav03.desk-edit-required", "nav12.self-desk-edit"]);
    expect(result.blockers[1]!.location).toEqual({ field: "reviews", phrase: "user-reporter-01" });
  });

  it("독립 편집자 승인이 따로 있어도 본인 승인 기록은 차단 항목으로 남는다", () => {
    const self: EditorialReview = { ...desk, reviewerUserId: q.authorUserId!, signedAt: "2026-10-12T15:00:00+09:00" };
    expect(blockers({ ...q, reviews: [self, desk] })).toEqual(["nav12.self-desk-edit"]);
  });

  it("작성 기자의 세무 감수 서명은 이 규칙 대상이 아니다 (DB 규칙도 desk_edit만)", () => {
    const selfTax: EditorialReview = { ...exTax, reviewerUserId: ex.authorUserId! };
    expect(blockers({ ...ex, reviews: [exDesk, selfTax] })).toEqual([]);
  });
});

describe("세무 감수 대상", () => {
  it("세금 계산·법률 주장이 있는 보도기사는 감수 서명 필요 (NAV-12)", () => {
    expect(blockers({ ...q, hasTaxOrLegalClaims: true })).toEqual(["nav03.tax-review-required"]);
  });

  it("핵심 주장에 세금 계산(tax_calculation)이 표시돼 있으면 감수 서명 필요", () => {
    const claims = [{ ...q.claims[0]!, kind: "tax_calculation" as const }];
    expect(blockers({ ...q, claims })).toEqual(["nav03.tax-review-required"]);
  });

  it("면책 대상 분야의 가이드는 세금 주장 표시가 없어도 감수 필요 (ART-01)", () => {
    const guide = { ...ex, contentType: "guide" as const, hasTaxOrLegalClaims: false, claims: [], reviews: [exDesk] };
    expect(blockers(guide)).toEqual(["nav03.tax-review-required"]);
    expect(blockers({ ...guide, category: { slug: "acquisition", needsDisclaimer: false } })).toEqual([]);
  });

  it("면책 대상 분야라도 칼럼(opinion)은 세금 주장이 없으면 대상 아님", () => {
    const opinion = { ...ex, contentType: "opinion" as const, hasTaxOrLegalClaims: false, claims: [], reviews: [exDesk] };
    expect(blockers(opinion)).toEqual([]);
  });

  it("감수 대상 이유를 모두 돌려주고 차단 문구에 적는다", () => {
    const article: ArticleForPublish = { ...ex, isTaxIssue: true, subtype: "solved_case", reviews: [exDesk] };
    expect(taxReviewReasons(article)).toEqual([
      "세금 계산·법률 주장 (NAV-12)",
      "면책 대상 분야의 해설·가이드 (ART-01)",
      "세금 쟁점 원고 (NAV-11)",
      "해결 사례의 결과·교훈 (CAT-05)",
    ]);
    const tax = run(article).blockers.find((f) => f.id === "nav03.tax-review-required")!;
    expect(tax.message).toBe(
      "세무 감수 서명이 없습니다 — 대상 이유: 세금 계산·법률 주장 (NAV-12), 면책 대상 분야의 해설·가이드 (ART-01), 세금 쟁점 원고 (NAV-11), 해결 사례의 결과·교훈 (CAT-05)",
    );
  });

  it("세금 주장도 면책 분야도 아닌 보도기사는 감수 대상이 아니다", () => {
    expect(taxReviewReasons(q)).toEqual([]);
  });
});
