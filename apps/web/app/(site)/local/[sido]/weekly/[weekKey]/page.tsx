import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { WeeklyPage } from "@/components/site/LocalNewsViews";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getWeeklyPage } from "@/lib/server/public/local-news";
import { pageTitle } from "@/lib/site/hub-view";

// 주간 핫뉴스 페이지 (/local/[sido]/weekly/[yyyy-ww] - W6 LG-01). 존재하지 않는 주·발행 안 된 주·키 꺼짐은 404, 발행된 주는 다음 주가 시작돼도 200(아카이브).
const load = cache(async (sido: string, weekKey: string) => {
  await connection();
  return readPublic("주간 핫뉴스", () => getWeeklyPage(sido, weekKey), () => UNAVAILABLE);
});

export async function generateMetadata({ params }: { params: Promise<{ sido: string; weekKey: string }> }): Promise<Metadata> {
  const { sido, weekKey } = await params;
  const view = await load(sido, weekKey);
  if (!view || isUnavailable(view)) return { title: pageTitle("금주 핫뉴스"), robots: { index: false, follow: false } };
  return { title: pageTitle(`${view.sidoName} 금주 핫뉴스 ${view.weekKey}`) };
}

export default async function Page({ params }: { params: Promise<{ sido: string; weekKey: string }> }) {
  const { sido, weekKey } = await params;
  const view = await load(sido, weekKey);
  if (view === null) notFound();
  if (isUnavailable(view)) return <UnavailablePage />;
  return <WeeklyPage view={view} />;
}
