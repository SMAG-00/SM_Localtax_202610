// NAV-10 — 정량형 필수 7묶음(원자료 · 지표 정의 · 계산 과정 · 원자료 대조 기록 · 그래프·표 표기 · 한계 · 관계자 확인)과 '인과 단정 없음'
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { uniqueIds, withBlock } from "../../fixtures/helpers";
import { QUALITATIVE_NEWS } from "../../fixtures/qualitative";
import { QUANTITATIVE_NEWS } from "../../fixtures/quantitative";
import { evaluatePublish } from "../evaluate";
import type { ArticleDataset, ArticleForPublish, QuantitativeChecklist, TableBlock } from "../model";

const q = QUANTITATIVE_NEWS;
const table = q.blocks[3] as TableBlock;
const run = (article: ArticleForPublish) => evaluatePublish(article, BASE_CONTEXT);
const blockers = (article: ArticleForPublish) => uniqueIds(run(article).blockers);
const editDataset = (index: number, patch: Partial<ArticleDataset>): ArticleForPublish => ({
  ...q,
  datasets: q.datasets.map((d, i) => (i === index ? { ...d, ...patch } : d)),
});
const editChecklist = (patch: Partial<QuantitativeChecklist>): ArticleForPublish => ({
  ...q,
  quantitativeChecklist: { ...q.quantitativeChecklist!, ...patch },
});

describe("NAV-10 필수 7묶음을 하나씩 비운 원고 7건 — 모두 발행 거부", () => {
  const cases: [string, ArticleForPublish, string][] = [
    ["① 원자료 — 이용권리(license) 빔", editDataset(0, { license: null }), "nav10.source-data"],
    ["② 지표 정의 — 분모 빔", editDataset(1, { denominator: "" }), "nav10.indicator-definition"],
    ["③ 계산 과정 — 수식(transform) 빔", editDataset(0, { transform: null }), "nav10.calculation"],
    ["④ 원자료 대조 기록 빔", editChecklist({ sourceCrossCheck: "" }), "nav10.source-cross-check"],
    ["⑤ 그래프·표 표기 — 표의 축/단위/출처 없음", withBlock(q, 3, { ...table, chart: null }), "nav10.chart-labels"],
    ["⑥ 한계 빔", editChecklist({ limitations: null }), "nav10.limitations"],
    ["⑦ 관계자 확인 — 공백만", editChecklist({ relatedPartyCheck: "   " }), "nav10.related-party-check"],
  ];

  it.each(cases)("%s", (_name, article, expected) => {
    const result = run(article);
    expect(result.canPublish).toBe(false);
    expect(uniqueIds(result.blockers)).toEqual([expected]);
  });

  it("7묶음 모두 있는 견본은 통과", () => {
    expect(blockers(q)).toEqual([]);
  });
});

describe("NAV-10 묶음 안의 칸", () => {
  it.each([
    ["원자료 파일/공식 URL", { sourceUrl: null }, "nav10.source-data"],
    ["제공기관", { provider: "" }, "nav10.source-data"],
    ["수집일", { collectedAt: null }, "nav10.source-data"],
    ["지표 정의", { definition: null }, "nav10.indicator-definition"],
    ["기간", { period: "" }, "nav10.indicator-definition"],
    ["단위", { unit: null }, "nav10.indicator-definition"],
    ["지역 단위", { regionUnit: null }, "nav10.indicator-definition"],
    ["제외값", { exclusions: null }, "nav10.indicator-definition"],
    ["재현 파일 해시", { reproFileHash: "" }, "nav10.calculation"],
  ] as const)("%s를 비우면 그 묶음이 빈다", (_name, patch, expected) => {
    expect(blockers(editDataset(1, patch))).toEqual([expected]);
  });

  it("빈 칸 이름을 문구에 적는다 (분모를 지운 원고)", () => {
    const f = run(editDataset(1, { denominator: null })).blockers[0]!;
    expect(f.message).toBe("지표 정의 묶음이 비었습니다 — 비어 있는 칸: 분모 (자료 ev-ds-2)");
    expect(f.location).toEqual({ field: "datasets", phrase: "ev-ds-2" });
  });

  it("재현 정보(article_datasets)가 0건이면 원자료·지표 정의·계산 과정 3묶음이 빈다", () => {
    expect(blockers({ ...q, datasets: [] })).toEqual(["nav10.source-data", "nav10.indicator-definition", "nav10.calculation"]);
  });

  it("확인 목록이 없으면 대조 기록·한계·관계자 확인·인과 단정 없음이 빈다", () => {
    expect(blockers({ ...q, quantitativeChecklist: null })).toEqual([
      "nav10.source-cross-check",
      "nav10.limitations",
      "nav10.related-party-check",
      "nav10.no-causal-claim",
    ]);
  });

  it("표의 단위만 비어도 그래프·표 표기가 빈다 — 위치는 그 블록", () => {
    const result = run(withBlock(q, 3, { ...table, chart: { ...table.chart!, unit: "" } }));
    expect(result.blockers).toEqual([
      expect.objectContaining({ id: "nav10.chart-labels", location: { field: "blocks", blockIndex: 3 } }),
    ]);
  });

  it("표·인포그래픽이 하나도 없으면 그래프·표 표기가 빈다", () => {
    expect(blockers({ ...q, blocks: q.blocks.filter((b) => b.type !== "table") })).toEqual(["nav10.chart-labels"]);
  });

  it("축/단위/출처를 갖춘 인포그래픽도 그래프 표기로 친다", () => {
    const infographic = {
      type: "infographic" as const,
      mediaId: "media-0101-chart",
      alt: "구별 거래량 막대그래프",
      caption: "구별 아파트 매매 거래량",
      rightsStatus: "confirmed" as const,
      chart: table.chart,
      template: "compare" as const,
      data: { kind: "table" as const, columns: ["구", "거래량"], rows: [["가온구", "120건"]] },
    };
    expect(blockers(withBlock(q, 3, infographic))).toEqual([]);
  });
});

describe("NAV-10 편집자 확인 '인과 단정 없음'", () => {
  it("체크하지 않으면 발행 불가", () => {
    expect(blockers(editChecklist({ noCausalClaim: false }))).toEqual(["nav10.no-causal-claim"]);
  });
});

describe("NAV-10 적용 범위", () => {
  it("정성형 보도기사에는 정량형 묶음을 요구하지 않는다", () => {
    expect(QUALITATIVE_NEWS.datasets).toEqual([]);
    expect(blockers(QUALITATIVE_NEWS)).toEqual([]);
  });

  it("혼합형(mixed)은 정량형 묶음도 요구한다", () => {
    const mixed: ArticleForPublish = { ...QUALITATIVE_NEWS, reportingMethod: "mixed" };
    expect(blockers(mixed)).toEqual([
      "nav10.source-data",
      "nav10.indicator-definition",
      "nav10.calculation",
      "nav10.source-cross-check",
      "nav10.chart-labels",
      "nav10.limitations",
      "nav10.related-party-check",
      "nav10.no-causal-claim",
    ]);
  });
});
