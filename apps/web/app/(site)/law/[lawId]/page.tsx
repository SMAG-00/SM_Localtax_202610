import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { LawBody } from "@/components/site/LawView";
import { getLawPage, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle } from "@/lib/site/hub-view";

// 법령 전문 (/law/[lawId]?date= - LAW-01·02·03). 법령은 이름 또는 번호. 기준일에 시행 중인 개정판을 보인다.
type Props = { params: Promise<{ lawId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lawId } = await params;
  let name = "";
  try {
    name = decodeURIComponent(lawId);
  } catch {
    name = "";
  }
  return { title: pageTitle(name === "" ? "법령" : name) };
}

export default async function LawPage({ params, searchParams }: Props) {
  await connection();
  const { lawId } = await params;
  const sp = await searchParams;
  const view = await readPublic("법령 전문", () => getLawPage(lawId, sp.date), () => UNAVAILABLE);
  if (isUnavailable(view)) {
    return (
      <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-10">
        <p className="text-[15px] text-navy-500">지금은 법령을 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.</p>
      </main>
    );
  }
  if (view === null) notFound();
  return <LawBody view={view} />;
}
