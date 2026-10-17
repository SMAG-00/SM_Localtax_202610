// ART-01 — 분야·유형 필수, 보도기사의 취재 방식, sponsored 표기, digest 회차, 예약 slug
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { TAX_EXPLAINER } from "../../fixtures/explainer";
import { uniqueIds } from "../../fixtures/helpers";
import { QUANTITATIVE_NEWS } from "../../fixtures/quantitative";
import { evaluatePublish } from "../evaluate";
import type { ArticleForPublish } from "../model";

const blockers = (article: ArticleForPublish) => uniqueIds(evaluatePublish(article, BASE_CONTEXT).blockers);

describe("ART-01 분야·유형", () => {
  it("section이 없으면 발행 불가", () => {
    expect(blockers({ ...TAX_EXPLAINER, section: null })).toEqual(["art01.section-required"]);
  });

  it("content_type이 없으면(이관 기사 분류 전) 발행 불가", () => {
    expect(blockers({ ...TAX_EXPLAINER, contentType: null })).toEqual(["art01.content-type-required"]);
  });
});

describe("ART-01 취재 방식 — reported_news만 갖는다", () => {
  it("reported_news에 reporting_method가 없으면 발행 불가", () => {
    expect(blockers({ ...QUANTITATIVE_NEWS, reportingMethod: null })).toEqual(["art01.reporting-method-required"]);
  });

  it.each(["quantitative", "qualitative", "mixed"] as const)("explainer에 reporting_method(%s)가 있으면 발행 불가", (method) => {
    expect(blockers({ ...TAX_EXPLAINER, reportingMethod: method })).toEqual(["art01.reporting-method-not-allowed"]);
  });
});

describe("ART-01 sponsored 표기", () => {
  it("sponsored인데 표기가 '없음'이면 발행 불가", () => {
    expect(blockers({ ...TAX_EXPLAINER, contentType: "sponsored", label: "none" })).toEqual(["art01.sponsored-label-required"]);
  });

  it("sponsored + 광고 표기는 통과", () => {
    expect(evaluatePublish({ ...TAX_EXPLAINER, contentType: "sponsored", label: "ad" }, BASE_CONTEXT).canPublish).toBe(true);
  });
});

describe("ART-01 digest — 주간 회차(weekly_digests) 연결 필수", () => {
  it("회차 연결이 없으면 발행 불가", () => {
    expect(blockers({ ...TAX_EXPLAINER, contentType: "digest", digestId: null })).toEqual(["art01.digest-link-required"]);
  });

  it("회차가 연결되면 통과", () => {
    expect(blockers({ ...TAX_EXPLAINER, contentType: "digest", digestId: "digest-2026-42-gaon" })).toEqual([]);
  });

  it("digest가 아닌 기사에는 회차가 필요 없다", () => {
    expect(blockers({ ...TAX_EXPLAINER, digestId: null })).toEqual([]);
  });
});

describe("ART-01 예약 slug — /news/ 아래 목록 경로 이름", () => {
  it.each(["video", "photo", "popular"])("slug '%s'는 발행 불가", (slug) => {
    const result = evaluatePublish({ ...TAX_EXPLAINER, slug }, BASE_CONTEXT);
    expect(uniqueIds(result.blockers)).toEqual(["art01.reserved-slug"]);
    expect(result.blockers[0]!.location).toEqual({ field: "slug", phrase: slug });
  });

  it.each(["videos", "photo-essay", "popular-tax-questions"])("예약 이름을 포함만 하는 slug '%s'는 통과", (slug) => {
    expect(blockers({ ...TAX_EXPLAINER, slug })).toEqual([]);
  });
});
