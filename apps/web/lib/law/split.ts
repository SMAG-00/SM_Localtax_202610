// 분할 화면 (LAW-07) - 순수 모듈. 패널 구성은 주소에만 담는다. 종류·번호 모양을 목록 검사로 걸러 낸다.
export const SPLIT_KINDS = ["law", "case", "node", "note"] as const;
export type SplitKind = (typeof SPLIT_KINDS)[number];
export const SPLIT_KIND_LABELS: Readonly<Record<SplitKind, string>> = { law: "조문", case: "결정례", node: "지식창고", note: "내 메모" };
export const MAX_PANELS = 3;
export const MIN_WIDTH_PCT = 20;
export const WIDTH_STEP = 5;

export interface PanelSpec {
  kind: SplitKind;
  /** law = 법령 번호, 나머지 = 해당 번호 */
  id: number;
  /** law = 조 구간 (11 또는 11-2) */
  article?: string;
}

const POS = /^[1-9][0-9]{0,14}$/;
const ARTICLE = /^[1-9][0-9]{0,3}(-[1-9][0-9]{0,2})?$/;

export function parseSpec(token: string): PanelSpec | null {
  const parts = token.split(":");
  const kind = parts[0] as SplitKind;
  if (!(SPLIT_KINDS as readonly string[]).includes(kind)) return null;
  if (kind === "law") return parts.length === 3 && POS.test(parts[1]) && ARTICLE.test(parts[2]) ? { kind, id: Number(parts[1]), article: parts[2] } : null;
  return parts.length === 2 && POS.test(parts[1]) ? { kind, id: Number(parts[1]) } : null;
}
export const formatSpec = (s: PanelSpec): string => (s.kind === "law" ? `law:${s.id}:${s.article}` : `${s.kind}:${s.id}`);

/** p=law:1:11,case:55 → 패널 목록. 틀린 조각은 버리고 최대 3개까지 */
export function parsePanels(p: string | null | undefined): PanelSpec[] {
  if (!p) return [];
  const out: PanelSpec[] = [];
  for (const t of p.split(",")) {
    const s = parseSpec(t);
    if (s) out.push(s);
    if (out.length === MAX_PANELS) break;
  }
  return out;
}

/** 너비 w=40-30-30 → 패널 수와 같고 합 100, 각 20 이상일 때만 쓰고 아니면 균등 */
export function parseWidths(w: string | null | undefined, n: number): number[] {
  if (n <= 0) return [];
  const even = (): number[] => {
    const base = Math.floor(100 / n);
    return Array.from({ length: n }, (_, i) => (i === n - 1 ? 100 - base * (n - 1) : base));
  };
  if (!w) return even();
  const parts = w.split("-");
  if (parts.length !== n || !parts.every((x) => /^[0-9]{1,3}$/.test(x))) return even();
  const nums = parts.map(Number);
  return nums.reduce((a, b) => a + b, 0) === 100 && nums.every((x) => x >= MIN_WIDTH_PCT) ? nums : even();
}

export const parseActive = (a: string | null | undefined, n: number): number => {
  const v = a !== null && a !== undefined && /^[0-9]{1,2}$/.test(a) ? Number(a) : 0;
  return n === 0 ? 0 : Math.min(v, n - 1);
};

export function buildSplitHref(panels: readonly PanelSpec[], active: number, widths: readonly number[]): string {
  if (panels.length === 0) return "/workspace/split";
  const q = new URLSearchParams();
  q.set("p", panels.map(formatSpec).join(","));
  if (active > 0) q.set("a", String(active));
  if (widths.length === panels.length && panels.length > 1) q.set("w", widths.join("-"));
  return `/workspace/split?${q.toString().replace(/%3A/g, ":").replace(/%2C/g, ",")}`;
}

/** 새 패널 열기 - 이미 같은 패널이 있으면 그 패널로 이동, 가득 차면 마지막 패널을 바꾼다 */
export function openPanel(panels: readonly PanelSpec[], spec: PanelSpec): { panels: PanelSpec[]; active: number } {
  const key = formatSpec(spec);
  const at = panels.findIndex((p) => formatSpec(p) === key);
  if (at >= 0) return { panels: [...panels], active: at };
  if (panels.length < MAX_PANELS) return { panels: [...panels, spec], active: panels.length };
  return { panels: [...panels.slice(0, MAX_PANELS - 1), spec], active: MAX_PANELS - 1 };
}

export const closePanel = (panels: readonly PanelSpec[], index: number): PanelSpec[] => panels.filter((_, i) => i !== index);

// ── 레이아웃 경계 (1280 이상 3분할 · 1024~1279 2분할 · 1024 미만 탭) ──
export type SplitLayout = "three" | "two" | "tabs";
export const layoutFor = (width: number): SplitLayout => (width >= 1280 ? "three" : width >= 1024 ? "two" : "tabs");
export const columnsOf = (layout: SplitLayout): number => (layout === "three" ? 3 : layout === "two" ? 2 : 1);

/** 한 번에 보이는 패널의 위치 목록 - 활성 패널이 항상 보이도록 창을 옮긴다 */
export function visibleIndexes(layout: SplitLayout, count: number, active: number): number[] {
  const cols = columnsOf(layout);
  if (count <= cols) return Array.from({ length: count }, (_, i) => i);
  const start = Math.max(0, Math.min(active, count - cols));
  const first = active < start ? active : active >= start + cols ? active - cols + 1 : start;
  return Array.from({ length: cols }, (_, i) => first + i);
}

/** 너비 조절 - 이웃과 주고받고, 어느 쪽도 20% 아래로 내려가지 않는다. 한계에 닿으면 원래 값을 돌려준다 */
export function resizeWidths(widths: readonly number[], index: number, delta: number): number[] {
  const j = index + 1 < widths.length ? index + 1 : index - 1;
  if (j < 0 || index < 0 || index >= widths.length) return [...widths];
  const a = widths[index] + delta;
  const b = widths[j] - delta;
  if (a < MIN_WIDTH_PCT || b < MIN_WIDTH_PCT) return [...widths];
  const out = [...widths];
  out[index] = a;
  out[j] = b;
  return out;
}

export type KeyAction = { type: "focus"; delta: -1 | 1 } | { type: "resize"; delta: number } | { type: "close" } | null;
/** Alt+←/→ 이동 · Alt+Shift+←/→ 너비 · Alt+W 닫기 */
export function keyAction(e: { key: string; altKey: boolean; shiftKey: boolean; ctrlKey?: boolean; metaKey?: boolean }): KeyAction {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  if (e.key === "w" || e.key === "W") return e.shiftKey ? null : { type: "close" };
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return null;
  const dir = e.key === "ArrowLeft" ? -1 : 1;
  return e.shiftKey ? { type: "resize", delta: dir * WIDTH_STEP } : { type: "focus", delta: dir };
}
