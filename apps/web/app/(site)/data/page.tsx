import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DataIndex } from "@/components/site/DataStoryViews";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { listSeries } from "@/lib/server/public/data-stories";
import { pageTitle } from "@/lib/site/hub-view";

// 지방세 데이터 (/data - DATA-01). 기능 키 data_stories가 꺼져 있거나 승인된 시계열이 없으면 404. 비회원 열람.
export const metadata: Metadata = { title: pageTitle("지방세 데이터"), description: "출처와 기준연도가 확인된 지방세 통계 시계열을 모아 봅니다." };

export default async function DataRoute() {
  await connection();
  const items = await readPublic("지방세 데이터", () => listSeries(), () => UNAVAILABLE);
  if (isUnavailable(items)) {
    return (
      <main id="main" className="mx-auto w-full max-w-[860px] px-4 py-10">
        <h1 className="text-[28px] font-black text-navy-900">지방세 데이터</h1>
        <p className="mt-4 text-[15px] text-navy-500">지금은 내용을 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.</p>
      </main>
    );
  }
  if (items === null) notFound();
  return <DataIndex items={items} />;
}
