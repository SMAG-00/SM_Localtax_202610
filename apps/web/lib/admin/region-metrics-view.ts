// 지역 성과 대시보드(/admin/metrics?tab=region — REG1-15, docs/dev/W4_설계.md 1장 25단계)의 화면 값 — 정의 글자·행 만들기·편집비 입력 검사. 순수 모듈 (시험 region-metrics-view.test.ts)
// 비율은 항상 분자·분모를 함께 보인다(formatRatio). 편집비 행이 없는 달은 '편집비 미입력' — 추정값 0을 만들지 않는다.
import { REVISIT_DAYS, addDays, kstDate, kstDayStart, ratio, type Ratio } from "@/lib/analytics/metrics";
import { formatCount, formatRate, type MetricDefinition } from "@/lib/admin/metrics-view";

export const REGION_TAB = "region";
export const REGION_TAB_PATH = "/admin/metrics?tab=region";
export const COST_MISSING = "편집비 미입력";
export const COST_API_PATH = "/api/admin/region-costs";
/** 편집비 한 칸 상한(원) — DB check와 같다. 서버 보호 값이지 지표 기준이 아니다 */
export const COST_MAX_KRW = 100_000_000_000;

/** DB 함수 region_dashboard_metrics가 지역마다 돌려주는 숫자 */
export interface RegionMetricRow {
  regionCode: string;
  published: number;
  own: number;
  ownWithEvidence: number;
  viewSessions: number;
  movedSessions: number;
  visitors: number;
  returned: number;
  pending: number;
}

export function decodeRegionMetrics(payload: unknown): RegionMetricRow[] {
  const list = (payload as { regions?: unknown } | null)?.regions;
  if (!Array.isArray(list)) throw new Error("지역 지표 응답 모양이 틀렸습니다");
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return list.map((r) => {
    const o = r as Record<string, unknown>;
    return {
      regionCode: String(o.region_code),
      published: num(o.published),
      own: num(o.own),
      ownWithEvidence: num(o.own_with_evidence),
      viewSessions: num(o.view_sessions),
      movedSessions: num(o.moved_sessions),
      visitors: num(o.visitors),
      returned: num(o.returned),
      pending: num(o.pending),
    };
  });
}

/** "n / d (비율)" — 분자와 분모를 항상 함께, 분모 0이면 비율 '—' */
export const formatRatio = (r: Ratio): string => `${formatCount(r.numerator)} / ${formatCount(r.denominator)} (${formatRate(r)})`;

export interface RegionRow {
  regionCode: string;
  name: string;
  /** 자체 취재 수 — 분자 = 자체 취재(보도) 기사, 분모 = 공개 중 지역 기사 */
  own: Ratio;
  /** 근거 충족률 — 분자 = 확인된 취재 근거가 있는 자체 취재, 분모 = 자체 취재 */
  evidence: Ratio;
  /** 재방문(region_returned) — 분자 = 재방문자, 분모 = 방문자 */
  returned: Ratio;
  pending: number;
  /** 문제해결 이동률 — 분자 = 세금·부동산 이동 세션, 분모 = 지역 열람 세션 */
  moved: Ratio;
}

export function regionRows(rows: readonly RegionMetricRow[], names: ReadonlyMap<string, string>): RegionRow[] {
  return rows
    .map((r) => ({
      regionCode: r.regionCode,
      name: names.get(r.regionCode) ?? r.regionCode,
      own: { numerator: r.own, denominator: r.published },
      evidence: { numerator: r.ownWithEvidence, denominator: r.own },
      returned: { numerator: r.returned, denominator: r.visitors },
      pending: r.pending,
      moved: { numerator: r.movedSessions, denominator: r.viewSessions },
    }))
    .sort((a, b) => (a.regionCode < b.regionCode ? -1 : a.regionCode > b.regionCode ? 1 : 0));
}

export const DEFINITIONS = {
  own: {
    title: "자체 취재 수",
    owner: "REG1-15",
    denominator: "기간에 처음 발행되어 지금 공개 중인 그 지역 태그 기사 (이관 기사 제외)",
    numerator: "그중 유형이 보도(reported_news)인 기사",
    exclusions: "보류·삭제로 내린 기사, 이관(옛 사이트) 기사, 지역 태그가 없는 기사",
    note: "기사가 지역을 여러 개 달면 지역마다 한 건씩 셉니다. 편집국 안의 표시이며 네이버가 보는 범위와 다를 수 있습니다.",
  },
  evidence: {
    title: "근거 충족률",
    owner: "REG1-15",
    denominator: "그 지역의 자체 취재 기사",
    numerator: "그중 확인된(verified) 취재 근거가 1건 이상 있는 기사",
    exclusions: "자체 취재가 아닌 기사, 이관 기사",
  },
  returned: {
    title: "지역 재방문 (region_returned)",
    owner: "REG1-15 · W4 12장 #28",
    denominator: "기간 안에 그 지역(region_viewed)을 본 측정 동의 방문자",
    numerator: `그중 처음 본 날(한국 날짜)부터 ${REVISIT_DAYS}일째 날짜까지 다른 방문(세션)에서 같은 지역을 다시 본 방문자 — ${REVISIT_DAYS + 1}일째는 넣지 않음`,
    exclusions: "봇·편집국·관리자 세션, 방문자 ID가 없는 세션(측정 동의가 확인되지 않음)",
    note: `수집 이벤트가 아니라 지역 열람 이벤트로 계산합니다. '${REVISIT_DAYS}일 안 지남'은 아직 다시 오지 않았지만 ${REVISIT_DAYS}일이 끝나지 않아 숫자가 늘 수 있는 방문자입니다(분모에 들어 있음).`,
  },
  moved: {
    title: "문제해결 이동률",
    owner: "REG1-15",
    denominator: "기간 안에 그 지역 허브를 본 세션",
    numerator: "그 세션 가운데 같은 지역에서 세금 연결(region_to_tax_clicked) 또는 부동산 연결(region_to_realestate_clicked)을 누른 세션",
    exclusions: "봇·편집국·관리자 세션(세션 안에 하나라도 있으면 세션째), 다른 지역 허브의 이동",
  },
} as const satisfies Record<string, MetricDefinition>;

// ── 편집비 ────────────────────────────────────────────────

/** 한국 달력 'YYYY-MM' 이 올바른 달인가 */
export const isMonth = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) && v >= "2000-01";

/** 가장 최근에 끝난 달 (오늘 한국 날짜 기준) */
export function lastCompleteMonth(nowMs: number): string {
  return kstDate(kstDayStart(`${kstDate(nowMs).slice(0, 7)}-01`) - 86_400_000).slice(0, 7);
}

/** 달의 [시작, 다음 달 시작) 시각(ms) */
export function monthWindow(month: string): { from: number; to: number } {
  const from = kstDayStart(`${month}-01`);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from, to: kstDayStart(`${next}-01`) };
}

export const monthLinkTarget = (month: string): string => `${REGION_TAB_PATH}&month=${month}`;
export const shiftMonth = (month: string, delta: number): string => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
};
export { addDays };

export const formatKrw = (n: number): string => `${n.toLocaleString("ko-KR")}원`;

export interface CostInput {
  regionCode: string;
  month: string;
  amountKrw: number;
  reason: string;
}

/** 편집비 입력 검사 — 금액은 0 이상의 정수 원(글자 숫자도 받는다), 사유는 1~200자 */
export function parseCostInput(body: Record<string, unknown>): { ok: true; value: CostInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const regionCode = typeof body.regionCode === "string" ? body.regionCode.trim() : "";
  if (!/^\d{10}$/.test(regionCode)) errors.push("regionCode: 지역 코드 10자리 숫자여야 합니다");
  const month = typeof body.month === "string" ? body.month.trim() : "";
  if (!isMonth(month)) errors.push("month: YYYY-MM 형식의 올바른 달이어야 합니다");
  const raw = typeof body.amountKrw === "string" ? body.amountKrw.replace(/[,\s]/g, "") : body.amountKrw;
  const amountKrw = typeof raw === "string" ? (/^\d+$/.test(raw) ? Number(raw) : Number.NaN) : typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isInteger(amountKrw) || amountKrw < 0 || amountKrw > COST_MAX_KRW) errors.push(`amountKrw: 0 이상 ${COST_MAX_KRW.toLocaleString("ko-KR")} 이하의 정수(원)여야 합니다`);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 1 || reason.length > 200) errors.push("reason: 입력·변경 사유를 1~200자로 적어야 합니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: { regionCode, month, amountKrw, reason } };
}

export interface CostRow {
  regionCode: string;
  name: string;
  /** 입력된 편집비(원) — 입력 행이 없으면 null = '편집비 미입력' */
  amountKrw: number | null;
  /** 그 달 자체 취재 수 */
  own: number;
  /** 자체 취재 1건당 편집비 = 편집비 ÷ 자체 취재 (둘 다 있을 때만) */
  perArticle: { numerator: number; denominator: number } | null;
}

export function costRows(month: readonly RegionMetricRow[], costs: ReadonlyMap<string, number>, names: ReadonlyMap<string, string>): CostRow[] {
  const ownBy = new Map(month.map((r) => [r.regionCode, r.own]));
  const codes = new Set<string>([...ownBy.keys(), ...costs.keys()]);
  return [...codes]
    .sort()
    .map((code) => {
      const amount = costs.get(code) ?? null;
      const own = ownBy.get(code) ?? 0;
      return { regionCode: code, name: names.get(code) ?? code, amountKrw: amount, own, perArticle: amount !== null && own > 0 ? { numerator: amount, denominator: own } : null };
    });
}

/** 취재 1건당 편집비 글자 — 분자(원)·분모(건)를 함께 */
export function formatPerArticle(c: CostRow): string {
  if (c.amountKrw === null) return COST_MISSING;
  if (!c.perArticle) return "— (자체 취재 0건)";
  return `${formatKrw(c.amountKrw)} ÷ ${formatCount(c.own)}건 = ${formatKrw(Math.round(ratio({ numerator: c.perArticle.numerator, denominator: c.perArticle.denominator }) ?? 0))}`;
}
