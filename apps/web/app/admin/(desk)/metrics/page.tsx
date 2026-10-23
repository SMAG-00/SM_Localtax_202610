import type { Metadata } from "next";
import Link from "next/link";
import { Callout } from "@ltr/ui";
import { MetricsView } from "@/components/admin/MetricsView";
import { RegionMetricsView } from "@/components/admin/RegionMetricsView";
import { PageTitle } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { METRICS_PATH } from "@/lib/admin/metrics-view";
import { REGION_TAB, REGION_TAB_PATH } from "@/lib/admin/region-metrics-view";
import { loadRegionDashboard, type RegionDashboard } from "@/lib/server/analytics/region-metrics";
import { loadMetricsDashboard, type MetricsDashboard } from "@/lib/server/analytics/metrics";
import { pageViewer, queryValue, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";

// 측정 지표 대시보드 (/admin/metrics — GROW-01, docs/dev/W2-c_설계.md 8.3) — 관리자만(metrics.read). 그 밖의 역할은 403 화면.
// 기간: ?period=7|30|90|baseline 또는 ?period=custom&from=YYYY-MM-DD&to=YYYY-MM-DD (한국 날짜). 화면을 열 때마다 원본 이벤트에서 다시 센다.
export const metadata: Metadata = { title: "측정 지표" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function MetricsPage({ searchParams }: Props) {
  const viewer = await pageViewer();
  requirePage(viewer, "metrics.read");
  const q = await searchParams;
  const pick = (k: string) => queryValue(q[k]).trim() || undefined;
  const regionTab = pick("tab") === REGION_TAB;
  let dash: MetricsDashboard | null = null;
  let regionDash: RegionDashboard | null = null;
  let failed: string | null = null;
  try {
    const query = { period: pick("period"), from: pick("from"), to: pick("to") };
    if (regionTab) regionDash = await loadRegionDashboard(serviceDb(), { ...query, month: pick("month") }, new Date());
    else dash = await loadMetricsDashboard(serviceDb(), query, new Date());
  } catch (err) {
    console.error("[admin/metrics] 지표 읽기 실패:", err instanceof Error ? err.message : "알 수 없는 오류");
    failed = "지표를 읽지 못했습니다 — 잠시 뒤 다시 열어 주세요.";
  }
  const TAB = "inline-flex min-h-11 items-center rounded-xl border px-4 text-[15px] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";
  const tabClass = (on: boolean) => `${TAB} ${on ? "border-navy-900 bg-navy-900 text-white" : "border-navy-200 bg-white text-navy-800 hover:border-navy-900"}`;

  return (
    <>
      <PageTitle
        title="측정 지표"
        description="분야별 유효 방문·재방문율·첫 방문 깔때기(GROW-01)와 다른 문서가 정하는 지표를 한곳에 모았습니다. 봇·편집국·관리자 방문은 뺍니다."
      />
      <nav aria-label="지표 탭" data-part="metrics-tabs" className="mb-6">
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link href={METRICS_PATH} aria-current={regionTab ? undefined : "page"} className={tabClass(!regionTab)}>
              전체
            </Link>
          </li>
          <li>
            <Link href={REGION_TAB_PATH} aria-current={regionTab ? "page" : undefined} className={tabClass(regionTab)}>
              지역
            </Link>
          </li>
        </ul>
      </nav>
      {failed || (!dash && !regionDash) ? (
        <Callout>
          <span data-part="load-error">{failed}</span>
        </Callout>
      ) : regionDash ? (
        <RegionMetricsView dash={regionDash} canEditCost={can(viewer, "region_cost.edit")} />
      ) : (
        dash && <MetricsView dash={dash} />
      )}
    </>
  );
}
