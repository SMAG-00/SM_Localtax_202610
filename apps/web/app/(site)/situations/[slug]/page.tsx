import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { SituationView } from "@/components/site/SituationView";
import type { SearchParams } from "@/components/site/routes";
import { UnavailablePage } from "@/components/site/Unavailable";
import { getSituationPage, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle, queryValue } from "@/lib/site/hub-view";
import { UNAVAILABLE_TITLE } from "@/lib/site/public-gate";

// 상황 페이지 (/situations/[slug] — UX-05 · FAM-02 · CAT-03). 공개(감수 끝)된 상황만 — 숨긴·감수 전·없는 상황은 404.
// 지역 선택은 이 상황만(?region=<법정동코드>). 요청 때 그린다 — 편집국이 고치면 바로 반영된다(캐시 만료, 설계 7.1).
// 공개 데이터를 읽지 못하면 proxy가 503을 먼저 보낸다(있는지 모르므로 404 0) — 확인 뒤 실패하면 같은 안내를 이 화면이 그린다
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const load = cache(async (slug: string, region: string | null) => {
  await connection();
  if (!SLUG.test(slug)) notFound();
  const page = await readPublic("상황 페이지", () => getSituationPage(slug, { region }), () => UNAVAILABLE);
  if (!page) notFound();
  return page;
});

type Props = { params: Promise<{ slug: string }>; searchParams: SearchParams };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const page = await load((await params).slug, queryValue((await searchParams).region) ?? null);
  if (isUnavailable(page)) return { title: pageTitle(UNAVAILABLE_TITLE), robots: { index: false, follow: false } };
  return { title: pageTitle(page.card.title), ...(page.card.subtitle ? { description: page.card.subtitle } : {}) };
}

export default async function SituationPage({ params, searchParams }: Props) {
  const page = await load((await params).slug, queryValue((await searchParams).region) ?? null);
  if (isUnavailable(page)) return <UnavailablePage />;
  return <SituationView page={page} />;
}
