import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { ExpertProfilePageView } from "@/components/site/ExpertViews";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getExpertProfile } from "@/lib/server/public/experts";
import { pageTitle } from "@/lib/site/hub-view";
import { UNAVAILABLE_TITLE } from "@/lib/site/public-gate";

// SM 전문가 프로필 (/experts/profile/[slug] - W7c EXPL-02·05·07·12). 공개 중인 프로필만 - 초안·내림·철회·없는 주소·기능 키 꺼짐은 404.
// 공개 데이터를 읽지 못하면 503 화면 (있는지 모르므로 404 0)
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const load = cache(async (slug: string) => {
  await connection();
  if (!SLUG.test(slug)) notFound();
  return readPublic("전문가 프로필", () => getExpertProfile(slug), () => UNAVAILABLE);
});

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const view = await load((await params).slug);
  if (isUnavailable(view)) return { title: pageTitle(UNAVAILABLE_TITLE), robots: { index: false, follow: false } };
  if (!view.open || !view.profile) notFound();
  return { title: pageTitle(`${view.profile.name} - SM 전문가`) };
}

export default async function ExpertProfileRoute({ params }: Props) {
  const view = await load((await params).slug);
  if (isUnavailable(view)) return <UnavailablePage />;
  if (!view.open || !view.profile) notFound();
  return <ExpertProfilePageView view={view} />;
}
