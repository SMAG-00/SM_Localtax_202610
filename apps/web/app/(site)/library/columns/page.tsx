import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getColumns } from "@/lib/server/library/read";
import { pageTitle } from "@/lib/site/hub-view";

// 프리미엄 칼럼 아카이브 (/library/columns - W13-a a7, LIB-03·07). 기능 키 library_premium이 꺼져 있거나 공개 칼럼이 없으면 404.
// 제목·필자·시리즈 정보만 보여 준다(본문·요약 0). 유료 콘텐츠임을 목록에서 표시한다.
export const metadata: Metadata = { title: pageTitle("프리미엄 칼럼"), robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ColumnsArchivePage() {
  await connection();
  const columns = await getColumns();
  if (columns.length === 0) notFound();
  return (
    <main data-ui="library-columns" className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-[32px] leading-tight font-black tracking-tight text-navy-900">프리미엄 칼럼</h1>
      <ul className="mt-8 space-y-4">
        {columns.map((c) => (
          <li key={c.id} data-part="library-column-item" className="rounded-2xl border border-navy-100 bg-white p-5">
            <a href={`/library/columns/${c.id}`} className="text-[19px] font-black text-navy-900 underline underline-offset-2">
              {c.title}
            </a>
            <p className="mt-1 text-[14px] text-navy-700">
              <span data-part="library-paid-badge">구독자 전용</span>
              {c.series_title ? ` · ${c.series_title}${c.series_no ? ` ${c.series_no}회` : ""}` : ""}
              {c.first_published_at ? ` · ${c.first_published_at.slice(0, 10)}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
