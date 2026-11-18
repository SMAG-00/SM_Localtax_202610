// REG1-17 지역 기사 편집 게이트 — 2026-11-18 PO 결정으로 걷어냈다 ("지자체뉴스는 지자체뉴스일 뿐").
// 예전에 차단·경고·보류를 냈던 모든 칸 조합이 이제 아무것도 내지 않는지 본다. 값 목록(설계 2.1)은 DB 칸과 맞춰야 하므로 그대로 둔다.
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

describe("지역 기사 판정을 쓰지 않는다 (2026-11-18 PO 결정)", () => {
  const noRegionalFindings = (a: ArticleForPublish): void => {
    expect(regionalIds(a)).toEqual([]);
    expect(checkRegional(a, BASE_CONTEXT)).toEqual([]);
    expect(regionalState(a, BASE_CONTEXT)).toEqual({ state: "not_regional", reasons: [] });
  };

  it("지역 태그 0인 지자체뉴스 새 발행도 reg1_17 차단이 없다", () => {
    const a: ArticleForPublish = { ...reg({ regionCodes: [] }), section: "local", firstPublishedAt: null };
    noRegionalFindings(a);
  });
  it("regional 입력이 아예 없는 지자체뉴스 새 원고도 막지 않는다", () => {
    const { regional: _drop, ...rest } = q;
    noRegionalFindings({ ...rest, section: "local", firstPublishedAt: null } as ArticleForPublish);
  });
  it("지역 태그가 있어도 편집 분야·공익적 질문이 비어 있어도 막지 않는다", () => {
    noRegionalFindings(reg({ editorialField: null, publicQuestion: " " }));
  });
  it("판정 책임자 목록에 분야가 없어도 보류하지 않는다", () => {
    noRegionalFindings(reg({}));
    expect(regionalIds(reg({}), { ...BASE_CONTEXT, regionalJudgeFields: [] })).toEqual([]);
  });
  it.each(["festival", "attraction", "commerce"] as const)("%s 소재에 관계 유형·근거가 없어도 막지 않는다", (subjectKind) => {
    noRegionalFindings({ ...reg({ subjectKind, relationTypes: [] }), evidence: [] });
  });
  it.each(NON_NEWS_JUDGEMENTS)("%s 판정 + 보도기사도 막지 않는다", (judgement) => {
    noRegionalFindings(reg({ judgement }));
  });
  it("승인 3항목이 비어 있어도, 계약 제휴사 이해관계 표시가 없어도 막지 않는다", () => {
    noRegionalFindings(withDeskChecklist(q, { noCausalClaim: true }));
    noRegionalFindings(reg({ contractedPartners: [{ id: 7, name: "시험용 가상상회" }], interestDisclosure: null }));
  });
  it("그래도 발행 가능 여부는 다른 규칙이 정한다 — 견본은 통과", () => {
    expect(evaluatePublish(q, BASE_CONTEXT).canPublish).toBe(true);
  });
  it("이름표 도우미는 남아 있다 — 승인 3항목 키는 true만 확인으로 센다", () => {
    expect(missingRegionalChecks({ evidence: true, relation: true, ad_independence: true })).toEqual([]);
    expect(missingRegionalChecks({ evidence: true, relation: "true", ad_independence: 1 })).toEqual(["relation", "ad_independence"]);
    expect(missingRegionalChecks(null)).toEqual(["evidence", "relation", "ad_independence"]);
  });
  it("지역 기사 여부(isRegionalArticle)는 다른 경고 검사가 쓰므로 그대로다", () => {
    expect(isRegionalArticle(q)).toBe(true);
    expect(isRegionalArticle(TAX_EXPLAINER)).toBe(false);
  });
});
