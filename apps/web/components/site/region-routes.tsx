import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { getRegionPage, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { siteIndexing, siteUrl } from "@/lib/server/env";
import { LOCAL_TOPICS, SECTION_INFO } from "@/lib/server/public/constants";
import { regionRobots, regionTitle } from "@/lib/server/public/region-index-logic";
import { pageTitle, queryValue } from "@/lib/site/hub-view";
import { UNAVAILABLE_TITLE } from "@/lib/site/public-gate";
import { RegionView } from "./RegionView";
import { UnavailablePage } from "./Unavailable";

// 지역 화면 경로 처리 (/local/[sido] · /local/[sido]/[sigungu] — W4 3단계) — 경로 파일은 slug만 넘긴다. 요청 때 그린다(빌드 때 DB를 읽지 않는다).
// 기능 키 region_hubs 꺼짐·없는 지역·예약 이름·다른 시·도 아래 slug·폐지 지역은 404 (옛 주소 301·읽지 못함 503은 proxy.ts가 먼저 정한다).
// 확인 뒤 읽기에 실패하면 상세 화면과 같은 안내(UnavailablePage). 제목·noindex와 본문이 같은 요청 안에서 한 번만 읽는다(React cache)
// 분야 필터는 주소 쿼리 topic (W4 4단계 — 목록 밖 값은 전체, 옛 주소 301은 쿼리를 그대로 넘긴다)
// W4 11단계 — robots: 검색 노출 제외 사유(빈 지역·고른 분야 0건·최소선 미달)가 있으면 noindex, 없고 SITE_INDEXING=on이면 index, 아니면 루트 그대로(운영 전환 전 noindex).
//   제목에 고른 분야 글자, 메타 설명 = 그 지역 최신 자체 취재 기사 제목 2건(없으면 내지 않는다), canonical = 그 지역 허브 주소(쿼리 없음 — 사이트 주소가 있을 때만)

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
  const robots = regionRobots(page.noindexReason, siteIndexing());
  const topicLabel = page.topic ? (LOCAL_TOPICS.find((t) => t.topic === page.topic)?.label ?? null) : null;
  const site = siteUrl();
  return {
    title: pageTitle(regionTitle(page.fullName, SECTION_INFO.local.name, topicLabel)),
    ...(page.description ? { description: page.description } : {}),
    ...(site ? { alternates: { canonical: `${site}${page.href}` } } : {}),
    ...(robots ? { robots } : {}),
  };
}

export async function RegionRoute({ params, searchParams }: { params: RegionParams; searchParams?: RegionSearchParams }) {
  const { sido, sigungu } = await params;
  const page = await loadRegion(sido, sigungu ?? null, await topicOf(searchParams));
  if (isUnavailable(page)) return <UnavailablePage />;
  return <RegionView page={page} />;
}
