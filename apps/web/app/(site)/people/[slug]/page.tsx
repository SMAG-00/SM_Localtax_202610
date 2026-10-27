import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { AuthorLibrary } from "@/components/site/LibraryViews";
import { PersonView } from "@/components/site/PersonView";
import type { SearchParams } from "@/components/site/routes";
import { UnavailablePage } from "@/components/site/Unavailable";
import { getAuthorItems } from "@/lib/server/library/read";
import { getPersonPage, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle, parsePage } from "@/lib/site/hub-view";
import { UNAVAILABLE_TITLE } from "@/lib/site/public-gate";

// 인물 (기자·필자 /people/[slug] — ART-04 · NAV-03). 공개 인물만 — 비공개·없는 인물은 404. 목록 끝을 넘긴 쪽도 404.
// 공개 데이터를 읽지 못하면 proxy가 503을 먼저 보낸다(있는지 모르므로 404 0)
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const load = cache(async (slug: string, page: number) => {
  await connection();
  if (!SLUG.test(slug)) notFound();
  const person = await readPublic("인물", () => getPersonPage(slug, page), () => UNAVAILABLE);
  if (!isUnavailable(person) && person && page > 1 && person.articles.length === 0) notFound();
  return person;
});

type Props = { params: Promise<{ slug: string }>; searchParams: SearchParams };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const person = await load((await params).slug, parsePage((await searchParams).page));
  if (isUnavailable(person)) return { title: pageTitle(UNAVAILABLE_TITLE), robots: { index: false, follow: false } };
  if (!person) notFound();
  return { title: pageTitle(person.name), ...(person.beat ? { description: `${person.name} — 담당 분야 ${person.beat}` } : {}) };
}

export default async function PersonPageRoute({ params, searchParams }: Props) {
  const person = await load((await params).slug, parsePage((await searchParams).page));
  if (isUnavailable(person)) return <UnavailablePage />;
  if (!person) notFound();
  const libraryItems = await getAuthorItems(person.slug); // 지식창고 항목 - 공개 뷰(권리·기능 키 통과분)만, 비면 아무것도 그리지 않는다
  return (
    <>
      <PersonView person={person} />
      <AuthorLibrary items={libraryItems} />
    </>
  );
}
