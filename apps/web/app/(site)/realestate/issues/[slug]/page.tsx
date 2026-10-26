import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { IssueMapPage } from "@/components/site/IssueMapView";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getIssuePage, parseIssueEntry } from "@/lib/server/public/issues";
import { pageTitle } from "@/lib/site/hub-view";

// 쟁점 연결 지도 상세 (/realestate/issues/[slug] - LINK-01). 서명 후 공개된 지도만. 공개 전 슬러그·기능 키 꺼짐은 404.
export const metadata: Metadata = { title: pageTitle("쟁점 연결 지도") };

export default async function IssueMapRoute({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const { slug } = await params;
  const entry = parseIssueEntry((await searchParams).from);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 100) notFound();
  const view = await readPublic("쟁점 지도", () => getIssuePage(slug), () => UNAVAILABLE);
  if (isUnavailable(view)) {
    return (
      <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-10">
        <h1 className="text-[28px] font-black text-navy-900">쟁점 연결 지도</h1>
        <p className="mt-4 text-[15px] text-navy-500">지금은 지도를 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.</p>
      </main>
    );
  }
  if (view === null) notFound();
  return <IssueMapPage view={view} entry={entry} />;
}
