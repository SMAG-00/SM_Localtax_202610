import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { IssueCaseList } from "@/components/site/IssueMapView";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getIssueCaseList } from "@/lib/server/public/issues";
import { pageTitle } from "@/lib/site/hub-view";

// 쟁점 태그로 거른 판례·해석 모음 (/realestate/issues/cases/[hub] - TRU-05 신탁 · RDV-08 정비). 승인된 태그가 붙은 항목만 나온다.
export const metadata: Metadata = { title: pageTitle("판례·해석 모음") };

export default async function IssueCasesPage({ params, searchParams }: { params: Promise<{ hub: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const { hub } = await params;
  const sp = await searchParams;
  const tag = typeof sp.tag === "string" && /^[a-z][a-z0-9_]{1,39}$/.test(sp.tag) ? sp.tag : null;
  const view = await readPublic("쟁점 판례·해석 모음", () => getIssueCaseList(hub, tag), () => UNAVAILABLE);
  if (isUnavailable(view)) {
    return (
      <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-10">
        <h1 className="text-[28px] font-black text-navy-900">판례·해석 모음</h1>
        <p className="mt-4 text-[15px] text-navy-500">지금은 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.</p>
      </main>
    );
  }
  if (view === null) notFound();
  return <IssueCaseList view={view} />;
}
