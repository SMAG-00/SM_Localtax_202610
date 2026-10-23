import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { REVISIT_DAYS, addDays, kstDate, kstDayStart, readWindow, resolvePeriod, type Period, type PeriodQuery, CUTOVER_SETTING_KEY, readCutover } from "@/lib/analytics/metrics";
import { decodeRegionMetrics, isMonth, lastCompleteMonth, monthWindow, type RegionMetricRow } from "@/lib/admin/region-metrics-view";

// 지역 성과 대시보드(/admin/metrics?tab=region)의 바깥 일 — 세는 규칙은 DB 함수 region_dashboard_metrics(…58) 한 곳, 화면 값은 lib/admin/region-metrics-view.ts.
//  · service_role로만 읽는다. 화면은 관리자만(metrics.read) — 이 함수를 부르기 전에 판정한다
//  · 오류 문장에는 DB 오류 코드만 — 이벤트 값·방문자 정보는 남기지 않는다

export interface RegionOption {
  code: string;
  name: string;
  level: string;
}

export interface RegionDashboard {
  period: Period;
  periodError: string | null;
  today: string;
  computedAt: string;
  rows: RegionMetricRow[];
  /** 편집비를 보는 달 (YYYY-MM) · 그 달 지역별 숫자 · 입력된 편집비 */
  month: string;
  monthRows: RegionMetricRow[];
  costs: Map<string, number>;
  regions: RegionOption[];
}

const fail = (what: string, error: { code?: string } | null | undefined) => new Error(`${what} 실패 (${error?.code ?? "응답 없음"})`);

export async function loadRegionDashboard(db: SupabaseClient, query: PeriodQuery & { month?: string }, now: Date): Promise<RegionDashboard> {
  const { data: setting, error: settingError } = await db.from("settings").select("value").eq("key", CUTOVER_SETTING_KEY).limit(1);
  if (settingError) throw fail("전환일 설정 읽기", settingError);
  const { date: cutover } = readCutover(setting?.[0]?.value, (setting ?? []).length > 0);
  const { period, error: periodError } = resolvePeriod(query, now.getTime(), cutover);
  const win = readWindow(period);
  const today = kstDate(now.getTime());
  const month = isMonth(query.month) ? query.month : lastCompleteMonth(now.getTime());
  const mw = monthWindow(month);

  const call = async (from: number, to: number, until: number) => {
    const { data, error } = await db.rpc("region_dashboard_metrics", {
      p_from: new Date(from).toISOString(),
      p_to: new Date(to).toISOString(),
      p_until: new Date(until).toISOString(),
      p_today: today,
    });
    if (error) throw fail("지역 지표 읽기", error);
    return decodeRegionMetrics(data);
  };
  const [rows, monthRows] = await Promise.all([call(win.from, win.to, win.until), call(mw.from, mw.to, kstDayStart(addDays(kstDate(mw.to), REVISIT_DAYS + 1)))]);

  const { data: costData, error: costError } = await db.from("region_editorial_costs").select("region_code, amount_krw").eq("month", `${month}-01`);
  if (costError) throw fail("편집비 읽기", costError);
  const costs = new Map<string, number>((costData ?? []).map((c: { region_code: string; amount_krw: number | string }) => [c.region_code, Number(c.amount_krw)]));

  const { data: regionData, error: regionError } = await db.from("regions").select("code, name, level").order("code");
  if (regionError) throw fail("지역 목록 읽기", regionError);
  return { period, periodError, today, computedAt: now.toISOString(), rows, month, monthRows, costs, regions: (regionData ?? []) as RegionOption[] };
}
