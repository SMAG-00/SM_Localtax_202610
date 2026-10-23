// 개발금융 공개 화면의 순수 계산 (W5 — PRD-01B DF-01 · DF-03 · DF-04 · DF-09, docs/dev/W5_설계.md 1장 4단계) — 시험 finance-logic.test.ts.
//  · 구조도 배치 — 노드·관계 데이터를 층(들어오는 관계가 없는 노드가 0층)으로 나눠 SVG 좌표를 만든다. 글자는 SVG 안 text이고 그림 파일은 없다
//  · 같은 내용의 표 — 관계 목록에서 만든다(구조도와 표가 같은 데이터)
//  · 규제 항목 묶음 — 같은 항목의 단계 이력 중 최신 행 + 시행 여부(DB 뷰가 한국 시간 날짜로 계산)
//  · 통계 묶음 — 지표마다 최신 값 + 이전 값 이력(덮어쓰기 없는 시계열)
//  · 칼럼 소속 줄 — 소속 금융사·신탁사 두 항목이 모두 있을 때만

export const STRUCTURE_TYPE_NAMES: Readonly<Record<string, string>> = { trust: "신탁 유형", completion_guarantee: "책임준공", pf_stage: "PF 단계", reit: "리츠" };

export interface DiagramData {
  alt: string;
  nodes: { key: string; label: string }[];
  edges: { from: string; to: string; label: string }[];
}

export function isDiagram(v: unknown): v is DiagramData {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  return typeof d.alt === "string" && Array.isArray(d.nodes) && Array.isArray(d.edges);
}

export const SVG = { nodeW: 150, nodeH: 44, gapX: 70, gapY: 28, pad: 16 } as const;

export interface LaidNode {
  key: string;
  label: string;
  x: number;
  y: number;
  layer: number;
}
export interface Layout {
  width: number;
  height: number;
  nodes: LaidNode[];
  edges: { from: string; to: string; label: string; x1: number; y1: number; x2: number; y2: number }[];
}

/** 층 나누기 — 들어오는 관계가 없는 노드 = 0층, 나머지는 (앞선 노드 층 + 1)의 최댓값. 순환이 있어도 노드 수만큼만 돌아 끝난다 */
export function layoutDiagram(d: DiagramData): Layout {
  const layerOf = new Map<string, number>();
  for (const n of d.nodes) layerOf.set(n.key, 0);
  for (let pass = 0; pass < d.nodes.length; pass++) {
    let changed = false;
    for (const e of d.edges) {
      const next = (layerOf.get(e.from) ?? 0) + 1;
      if (next > (layerOf.get(e.to) ?? 0) && next < d.nodes.length) {
        layerOf.set(e.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const rows = new Map<number, number>();
  const nodes: LaidNode[] = d.nodes.map((n) => {
    const layer = layerOf.get(n.key) ?? 0;
    const row = rows.get(layer) ?? 0;
    rows.set(layer, row + 1);
    return { key: n.key, label: n.label, layer, x: SVG.pad + layer * (SVG.nodeW + SVG.gapX), y: SVG.pad + row * (SVG.nodeH + SVG.gapY) };
  });
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const layers = Math.max(0, ...nodes.map((n) => n.layer)) + 1;
  const maxRows = Math.max(1, ...rows.values());
  const edges = d.edges.flatMap((e) => {
    const a = byKey.get(e.from);
    const b = byKey.get(e.to);
    if (!a || !b) return [];
    const forward = b.x > a.x;
    return [{ ...e, x1: forward ? a.x + SVG.nodeW : a.x + SVG.nodeW / 2, y1: a.y + SVG.nodeH / 2, x2: forward ? b.x : b.x + SVG.nodeW / 2, y2: forward ? b.y + SVG.nodeH / 2 : b.y + (b.y >= a.y ? 0 : SVG.nodeH) }];
  });
  return {
    width: SVG.pad * 2 + layers * SVG.nodeW + (layers - 1) * SVG.gapX,
    height: SVG.pad * 2 + maxRows * SVG.nodeH + (maxRows - 1) * SVG.gapY,
    nodes,
    edges,
  };
}

/** 구조도와 같은 내용의 표 — 관계 한 줄 = 표 한 행 */
export function relationRows(d: DiagramData): { from: string; to: string; label: string }[] {
  const name = new Map(d.nodes.map((n) => [n.key, n.label]));
  return d.edges.map((e) => ({ from: name.get(e.from) ?? e.from, to: name.get(e.to) ?? e.to, label: e.label }));
}

export interface IndicatorRow {
  id: number | string;
  indicator_key: string;
  label: string;
  definition: string;
  value: number | string;
  unit: string;
  as_of: string;
  collected_on: string;
  provider: string;
  source_url: string;
  is_latest: boolean;
}
export interface IndicatorGroup {
  key: string;
  label: string;
  definition: string;
  latest: IndicatorRow;
  history: IndicatorRow[];
}

/** 원자료 칸이 하나라도 비면 그 행은 그리지 않는다 (DF-04 — 빈 칸 행 렌더 0) */
export function indicatorComplete(r: Partial<IndicatorRow>): r is IndicatorRow {
  return [r.indicator_key, r.label, r.definition, r.unit, r.as_of, r.collected_on, r.provider, r.source_url].every((v) => typeof v === "string" && v.trim() !== "") && r.value !== null && r.value !== undefined && r.value !== "";
}

export function groupIndicators(rows: readonly Partial<IndicatorRow>[]): IndicatorGroup[] {
  const by = new Map<string, IndicatorRow[]>();
  for (const r of rows) if (indicatorComplete(r)) by.set(r.indicator_key, [...(by.get(r.indicator_key) ?? []), r]);
  const out: IndicatorGroup[] = [];
  for (const [key, list] of by) {
    const sorted = [...list].sort((a, b) => (a.as_of === b.as_of ? Number(b.id) - Number(a.id) : a.as_of < b.as_of ? 1 : -1));
    const latest = sorted[0]!;
    out.push({ key, label: latest.label, definition: latest.definition, latest, history: sorted.slice(1) });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, "ko"));
}

export interface RegulationRow {
  id: number | string;
  reg_key: string;
  title: string;
  stage: string;
  effective_on: string;
  provider: string;
  source_url: string;
  is_latest: boolean;
  in_force: boolean;
}
export interface RegulationGroup {
  key: string;
  latest: RegulationRow;
  history: RegulationRow[];
}
export const REGULATION_STATUS = { inForce: "시행", planned: "시행 예정" } as const;

export function groupRegulations(rows: readonly Partial<RegulationRow>[]): RegulationGroup[] {
  const ok = rows.filter((r): r is RegulationRow => [r.reg_key, r.title, r.stage, r.effective_on, r.provider, r.source_url].every((v) => typeof v === "string" && v.trim() !== ""));
  const by = new Map<string, RegulationRow[]>();
  for (const r of ok) by.set(r.reg_key, [...(by.get(r.reg_key) ?? []), r]);
  const out: RegulationGroup[] = [];
  for (const [key, list] of by) {
    const sorted = [...list].sort((a, b) => Number(b.id) - Number(a.id));
    out.push({ key, latest: sorted[0]!, history: sorted.slice(1) });
  }
  return out.sort((a, b) => (a.latest.effective_on < b.latest.effective_on ? -1 : a.latest.effective_on > b.latest.effective_on ? 1 : a.key.localeCompare(b.key)));
}

export interface FinanceInterestRow {
  article_id: number | string;
  item: string;
  state: string;
  interest_text: string | null;
}
const FINANCE_ITEMS = [
  { item: "financial_company", label: "소속 금융사" },
  { item: "trust_company", label: "소속 신탁사" },
] as const;
export const FINANCE_NO_INTEREST = "필자가 밝힌 관계 없음";

/** 개발금융 칼럼 소속 줄 — 두 항목이 모두 있을 때만, 하나라도 비면 null (부분 줄 0) */
export function financeInterestLine(rows: readonly FinanceInterestRow[]): string | null {
  const parts: string[] = [];
  for (const { item, label } of FINANCE_ITEMS) {
    const r = rows.find((x) => x.item === item);
    if (!r) return null;
    if (r.state === "declared") {
      const t = (r.interest_text ?? "").trim();
      if (t === "") return null;
      parts.push(`${label}: ${t}`);
    } else if (r.state === "none_confirmed") parts.push(`${label}: ${FINANCE_NO_INTEREST}`);
    else return null;
  }
  return parts.join(" · ");
}

/** 화면 고정 글자 — 숫자·비율·수익 낱말 0 (시험이 본다) */
export const FINANCE_COPY = {
  structuresTitle: "구조 해설",
  structuresLead: "구조도와 같은 내용의 표를 함께 싣습니다. 세무 감수와 법률 확인을 마친 해설만 공개합니다.",
  relationCaption: "구조도와 같은 내용의 표",
  relationHead: ["주체", "관계", "상대"],
  lensTitle: "지방세로 읽기",
  trackerTitle: "규제·통계 트래커",
  trackerLead: "원자료와 기준일을 함께 보입니다. 새 값은 이전 값을 지우지 않고 쌓입니다.",
  regulationsTitle: "규제 항목",
  indicatorsTitle: "통계 지표",
  historyTitle: "이전 값",
  caseTitle: "사례 구조",
  caseLead: "공개된 자료의 범위에서만 구조를 서술합니다.",
  notice: "이 화면은 정보 제공용이며 특정 상품의 가입이나 매수를 권하지 않습니다.",
} as const;
