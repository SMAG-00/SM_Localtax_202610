import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DataSeriesPage } from "@/components/site/DataStoryViews";
import { SERIES_KEY } from "@/lib/data-stories/series";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getSeries } from "@/lib/server/public/data-stories";
import { pageTitle } from "@/lib/site/hub-view";

// 지방세 데이터 상세 (/data/[seriesKey] - DATA-01). ?base=기준연도로 이전 기준연도 자료를 본다. 출처·기준연도·확인일이 없는 시계열은 404.
export const metadata: Metadata = { title: pageTitle("지방세 데이터") };

export default async function DataSeriesRoute({ params, searchParams }: { params: Promise<{ seriesKey: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const { seriesKey } = await params;
  const sp = await searchParams;
  if (!SERIES_KEY.test(seriesKey)) notFound();
  const raw = typeof sp.base === "string" && /^\d{4}$/.test(sp.base) ? Number(sp.base) : null;
  const page = await readPublic("지방세 데이터 상세", () => getSeries(seriesKey, raw), () => UNAVAILABLE);
  if (isUnavailable(page)) {
    return (
      <main id="main" className="mx-auto w-full max-w-[860px] px-4 py-10">
        <h1 className="text-[28px] font-black text-navy-900">지방세 데이터</h1>
        <p className="mt-4 text-[15px] text-navy-500">지금은 내용을 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.</p>
      </main>
    );
  }
  if (page === null) notFound();
  return <DataSeriesPage series={page.series} baseYears={page.baseYears} isCurrent={page.isCurrent} />;
}
