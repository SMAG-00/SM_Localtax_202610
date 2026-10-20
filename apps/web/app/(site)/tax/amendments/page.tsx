import type { Metadata } from "next";
import { connection } from "next/server";
import { AmendmentList } from "@/components/site/AmendmentView";
import { CategoryRoute, categoryMetadata, type SearchParams } from "@/components/site/routes";
import { getAmendmentList, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle } from "@/lib/site/hub-view";

// 개정 트래커 목록 (/tax/amendments — TX-07 · W3 3단계). 기능 키 amendments가 꺼져 있으면 지금까지처럼 하위 분야 목록(CAT-04)으로 보인다
// — 트래커를 열기 전에 하위 분야 주소가 깨지지 않게. 켜지면 트래커 목록. 요청 때 그린다(단계는 날짜로 바뀐다).
const fallbackMeta = categoryMetadata("tax");

export async function generateMetadata(props: { params: Promise<{ category: string }>; searchParams: SearchParams }): Promise<Metadata> {
  await connection();
  const view = await readPublic("개정 트래커 목록", () => getAmendmentList(), () => UNAVAILABLE);
  if (view === null || isUnavailable(view)) return fallbackMeta({ ...props, params: Promise.resolve({ category: "amendments" }) });
  return { title: pageTitle("개정 트래커"), description: "개정안의 진행 단계를 단계별 날짜와 원문으로 확인합니다." };
}

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const view = await readPublic("개정 트래커 목록", () => getAmendmentList(), () => UNAVAILABLE);
  if (view === null || isUnavailable(view)) return <CategoryRoute section="tax" params={Promise.resolve({ category: "amendments" })} searchParams={searchParams} />;
  return <AmendmentList view={view} />;
}
