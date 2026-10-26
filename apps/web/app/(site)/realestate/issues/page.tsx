import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { IssueIndex } from "@/components/site/IssueMapView";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getIssueIndex } from "@/lib/server/public/issues";
import { pageTitle } from "@/lib/site/hub-view";

// 쟁점 연결 지도 목록 (/realestate/issues - LINK-01). 기능 키 issue_graph가 꺼져 있으면 404. 서명 후 공개된 지도만 나온다.
export const metadata: Metadata = { title: pageTitle("쟁점 연결 지도"), description: "한 쟁점에 걸린 조문을 관계와 함께 봅니다." };

export default async function IssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const sp = await searchParams;
  const hub = typeof sp.hub === "string" ? sp.hub : null;
  const view = await readPublic("쟁점 지도 목록", () => getIssueIndex(hub), () => UNAVAILABLE);
  if (isUnavailable(view)) {
    return (
      <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-10">
        <h1 className="text-[28px] font-black text-navy-900">쟁점 연결 지도</h1>
        <p className="mt-4 text-[15px] text-navy-500">지금은 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.</p>
      </main>
    );
  }
  if (view === null) notFound();
  return <IssueIndex view={view} />;
}
