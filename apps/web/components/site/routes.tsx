import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { PublicDataError, closedHubData, getCategoryList, getHubData, type HubData } from "@/lib/server/public";
import type { SectionKey } from "@/lib/server/public/constants";
import { listRobots, pageTitle, parsePage, queryValue } from "@/lib/site/hub-view";
import { CategoryView } from "./CategoryView";
import { HubView } from "./HubView";

// 허브 4곳(/tax · /realestate · /finance · /local)과 하위 분야 목록(/tax/[category] 등)의 공용 경로 처리 — 경로 파일은 분야 값만 넘긴다.
// 요청 때 그린다(빌드 때 DB를 읽지 않는다). 화면 제목·noindex(generateMetadata)와 본문이 같은 요청 안에서 한 번만 읽는다(React cache).

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** 허브 데이터 — 공개 데이터를 읽지 못하면 닫힌 허브(머리만, 200 — 원인은 서버 로그 [public]) */
const loadHub = cache(async (section: SectionKey, topic: string | null): Promise<HubData> => {
  await connection();
  try {
    return await getHubData(section, { topic });
  } catch (err) {
    if (!(err instanceof PublicDataError)) throw err;
    console.error("[public] 허브를 읽지 못해 닫힌 허브를 보입니다:", err.context);
    return closedHubData(section);
  }
});

export function hubMetadata(section: SectionKey) {
  return async ({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> => {
    const hub = await loadHub(section, queryValue((await searchParams).topic) ?? null);
    const robots = listRobots(hub.noindex);
    return { title: pageTitle(hub.name), ...(robots ? { robots } : {}) };
  };
}

export async function HubRoute({ section, searchParams }: { section: SectionKey; searchParams: SearchParams }) {
  const hub = await loadHub(section, queryValue((await searchParams).topic) ?? null);
  return <HubView hub={hub} />;
}

type CategoryParams = Promise<{ category: string }>;

/** 하위 분야 목록 — 없는(또는 비공개) 하위 분야는 404, 기사 0건은 200 + 상위 허브 안내 + noindex, 목록 끝을 넘긴 쪽은 404 */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const loadCategory = cache(async (section: SectionKey, slug: string, page: number) => {
  await connection();
  // 하위 분야 주소 형식(영문 소문자·숫자·'-' — DB categories_slug_check) 밖은 찾아보지 않고 404
  if (!SLUG.test(slug)) notFound();
  const list = await getCategoryList(section, slug, page);
  if (!list || (page > 1 && list.items.length === 0)) notFound();
  return list;
});

export function categoryMetadata(section: SectionKey) {
  return async ({ params, searchParams }: { params: CategoryParams; searchParams: SearchParams }): Promise<Metadata> => {
    const list = await loadCategory(section, (await params).category, parsePage((await searchParams).page));
    const robots = listRobots(list.noindex);
    return { title: pageTitle(`${list.category.name} · ${list.hub.name}`), ...(robots ? { robots } : {}) };
  };
}

export async function CategoryRoute({ section, params, searchParams }: { section: SectionKey; params: CategoryParams; searchParams: SearchParams }) {
  const list = await loadCategory(section, (await params).category, parsePage((await searchParams).page));
  return <CategoryView list={list} />;
}
