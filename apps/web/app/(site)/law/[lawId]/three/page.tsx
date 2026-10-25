import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { LawThree } from "@/components/site/LawThreeView";
import { getThreePage, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle } from "@/lib/site/hub-view";

// 3단 보기 (/law/[lawId]/three?date=&article= - LAW-05·TX-11). 기능 키 law_three + 위임 매핑 표본 검사 관문(50건 중 48)을 통과해야 열린다 - 아니면 404.
type Props = { params: Promise<{ lawId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = { title: pageTitle("법령 3단 보기") };

export default async function LawThreePage({ params, searchParams }: Props) {
  await connection();
  const { lawId } = await params;
  const sp = await searchParams;
  const view = await readPublic("법령 3단 보기", () => getThreePage(lawId, sp.date, typeof sp.article === "string" ? sp.article : undefined), () => UNAVAILABLE);
  if (isUnavailable(view)) {
    return (
      <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-10">
        <p className="text-[15px] text-navy-500">지금은 3단 보기를 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.</p>
      </main>
    );
  }
  if (view === null) notFound();
  return <LawThree view={view} />;
}
