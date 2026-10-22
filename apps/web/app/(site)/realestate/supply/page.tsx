import type { Metadata } from "next";
import { connection } from "next/server";
import { SupplyList } from "@/components/site/SupplyView";
import { CategoryRoute, categoryMetadata, type SearchParams } from "@/components/site/routes";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getSupplyList } from "@/lib/server/public/supply";
import { SUPPLY_TITLE, parseSupplyFilter } from "@/lib/server/public/supply-logic";
import { pageTitle } from "@/lib/site/hub-view";

// 분양 정보 목록 (/realestate/supply — W4 17단계 · PR-04 · 12장 #11 권고안: 기존 하위 분야 주소를 분양 정보 목록으로). 기능 키 supply_notices가 꺼져 있으면
// 지금까지처럼 하위 분야 목록(CAT-02)으로 보인다 — 분양 광고 표시 기준 법률 검토 기록(12장 #12) 전에는 꺼 둔다(W3 /tax/amendments · 15단계 프로젝트 목록과 같은 방식).
// 켜지면 청약 마감일이 지나지 않은 공개 분양 정보만(마감일 다음 날 00:00 KST부터 빠진다) — 기사 0, '정보 목록' 표시, BreadcrumbList만(NewsArticle 0).
// 거르개 ?region=는 링크(JS 없이), 모양 밖 값은 전체. 거른 목록·빈 목록은 검색 노출 제외(CAT-02). 요청 때 그린다(마감·공개 전환이 다음 요청부터).
const fallbackMeta = categoryMetadata("realestate");
const fallbackParams = Promise.resolve({ category: "supply" });

export async function generateMetadata(props: { searchParams: SearchParams }): Promise<Metadata> {
  await connection();
  const filter = parseSupplyFilter(await props.searchParams);
  const view = await readPublic("분양 정보 목록", () => getSupplyList(filter), () => UNAVAILABLE);
  if (view === null || isUnavailable(view)) return fallbackMeta({ ...props, params: fallbackParams });
  return {
    title: pageTitle(SUPPLY_TITLE),
    description: "청약 마감일이 지나지 않은 분양 공고를 공식 공고 링크와 함께 모았습니다.",
    ...(filter.region !== null || view.items.length === 0 ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const view = await readPublic("분양 정보 목록", async () => getSupplyList(parseSupplyFilter(await searchParams)), () => UNAVAILABLE);
  if (view === null || isUnavailable(view)) return <CategoryRoute section="realestate" params={fallbackParams} searchParams={searchParams} />;
  return <SupplyList view={view} />;
}
