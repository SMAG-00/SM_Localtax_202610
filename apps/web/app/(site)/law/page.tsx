import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { LawIndex } from "@/components/site/LawView";
import { getLawIndex, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle } from "@/lib/site/hub-view";

// 법령 목록 (/law - LAW-01). 기능 키 law_viewer가 꺼져 있으면 404. 요청 때 그린다(시행일에 따라 오늘 시행본이 바뀐다).
export const metadata: Metadata = { title: pageTitle("법령"), description: "지방세 법령의 조문을 시행일 기준으로 찾아봅니다." };

export default async function LawIndexPage() {
  await connection();
  const view = await readPublic("법령 목록", () => getLawIndex(), () => UNAVAILABLE);
  if (isUnavailable(view)) {
    return (
      <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-10">
        <h1 className="text-[28px] font-black text-navy-900">법령</h1>
        <p className="mt-4 text-[15px] text-navy-500">지금은 법령을 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.</p>
      </main>
    );
  }
  if (view === null) notFound();
  return <LawIndex view={view} />;
}
