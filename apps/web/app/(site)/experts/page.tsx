import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ExpertsListView } from "@/components/site/ExpertViews";
import type { SearchParams } from "@/components/site/routes";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getExpertList } from "@/lib/server/public/experts";
import { pageTitle, queryValue } from "@/lib/site/hub-view";

// SM(선명) 소속 전문가 소개 목록 (/experts - W7c EXPL-01). 기능 키 experts 꺼짐은 404. 분류 필터는 ?category= 하나 (지역 쿼리는 읽지 않는다 - 지역 필터·정렬 0).
export const metadata: Metadata = { title: pageTitle("SM 전문가 소개") };

export default async function ExpertsPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const view = await readPublic("전문가 목록", () => getExpertList({ category: queryValue(sp.category) ?? null }), () => UNAVAILABLE);
  if (isUnavailable(view)) return <UnavailablePage />;
  if (!view.open) notFound();
  return <ExpertsListView view={view} />;
}
