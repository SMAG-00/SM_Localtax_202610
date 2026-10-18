import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { PartnerView } from "@/components/site/MediaListViews";
import type { SearchParams } from "@/components/site/routes";
import { UnavailablePage } from "@/components/site/Unavailable";
import { getPartnerPage, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { parsePartnerId } from "@/lib/server/public/media-logic";
import { pageTitle, parsePage } from "@/lib/site/hub-view";
import { UNAVAILABLE_TITLE } from "@/lib/site/public-gate";

// 제휴사 프로필 (/partners/[id] — ART-10 · PRD-01A 3장 '제휴사 소개 · 제휴 배지 · 공동 기획 기사 카드 목록').
// 공개 제휴사(visible)만 — 없는·비공개 제휴사·번호 모양이 아닌 주소는 404. 계약이 끝난 제휴사도 공개로 두면 프로필과 기존 기사(배지 그대로)가 보인다
// (계약 기간은 비공개 칸 — W2-c 설계 9장). 목록 끝을 넘긴 쪽도 404. 공개 데이터를 읽지 못하면 proxy가 503을 먼저 보낸다
const load = cache(async (rawId: string, page: number) => {
  await connection();
  const id = parsePartnerId(rawId);
  if (id === null) notFound();
  const data = await readPublic("제휴사", () => getPartnerPage(id, { page }), () => UNAVAILABLE);
  if (!isUnavailable(data) && data && page > 1 && data.items.length === 0) notFound();
  return data;
});

type Props = { params: Promise<{ id: string }>; searchParams: SearchParams };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const data = await load((await params).id, parsePage((await searchParams).page));
  if (isUnavailable(data)) return { title: pageTitle(UNAVAILABLE_TITLE), robots: { index: false, follow: false } };
  if (!data) notFound();
  return { title: pageTitle(data.partner.name), ...(data.partner.intro ? { description: data.partner.intro } : {}) };
}

export default async function PartnerPageRoute({ params, searchParams }: Props) {
  const data = await load((await params).id, parsePage((await searchParams).page));
  if (isUnavailable(data)) return <UnavailablePage />;
  if (!data) notFound();
  return <PartnerView data={data} />;
}
