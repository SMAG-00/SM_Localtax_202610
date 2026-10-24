import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { StoreDetailPage } from "@/components/site/StoreViews";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getStoreProduct } from "@/lib/server/public/store";
import { pageTitle, queryValue } from "@/lib/site/hub-view";
import { UNAVAILABLE_TITLE } from "@/lib/site/public-gate";
import type { SearchParams } from "@/components/site/routes";

// 상품 상세 (/store/[slug] - W8 BIZ-01·02). 공개 중인 상품만 - 초안·중지·없는 주소·기능 키 꺼짐은 404. ?from= 은 누른 출발 위치(기사 a12 · 홈 h)로 주문 링크 측정에만 쓴다.
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const load = cache(async (slug: string, from: string | null) => {
  await connection();
  if (!SLUG.test(slug)) notFound();
  return readPublic("스토어 상품", () => getStoreProduct(slug, from), () => UNAVAILABLE);
});

type Props = { params: Promise<{ slug: string }>; searchParams: SearchParams };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const view = await load((await params).slug, queryValue((await searchParams).from) ?? null);
  if (isUnavailable(view)) return { title: pageTitle(UNAVAILABLE_TITLE), robots: { index: false, follow: false } };
  if (!view.open || !view.product) notFound();
  return { title: pageTitle(view.product.title) };
}

export default async function StoreProductRoute({ params, searchParams }: Props) {
  const view = await load((await params).slug, queryValue((await searchParams).from) ?? null);
  if (isUnavailable(view)) return <UnavailablePage />;
  if (!view.open || !view.product) notFound();
  return <StoreDetailPage view={view} />;
}
