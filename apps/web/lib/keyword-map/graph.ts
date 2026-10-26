// 키워드 맵 순수 규칙 (CASE-06, W12-g) - 주소 상태 해석·노드 토글 주소·SVG 배치·표 행·키보드 이동. 서버/브라우저 어디서나 같은 결과.
// 그림(원·선)과 표(노드 행·연결선 행)는 buildKeywordMap의 한 결과에서 나오므로 어긋날 수 없다. 이 모듈에 쟁점 태그 이름·세무 내용은 없다.

export interface KmNode {
  tag_key: string;
  label: string;
  n: number;
}
export interface KmEdge {
  tag_a: string;
  tag_b: string;
  n: number;
}
export const TAG_KEY = /^[a-z][a-z0-9_]{1,39}$/;
export const MAX_SELECTED = 5;

const first = (v: string | string[] | undefined): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : Array.isArray(v) && v[0] ? v[0].trim() : null);

export interface KmState {
  tax: string | null;
  tags: string[];
  page: number;
}
/** URL 쿼리 -> 상태. 세목은 탭에 있는 값만, 태그는 노드에 있는 키만(중복 제거, 최대 5개), 모르는 값은 버린다 */
export function parseKeywordState(sp: Record<string, string | string[] | undefined>, taxes: readonly string[], nodeKeys: readonly string[]): KmState {
  const t = first(sp.tax);
  const tax = t && taxes.includes(t) ? t : (taxes[0] ?? null);
  const raw = Array.isArray(sp.tag) ? sp.tag : typeof sp.tag === "string" ? [sp.tag] : [];
  const tags: string[] = [];
  for (const r of raw) {
    const k = r.trim();
    if (TAG_KEY.test(k) && nodeKeys.includes(k) && !tags.includes(k) && tags.length < MAX_SELECTED) tags.push(k);
  }
  const p = Number(first(sp.page) ?? 1);
  return { tax, tags, page: Number.isInteger(p) && p >= 1 && p <= 500 ? p : 1 };
}

/** 상태 -> 주소. 세목이 첫 탭이어도 항상 적어 공유 주소가 흔들리지 않게 한다 */
export function keywordHref(tax: string | null, tags: readonly string[], page = 1): string {
  const q = new URLSearchParams();
  if (tax) q.set("tax", tax);
  for (const t of tags) q.append("tag", t);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return `/cases/keywords${s ? `?${s}` : ""}`;
}
/** 노드를 누르면: 이미 골랐으면 빼고, 아니면 더한다 (상한을 넘으면 가장 오래된 것을 뺀다) */
export function toggleTag(tags: readonly string[], key: string): string[] {
  if (tags.includes(key)) return tags.filter((t) => t !== key);
  const next = [...tags, key];
  return next.length > MAX_SELECTED ? next.slice(next.length - MAX_SELECTED) : next;
}

export interface KmCircle extends KmNode {
  no: number;
  cx: number;
  cy: number;
  r: number;
  selected: boolean;
  href: string;
}
export interface KmLine {
  a: string;
  b: string;
  n: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface KmDiagram {
  width: number;
  height: number;
  circles: KmCircle[];
  lines: KmLine[];
  nodeRows: Array<KmNode & { no: number; selected: boolean }>;
  edgeRows: Array<KmEdge & { no: number; aLabel: string; bLabel: string }>;
}

const W = 720;
const H = 520;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function buildKeywordMap(tax: string | null, nodes: readonly KmNode[], edges: readonly KmEdge[], selected: readonly string[]): KmDiagram {
  const sorted = [...nodes].sort((x, y) => (y.n - x.n) || (x.tag_key < y.tag_key ? -1 : 1));
  const maxN = Math.max(1, ...sorted.map((n) => n.n));
  const keys = new Set(sorted.map((n) => n.tag_key));
  const usable = edges.filter((e) => keys.has(e.tag_a) && keys.has(e.tag_b) && e.tag_a !== e.tag_b);
  const circles: KmCircle[] = sorted.map((n, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(sorted.length, 1);
    return {
      ...n,
      no: i + 1,
      cx: r1(W / 2 + 270 * Math.cos(angle)),
      cy: r1(H / 2 + 190 * Math.sin(angle)),
      r: r1(14 + 22 * Math.sqrt(n.n / maxN)),
      selected: selected.includes(n.tag_key),
      href: keywordHref(tax, toggleTag(selected, n.tag_key)),
    };
  });
  const at = new Map(circles.map((c) => [c.tag_key, c]));
  const lines: KmLine[] = usable.map((e) => {
    const a = at.get(e.tag_a) as KmCircle;
    const b = at.get(e.tag_b) as KmCircle;
    return { a: e.tag_a, b: e.tag_b, n: e.n, x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy };
  });
  const label = (k: string) => at.get(k)?.label ?? k;
  return {
    width: W,
    height: H,
    circles,
    lines,
    nodeRows: circles.map((c) => ({ tag_key: c.tag_key, label: c.label, n: c.n, no: c.no, selected: c.selected })),
    edgeRows: usable.map((e, i) => ({ ...e, no: i + 1, aLabel: label(e.tag_a), bLabel: label(e.tag_b) })),
  };
}

/** 방향키·Home·End로 옮길 다음 노드 위치 (끝에서 돌아 이어짐). 다른 키는 null */
export function nextFocusIndex(current: number, key: string, len: number): number | null {
  if (len <= 0) return null;
  if (key === "ArrowRight" || key === "ArrowDown") return (current + 1) % len;
  if (key === "ArrowLeft" || key === "ArrowUp") return (current - 1 + len) % len;
  if (key === "Home") return 0;
  if (key === "End") return len - 1;
  return null;
}

/** 측정 속성 tax_item은 영문 소문자 키여야 한다 - 세목 이름 표(이름 매핑일 뿐 세무 값이 아님), 표에 없으면 other */
const TAX_ITEM_KEYS: Readonly<Record<string, string>> = {
  취득세: "acquisition",
  재산세: "property",
  종합부동산세: "comprehensive",
  자동차세: "vehicle",
  등록면허세: "registration",
  지방소득세: "local_income",
  지방소비세: "local_consumption",
  지방교육세: "local_education",
  주민세: "resident",
  지역자원시설세: "resource",
  담배소비세: "tobacco",
  레저세: "leisure",
};
export const taxItemKey = (tax: string | null): string => (tax ? (TAX_ITEM_KEYS[tax] ?? "other") : "other");
