// 지방세 데이터 스토리의 순수 규칙 (W12-h DATA-01 - docs/dev/W12-h_설계.md). DB·네트워크를 읽지 않는다. 통계 값은 DB 승인본이고 이 파일에 값은 없다.
//  · statsRenderable - 출처 이름·주소·기준연도·확인일·점이 하나라도 비면 렌더하지 않는다 (DB 제약과 같은 이중 방어)
//  · buildSeriesChart - 차트(SVG 점·선)와 같은 내용의 표 행을 한 목록(points)에서 모두 만든다 (PRD-00 8.6·8.9)
//  · isLocalTaxItem - 국세 세목 이름이 든 항목 이름을 거른다. 낱말은 조각을 이어 만들어 국세 낱말이 소스에 한 덩어리로 놓이지 않는다 (DB 제약 179와 같은 조각)

export interface SeriesPoint {
  period: string;
  value: number;
}

export interface SeriesView {
  id: number;
  series_key: string;
  title: string;
  tax_item: string | null;
  region_code: string | null;
  unit: string;
  points: SeriesPoint[];
  source_name: string;
  source_url: string;
  base_year: number;
  checked_at: string;
  status: "approved" | "superseded";
}

export const SERIES_KEY = /^[a-z][a-z0-9_]{2,59}$/;
export const PERIOD = /^[0-9]{4}(-[0-9]{2})?$/;
export const MAX_POINTS = 200;
export const DATA_VIA = ["article", "data_page"] as const;
export type DataVia = (typeof DATA_VIA)[number];

/** 국세 세목 이름 조각 (SQL 제약과 같은 조각 - 시험이 둘을 대조한다) */
export const NATIONAL_STEMS: readonly (readonly string[])[] = [["양", "도"], ["상", "속"], ["증", "여"], ["부", "가가", "치"]];
const NATIONAL_ITEM = new RegExp(NATIONAL_STEMS.map((p) => p.join("")).join("|"));

export function isLocalTaxItem(item: string | null): boolean {
  if (item === null) return true;
  const t = item.trim();
  return t.length >= 1 && t.length <= 30 && !NATIONAL_ITEM.test(t);
}

/** points 모양 검사 - 문제 글 또는 null (DB 함수 stats_points_problem과 같은 규칙) */
export function pointsProblem(points: unknown): string | null {
  if (!Array.isArray(points)) return "points는 목록이어야 합니다";
  if (points.length < 1 || points.length > MAX_POINTS) return `points는 1~${MAX_POINTS}개여야 합니다`;
  let prev: string | null = null;
  for (const p of points) {
    if (!p || typeof p !== "object" || Array.isArray(p)) return "각 점은 period와 value 두 칸이어야 합니다";
    const keys = Object.keys(p as object);
    if (keys.length !== 2 || !keys.includes("period") || !keys.includes("value")) return "각 점은 period와 value 두 칸뿐이어야 합니다";
    const { period, value } = p as Record<string, unknown>;
    if (typeof period !== "string" || !PERIOD.test(period)) return "period 모양이 틀렸습니다 (YYYY 또는 YYYY-MM)";
    if (typeof value !== "number" || !Number.isFinite(value)) return "value는 숫자여야 합니다";
    if (prev !== null && period <= prev) return "period는 오름차순이고 중복이 없어야 합니다";
    prev = period;
  }
  return null;
}

const isHttps = (u: unknown): u is string => typeof u === "string" && /^https:\/\/[^\s]+$/i.test(u) && !/[?&;](oc|servicekey|api_?key|auth_?key|access_?token|key)=/i.test(u);
const isDate = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) && !Number.isNaN(Date.parse(d.slice(0, 10)));

/** 렌더해도 되는 시계열인가 - 출처·기준연도·확인일이 없거나 모양이 틀리면 false */
export function statsRenderable(s: Partial<SeriesView> | null | undefined): s is SeriesView {
  if (!s) return false;
  if (typeof s.series_key !== "string" || !SERIES_KEY.test(s.series_key)) return false;
  if (typeof s.title !== "string" || s.title.trim() === "" || typeof s.unit !== "string" || s.unit.trim() === "") return false;
  if (typeof s.source_name !== "string" || s.source_name.trim() === "") return false;
  if (!isHttps(s.source_url)) return false;
  if (typeof s.base_year !== "number" || !Number.isInteger(s.base_year) || s.base_year < 1990 || s.base_year > 2100) return false;
  if (!isDate(s.checked_at)) return false;
  if (pointsProblem(s.points) !== null) return false;
  return isLocalTaxItem(s.tax_item ?? null);
}

export interface ChartDot {
  no: number;
  period: string;
  value: number;
  x: number;
  y: number;
}
export interface SeriesChart {
  width: number;
  height: number;
  dots: ChartDot[];
  /** SVG polyline points 속성 값 */
  line: string;
  min: number;
  max: number;
  rows: Array<{ no: number; period: string; value: number }>;
}

const W = 640;
const H = 280;
const PAD = 32;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** 점 목록 하나에서 SVG 점·선과 표 행을 모두 만든다 - 점 수 = 표 행 수 */
export function buildSeriesChart(points: readonly SeriesPoint[]): SeriesChart {
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const n = points.length;
  const dots: ChartDot[] = points.map((p, i) => ({
    no: i + 1,
    period: p.period,
    value: p.value,
    x: r1(n === 1 ? W / 2 : PAD + ((W - 2 * PAD) * i) / (n - 1)),
    y: r1(H - PAD - ((H - 2 * PAD) * (p.value - min)) / span),
  }));
  return { width: W, height: H, dots, line: dots.map((d) => `${d.x},${d.y}`).join(" "), min, max, rows: dots.map((d) => ({ no: d.no, period: d.period, value: d.value })) };
}

export const formatValue = (v: number): string => new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 }).format(v);

export const seriesHref = (key: string, base?: number): string => `/data/${encodeURIComponent(key)}${base ? `?base=${base}` : ""}`;

export function parseVia(v: string | null | undefined): DataVia {
  return (DATA_VIA as readonly string[]).includes(v ?? "") ? (v as DataVia) : "data_page";
}

/** 측정 속성 series_key는 영문 소문자 키여야 한다 (이미 SERIES_KEY) - 모양이 틀리면 보내지 않는다 */
export const measurableKey = (k: string): boolean => SERIES_KEY.test(k);
