import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CaseSearch } from "@/components/site/CaseView";
import { isUnavailable, parseCaseFilter, readPublic, searchCases, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle } from "@/lib/site/hub-view";

// 판례·해석 검색 (/cases - CASE-01·TX-10). 기능 키 case_db가 꺼져 있으면 404. 검색은 캐시하지 않는다.
export const metadata: Metadata = { title: pageTitle("판례·해석 검색"), description: "예규·통칙·유권해석·심판·판례 원문을 찾아봅니다." };

export default async function CasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const filter = parseCaseFilter(await searchParams);
  const view = await readPublic("해석 검색", () => searchCases(filter), () => UNAVAILABLE);
  if (isUnavailable(view)) {
    return (
      <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-10">
        <h1 className="text-[28px] font-black text-navy-900">판례·해석 검색</h1>
        <p className="mt-4 text-[15px] text-navy-500">지금은 검색을 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.</p>
      </main>
    );
  }
  if (view === null) notFound();
  return <CaseSearch view={view} />;
}
