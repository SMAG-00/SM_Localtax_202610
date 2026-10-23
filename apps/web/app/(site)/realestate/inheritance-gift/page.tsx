import type { Metadata } from "next";
import { connection } from "next/server";
import { InheritanceGiftView } from "@/components/site/InheritanceGiftView";
import { CategoryRoute, categoryMetadata, type SearchParams } from "@/components/site/routes";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getInheritanceGift } from "@/lib/server/public/inheritance-gift";
import { pageTitle } from "@/lib/site/hub-view";

// 상속·증여 안내 (W4 23단계 · FAM-01). 기능 키 inheritance_gift가 꺼져 있으면 지금까지처럼 하위 분야 목록. 요청 때 그린다
const fallbackMeta = categoryMetadata("realestate");
const fallbackParams = Promise.resolve({ category: "inheritance-gift" });

export async function generateMetadata(props: { searchParams: SearchParams }): Promise<Metadata> {
  await connection();
  const view = await readPublic("상속·증여 안내", () => getInheritanceGift("inheritance-gift"), () => UNAVAILABLE);
  if (view === null || isUnavailable(view)) return fallbackMeta({ ...props, params: fallbackParams });
  return { title: pageTitle(view.title) };
}

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const view = await readPublic("상속·증여 안내", () => getInheritanceGift("inheritance-gift"), () => UNAVAILABLE);
  if (view === null || isUnavailable(view)) return <CategoryRoute section="realestate" params={fallbackParams} searchParams={searchParams} />;
  return <InheritanceGiftView view={view} />;
}
