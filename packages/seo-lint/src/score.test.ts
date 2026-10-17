// 축 점수(0~100 정수)와 결정론 — 같은 원고·같은 규칙 버전이면 같은 결과 (OPT-03)
// 축 점수 = round(100 × 통과 항목 가중치 합 ÷ 해당 항목 가중치 합). v1 가중치: 차단 규칙 3 · 경고 규칙 1
import { describe, expect, it } from "vitest";
import rawRules from "../rules/rules.v1.json";
import { AXES, BLOCKING_SAMPLES, PASSING_SAMPLE, RULES_V1, lintArticle, parseRules } from "./index";
import type { ArticleForLint } from "./index";

const base = PASSING_SAMPLE.article;
const ctx = PASSING_SAMPLE.context;
const art = (over: Partial<ArticleForLint>): ArticleForLint => ({ ...base, ...over });
const scores = (a: ArticleForLint) => lintArticle(a, ctx, RULES_V1).scores;

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
};

describe("축 점수", () => {
  it("통과 견본 — SEO 7/8 → 88, AEO 2/3 → 67, GEO·공통 100", () => {
    // SEO: canonical 3 + 경고 5개×1 = 8, 내부 링크 경고 하나 빠져 7. AEO: 경고 3개 중 질문형 소제목 하나 빠져 2
    expect(scores(base)).toEqual({ SEO: 88, AEO: 67, GEO: 100, 공통: 100 });
  });

  it("모든 항목을 통과하면 네 축 모두 100", () => {
    const all = art({ internalLinkCount: 2, headings: [...base.headings, { level: 2, text: "감면은 언제 신청하나요?" }] });
    expect(scores(all)).toEqual({ SEO: 100, AEO: 100, GEO: 100, 공통: 100 });
    expect(lintArticle(all, ctx, RULES_V1).items.every((i) => i.level === "pass")).toBe(true);
  });

  it("모든 항목을 어기면 네 축 모두 0", () => {
    const worst = art({
      title: "주택 취득세율 한눈에 보기",
      metaDescription: "",
      canonical: null,
      lawBasisDate: null,
      authors: [],
      dates: { data: { publishedAt: null, updatedAt: null }, displayed: { publishedAt: null, updatedAt: null } },
      claims: [{ id: "c", text: "근거 없는 주장", evidenceIds: [] }],
      sources: [],
      evidence: [],
      structuredDataMismatches: ["headline"],
      similarity: { status: "blocked" },
      sponsorship: { label: "광고", pageBadge: null, structuredHeadline: base.title },
      internalLinkCount: 0,
      images: [{ alt: "" }],
      summaryBoxLines: [],
      faqs: [],
    });
    expect(scores(worst)).toEqual({ SEO: 0, AEO: 0, GEO: 0, 공통: 0 });
  });

  it("해당 없음(법령 기준일 비대상)은 점수에서 뺀다 — 실패로 세면 75가 될 GEO가 100", () => {
    expect(scores(art({ section: "realestate", taxReviewTarget: false, hasTaxLens: false, lawBasisDate: null })).GEO).toBe(100);
  });

  it("차단 항목 하나는 그 축에서 가중치 3만큼 빠진다 — 저자 없음 GEO 9/12 → 75", () => {
    expect(scores(art({ authors: [] }))).toEqual({ SEO: 88, AEO: 67, GEO: 75, 공통: 100 });
  });

  it("유사도 비교 대상 없음은 통과로 세지 않는다 — 공통 6/9 → 67", () => {
    expect(scores(art({ similarity: { status: "no_sources" } })).공통).toBe(67);
  });

  it("가중치는 규칙 파일 값을 쓴다 — 내부 링크 가중치 3이면 SEO 7/10 → 70", () => {
    const raw = JSON.parse(JSON.stringify(rawRules));
    raw.rules.find((r: { id: string }) => r.id === "seo.internal-links").weight = 3;
    expect(lintArticle(base, ctx, parseRules(raw)).scores.SEO).toBe(70);
  });

  it("견본 9종의 네 축 점수가 모두 0~100 정수다", () => {
    for (const s of [PASSING_SAMPLE, ...BLOCKING_SAMPLES]) {
      const result = lintArticle(s.article, s.context, RULES_V1);
      expect(Object.keys(result.scores)).toEqual([...AXES]);
      for (const v of Object.values(result.scores)) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("결정론", () => {
  it.each([PASSING_SAMPLE, ...BLOCKING_SAMPLES].map((s) => [s.id, s] as const))("%s — 두 번 돌려도, 복사본으로 돌려도 결과가 같다", (_id, s) => {
    const first = lintArticle(s.article, s.context, RULES_V1);
    const second = lintArticle(s.article, s.context, RULES_V1);
    const cloned = lintArticle(structuredClone(s.article), structuredClone(s.context), parseRules(JSON.parse(JSON.stringify(rawRules))));
    expect(second).toEqual(first);
    expect(cloned).toEqual(first);
    expect(JSON.stringify(cloned)).toBe(JSON.stringify(first));
  });

  it("점검은 입력을 바꾸지 않는다 — 얼린 입력으로도 같은 결과", () => {
    const frozenArticle = deepFreeze(structuredClone(base));
    const frozenContext = deepFreeze(structuredClone(ctx));
    expect(lintArticle(frozenArticle, frozenContext, RULES_V1)).toEqual(lintArticle(base, ctx, RULES_V1));
  });
});
