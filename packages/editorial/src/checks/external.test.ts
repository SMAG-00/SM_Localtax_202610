// OPT-03 seo-lint 결과·OPT-06 유사도 결과를 입력으로 받아 발행 판정에 합친다
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { TAX_EXPLAINER } from "../../fixtures/explainer";
import { uniqueIds } from "../../fixtures/helpers";
import { evaluatePublish } from "../evaluate";
import type { PublishContext } from "../model";

const run = (ctx: PublishContext) => evaluatePublish(TAX_EXPLAINER, ctx);

describe("OPT-03 최적화 점검 결과", () => {
  it("차단 항목은 하나씩 차단으로 옮기고 항목 ID를 알려 준다", () => {
    const result = run({ ...BASE_CONTEXT, seoLint: { blockers: ["seo.canonical", "geo.author"], warnings: [] } });
    expect(result.canPublish).toBe(false);
    expect(result.blockers).toEqual([
      expect.objectContaining({ id: "opt03.seo-lint-blocker", location: { field: "seoLint", phrase: "geo.author" } }),
      expect.objectContaining({ id: "opt03.seo-lint-blocker", location: { field: "seoLint", phrase: "seo.canonical" } }),
    ]);
  });

  it("경고 항목은 발행을 막지 않고 경고로 남긴다", () => {
    const result = run({ ...BASE_CONTEXT, seoLint: { blockers: [], warnings: ["seo.internal-links", "aeo.question-heading"] } });
    expect(result.canPublish).toBe(true);
    expect(result.warnings.map((f) => f.location?.phrase)).toEqual(["aeo.question-heading", "seo.internal-links"]);
    expect(uniqueIds(result.warnings)).toEqual(["opt03.seo-lint-warning"]);
  });

  it("점검 결과가 없으면 발행 불가", () => {
    expect(uniqueIds(run({ ...BASE_CONTEXT, seoLint: null }).blockers)).toEqual(["opt03.seo-lint-missing"]);
  });
});

describe("OPT-06 유사도 결과", () => {
  it("기준 초과(blocked)는 발행 불가", () => {
    expect(uniqueIds(run({ ...BASE_CONTEXT, similarity: { status: "blocked" } }).blockers)).toEqual(["opt06.similarity-blocked"]);
  });

  it.each(["no_sources", "no_body"] as const)("비교하지 못한 상태(%s)는 통과로 보지 않고 경고로 남긴다", (status) => {
    const result = run({ ...BASE_CONTEXT, similarity: { status } });
    expect(result.canPublish).toBe(true);
    expect(uniqueIds(result.warnings)).toEqual(["opt06.similarity-unverified"]);
  });

  it("유사도 검사 결과가 없으면 발행 불가", () => {
    expect(uniqueIds(run({ ...BASE_CONTEXT, similarity: null }).blockers)).toEqual(["opt06.similarity-missing"]);
  });
});
