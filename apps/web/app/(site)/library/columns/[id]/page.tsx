import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { paywalledArticle, toJsonLdScriptContent } from "@ltr/structured-data";
import { JsonLd } from "@/components/site/JsonLd";
import { LibraryGate, LibraryLimited, LibraryText } from "@/components/site/LibraryViews";
import { PAYWALL_SELECTOR } from "@/lib/server/billing/paywall-logic";
import { siteUrl } from "@/lib/server/env";
import { currentUserId, getColumn, rateGate, readColumn } from "@/lib/server/library/read";
import { pageTitle } from "@/lib/site/hub-view";

// 프리미엄 칼럼 읽기 (/library/columns/[id] - W13-a a7, LIB-07·04). 요청마다 그린다(공유 캐시 0).
//  · 본문은 column_read가 자른 값만. 메타 설명·구조화 데이터에는 제목만 쓴다(요약·본문 0). 보도기사·뉴스 전송 후보가 아니다(opinion).
export const dynamic = "force-dynamic";

const idOf = (v: string): number | null => (/^\d{1,12}$/.test(v) && Number(v) >= 1 ? Number(v) : null);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const id = idOf((await params).id);
  const c = id === null ? null : await getColumn(id);
  return { title: pageTitle(c ? c.title : "프리미엄 칼럼"), robots: { index: false, follow: false } };
}

export default async function ColumnPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const id = idOf((await params).id);
  if (id === null) notFound();
  const column = await getColumn(id);
  if (!column) notFound();
  const userId = await currentUserId();
  if ((await rateGate(userId)) !== "ok") return <LibraryLimited />;
  const r = await readColumn(column.id, userId);
  const base = siteUrl();
  return (
    <main data-ui="library-column" className="mx-auto max-w-3xl px-4 py-16">
      {r.status === "ok" && !r.full ? (
        <JsonLd
          part="library-jsonld"
          content={toJsonLdScriptContent(
            paywalledArticle({
              ...(base ? { url: `${base}/library/columns/${column.id}` } : {}),
              title: column.title,
              ...(column.first_published_at ? { datePublished: column.first_published_at } : {}),
              paywallSelector: PAYWALL_SELECTOR,
            }),
          )}
        />
      ) : null}
      {column.series_title ? (
        <p className="text-[15px] text-navy-700" data-part="library-series">
          {column.series_title}
          {column.series_no ? ` ${column.series_no}회` : ""}
        </p>
      ) : null}
      <h1 className="mt-2 text-[32px] leading-tight font-black tracking-tight text-navy-900">{column.title}</h1>
      <div className="mt-8">
        {r.status === "ok" ? (
          <>
            <LibraryText text={r.text} part={r.full ? "library-body" : "library-preview"} watermark={r.full && userId ? `구독자 ${userId.slice(0, 8)}` : null} />
            {!r.full ? <LibraryGate reason={r.reason} /> : null}
          </>
        ) : (
          <p className="text-[16px] text-navy-800">이 칼럼은 지금 열 수 없습니다.</p>
        )}
      </div>
    </main>
  );
}
