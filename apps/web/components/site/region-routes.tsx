import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { getRegionPage, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { SECTION_INFO } from "@/lib/server/public/constants";
import { listRobots, pageTitle, queryValue } from "@/lib/site/hub-view";
import { UNAVAILABLE_TITLE } from "@/lib/site/public-gate";
import { RegionView } from "./RegionView";
import { UnavailablePage } from "./Unavailable";

// 지역 화면 경로 처리 (/local/[sido] · /local/[sido]/[sigungu] — W4 3단계) — 경로 파일은 slug만 넘긴다. 요청 때 그린다(빌드 때 DB를 읽지 않는다).
// 기능 키 region_hubs 꺼짐·없는 지역·예약 이름·다른 시·도 아래 slug·폐지 지역은 404 (옛 주소 301·읽지 못함 503은 proxy.ts가 먼저 정한다).
// 확인 뒤 읽기에 실패하면 상세 화면과 같은 안내(UnavailablePage). 제목·noindex와 본문이 같은 요청 안에서 한 번만 읽는다(React cache)
// 분야 필터는 주소 쿼리 topic (W4 4단계 — 목록 밖 값은 전체, 옛 주소 301은 쿼리를 그대로 넘긴다)

export type RegionParams = Promise<{ sido: string; sigungu?: string }>;
export type RegionSearchParams = Promise<Record<string, string | string[] | undefined>>;

const loadRegion = cache(async (sido: string, sigungu: string | null, topic: string | null) => {
  await connection();
  const page = await readPublic("지역 화면", () => getRegionPage(sido, sigungu, { topic }), () => UNAVAILABLE);
  if (!page) notFound();
  return page;
});

const topicOf = async (searchParams: RegionSearchParams | undefined) => (searchParams ? (queryValue((await searchParams).topic) ?? null) : null);

export async function regionMetadata({ params, searchParams }: { params: RegionParams; searchParams?: RegionSearchParams }): Promise<Metadata> {
  const { sido, sigungu } = await params;
  const page = await loadRegion(sido, sigungu ?? null, await topicOf(searchParams));
  if (isUnavailable(page)) return { title: pageTitle(UNAVAILABLE_TITLE), robots: { index: false, follow: false } };
  const robots = listRobots(page.noindex);
  return { title: pageTitle(`${page.fullName} · ${SECTION_INFO.local.name}`), ...(robots ? { robots } : {}) };
}

export async function RegionRoute({ params, searchParams }: { params: RegionParams; searchParams?: RegionSearchParams }) {
  const { sido, sigungu } = await params;
  const page = await loadRegion(sido, sigungu ?? null, await topicOf(searchParams));
  if (isUnavailable(page)) return <UnavailablePage />;
  return <RegionView page={page} />;
}
