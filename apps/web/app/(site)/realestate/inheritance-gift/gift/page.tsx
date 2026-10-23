import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { InheritanceGiftView } from "@/components/site/InheritanceGiftView";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getInheritanceGift } from "@/lib/server/public/inheritance-gift";
import { pageTitle } from "@/lib/site/hub-view";
import { UNAVAILABLE_TITLE } from "@/lib/site/public-gate";

// 상속·증여 안내 하위 경로 (W4 23단계 · FAM-01 — 본 경로와 같은 규칙). 기능 키가 꺼지면 404
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const view = await readPublic("상속·증여 안내", () => getInheritanceGift("gift"), () => UNAVAILABLE);
  if (view === null) return { robots: { index: false, follow: false } };
  if (isUnavailable(view)) return { title: pageTitle(UNAVAILABLE_TITLE), robots: { index: false, follow: false } };
  return { title: pageTitle(view.title) };
}

export default async function Page() {
  await connection();
  const view = await readPublic("상속·증여 안내", () => getInheritanceGift("gift"), () => UNAVAILABLE);
  if (view === null) notFound();
  if (isUnavailable(view)) return <UnavailablePage />;
  return <InheritanceGiftView view={view} />;
}
