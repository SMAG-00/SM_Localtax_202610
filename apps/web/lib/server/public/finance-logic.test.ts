import { describe, expect, it } from "vitest";
import {
  FINANCE_COPY,
  FINANCE_NO_INTEREST,
  SVG,
  financeInterestLine,
  groupIndicators,
  groupRegulations,
  layoutDiagram,
  relationRows,
  type IndicatorRow,
  type RegulationRow,
} from "./finance-logic";

// 개발금융 공개 화면 순수 계산 (W5) - 모든 값은 시험용 가짜다.
const D = {
  alt: "시험 구조도",
  nodes: [{ key: "a", label: "가" }, { key: "b", label: "나" }, { key: "c", label: "다" }],
  edges: [{ from: "a", to: "b", label: "ab" }, { from: "b", to: "c", label: "" }],
};

describe("구조도 배치와 같은 내용의 표", () => {
  it("들어오는 관계가 없는 노드가 0층, 관계를 따라 층이 늘고 좌표가 겹치지 않는다", () => {
    const l = layoutDiagram(D);
    expect(l.nodes.map((n) => n.layer)).toEqual([0, 1, 2]);
    expect(new Set(l.nodes.map((n) => `${n.x},${n.y}`)).size).toBe(3);
    expect(l.width).toBe(SVG.pad * 2 + 3 * SVG.nodeW + 2 * SVG.gapX);
    expect(l.edges).toHaveLength(2);
    expect(l.edges[0]).toMatchObject({ x1: SVG.pad + SVG.nodeW, x2: SVG.pad + SVG.nodeW + SVG.gapX });
  });
  it("같은 층 노드는 세로로 쌓이고 순환 관계에서도 끝난다", () => {
    const fan = layoutDiagram({ alt: "x", nodes: [{ key: "a", label: "a" }, { key: "b", label: "b" }, { key: "c", label: "c" }], edges: [{ from: "a", to: "b", label: "" }, { from: "a", to: "c", label: "" }] });
    expect(fan.nodes[1]!.y).toBeLessThan(fan.nodes[2]!.y);
    const cycle = layoutDiagram({ alt: "x", nodes: [{ key: "a", label: "a" }, { key: "b", label: "b" }], edges: [{ from: "a", to: "b", label: "" }, { from: "b", to: "a", label: "" }] });
    expect(cycle.nodes).toHaveLength(2);
  });
  it("표 행은 관계 목록과 1:1이고 노드 key를 이름으로 바꾼다", () => {
    expect(relationRows(D)).toEqual([{ from: "가", to: "나", label: "ab" }, { from: "나", to: "다", label: "" }]);
  });
});

const ind = (over: Partial<IndicatorRow>): IndicatorRow => ({ id: 1, indicator_key: "k", label: "지표", definition: "정의", value: 1, unit: "u", as_of: "2026-09-30", collected_on: "2026-10-01", provider: "기관", source_url: "https://www.example.test/a", is_latest: true, ...over });

describe("통계 묶음", () => {
  it("지표마다 기준일이 가장 늦은 행이 최신이고 이전 값이 남는다(덮어쓰기 0)", () => {
    const g = groupIndicators([ind({ id: 1, as_of: "2026-06-30", value: 1 }), ind({ id: 2, as_of: "2026-09-30", value: 2 }), ind({ id: 3, indicator_key: "z", label: "다른 지표" })]);
    const k = g.find((x) => x.key === "k")!;
    expect(k.latest.value).toBe(2);
    expect(k.history.map((h) => h.value)).toEqual([1]);
    expect(g).toHaveLength(2);
  });
  it("원자료 칸(제공기관·원문 주소·기준일)이 하나라도 비면 그 행은 그리지 않는다", () => {
    expect(groupIndicators([ind({ provider: "" })])).toEqual([]);
    expect(groupIndicators([ind({ source_url: " " })])).toEqual([]);
    expect(groupIndicators([ind({ as_of: "" })])).toEqual([]);
    expect(groupIndicators([ind({ value: "" })])).toEqual([]);
  });
});

const reg = (over: Partial<RegulationRow>): RegulationRow => ({ id: 1, reg_key: "r", title: "규제", stage: "예정", effective_on: "2099-01-01", provider: "기관", source_url: "https://www.example.test/r", is_latest: true, in_force: false, ...over });

describe("규제 묶음", () => {
  it("같은 항목은 가장 늦게 쌓인 행이 현재 단계이고 이전 단계가 남는다, 시행 예정일 순으로 늘어놓는다", () => {
    const g = groupRegulations([reg({ id: 1, stage: "입법예고" }), reg({ id: 2, stage: "공포" }), reg({ id: 3, reg_key: "s", effective_on: "2098-01-01" })]);
    expect(g.map((x) => x.key)).toEqual(["s", "r"]);
    const r = g.find((x) => x.key === "r")!;
    expect(r.latest.stage).toBe("공포");
    expect(r.history.map((h) => h.stage)).toEqual(["입법예고"]);
  });
  it("원문(제공기관·주소) 없는 행은 뺀다", () => {
    expect(groupRegulations([reg({ source_url: "" })])).toEqual([]);
  });
});

describe("칼럼 소속 줄", () => {
  const row = (item: string, state: string, text: string | null = null) => ({ article_id: 1, item, state, interest_text: text });
  it("두 항목이 모두 있을 때만 줄을 만든다 - 없음은 고정 문장", () => {
    expect(financeInterestLine([row("financial_company", "declared", "시험 소속"), row("trust_company", "none_confirmed")])).toBe(`소속 금융사: 시험 소속 · 소속 신탁사: ${FINANCE_NO_INTEREST}`);
    expect(financeInterestLine([row("financial_company", "declared", "시험")])).toBeNull();
    expect(financeInterestLine([row("financial_company", "declared", " "), row("trust_company", "declared", "x")])).toBeNull();
    expect(financeInterestLine([row("financial_company", "maybe"), row("trust_company", "declared", "x")])).toBeNull();
  });
});

describe("화면 고정 문구", () => {
  it("숫자·비율·수익·권유 낱말이 없다 (DF-04 · DF-05)", () => {
    const all = JSON.stringify(FINANCE_COPY);
    expect(all).not.toMatch(/[0-9%]/);
    expect(all).not.toMatch(/수익률|순위|추천|가입하|매수하/);
  });
});
