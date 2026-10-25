import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { LawArticle } from "@/components/site/LawView";
import { getArticlePage, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle } from "@/lib/site/hub-view";

// 조문 하나 (/law/[lawId]/[article]?date=#p1 - LAW-04). 조 번호는 11 또는 11-2(조의2). 같은 주소 = 같은 시점·같은 위치.
type Props = { params: Promise<{ lawId: string; article: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lawId, article } = await params;
  let name = "";
  try {
    name = decodeURIComponent(lawId);
  } catch {
    name = "";
  }
  return { title: pageTitle(`${name} ${article}`.trim()) };
}

export default async function LawArticlePage({ params, searchParams }: Props) {
  await connection();
  const { lawId, article } = await params;
  const sp = await searchParams;
  const view = await readPublic("법령 조문", () => getArticlePage(lawId, article, sp.date, sp.vs), () => UNAVAILABLE);
  if (isUnavailable(view)) {
    return (
      <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-10">
        <p className="text-[15px] text-navy-500">지금은 조문을 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.</p>
      </main>
    );
  }
  if (view === null) notFound();
  return <LawArticle view={view} />;
}
