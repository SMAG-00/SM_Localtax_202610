import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getColumns, libraryFeatureOn, listIssues, listTopNodes } from "@/lib/server/library/read";
import { pageTitle } from "@/lib/site/hub-view";

// 지식창고 허브 (/library - W13-a, 5단계 설계 5장 #5). 기능 키 library 꺼짐이면 404.
// 공개 뷰(권호·단행본 장·칼럼 목록)의 제목·발행일·판차·기준일만 보여 준다 - 본문·요약·미리보기 0. 목록은 승인·공개 권리 확인분뿐이다.
export const metadata: Metadata = { title: pageTitle("지식창고"), robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function LibraryHubPage() {
  await connection();
  if (!(await libraryFeatureOn())) notFound();
  const [issues, nodes, columns] = await Promise.all([listIssues(), listTopNodes(), getColumns()]);
  return (
    <main data-ui="library-hub" className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-[32px] leading-tight font-black tracking-tight text-navy-900">지식창고</h1>
      <section data-part="library-hub-issues" aria-label="월간지 권호" className="mt-10">
        <h2 className="text-[22px] font-black text-navy-900">월간지 권호</h2>
        {issues.length === 0 ? (
          <p className="mt-2 text-[16px] text-navy-800">공개된 권호가 아직 없습니다.</p>
        ) : (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-[16px]">
            {issues.map((i) => (
              <li key={i.id}>
                <a href={`/library/magazine/${i.id}`} className="underline underline-offset-2">
                  {i.publication_title} {i.issue_no}
                </a>
                <span className="font-mono text-[14px] text-navy-700"> · 발행일 {i.issued_on}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section data-part="library-hub-wiki" aria-label="실무·편람 위키" className="mt-10">
        <h2 className="text-[22px] font-black text-navy-900">실무·편람 위키</h2>
        {nodes.length === 0 ? (
          <p className="mt-2 text-[16px] text-navy-800">공개된 항목이 아직 없습니다.</p>
        ) : (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-[16px]">
            {nodes.map((n) => (
              <li key={n.id}>
                <a href={`/library/wiki/${n.id}`} className="underline underline-offset-2">
                  {n.publication_title} · {n.title}
                </a>
                <span className="font-mono text-[14px] text-navy-700"> · {n.edition_label} · 기준일 {n.as_of}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {columns.length > 0 ? (
        <section data-part="library-hub-columns" aria-label="프리미엄 칼럼" className="mt-10">
          <h2 className="text-[22px] font-black text-navy-900">프리미엄 칼럼</h2>
          <p className="mt-2 text-[16px]">
            <Link href="/library/columns" className="underline underline-offset-2">
              칼럼 아카이브 보기
            </Link>
          </p>
        </section>
      ) : null}
    </main>
  );
}
