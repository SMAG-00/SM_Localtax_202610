import Link from "next/link";
import { MeasureView } from "./Measure";
import { buildSeriesChart, formatValue, measurableKey, seriesHref, type DataVia, type SeriesView } from "@/lib/data-stories/series";

// 지방세 데이터 스토리 화면 (DATA-01). 글자는 DB 승인본이고 이 파일에 통계 값·세무 내용은 없다.
// 차트(SVG)와 아래의 표는 같은 점 목록(buildSeriesChart)에서 나온다 - 점 수 = 표 행 수. 출처·기준연도·확인일은 차트마다 붙는다.
const SHELL = "mx-auto w-full max-w-[860px] px-4 py-10";

export function DataChart({ series, via, caption, newerBaseYear }: { series: SeriesView; via: DataVia; caption?: string | null; newerBaseYear?: number | null }) {
  const c = buildSeriesChart(series.points);
  return (
    <figure data-part="data-chart" data-series={series.series_key} data-base-year={series.base_year} className="my-6 rounded-2xl border border-navy-100 p-4">
      {measurableKey(series.series_key) && <MeasureView name="data_story_viewed" section="tax" props={{ series_key: series.series_key, via }} />}
      <figcaption className="text-[16px] font-bold text-navy-900">{caption ?? series.title}</figcaption>
      <svg role="img" aria-label={`${series.title} 선 그래프`} viewBox={`0 0 ${c.width} ${c.height}`} className="mt-2 h-auto w-full" data-chart-svg>
        <title>{series.title}</title>
        <polyline points={c.line} fill="none" className="stroke-navy-500" strokeWidth={2} />
        {c.dots.map((d) => (
          <circle key={d.no} cx={d.x} cy={d.y} r={4} data-dot={d.period} data-value={d.value} className="fill-navy-900" />
        ))}
      </svg>
      <table className="mt-3 w-full border-collapse text-left text-[14px]" data-part="chart-table">
        <caption className="mb-1 text-left font-bold">같은 내용의 표 (단위 {series.unit})</caption>
        <thead>
          <tr className="border-b border-navy-200">
            <th scope="col" className="py-1 pr-3">시점</th>
            <th scope="col" className="py-1">값</th>
          </tr>
        </thead>
        <tbody>
          {c.rows.map((r) => (
            <tr key={r.no} data-row={r.period} className="border-b border-navy-100">
              <th scope="row" className="py-1 pr-3 font-normal">{r.period}</th>
              <td className="py-1 font-mono">{formatValue(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p data-part="data-source" className="mt-3 text-[13px] text-navy-700">
        출처{" "}
        <a href={series.source_url} rel="noopener noreferrer" target="_blank" className="underline underline-offset-2">{series.source_name}</a>
        {" · "}기준연도 <span className="font-mono">{series.base_year}</span>
        {" · "}확인일 <time dateTime={series.checked_at.slice(0, 10)} className="font-mono">{series.checked_at.slice(0, 10)}</time>
      </p>
      {newerBaseYear ? (
        <p data-part="newer-base-year" className="mt-1 text-[13px] text-navy-700">
          이 차트는 기준연도 {series.base_year} 자료입니다. 더 새로운 기준연도({newerBaseYear}) 자료는 <Link href={seriesHref(series.series_key)} className="font-bold underline underline-offset-2">데이터 보기</Link>에서 볼 수 있습니다.
        </p>
      ) : null}
    </figure>
  );
}

export function DataIndex({ items }: { items: SeriesView[] }) {
  return (
    <main id="main" className={SHELL} data-part="data-index">
      <h1 className="text-[28px] font-black text-navy-900">지방세 데이터</h1>
      <p className="mt-2 text-[15px] text-navy-700">공공 통계를 편집자가 확인해 올린 시계열입니다. 모든 차트에는 출처·기준연도·확인일이 붙고, 차트 아래에 같은 내용의 표가 있습니다.</p>
      <ul className="mt-6 space-y-2">
        {items.map((s) => (
          <li key={s.series_key} data-series={s.series_key} className="rounded-lg border border-navy-100 p-3 text-[15px]">
            <Link href={seriesHref(s.series_key)} className="font-bold text-navy-900 underline-offset-2 hover:underline">{s.title}</Link>
            <span className="ml-2 text-[13px] text-navy-500">기준연도 {s.base_year} · {s.source_name}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function DataSeriesPage({ series, baseYears, isCurrent }: { series: SeriesView; baseYears: number[]; isCurrent: boolean }) {
  return (
    <main id="main" className={SHELL} data-part="data-series" data-series={series.series_key}>
      <p className="text-[14px] text-navy-500"><Link href="/data" className="underline-offset-2 hover:underline">지방세 데이터</Link></p>
      <h1 className="mt-1 text-[28px] font-black text-navy-900">{series.title}</h1>
      {!isCurrent && <p data-part="old-base-year" className="mt-2 text-[14px] text-navy-700">이전 기준연도({series.base_year}) 자료입니다. <Link href={seriesHref(series.series_key)} className="font-bold underline underline-offset-2">현재 자료 보기</Link></p>}
      <DataChart series={series} via="data_page" />
      {baseYears.length > 1 && (
        <nav aria-label="기준연도" className="mt-2 flex flex-wrap gap-2 text-[14px]" data-part="base-years">
          {baseYears.map((y) => (
            <Link key={y} href={seriesHref(series.series_key, y)} aria-current={y === series.base_year ? "page" : undefined} className={`rounded-full border px-3 py-1 ${y === series.base_year ? "border-navy-900 font-bold" : "border-navy-200"}`}>{y}</Link>
          ))}
        </nav>
      )}
    </main>
  );
}
