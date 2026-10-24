import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { StoreListPage } from "@/components/site/StoreViews";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getStoreList } from "@/lib/server/public/store";
import { pageTitle } from "@/lib/site/hub-view";

// 스토어 목록 (/store - W8 BIZ-01). 기능 키 store 꺼짐은 404. 공개 조건은 뷰 public_store_products 한 곳. 가격·결제 요소 없음.
export const metadata: Metadata = { title: pageTitle("구독·도서·교육") };

export default async function StorePage() {
  await connection();
  const view = await readPublic("스토어 목록", () => getStoreList(), () => UNAVAILABLE);
  if (isUnavailable(view)) return <UnavailablePage />;
  if (!view.open) notFound();
  return <StoreListPage view={view} />;
}
