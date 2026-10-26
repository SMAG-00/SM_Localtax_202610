// 쟁점 연결 지도 그림 배치 (W11-d d6 - PRD-03 LINK-01 · PRD-00 8.6 쟁점 연결 지도, docs/dev/W11-d_설계.md 6장).
// 순수 함수 - 같은 입력이면 같은 좌표. 그림의 상자·연결선과 같은 내용의 표 행이 같은 목록에서 나오므로 수가 어긋날 수 없다.
// 가운데 쟁점 상자는 노드가 아니다(상자 수에 세지 않는다). 연결선은 표의 연결선 행과 1:1이고, 가운데에서 뻗는 보조선은 그리지 않는다.
export const RELATION_LABEL = { delegation: "위임", mutatis: "준용", requirement: "요건", precedent: "판례" } as const;
export type Relation = keyof typeof RELATION_LABEL;
export const RELATIONS = Object.keys(RELATION_LABEL) as Relation[];

export interface DiagramNode {
  id: string;
  kind: "law_article" | "case";
  /** 둘레에서 가까이 모아 놓는 묶음 - 법령 이름 또는 결정례 종류 */
  group: string;
  title: string;
  sub: string;
}
export interface DiagramEdge {
  from: string;
  to: string;
  relation: Relation;
  note: string | null;
}
export interface Box extends DiagramNode {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Line {
  from: string;
  to: string;
  relation: Relation;
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  mx: number;
  my: number;
}
export interface Diagram {
  width: number;
  height: number;
  center: { x: number; y: number; w: number; h: number; title: string };
  boxes: Box[];
  lines: Line[];
  /** 표 행 - 그림과 같은 목록에서 만든다 */
  nodeRows: Array<DiagramNode & { no: number }>;
  edgeRows: Array<DiagramEdge & { no: number; fromTitle: string; toTitle: string; label: string }>;
}

const W = 960;
const H = 640;
const BOX_W = 200;
const BOX_H = 64;
const CENTER_W = 220;
const CENTER_H = 84;
const RX = 330;
const RY = 215;

/** 두 상자 중심을 잇는 선이 상자 테두리와 만나는 점 */
function clip(cx: number, cy: number, tx: number, ty: number, w: number, h: number): { x: number; y: number } {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const s = Math.min(dx === 0 ? Infinity : w / 2 / Math.abs(dx), dy === 0 ? Infinity : h / 2 / Math.abs(dy));
  return { x: cx + dx * s, y: cy + dy * s };
}
const r1 = (n: number) => Math.round(n * 10) / 10;

export function buildDiagram(issueTitle: string, nodes: DiagramNode[], edges: DiagramEdge[]): Diagram {
  const ids = new Set(nodes.map((n) => n.id));
  const usable = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const sorted = nodes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => (a.n.group === b.n.group ? a.i - b.i : a.n.group < b.n.group ? -1 : 1))
    .map((x) => x.n);
  const cx = W / 2;
  const cy = H / 2;
  const boxes: Box[] = sorted.map((n, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(sorted.length, 1);
    return { ...n, x: r1(cx + RX * Math.cos(angle) - BOX_W / 2), y: r1(cy + RY * Math.sin(angle) - BOX_H / 2), w: BOX_W, h: BOX_H };
  });
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const lines: Line[] = usable.map((e) => {
    const a = byId.get(e.from) as Box;
    const b = byId.get(e.to) as Box;
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const p = clip(ac.x, ac.y, bc.x, bc.y, a.w, a.h);
    const q = clip(bc.x, bc.y, ac.x, ac.y, b.w, b.h);
    return { from: e.from, to: e.to, relation: e.relation, label: RELATION_LABEL[e.relation], x1: r1(p.x), y1: r1(p.y), x2: r1(q.x), y2: r1(q.y), mx: r1((p.x + q.x) / 2), my: r1((p.y + q.y) / 2) };
  });
  const title = (id: string) => nodes.find((n) => n.id === id)?.title ?? id;
  return {
    width: W,
    height: H,
    center: { x: cx - CENTER_W / 2, y: cy - CENTER_H / 2, w: CENTER_W, h: CENTER_H, title: issueTitle },
    boxes,
    lines,
    nodeRows: nodes.map((n, i) => ({ ...n, no: i + 1 })),
    edgeRows: usable.map((e, i) => ({ ...e, no: i + 1, fromTitle: title(e.from), toTitle: title(e.to), label: RELATION_LABEL[e.relation] })),
  };
}
