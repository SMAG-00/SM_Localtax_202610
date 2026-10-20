import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { AmendmentDetail } from "@/components/site/AmendmentView";
import { getAmendment, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle } from "@/lib/site/hub-view";

// 개정 트래커 상세 (/tax/amendments/[slug] — TX-07·08 · W3 3단계). 기능 키 amendments가 꺼져 있거나 공개 전·없는 개정안이면 404.
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const load = cache(async (slug: string) => {
  await connection();
  if (!SLUG.test(slug)) return null;
  return readPublic("개정 트래커 상세", () => getAmendment(slug), () => UNAVAILABLE);
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const view = await load((await params).slug);
  return view && !isUnavailable(view) ? { title: pageTitle(view.item.title) } : { title: pageTitle("개정 트래커") };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const view = await load((await params).slug);
  if (view === null || isUnavailable(view)) notFound();
  return <AmendmentDetail view={view} />;
}
