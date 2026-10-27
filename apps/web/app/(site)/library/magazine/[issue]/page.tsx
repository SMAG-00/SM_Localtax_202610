import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { paywalledArticle, toJsonLdScriptContent } from "@ltr/structured-data";
import { JsonLd } from "@/components/site/JsonLd";
import { LibraryGate, LibraryLimited, LibraryText } from "@/components/site/LibraryViews";
import { PAYWALL_SELECTOR } from "@/lib/server/billing/paywall-logic";
import { siteUrl } from "@/lib/server/env";
import { currentUserId, getIssue, getIssueArticles, rateGate, readItem } from "@/lib/server/library/read";
import { pageTitle } from "@/lib/site/hub-view";

// 월간지 권호 e-Book (/library/magazine/[issue] - W13-a a4, LIB-01·04·06). 요청마다 그린다(공유 캐시 0 - 구독자 응답이 남지 않게).
//  · 권호가 승인·공개 권리 확인·기능 키 켜짐일 때만 열린다(공개 뷰) - 아니면 404.
//  · 기사 본문은 서버 함수 library_read가 자른 값만 받는다. 메타 설명·구조화 데이터에는 제목만 쓴다(본문 0).
//  · 조문 인용은 검색 링크로 이어지고, 권호 기준일을 asOf로 붙인다.
export const dynamic = "force-dynamic";

const idOf = (v: string): number | null => (/^\d{1,12}$/.test(v) && Number(v) >= 1 ? Number(v) : null);

export async function generateMetadata({ params }: { params: Promise<{ issue: string }> }): Promise<Metadata> {
  const id = idOf((await params).issue);
  const issue = id === null ? null : await getIssue(id);
  return { title: pageTitle(issue ? `${issue.publication_title} ${issue.issue_no}` : "지식창고"), robots: { index: false, follow: false } };
}

export default async function MagazineIssuePage({ params }: { params: Promise<{ issue: string }> }) {
  await connection();
  const id = idOf((await params).issue);
  if (id === null) notFound();
  const issue = await getIssue(id);
  if (!issue) notFound();
  const userId = await currentUserId();
  if ((await rateGate(userId)) !== "ok") return <LibraryLimited />;
  const articles = await getIssueArticles(issue.id);
  const read = await Promise.all(articles.map(async (a) => ({ a, r: await readItem("issue_article", a.id, userId) })));
  const anyLocked = read.some(({ r }) => r.status === "ok" && !r.full);
  const base = siteUrl();
  return (
    <main data-ui="library-issue" className="mx-auto max-w-3xl px-4 py-16">
      {anyLocked ? (
        <JsonLd
          part="library-jsonld"
          content={toJsonLdScriptContent(
            paywalledArticle({
              ...(base ? { url: `${base}/library/magazine/${issue.id}` } : {}),
              title: `${issue.publication_title} ${issue.issue_no}`,
              datePublished: issue.issued_on,
              paywallSelector: PAYWALL_SELECTOR,
            }),
          )}
        />
      ) : null}
      <h1 className="text-[32px] leading-tight font-black tracking-tight text-navy-900">
        {issue.publication_title} {issue.issue_no}
      </h1>
      <p className="mt-2 font-mono text-[15px] text-navy-700" data-part="library-dates">
        발행일 {issue.issued_on} · 기준일 {issue.as_of}
      </p>
      {issue.pdf_available ? (
        <p className="mt-2 text-[15px]" data-part="library-pdf">
          원본 PDF 열람이 허용된 권호입니다.
        </p>
      ) : null}
      <nav aria-label="목차" className="mt-8">
        <ol className="list-decimal space-y-1 pl-5 text-[16px]">
          {articles.map((a) => (
            <li key={a.id}>
              <a href={`#a${a.id}`} className="underline underline-offset-2">
                {a.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {read.map(({ a, r }) => (
        <article key={a.id} id={`a${a.id}`} data-part="library-article" data-locked={r.status === "ok" && !r.full ? "true" : "false"} className="mt-12">
          <h2 className="text-[24px] font-black text-navy-900">{a.title}</h2>
          {r.status === "ok" ? (
            <>
              <div className="mt-4">
                <LibraryText text={r.text} asOf={issue.as_of} part={r.full ? "library-body" : "library-preview"} watermark={r.full && userId ? `구독자 ${userId.slice(0, 8)}` : null} />
              </div>
              {!r.full ? <LibraryGate reason={r.reason} /> : null}
            </>
          ) : (
            <p className="mt-4 text-[16px] text-navy-800">이 기사는 지금 열 수 없습니다.</p>
          )}
        </article>
      ))}
    </main>
  );
}
