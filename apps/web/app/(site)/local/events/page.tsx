import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EventsListView } from "@/components/site/LocalNewsViews";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getEventList } from "@/lib/server/public/local-news";
import { pageTitle, queryValue } from "@/lib/site/hub-view";

// 행사 목록·달력 (/local/events - W6 LG-09 · REG-04). 기능 키 local_events 꺼짐은 404. 축제는 이 화면에 없다 (LG-10).
export const metadata: Metadata = { title: pageTitle("행사안내") };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const view = await readPublic("행사 목록", () => getEventList({ region: queryValue(sp.region) ?? null, month: queryValue(sp.month) ?? null }), () => UNAVAILABLE);
  if (isUnavailable(view)) return <UnavailablePage />;
  if (!view.open) notFound();
  return <EventsListView view={view} />;
}
