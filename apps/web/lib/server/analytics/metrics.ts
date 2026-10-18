import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CUTOVER_SETTING_KEY,
  METRIC_EVENT_NAMES,
  computeSegment,
  decodeMetricSessions,
  kstDate,
  readCutover,
  readWindow,
  resolvePeriod,
  splitAtCutover,
  type Period,
  type PeriodQuery,
  type SegmentMetrics,
} from "@/lib/analytics/metrics";

// 지표 대시보드(/admin/metrics)의 바깥 일 (docs/dev/W2-c_설계.md 8.3) — 세는 규칙은 lib/analytics/metrics.ts(순수 함수) 한 곳.
//  · service_role로만 읽는다(원본 analytics_events는 anon·authenticated 0). 화면은 관리자만(접근 판정 metrics.read) — 이 함수를 부르기 전에 판정한다
//  · DB 함수 analytics_metric_sessions 한 번: 기간 안에서 시작한 세션 + 그 방문자의 30일 뒤 세션을 세션별로 묶어 받는다(방문자 UUID 대신 응답 안 번호)
//  · 세션이 상한을 넘으면 숫자를 만들지 않는다(over) — 화면이 '기간을 줄이세요'를 보인다. 일 단위 미리 계산은 운영 트래픽을 보고 정한다 (설계 9장)
//  · 오류 문장에는 DB 오류 코드만 — 이벤트 값·방문자 정보는 남기지 않는다

/** 한 번에 계산하는 세션 상한 — 응답 크기(세션 하나 약 100바이트)를 묶는다. 지표 정의 값이 아니라 서버 보호 값 */
export const METRICS_SESSION_LIMIT = 100_000;

export type MetricsResult = { kind: "ok"; segments: SegmentMetrics[] } | { kind: "over"; count: number; limit: number };

export interface MetricsDashboard {
  period: Period;
  /** 주소의 기간을 쓸 수 없어 기본 기간으로 보일 때의 이유 */
  periodError: string | null;
  /** 운영 도메인 전환일 (한국 날짜) — 없으면 null */
  cutover: string | null;
  cutoverProblem: string | null;
  /** 오늘 한국 날짜 · 계산 시각 */
  today: string;
  computedAt: string;
  result: MetricsResult;
}

const fail = (what: string, error: { code?: string } | null | undefined) => new Error(`${what} 실패 (${error?.code ?? "응답 없음"})`);

export async function loadMetricsDashboard(db: SupabaseClient, query: PeriodQuery, now: Date): Promise<MetricsDashboard> {
  const { data: rows, error: settingError } = await db.from("settings").select("value").eq("key", CUTOVER_SETTING_KEY).limit(1);
  if (settingError) throw fail("전환일 설정 읽기", settingError);
  const { date: cutover, problem: cutoverProblem } = readCutover(rows?.[0]?.value, (rows ?? []).length > 0);
  const { period, error: periodError } = resolvePeriod(query, now.getTime(), cutover);
  const window = readWindow(period);
  const { data, error } = await db.rpc("analytics_metric_sessions", {
    p_from: new Date(window.from).toISOString(),
    p_to: new Date(window.to).toISOString(),
    p_until: new Date(window.until).toISOString(),
    p_names: [...METRIC_EVENT_NAMES],
    p_limit: METRICS_SESSION_LIMIT,
  });
  if (error) throw fail("측정 세션 읽기", error);
  const read = decodeMetricSessions(data, window.from);
  const today = kstDate(now.getTime());
  const result: MetricsResult = read.over
    ? { kind: "over", count: read.count, limit: METRICS_SESSION_LIMIT }
    : { kind: "ok", segments: splitAtCutover(period, cutover).map((seg) => computeSegment(read.sessions, seg, today)) };
  return { period, periodError, cutover, cutoverProblem, today, computedAt: now.toISOString(), result };
}
