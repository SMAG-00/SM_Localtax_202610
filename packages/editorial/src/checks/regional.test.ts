// REG1-17 지역 기사 편집 게이트 (01B — W4 7단계, docs/dev/W4_설계.md 1장 7단계 · 2.1 · 12장 #7·#9·#30)
// 견본(QUANTITATIVE_NEWS — 지역 태그·편집 분야·공익적 질문·3항목 승인이 있는 통과 원고)에서 칸 하나씩 바꿔 차단 ID와 위치를 본다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { TAX_EXPLAINER } from "../../fixtures/explainer";
import { uniqueIds } from "../../fixtures/helpers";
import { QUANTITATIVE_NEWS } from "../../fixtures/quantitative";
import { evaluatePublish } from "../evaluate";
import {
  EDITORIAL_FIELDS,
  EDITORIAL_JUDGEMENTS,
  EDITORIAL_JUDGEMENT_LABELS,
  NON_NEWS_JUDGEMENTS,
  REGIONAL_DESK_CHECKLIST,
  RELATION_TYPES,
  RELATION_TYPE_LABELS,
  SUBJECT_KINDS,
  SUBJECT_KIND_LABELS,
  type ArticleForPublish,
  type ContentType,
  type PublishContext,
  type RegionalFacts,
} from "../model";
import { checkRegional, isRegionalArticle, missingRegionalChecks, regionalState } from "./regional";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = fs.readFileSync(path.join(HERE, "..", "..", "..", "..", "docs", "dev", "W4_설계.md"), "utf8");
const designCodes = (prefix: string): string[] => {
  const line = DESIGN.split("\n").find((l) => l.startsWith(prefix));
  if (!line) throw new Error(`설계 문서에 '${prefix}' 줄이 없다`);
  return [...line.split("|")[2]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
};

const q = QUANTITATIVE_NEWS;
const reg = (patch: Partial<RegionalFacts>, base: ArticleForPublish = q): ArticleForPublish => ({ ...base, regional: { ...base.regional!, ...patch } });
const blockers = (a: ArticleForPublish, ctx: PublishContext = BASE_CONTEXT) => uniqueIds(evaluatePublish(a, ctx).blockers);
const regionalIds = (a: ArticleForPublish, ctx: PublishContext = BASE_CONTEXT) => blockers(a, ctx).filter((id) => id.startsWith("reg1_17."));
const evidence = (status: "pending" | "verified" | "rejected") => ({ ...q.evidence[0]!, id: `ev-rel-${status}`, verificationStatus: status });
const withDeskChecklist = (a: ArticleForPublish, checklist: Record<string, unknown> | null): ArticleForPublish => ({
  ...a,
  reviews: a.reviews.map((r) => (r.kind === "desk_edit" ? { ...r, checklist } : r)),
});

describe("값 목록 = 설계 2.1 (시험이 설계 문서 표를 읽는다)", () => {
  it("소재 4 · 관계 유형 6(12장 #9 PRD 6종) · 판정 4 · 승인 3항목 · 편집 분야 4", () => {
    expect(SUBJECT_KINDS).toEqual(designCodes("| article.subject_kind"));
    expect(RELATION_TYPES).toEqual(designCodes("| article.relation_types"));
    expect(EDITORIAL_JUDGEMENTS).toEqual(designCodes("| article.editorial_judgement"));
    expect(REGIONAL_DESK_CHECKLIST).toEqual(designCodes("| regional_review.checklist"));
    expect(EDITORIAL_FIELDS).toEqual(designCodes("| editorial_field"));
    expect(NON_NEWS_JUDGEMENTS).toEqual(["travel_review", "restaurant_pick", "event_promo"]);
  });
  it("글자 표 — 값마다 한 글자, 관계 유형은 PRD 글자(예산·세수·공유재산·개발·거래·주거 영향)", () => {
    expect(Object.values(RELATION_TYPE_LABELS)).toEqual(["예산", "세수", "공유재산", "개발", "거래", "주거 영향"]);
    expect(Object.keys(SUBJECT_KIND_LABELS)).toEqual([...SUBJECT_KINDS]);
    expect(Object.keys(EDITORIAL_JUDGEMENT_LABELS)).toEqual([...EDITORIAL_JUDGEMENTS]);
  });
});

describe("통과 견본", () => {
  it("지역 태그·편집 분야·공익적 질문·3항목 승인이 있는 지역 보도기사는 REG1-17 차단 0, 상태 후보", () => {
    expect(regionalIds(q)).toEqual([]);
    expect(evaluatePublish(q, BASE_CONTEXT).canPublish).toBe(true);
    expect(regionalState(q, BASE_CONTEXT)).toEqual({ state: "candidate", reasons: [] });
  });
  it("지역 태그 없는 지방세 해설은 지역 기사가 아니다 — 차단 0, 상태 not_regional", () => {
    expect(isRegionalArticle(TAX_EXPLAINER)).toBe(false);
    expect(checkRegional(TAX_EXPLAINER, BASE_CONTEXT)).toEqual([]);
    expect(regionalState(TAX_EXPLAINER, BASE_CONTEXT).state).toBe("not_regional");
  });
});

describe("지자체뉴스 지역 태그 (W2-b #17 · 12장 #30)", () => {
  it("지역 태그 0인 지자체뉴스 새 발행 → region-tag-required(위치 regionCodes)", () => {
    const a = reg({ regionCodes: [] });
    expect(regionalIds(a)).toEqual(["reg1_17.region-tag-required"]);
    expect(checkRegional(a, BASE_CONTEXT)[0]!.location).toEqual({ field: "regionCodes" });
    expect(regionalState(a, BASE_CONTEXT).state).toBe("held");
  });
  it("이미 공개된 적 있는 지자체뉴스 기사(firstPublishedAt 있음)는 지역 태그 0이어도 그대로 — 다시 발행 막지 않음", () => {
    const a = { ...reg({ regionCodes: [] }), firstPublishedAt: "2026-09-01T09:00:00+09:00", updateKind: "substantive" as const, updatedReason: "통계 갱신" };
    expect(regionalIds(a)).toEqual([]);
  });
  it("regional 입력이 아예 없는 지자체뉴스 새 원고도 지역 태그 0으로 본다", () => {
    const { regional: _drop, ...rest } = q;
    expect(regionalIds(rest as ArticleForPublish)).toEqual(["reg1_17.region-tag-required"]);
  });
});

describe("지역 태그 기사 = 편집 분야 + 공익적 질문 + 판정 책임자 (REG1-17 · 12장 #7)", () => {
  it("편집 분야 없음 → editorial-field", () => {
    expect(regionalIds(reg({ editorialField: null }))).toEqual(["reg1_17.editorial-field"]);
  });
  it("공익적 질문 빈칸·공백만 → public-question", () => {
    expect(regionalIds(reg({ publicQuestion: null }))).toEqual(["reg1_17.public-question"]);
    expect(regionalIds(reg({ publicQuestion: "   " }))).toEqual(["reg1_17.public-question"]);
  });
  it("둘 다 없으면 두 항목 — 위치는 editorialField·publicQuestion", () => {
    const found = checkRegional(reg({ editorialField: null, publicQuestion: "" }), BASE_CONTEXT);
    expect(found.map((f) => [f.id, f.location?.field])).toEqual([
      ["reg1_17.editorial-field", "editorialField"],
      ["reg1_17.public-question", "publicQuestion"],
    ]);
  });
  it("지자체뉴스가 아닌 분야라도 지역 태그가 있으면 같은 규칙 (부동산 분야 기사)", () => {
    expect(regionalIds(reg({ editorialField: null }, { ...q, section: "realestate" }))).toEqual(["reg1_17.editorial-field"]);
  });
  it("광고·협찬(sponsored)은 편집 분야·공익적 질문을 보지 않는다", () => {
    const ad = { ...reg({ editorialField: null, publicQuestion: null }), contentType: "sponsored" as ContentType, reportingMethod: null, label: "ad" as const };
    expect(checkRegional(ad, BASE_CONTEXT)).toEqual([]);
    expect(isRegionalArticle(ad)).toBe(false);
  });
  it("판정 책임자 목록(regional_judge_fields)에 없는 분야 → field-judge-missing(보류), 목록에 넣으면 통과", () => {
    const ctx = { ...BASE_CONTEXT, regionalJudgeFields: ["local_tax", "realestate"] as const };
    const a = reg({ editorialField: "local_finance" });
    expect(regionalIds(a, ctx)).toEqual(["reg1_17.field-judge-missing"]);
    expect(regionalState(a, ctx).state).toBe("held");
    expect(regionalIds(a, { ...ctx, regionalJudgeFields: [...ctx.regionalJudgeFields, "local_finance"] })).toEqual([]);
    expect(regionalIds(a, { ...BASE_CONTEXT, regionalJudgeFields: [] }), "빈 목록 = 모든 분야 보류").toEqual(["reg1_17.field-judge-missing"]);
  });
  it("설정 문맥이 없으면 씨앗(네 분야 모두 판정 책임자 있음)", () => {
    for (const field of EDITORIAL_FIELDS) expect(regionalIds(reg({ editorialField: field }))).toEqual([]);
  });
});

describe("축제·명소·상권 소재 = 관계 유형 1개 이상 + 근거 1건 이상 (REG1-17)", () => {
  it.each(["festival", "attraction", "commerce"] as const)("%s + 관계 0 → relation-required(보류)", (subjectKind) => {
    const a = reg({ subjectKind, relationTypes: [] });
    expect(regionalIds(a)).toEqual(["reg1_17.relation-required"]);
    expect(regionalState(a, BASE_CONTEXT).state).toBe("held");
  });
  it("축제 + 관계 1 + 근거 0 → relation-evidence(보류), 반려된 근거만 있어도 0으로 센다", () => {
    expect(regionalIds({ ...reg({ subjectKind: "festival", relationTypes: ["budget"] }), evidence: [] })).toContain("reg1_17.relation-evidence");
    const onlyRejected = { ...reg({ subjectKind: "festival", relationTypes: ["budget"] }), evidence: [evidence("rejected")] };
    expect(checkRegional(onlyRejected, BASE_CONTEXT).map((f) => f.id)).toEqual(["reg1_17.relation-evidence"]);
  });
  it("축제 + 관계 1 + 근거 1(검토 중 포함) → 후보 — '축제 예산의 지방재정 영향' 수용 시나리오", () => {
    const a = reg({ subjectKind: "festival", relationTypes: ["budget"], editorialField: "local_finance", publicQuestion: "축제 예산이 시험군 지방재정에 어떤 영향을 주는가" });
    expect(regionalIds(a)).toEqual([]);
    expect(regionalState(a, BASE_CONTEXT)).toEqual({ state: "candidate", reasons: [] });
    expect(checkRegional({ ...a, evidence: [evidence("pending")] }, BASE_CONTEXT)).toEqual([]);
  });
  it("일반 소재는 관계 유형을 보지 않는다", () => {
    expect(regionalIds(reg({ subjectKind: "general", relationTypes: [] }))).toEqual([]);
  });
});

describe("편집자 판정 — 여행 후기·맛집 추천·행사 홍보는 보도·해설 발행 거부 (REG1-17)", () => {
  it.each(NON_NEWS_JUDGEMENTS)("%s + reported_news → non-news-judgement, 상태 separate_product", (judgement) => {
    const a = reg({ judgement });
    expect(regionalIds(a)).toEqual(["reg1_17.non-news-judgement"]);
    expect(checkRegional(a, BASE_CONTEXT)[0]!.message).toContain(EDITORIAL_JUDGEMENT_LABELS[judgement]);
    expect(regionalState(a, BASE_CONTEXT).state).toBe("separate_product");
  });
  it("travel_review + explainer도 거부, guide·opinion은 이 규칙 밖", () => {
    const base = reg({ judgement: "travel_review" });
    expect(checkRegional({ ...base, contentType: "explainer", reportingMethod: null }, BASE_CONTEXT).map((f) => f.id)).toEqual(["reg1_17.non-news-judgement"]);
    for (const contentType of ["guide", "opinion"] as const) {
      expect(checkRegional({ ...base, contentType, reportingMethod: null }, BASE_CONTEXT).map((f) => f.id), contentType).toEqual([]);
    }
  });
  it("news_candidate 판정은 막지 않는다", () => {
    expect(regionalIds(reg({ judgement: "news_candidate" }))).toEqual([]);
  });
  it("'이번 주말 축제 10선'(축제·관계 0·여행 후기) → 후보 0 = separate_product, '맛집 순위'(상권·맛집 추천) → separate_product", () => {
    const tenPicks = reg({ subjectKind: "festival", relationTypes: [], judgement: "travel_review" });
    expect(regionalState(tenPicks, BASE_CONTEXT).state).toBe("separate_product");
    expect(regionalIds(tenPicks)).toEqual(["reg1_17.non-news-judgement", "reg1_17.relation-required"]);
    const ranking = reg({ subjectKind: "commerce", relationTypes: [], judgement: "restaurant_pick" });
    expect(regionalState(ranking, BASE_CONTEXT).state).toBe("separate_product");
  });
});

describe("편집 승인 3항목 · 이해관계 표시 (REG1-17 · NAV-06)", () => {
  it("3항목 키 = evidence·relation·ad_independence, true만 확인으로 센다", () => {
    expect(missingRegionalChecks({ evidence: true, relation: true, ad_independence: true })).toEqual([]);
    expect(missingRegionalChecks({ evidence: true, relation: "true", ad_independence: 1 })).toEqual(["relation", "ad_independence"]);
    expect(missingRegionalChecks(null)).toEqual(["evidence", "relation", "ad_independence"]);
  });
  it("승인 checklist에 하나라도 빠지면 desk-checklist(위치 reviews) — 빠진 항목 이름이 문장에", () => {
    for (const key of REGIONAL_DESK_CHECKLIST) {
      const checklist = Object.fromEntries(REGIONAL_DESK_CHECKLIST.filter((k) => k !== key).map((k) => [k, true]));
      const found = checkRegional(withDeskChecklist(q, checklist), BASE_CONTEXT);
      expect(found.map((f) => [f.id, f.location?.field]), key).toEqual([["reg1_17.desk-checklist", "reviews"]]);
    }
    expect(checkRegional(withDeskChecklist(q, {}), BASE_CONTEXT)[0]!.message).toContain("근거·관계·광고 독립성");
  });
  it("본인 발행 승인(작성 기자 본인 + checklist.selfPublish)도 3항목을 본다 — 빠지면 desk-checklist, 다 있으면 차단 0 (2026-10-31 PO 결정)", () => {
    const self = (checklist: Record<string, unknown>): ArticleForPublish => ({
      ...q,
      reviews: [{ ...q.reviews[0]!, reviewerUserId: q.authorUserId!, checklist: { ...checklist, selfPublish: true } }],
    });
    expect(regionalIds(self({ evidence: true, relation: true }))).toEqual(["reg1_17.desk-checklist"]);
    expect(blockers(self({ evidence: true, relation: true, ad_independence: true }))).toEqual([]);
  });
  it("승인 기록이 없으면 이 항목은 내지 않는다(편집 승인 없음은 nav03.desk-edit-required)", () => {
    const ids = blockers({ ...q, reviews: [] });
    expect(ids).toContain("nav03.desk-edit-required");
    expect(ids).not.toContain("reg1_17.desk-checklist");
  });
  it("지역 기사가 아니면(지방세 해설) 3항목을 보지 않는다", () => {
    expect(checkRegional(withDeskChecklist(TAX_EXPLAINER, {}), BASE_CONTEXT)).toEqual([]);
  });
  it("광고 계약 제휴사를 다뤘는데 이해관계 표시가 비면 interest-disclosure, 적으면 통과", () => {
    const partner = { id: "partner-7", name: "시험용 가상상회" };
    const a = reg({ contractedPartners: [partner], interestDisclosure: null });
    const found = checkRegional(a, BASE_CONTEXT);
    expect(found.map((f) => [f.id, f.location?.field])).toEqual([["reg1_17.interest-disclosure", "interestDisclosure"]]);
    expect(found[0]!.message).toContain("시험용 가상상회");
    expect(checkRegional(reg({ contractedPartners: [partner], interestDisclosure: "시험용 가상상회는 이 매체의 광고주입니다" }), BASE_CONTEXT)).toEqual([]);
  });
});
