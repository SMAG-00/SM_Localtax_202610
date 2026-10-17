import { useId } from "react";

/** 구조도의 상자 하나 — 격자 칸(col·row)에 놓는다 */
export type StructureNode = {
  id: string;
  /** 역할 이름 — 위탁자·수탁자·수익자, 시행사·대주단·시공사·신탁사 등 */
  role: string;
  /** 한 줄 설명 (선택) */
  note?: string;
  col: number;
  row: number;
  /** 지방세 납세의무자일 때 그 세목 — 예: 재산세 (`지방세` 배지로 표시) */
  localTaxpayer?: string;
};

/** 화살표 하나 — 돈 또는 권리의 흐름 */
export type StructureFlow = { from: string; to: string; kind: "money" | "right"; label: string };

export type TrustStructureDiagramProps = {
  title: string;
  nodes: StructureNode[];
  flows: StructureFlow[];
};

const KIND_LABEL: Record<StructureFlow["kind"], string> = { money: "돈", right: "권리" };

const BOX_W = 240;
const BOX_H = 112;
const GAP_X = 200;
const GAP_Y = 120;
const PAD = 24;
const LANE = 24;
const HEAD = 10;

type P = { x: number; y: number };
const r1 = (n: number) => Math.round(n * 10) / 10;

function boxOf(n: StructureNode): P {
  return { x: PAD + n.col * (BOX_W + GAP_X), y: PAD + n.row * (BOX_H + GAP_Y) };
}
function centerOf(n: StructureNode): P {
  const b = boxOf(n);
  return { x: b.x + BOX_W / 2, y: b.y + BOX_H / 2 };
}
/** 상자 중심에서 방향 d로 테두리까지의 거리 */
function toEdge(d: P): number {
  const tx = d.x === 0 ? Infinity : BOX_W / 2 / Math.abs(d.x);
  const ty = d.y === 0 ? Infinity : BOX_H / 2 / Math.abs(d.y);
  return Math.min(tx, ty);
}

type Drawn = StructureFlow & { a: StructureNode; b: StructureNode; start: P; end: P; head: string; at: P; anchor: "start" | "middle" | "end" };

/** 화살표 좌표 — 같은 두 상자 사이의 흐름은 나란한 차선으로 떼어 그린다 */
function layoutFlows(nodes: StructureNode[], flows: StructureFlow[]): Drawn[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const valid = flows.filter((f) => byId.has(f.from) && byId.has(f.to) && f.from !== f.to && f.label.trim());
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const pairKey = (f: StructureFlow) => [f.from, f.to].sort((x, y) => order.get(x)! - order.get(y)!).join("|");
  const groups = new Map<string, StructureFlow[]>();
  for (const f of valid) groups.set(pairKey(f), [...(groups.get(pairKey(f)) ?? []), f]);

  return valid.map((f) => {
    const a = byId.get(f.from)!;
    const b = byId.get(f.to)!;
    const group = groups.get(pairKey(f))!;
    const lane = (group.indexOf(f) - (group.length - 1) / 2) * LANE;
    // 차선 방향은 두 상자의 고정 순서(앞 상자 → 뒤 상자)로 정해 반대 방향 흐름끼리 겹치지 않게 한다
    const [first, second] = order.get(a.id)! < order.get(b.id)! ? [a, b] : [b, a];
    const c1 = centerOf(first);
    const c2 = centerOf(second);
    const len = Math.hypot(c2.x - c1.x, c2.y - c1.y) || 1;
    const canon = { x: (c2.x - c1.x) / len, y: (c2.y - c1.y) / len };
    const perp = { x: -canon.y, y: canon.x };
    const ca = centerOf(a);
    const cb = centerOf(b);
    const d = { x: (cb.x - ca.x) / len, y: (cb.y - ca.y) / len };
    const edge = toEdge(d) + 6;
    const start = { x: ca.x + perp.x * lane + d.x * edge, y: ca.y + perp.y * lane + d.y * edge };
    const end = { x: cb.x + perp.x * lane - d.x * edge, y: cb.y + perp.y * lane - d.y * edge };
    const base = { x: end.x - d.x * HEAD, y: end.y - d.y * HEAD };
    const head = [end, { x: base.x + perp.x * 5, y: base.y + perp.y * 5 }, { x: base.x - perp.x * 5, y: base.y - perp.y * 5 }].map((p) => `${r1(p.x)},${r1(p.y)}`).join(" ");
    const side = lane === 0 ? -1 : Math.sign(lane);
    const off = lane + side * 16;
    const mid = { x: (start.x + end.x) / 2 + perp.x * off, y: (start.y + end.y) / 2 + perp.y * off };
    const vertical = Math.abs(canon.y) > Math.abs(canon.x);
    const anchor = vertical ? (perp.x * side > 0 ? "start" : "end") : "middle";
    return { ...f, a, b, start, end, head, at: mid, anchor };
  });
}

/**
 * 신탁 구조도 — 인라인 SVG 상자와 화살표(신탁·PF·리츠 같은 문법). 상자 navy-100 테두리·역할 이름 19px 900,
 * 화살표 navy-200 + 돈·권리 라벨, 지방세 납세의무자는 `지방세` 배지. 아래에 같은 내용의 표 (DF-01·8.9)
 */
export function TrustStructureDiagram({ title, nodes, flows }: TrustStructureDiagramProps) {
  const headingId = useId();
  const placed = nodes.filter((n) => Number.isInteger(n.col) && Number.isInteger(n.row) && n.col >= 0 && n.row >= 0 && n.role.trim());
  const drawn = layoutFlows(placed, flows);
  const cols = Math.max(0, ...placed.map((n) => n.col)) + 1;
  const rows = Math.max(0, ...placed.map((n) => n.row)) + 1;
  const width = PAD * 2 + cols * BOX_W + (cols - 1) * GAP_X;
  const height = PAD * 2 + rows * BOX_H + (rows - 1) * GAP_Y;
  const desc = drawn.map((f) => `${f.a.role} → ${f.b.role} (${KIND_LABEL[f.kind]}): ${f.label}`).join(" / ");

  return (
    <section data-ui="trust-structure-diagram" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-[22px] font-black tracking-tight text-navy-900">
        {title}
      </h2>
      <div className="mt-4 rounded-2xl border border-navy-100 bg-white p-4">
        <svg role="img" aria-label={title} viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
          <title>{title}</title>
          {desc && <desc>{desc}</desc>}
          {drawn.map((f, i) => (
            <g key={i} data-flow={`${f.from}-${f.to}`}>
              <line
                x1={r1(f.start.x)}
                y1={r1(f.start.y)}
                x2={r1(f.end.x)}
                y2={r1(f.end.y)}
                className="stroke-navy-200"
                strokeWidth={2}
                strokeDasharray={f.kind === "right" ? "6 4" : undefined}
              />
              <polygon points={f.head} className="fill-navy-200" />
              <text
                data-flow-label
                x={r1(f.at.x)}
                y={r1(f.at.y)}
                textAnchor={f.anchor}
                dominantBaseline="middle"
                className="fill-navy-700 stroke-white text-[13px] font-bold"
                strokeWidth={4}
                strokeLinejoin="round"
                style={{ paintOrder: "stroke" }}
              >
                {`${KIND_LABEL[f.kind]} · ${f.label}`}
              </text>
            </g>
          ))}
          {placed.map((n) => {
            const b = boxOf(n);
            return (
              <g key={n.id} data-node={n.id}>
                <rect x={b.x} y={b.y} width={BOX_W} height={BOX_H} rx={16} className="fill-white stroke-navy-100" strokeWidth={1.5} />
                <text data-role x={b.x + 16} y={b.y + 36} className="fill-navy-900 text-[19px] font-black">
                  {n.role}
                </text>
                {n.note && (
                  <text x={b.x + 16} y={b.y + 62} className="fill-navy-600 text-[13px]">
                    {n.note}
                  </text>
                )}
                {n.localTaxpayer && (
                  <g data-taxpayer>
                    <rect x={b.x + 16} y={b.y + BOX_H - 34} width={52} height={22} rx={11} className="fill-navy-900" />
                    <text x={b.x + 42} y={b.y + BOX_H - 23} textAnchor="middle" dominantBaseline="middle" className="fill-white text-[12px] font-bold">
                      지방세
                    </text>
                    <text x={b.x + 76} y={b.y + BOX_H - 23} dominantBaseline="middle" className="fill-navy-700 text-[12px] font-bold">
                      {`${n.localTaxpayer} 납세의무자`}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <table className="w-full table-fixed border-collapse text-left text-[14px]">
          <caption className="mb-2 text-left text-[15px] font-bold text-navy-900">역할 표 — 위 구조도와 같은 내용</caption>
          <thead>
            <tr className="border-b border-navy-200">
              {["역할", "설명", "지방세 납세의무자"].map((h) => (
                <th key={h} scope="col" className="py-2 pr-2 text-[13px] font-bold text-navy-600">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {placed.map((n) => (
              <tr key={n.id} className="border-b border-navy-100 align-top">
                <td className="py-2 pr-2 font-bold break-words text-navy-900">{n.role}</td>
                <td className="py-2 pr-2 break-words text-navy-800">{n.note ?? "—"}</td>
                <td className="py-2 break-words text-navy-800">
                  {n.localTaxpayer ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center rounded-full bg-navy-900 px-2 py-0.5 text-[12px] font-bold text-white">지방세</span>
                      <span>{`${n.localTaxpayer} 납세의무자`}</span>
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="w-full table-fixed border-collapse text-left text-[14px]">
          <caption className="mb-2 text-left text-[15px] font-bold text-navy-900">흐름 표 — 위 구조도와 같은 내용</caption>
          <thead>
            <tr className="border-b border-navy-200">
              {["출발", "도착", "종류", "내용"].map((h) => (
                <th key={h} scope="col" className="py-2 pr-2 text-[13px] font-bold text-navy-600">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {drawn.map((f, i) => (
              <tr key={i} className="border-b border-navy-100 align-top">
                <td className="py-2 pr-2 break-words text-navy-900">{f.a.role}</td>
                <td className="py-2 pr-2 break-words text-navy-900">{f.b.role}</td>
                <td className="py-2 pr-2 text-navy-800">{KIND_LABEL[f.kind]}</td>
                <td className="py-2 break-words text-navy-800">{f.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
