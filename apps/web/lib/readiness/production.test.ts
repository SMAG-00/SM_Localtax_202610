// 기사 생산 대시보드의 세는 규칙 (NAV-14 · NAV-13 — docs/dev/W2-c_설계.md 8.5). 기대값은 견본 기사에서 손으로 센 값이다.
//  · 고르는 기사: 지금 공개 중(published)이고 기간 안에 처음 발행된 새 기사 — 보류·삭제·이관 기사는 빼고 따로 센다
//  · 내부 정의: 자체 취재 후보 = 보도(reported_news)만 — 금주 핫뉴스·칼럼·광고·해설·가이드를 더해도 분자 그대로
//  · 공식 정의: 규정 버전 요건의 거르개로 분자·분모를 센다. 기준 비교는 심사 대상 기간 하나에서만, 이상(gte)·초과(gt) 경계, 월평균
//  · 기준에 못 미치는 요건이 하나라도 있으면 인력 보강·신청 연기 안내(NAV-13)
import { describe, expect, test } from "vitest";
import type { RequirementItem } from "./requirements";
import {
  compareCriterion,
  decodeFacts,
  internalMetrics,
  matchesFilter,
  needsCapacityGuidance,
  officialRows,
  officialValue,
  reporterRows,
  traceRows,
  windowArticles,
  type FactArticle,
  type Facts,
} from "./production";
import { monthWindow } from "./windows";

const kst = (local: string) => Date.parse(`${local}+09:00`);
const NOW = kst("2026-10-18T12:00:00");
const W3 = monthWindow(3, "closed_months", NOW); // 2026-07-01 ~ 2026-09-30
const W6 = monthWindow(6, "closed_months", NOW); // 2026-04-01 ~ 2026-09-30

let seq = 0;
function art(over: Partial<FactArticle> = {}): FactArticle {
  seq += 1;
  return {
    id: seq,
    slug: `a-${seq}`,
    title: `기사 ${seq}`,
    section: "tax",
    contentType: "reported_news",
    reportingMethod: "quantitative",
    origin: "new",
    status: "published",
    label: "none",
    authorId: 1,
    publishedAt: kst("2026-08-10T09:00:00"),
    assignmentKind: null,
    editorialStatus: "approved",
    taxReviewStatus: "not_required",
    evidenceTotal: 1,
    evidenceVerified: 1,
    evidenceRightsUnconfirmed: 0,
    mediaUnconfirmed: 0,
    viewsHuman: 0,
    engagedViews: 0,
    shares: 0,
    lastSimilarity: "pass",
    ...over,
  };
}
function facts(articles: FactArticle[], over: Partial<Facts> = {}): Facts {
  return { articles, corrections: [], similarityChecks: [], people: new Map(), openAssignments: new Map(), ...over };
}

describe("decodeFacts — DB 함수 응답 읽기", () => {
  test("bigint 글자·시각 글자를 숫자로, 모양이 틀리면 오류", () => {
    const f = decodeFacts({
      articles: [
        {
          id: "7", slug: "s", title: "t", section: "tax", content_type: "reported_news", reporting_method: null, origin: "new", status: "published", label: "none", author_id: "3",
          published_at: "2026-06-30T15:00:00+00:00", assignment_kind: "feature", editorial_status: "approved", tax_review_status: "pending",
          evidence_total: 2, evidence_verified: 1, evidence_rights_unconfirmed: 0, media_unconfirmed: 1, views_human: 9, engaged_views: 4, shares: 1, last_similarity: null,
        },
      ],
      corrections: [{ article_id: 7, kind: "rebuttal", at: "2026-07-02T00:00:00+00:00" }],
      similarity_checks: [{ article_id: 7, status: "blocked", at: "2026-07-01T00:00:00+00:00" }],
      people: [{ id: 3, name: "기자", roles: ["reporter"], employment: "staff" }],
      open_assignments: [{ reporter_id: 3, count: 2 }],
    });
    expect(f.articles[0]).toMatchObject({ id: 7, authorId: 3, publishedAt: kst("2026-07-01T00:00:00"), assignmentKind: "feature", mediaUnconfirmed: 1, lastSimilarity: null });
    expect(f.corrections).toEqual([{ articleId: 7, kind: "rebuttal", at: Date.parse("2026-07-02T00:00:00Z") }]);
    expect(f.people.get(3)).toEqual({ name: "기자", roles: ["reporter"], employment: "staff" });
    expect(f.openAssignments.get(3)).toBe(2);
    expect(() => decodeFacts({ articles: "x" })).toThrow(/모양/);
    expect(() => decodeFacts(null)).toThrow(/모양/);
  });
});

describe("windowArticles — 지금 공개 중 · 기간 안 첫 발행 · 새 기사", () => {
  test("시작일 하루 전 제외 · 시작일 0시 포함 · 보류·삭제·이관 제외", () => {
    const dayBefore = art({ publishedAt: kst("2026-06-30T12:00:00") });
    const startDay = art({ publishedAt: kst("2026-07-01T00:00:00") });
    const lastDay = art({ publishedAt: kst("2026-09-30T23:59:59") });
    const thisMonth = art({ publishedAt: kst("2026-10-01T00:00:00") });
    const held = art({ status: "held" });
    const deleted = art({ status: "deleted" });
    const legacy = art({ origin: "legacy" });
    const f = facts([dayBefore, startDay, lastDay, thisMonth, held, deleted, legacy]);
    expect(windowArticles(f, W3).map((a) => a.id)).toEqual([startDay.id, lastDay.id]);
    expect(windowArticles(f, W3, { includeLegacy: true }).map((a) => a.id)).toEqual([startDay.id, lastDay.id, legacy.id]);
    expect(windowArticles(f, W6).map((a) => a.id)).toEqual([dayBefore.id, startDay.id, lastDay.id]);
  });
});

describe("internalMetrics — 내부 정의", () => {
  test("견본 기사 9건 — 손으로 센 값", () => {
    const quant = art({ authorId: 1, viewsHuman: 10, engagedViews: 4, shares: 1, assignmentKind: "feature" });
    const qual = art({ reportingMethod: "qualitative", evidenceVerified: 0, evidenceTotal: 2, lastSimilarity: "no_sources", viewsHuman: 5 });
    const mixed = art({ reportingMethod: "mixed", evidenceRightsUnconfirmed: 1, assignmentKind: "investigative", taxReviewStatus: "approved" });
    const noMethod = art({ reportingMethod: null, mediaUnconfirmed: 1, taxReviewStatus: "pending", lastSimilarity: null });
    const explainer = art({ contentType: "explainer", reportingMethod: null, evidenceVerified: 0, taxReviewStatus: "rejected", editorialStatus: "pending" });
    const opinion = art({ contentType: "opinion", reportingMethod: null, assignmentKind: "general" });
    const held = art({ status: "held" });
    const legacy = art({ origin: "legacy" });
    const outside = art({ publishedAt: kst("2026-06-30T23:59:59") });
    const f = facts([quant, qual, mixed, noMethod, explainer, opinion, held, legacy, outside], {
      corrections: [
        { articleId: quant.id, kind: "correction", at: kst("2026-07-01T00:00:00") },
        { articleId: quant.id, kind: "rebuttal", at: kst("2026-08-01T00:00:00") },
        { articleId: outside.id, kind: "follow_up", at: kst("2026-09-30T23:00:00") },
        { articleId: quant.id, kind: "correction", at: kst("2026-10-01T00:00:00") }, // 기간 뒤
        { articleId: quant.id, kind: "title_change", at: kst("2026-08-02T00:00:00") }, // 정정·반론·추후보도 밖
      ],
      similarityChecks: [
        { articleId: qual.id, status: "blocked", at: kst("2026-07-03T00:00:00") },
        { articleId: qual.id, status: "blocked", at: kst("2026-07-04T00:00:00") },
        { articleId: 9999, status: "blocked", at: kst("2026-08-04T00:00:00") }, // 발행되지 않은 원고도 경고로 센다
        { articleId: mixed.id, status: "pass", at: kst("2026-07-05T00:00:00") },
        { articleId: noMethod.id, status: "blocked", at: kst("2026-06-30T23:59:59") }, // 기간 앞
      ],
    });
    expect(internalMetrics(f, W3)).toEqual({
      total: 6,
      own: 4,
      methods: { quantitative: 1, qualitative: 1, mixed: 1, missing: 1 },
      feature: 2,
      missingEvidence: 1,
      missingRights: 2,
      missingDesk: 1,
      taxReviewNeeded: 3,
      missingTaxReview: 2,
      corrections: { correction: 1, rebuttal: 1, follow_up: 1 },
      similarity: { blocked: 2, unverified: 2 },
      reader: { views: 15, engaged: 4, shares: 1 },
      excluded: { notPublished: 1, legacy: 1 },
    });
  });

  test("금주 핫뉴스·칼럼·광고·해설을 1건씩 더해도 자체 취재 후보는 그대로 — 총 발행만 늘어난다", () => {
    const base = [art(), art({ reportingMethod: "qualitative" })];
    const before = internalMetrics(facts(base), W3);
    const more = ["digest", "opinion", "sponsored", "explainer", "guide"].map((t) => art({ contentType: t, reportingMethod: null }));
    const after = internalMetrics(facts([...base, ...more]), W3);
    expect(after.own).toBe(before.own);
    expect(after.methods).toEqual(before.methods);
    expect(after.total).toBe(before.total + 5);
  });

  test("기사 0건이면 모두 0", () => {
    const m = internalMetrics(facts([]), W3);
    expect([m.total, m.own, m.feature, m.missingEvidence, m.reader.views]).toEqual([0, 0, 0, 0, 0]);
  });
});

// ── 공식 정의 ────────────────────────────────────────────

const ratioItem: RequirementItem = {
  key: "own_ratio",
  label: "자체 생산 기사 비율",
  metric: "ratio",
  numerator: { contentTypes: ["reported_news"] },
  denominator: {},
  numeratorText: "자체 취재 보도기사",
  denominatorText: "전체 발행 기사",
  exclusionsText: "없음",
  criterion: { comparator: "gte", value: 50, per: "period" },
};
const countItem: RequirementItem = {
  key: "monthly",
  label: "월 발행량",
  metric: "count",
  numerator: { contentTypes: ["reported_news", "explainer"] },
  numeratorText: "보도·해설",
  exclusionsText: "칼럼·광고",
  criterion: { comparator: "gte", value: 2, per: "month" },
};
const perReporterItem: RequirementItem = {
  key: "per_reporter",
  label: "기자 1인당 생산량",
  metric: "per_reporter",
  numerator: { contentTypes: ["reported_news"] },
  numeratorText: "보도기사",
  denominatorText: "그 기사를 쓴 기자 수",
  exclusionsText: "작성자 없는 기사",
  criterion: { comparator: "gt", value: 2, per: "period" },
};

describe("matchesFilter · officialValue — 공식 정의 거르개", () => {
  test("유형·취재 방식·기획 종류는 모두 맞아야(그리고), 비운 칸은 모두", () => {
    const a = art({ contentType: "reported_news", reportingMethod: "mixed", assignmentKind: "feature" });
    expect(matchesFilter(a, {})).toBe(true);
    expect(matchesFilter(a, { contentTypes: ["reported_news"], reportingMethods: ["mixed", "qualitative"] })).toBe(true);
    expect(matchesFilter(a, { contentTypes: ["reported_news"], reportingMethods: ["quantitative"] })).toBe(false);
    expect(matchesFilter(a, { assignmentKinds: ["feature", "investigative"] })).toBe(true);
    expect(matchesFilter(art({ assignmentKind: null }), { assignmentKinds: ["general"] })).toBe(false);
  });

  test("비율 — 분자/분모, 분모 0이면 값 없음 · 이관 기사는 거르개가 넣을 때만", () => {
    const f = facts([art(), art({ contentType: "explainer" }), art({ contentType: "opinion" }), art({ origin: "legacy" })]);
    expect(officialValue(ratioItem, f, W3)).toEqual({ numerator: 1, denominator: 3, value: 1 / 3 });
    expect(officialValue({ ...ratioItem, numerator: { contentTypes: ["reported_news"], includeLegacy: true }, denominator: { includeLegacy: true } }, f, W3)).toEqual({ numerator: 2, denominator: 4, value: 0.5 });
    expect(officialValue(ratioItem, facts([]), W3)).toEqual({ numerator: 0, denominator: 0, value: null });
  });

  test("기사 수 · 기자 1인당(그 기사를 쓴 기자 수로 나눔, 작성자 없는 기사는 빼고)", () => {
    const f = facts([art({ authorId: 1 }), art({ authorId: 1 }), art({ authorId: 2 }), art({ authorId: null }), art({ contentType: "explainer", authorId: 3 })]);
    expect(officialValue(countItem, f, W3)).toEqual({ numerator: 5, denominator: null, value: 5 });
    expect(officialValue(perReporterItem, f, W3)).toEqual({ numerator: 3, denominator: 2, value: 1.5 });
    expect(officialValue(perReporterItem, facts([art({ authorId: null })]), W3)).toEqual({ numerator: 0, denominator: 0, value: null });
  });
});

describe("compareCriterion — 기준 비교 (이상·초과 경계 · 월평균 · %)", () => {
  test("비율 50% 이상 — 정확히 50%는 충족, 49.9%는 미달 · 초과(gt)면 50%는 미달", () => {
    expect(compareCriterion(ratioItem, { numerator: 1, denominator: 2, value: 0.5 }, W3)).toEqual({ kind: "met", compared: 50 });
    expect(compareCriterion(ratioItem, { numerator: 499, denominator: 1000, value: 0.499 }, W3)).toEqual({ kind: "short", compared: 49.9 });
    expect(compareCriterion({ ...ratioItem, criterion: { comparator: "gt", value: 50, per: "period" } }, { numerator: 1, denominator: 2, value: 0.5 }, W3).kind).toBe("short");
  });
  test("월평균 2건 이상 — 3개월 6건은 충족(2.0), 5건은 미달(1.67)", () => {
    expect(compareCriterion(countItem, { numerator: 6, denominator: null, value: 6 }, W3)).toEqual({ kind: "met", compared: 2 });
    const short = compareCriterion(countItem, { numerator: 5, denominator: null, value: 5 }, W3);
    expect(short.kind).toBe("short");
    expect(short.kind !== "none" && short.compared).toBeCloseTo(5 / 3);
  });
  test("값이 없으면(분모 0) 미달 · 기준이 없는 요건은 비교 없음", () => {
    expect(compareCriterion(ratioItem, { numerator: 0, denominator: 0, value: null }, W3)).toEqual({ kind: "short", compared: null });
    expect(compareCriterion({ ...ratioItem, criterion: null }, { numerator: 1, denominator: 2, value: 0.5 }, W3)).toEqual({ kind: "none" });
  });
});

describe("officialRows · needsCapacityGuidance — 기간별 공식 숫자와 심사 기간 비교", () => {
  test("3·6개월 숫자 + 심사 기간(3개월) 비교, 미달이 하나라도 있으면 인력 보강·신청 연기 안내", () => {
    const f = facts([art(), art({ contentType: "explainer" }), art({ publishedAt: kst("2026-05-02T09:00:00") })]);
    const rows = officialRows([ratioItem, countItem], f, [W3, W6], W3);
    expect(rows.map((r) => [r.item.key, r.values.map((v) => [v.numerator, v.denominator]), r.comparison.kind])).toEqual([
      ["own_ratio", [[1, 2], [2, 3]], "met"],
      ["monthly", [[2, null], [3, null]], "short"],
    ]);
    expect(needsCapacityGuidance(rows)).toBe(true);
    expect(needsCapacityGuidance(officialRows([ratioItem], f, [W3], W3))).toBe(false);
    expect(needsCapacityGuidance(officialRows([{ ...countItem, criterion: null }], f, [W3], W3))).toBe(false);
  });
});

describe("reporterRows — 기자별 취재 부담", () => {
  test("기간마다 발행·자체 취재 후보, 지금 맡은 기획 — 기사 없이 기획만 있는 기자도, 많이 쓴 순", () => {
    const people = new Map([
      [1, { name: "가 기자", roles: ["reporter"], employment: "staff" as string | null }],
      [2, { name: "나 필자", roles: ["writer"], employment: "external" }],
      [3, { name: "다 기자", roles: ["reporter"], employment: null }],
    ]);
    const f = facts(
      [
        art({ authorId: 1 }),
        art({ authorId: 1, contentType: "explainer", publishedAt: kst("2026-05-01T00:00:00") }),
        art({ authorId: 2, contentType: "opinion" }),
        art({ authorId: 2, contentType: "opinion" }),
        art({ authorId: 2, contentType: "opinion", status: "held" }),
      ],
      { people, openAssignments: new Map([[1, 1], [3, 2]]) },
    );
    expect(reporterRows(f, [W3, W6])).toEqual([
      { personId: 1, name: "가 기자", roles: ["reporter"], employment: "staff", published: [1, 2], own: [1, 1], open: 1 },
      { personId: 2, name: "나 필자", roles: ["writer"], employment: "external", published: [2, 2], own: [0, 0], open: 0 },
      { personId: 3, name: "다 기자", roles: ["reporter"], employment: null, published: [0, 0], own: [0, 0], open: 2 },
    ]);
  });
});

describe("traceRows — 근거 → 편집 → 정정 추적", () => {
  test("기간 안 자체 취재 후보만, 최신 발행 앞, 기사마다 정정 수 · 상한", () => {
    const old = art({ publishedAt: kst("2026-07-02T00:00:00"), evidenceTotal: 3, evidenceVerified: 2 });
    const recent = art({ publishedAt: kst("2026-09-02T00:00:00"), editorialStatus: "approved", taxReviewStatus: "pending" });
    const explainer = art({ contentType: "explainer" });
    const f = facts([old, recent, explainer], {
      corrections: [
        { articleId: old.id, kind: "correction", at: kst("2026-09-01T00:00:00") },
        { articleId: old.id, kind: "rebuttal", at: kst("2026-09-02T00:00:00") },
      ],
    });
    const t = traceRows(f, W3, 10);
    expect(t.total).toBe(2);
    expect(t.rows.map((r) => [r.id, r.evidenceVerified, r.evidenceTotal, r.corrections, r.taxReviewStatus])).toEqual([
      [recent.id, 1, 1, 0, "pending"],
      [old.id, 2, 3, 2, "not_required"],
    ]);
    expect(traceRows(f, W3, 1)).toMatchObject({ total: 2, rows: [{ id: recent.id }] });
  });
});
