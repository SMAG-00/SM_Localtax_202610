import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { KeywordMap } from "@/components/site/KeywordMapView";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getKeywordMap } from "@/lib/server/public/keyword-map";
import { pageTitle } from "@/lib/site/hub-view";

// 키워드 맵 (/cases/keywords - CASE-06). 기능 키 keyword_map이 꺼져 있거나 정책(노드 상한)이 비어 있으면 404. 비회원 열람.
export const metadata: Metadata = { title: pageTitle("키워드 맵"), description: "승인된 쟁점 태그가 함께 붙은 결정례의 관계를 세목별로 봅니다." };

export default async function KeywordMapPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const sp = await searchParams;
  const view = await readPublic("키워드 맵", () => getKeywordMap(sp), () => UNAVAILABLE);
  if (isUnavailable(view)) {
    return (
      <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-10">
        <h1 className="text-[28px] font-black text-navy-900">키워드 맵</h1>
        <p className="mt-4 text-[15px] text-navy-500">지금은 키워드 맵을 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.</p>
      </main>
    );
  }
  if (view === null) notFound();
  return <KeywordMap view={view} />;
}
