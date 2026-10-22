// PR-04 분양 홍보 원고 — sponsor_material 출처가 있는 기사는 sponsored로만 발행 (W4 17단계)
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { TAX_EXPLAINER } from "../../fixtures/explainer";
import { uniqueIds } from "../../fixtures/helpers";
import { QUANTITATIVE_NEWS } from "../../fixtures/quantitative";
import { evaluatePublish } from "../evaluate";
import { SOURCE_KINDS, type ArticleForPublish, type ArticleSource, type ContentType } from "../model";
import { checkSponsorMaterial } from "./sponsor-material";

const material: ArticleSource = {
  id: "src-sponsor-01",
  kind: "sponsor_material",
  title: "시험용 하늘마을 분양 홍보 원고",
  url: null,
  provider: "시험용 분양대행사",
  accessedAt: "2026-10-20",
  rightsStatus: "confirmed",
};
const withMaterial = (a: ArticleForPublish, over: Partial<ArticleForPublish> = {}): ArticleForPublish => ({ ...a, ...over, sources: [...a.sources, material] });
const blockers = (a: ArticleForPublish) => uniqueIds(evaluatePublish(a, BASE_CONTEXT).blockers);

describe("PR-04 분양 홍보 원고는 sponsored로만", () => {
  it("출처 종류 목록에 sponsor_material이 있다 (W2-a 7개 + 17단계 — DB check와 같은 값)", () => {
    expect(SOURCE_KINDS).toEqual(["official_doc", "dataset", "press_release", "interview", "field", "photo", "other", "sponsor_material"]);
  });

  it("분양 홍보 원고를 쓴 해설·보도기사는 발행 거부 — 걸린 출처 번호와 지금 유형을 알린다", () => {
    const explainer = checkSponsorMaterial(withMaterial(TAX_EXPLAINER), BASE_CONTEXT);
    expect(explainer.map((f) => [f.id, f.level, f.ruleRef, f.location])).toEqual([["pr04.sponsor-material-sponsored", "block", "PR-04", { field: "sources", phrase: "src-sponsor-01" }]]);
    expect(explainer[0]!.message).toContain("지금 유형 explainer");
    expect(blockers(withMaterial(TAX_EXPLAINER))).toContain("pr04.sponsor-material-sponsored");
    expect(blockers(withMaterial(QUANTITATIVE_NEWS))).toContain("pr04.sponsor-material-sponsored");
  });

  it("sponsored 밖 유형은 모두 거부 — 가이드·오피니언·digest·유형 없음도", () => {
    const types: (ContentType | null)[] = ["reported_news", "explainer", "guide", "opinion", "digest", null];
    for (const t of types) {
      expect(checkSponsorMaterial(withMaterial(TAX_EXPLAINER, { contentType: t }), BASE_CONTEXT).map((f) => f.id), String(t)).toEqual(["pr04.sponsor-material-sponsored"]);
    }
  });

  it("광고 표기 sponsored로는 이 규칙에 걸리지 않는다", () => {
    const ad = withMaterial(TAX_EXPLAINER, { contentType: "sponsored", label: "ad" });
    expect(checkSponsorMaterial(ad, BASE_CONTEXT)).toEqual([]);
    expect(blockers(ad)).not.toContain("pr04.sponsor-material-sponsored");
  });

  it("분양 홍보 원고가 없으면 0건 — 다른 출처 종류(보도자료·기타)로는 걸리지 않는다", () => {
    expect(checkSponsorMaterial(TAX_EXPLAINER, BASE_CONTEXT)).toEqual([]);
    const other: ArticleSource = { ...material, id: "src-other", kind: "other" };
    expect(checkSponsorMaterial({ ...TAX_EXPLAINER, sources: [...TAX_EXPLAINER.sources, other] }, BASE_CONTEXT)).toEqual([]);
  });

  it("분양 홍보 원고가 둘이면 항목 하나에 번호 둘", () => {
    const two = { ...TAX_EXPLAINER, sources: [...TAX_EXPLAINER.sources, material, { ...material, id: "src-sponsor-02" }] };
    expect(checkSponsorMaterial(two, BASE_CONTEXT).map((f) => f.location?.phrase)).toEqual(["src-sponsor-01,src-sponsor-02"]);
  });
});
