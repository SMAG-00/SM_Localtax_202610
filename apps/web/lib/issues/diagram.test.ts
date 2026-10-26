import { describe, expect, it } from "vitest";
import { buildDiagram, RELATIONS, type DiagramEdge, type DiagramNode } from "./diagram";

const node = (id: string, group = "시험용 법 가", kind: DiagramNode["kind"] = "law_article"): DiagramNode => ({ id, kind, group, title: `시험용 ${id}`, sub: "시험용 부제" });

describe("쟁점 지도 그림 배치 - 그림과 표가 같은 목록에서 나온다", () => {
  const nodes = [node("n1"), node("n2", "시험용 법 나"), node("n3", "시험용 법 다", "case"), node("n4", "시험용 법 가")];
  const edges: DiagramEdge[] = [
    { from: "n1", to: "n2", relation: "delegation", note: null },
    { from: "n2", to: "n4", relation: "requirement", note: "시험용 설명" },
    { from: "n1", to: "n3", relation: "precedent", note: null },
  ];

  it("상자 수 = 노드 표 행 수, 연결선 수 = 연결선 표 행 수", () => {
    const d = buildDiagram("시험용 쟁점", nodes, edges);
    expect(d.boxes).toHaveLength(4);
    expect(d.nodeRows).toHaveLength(4);
    expect(d.lines).toHaveLength(3);
    expect(d.edgeRows).toHaveLength(3);
    expect(d.edgeRows.map((r) => r.no)).toEqual([1, 2, 3]);
  });

  it("끝점이 지도에 없는 연결선과 자기 연결은 그림과 표에서 함께 빠진다", () => {
    const d = buildDiagram("시험용 쟁점", nodes, [...edges, { from: "n1", to: "n9", relation: "mutatis", note: null }, { from: "n2", to: "n2", relation: "mutatis", note: null }]);
    expect(d.lines).toHaveLength(3);
    expect(d.edgeRows).toHaveLength(3);
  });

  it("관계 라벨 4종이 한글 라벨로 나온다", () => {
    expect(RELATIONS).toEqual(["delegation", "mutatis", "requirement", "precedent"]);
    const d = buildDiagram("시험용 쟁점", nodes, edges);
    expect(d.lines.map((l) => l.label)).toEqual(["위임", "요건", "판례"]);
  });

  it("같은 묶음(법령) 상자는 둘레에서 이웃하고, 상자는 그림 안에 있고 가운데 상자와 겹치지 않는다", () => {
    const d = buildDiagram("시험용 쟁점", nodes, edges);
    const order = d.boxes.map((b) => b.id);
    expect(Math.abs(order.indexOf("n1") - order.indexOf("n4"))).toBe(1);
    for (const b of d.boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(d.width);
      expect(b.y + b.h).toBeLessThanOrEqual(d.height);
      const overlap = b.x < d.center.x + d.center.w && b.x + b.w > d.center.x && b.y < d.center.y + d.center.h && b.y + b.h > d.center.y;
      expect(overlap).toBe(false);
    }
  });

  it("연결선은 두 상자 테두리 위에서 시작하고 끝난다 (중심이 아니다)", () => {
    const d = buildDiagram("시험용 쟁점", nodes, edges);
    const a = d.boxes.find((b) => b.id === "n1")!;
    const l = d.lines[0];
    const onEdge = (px: number, py: number, b: typeof a) => {
      const inside = px >= b.x - 0.2 && px <= b.x + b.w + 0.2 && py >= b.y - 0.2 && py <= b.y + b.h + 0.2;
      const border = Math.abs(px - b.x) < 0.2 || Math.abs(px - (b.x + b.w)) < 0.2 || Math.abs(py - b.y) < 0.2 || Math.abs(py - (b.y + b.h)) < 0.2;
      return inside && border;
    };
    expect(onEdge(l.x1, l.y1, a)).toBe(true);
    expect(onEdge(l.x2, l.y2, d.boxes.find((b) => b.id === "n2")!)).toBe(true);
  });

  it("노드가 하나도 없어도 깨지지 않는다", () => {
    const d = buildDiagram("시험용 쟁점", [], []);
    expect(d.boxes).toEqual([]);
    expect(d.lines).toEqual([]);
    expect(d.center.title).toBe("시험용 쟁점");
  });
});
