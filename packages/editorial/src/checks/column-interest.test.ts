// PR-14 부동산 칼럼 이해관계 3항목 (01B W4 21단계, 12장 #170). 기사는 시험용 가짜.
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { uniqueIds } from "../../fixtures/helpers";
import { QUANTITATIVE_NEWS } from "../../fixtures/quantitative";
import { evaluatePublish } from "../evaluate";
import type { ArticleForPublish } from "../model";
import { checkColumnInterest, columnInterestProblem } from "./column-interest";

const col = (items: { item: string; state: string }[], over: Partial<ArticleForPublish> = {}, required = true): ArticleForPublish => ({
  ...QUANTITATIVE_NEWS,
  section: "realestate",
  contentType: "opinion",
  realestateColumn: { required, items },
  ...over,
});
const ALL = [
  { item: "union", state: "declared" },
  { item: "contractor", state: "none_confirmed" },
  { item: "trust_company", state: "none_confirmed" },
];

describe("부동산 칼럼 이해관계 3항목 (PR-14)", () => {
  it("3항목이 모두 있으면 막지 않는다", () => {
    expect(checkColumnInterest(col(ALL))).toEqual([]);
  });

  it("3항목이 모두 없으면 세 글자가 모두 빠진 항목으로 나온다", () => {
    const f = checkColumnInterest(col([]));
    expect(f).toHaveLength(1);
    expect(f[0]!.id).toBe("pr14.column-interest");
    expect(f[0]!.level).toBe("block");
    expect(f[0]!.message).toContain("빠진 항목: 조합 자문 관계·시공사 자문 관계·신탁사 자문 관계");
  });

  it("하나만 비면 그 항목만 빠진 것으로 나온다", () => {
    expect(columnInterestProblem(col(ALL.filter((i) => i.item !== "trust_company")))).toEqual({ missing: ["신탁사 자문 관계"] });
    expect(columnInterestProblem(col(ALL.filter((i) => i.item !== "union")))).toEqual({ missing: ["조합 자문 관계"] });
  });

  it("모르는 상태 값은 채운 것으로 세지 않는다", () => {
    expect(columnInterestProblem(col([{ item: "union", state: "unknown" }, ...ALL.slice(1)]))).toEqual({ missing: ["조합 자문 관계"] });
  });

  it("다른 분야 칼럼·칼럼이 아닌 기사·대상 아님·입력 없음은 이 검사를 하지 않는다", () => {
    expect(checkColumnInterest(col([], { section: "tax" }))).toEqual([]);
    expect(checkColumnInterest(col([], { contentType: "reported_news" }))).toEqual([]);
    expect(checkColumnInterest(col([], {}, false))).toEqual([]);
    expect(checkColumnInterest({ ...col([]), realestateColumn: undefined })).toEqual([]);
  });

  it("발행 판정에 차단으로 올라온다", () => {
    expect(uniqueIds(evaluatePublish(col([]), BASE_CONTEXT).blockers)).toContain("pr14.column-interest");
    expect(uniqueIds(evaluatePublish(col(ALL), BASE_CONTEXT).blockers)).not.toContain("pr14.column-interest");
  });
});
