import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { EventDetailPage } from "@/components/site/LocalNewsViews";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getEventDetail } from "@/lib/server/public/local-news";
import { pageTitle } from "@/lib/site/hub-view";

// 행사 상세 (/local/events/[slug] - W6 LG-09 · LG-12 · LG-14 · LG-16). 끝난 회차도 200. 키 꺼짐·비공개·없는 주소는 404.
// 축제 상세도 여기 있다 - 목록·달력에는 없고 지역 허브 행사안내 블록에서만 연결된다 (LG-10).
const load = cache(async (slug: string) => {
  await connection();
  return readPublic("행사 상세", () => getEventDetail(slug), () => UNAVAILABLE);
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const view = await load((await params).slug);
  if (!view || isUnavailable(view)) return { title: pageTitle("행사안내"), robots: { index: false, follow: false } };
  return { title: pageTitle(`${view.card.title} - 행사안내`) };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const view = await load((await params).slug);
  if (view === null) notFound();
  if (isUnavailable(view)) return <UnavailablePage />;
  return <EventDetailPage view={view} />;
}
