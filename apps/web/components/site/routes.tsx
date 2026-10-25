import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { COLUMN_SLUG, closedHubData, getCategoryList, getColumnList, getHeroMedia, getHubData, isUnavailable, readPublic, UNAVAILABLE, type HubData } from "@/lib/server/public";
import type { SectionKey } from "@/lib/server/public/constants";
import { SECTION_INFO } from "@/lib/server/public/constants";
import { listRobots, pageTitle, parsePage, queryValue } from "@/lib/site/hub-view";
import { CategoryView } from "./CategoryView";
import { ColumnView } from "./ColumnView";
import { HubView } from "./HubView";
import { ClosedListView } from "./ClosedListView";

// 허브 4곳(/tax · /realestate · /finance · /local)과 하위 분야 목록(/tax/[category] 등)·칼럼 목록(/tax/columns · /finance/columns)의
// 공용 경로 처리 — 경로 파일은 분야 값만 넘긴다. 요청 때 그린다(빌드 때 DB를 읽지 않는다).
// 화면 제목·noindex(generateMetadata)와 본문이 같은 요청 안에서 한 번만 읽는다(React cache).
// 공개 데이터를 읽지 못하면 닫힌 목록(머리 + 안내 한 줄, 200 — lib/server/public/fallback.ts 한 곳)

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** 허브 데이터 — 공개 데이터를 읽지 못하면 닫힌 허브(머리만, 200) */
const loadHub = cache(async (section: SectionKey, topic: string | null): Promise<HubData> => {
  await connection();
  return readPublic(`${SECTION_INFO[section].name} 허브`, () => getHubData(section, { topic }), () => closedHubData(section));
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
  return <HubView hub={hub} heroMedia={await getHeroMedia(section)} />;
}

type CategoryParams = Promise<{ category: string }>;

/** 하위 분야 목록 — 없는(또는 비공개) 하위 분야는 404, 기사 0건은 200 + 상위 허브 안내 + noindex, 목록 끝을 넘긴 쪽은 404. 칼럼(columns)은 칼럼 목록 */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const loadCategory = cache(async (section: SectionKey, slug: string, page: number) => {
  await connection();
  // 하위 분야 주소 형식(영문 소문자·숫자·'-' — DB categories_slug_check) 밖은 찾아보지 않고 404
  if (!SLUG.test(slug)) notFound();
  if (slug === COLUMN_SLUG) {
    const columns = await readPublic(`${SECTION_INFO[section].name} 칼럼 목록`, () => getColumnList(section), () => UNAVAILABLE);
    if (isUnavailable(columns)) return { kind: "closed" as const };
    if (!columns) notFound();
    if (page > 1) notFound(); // 칼럼 목록은 한 쪽 (연재 묶음을 쪽으로 나누지 않는다)
    return { kind: "columns" as const, columns };
  }
  const list = await readPublic(`${SECTION_INFO[section].name} 하위 분야 목록`, () => getCategoryList(section, slug, page), () => UNAVAILABLE);
  if (isUnavailable(list)) return { kind: "closed" as const };
  if (!list || (page > 1 && list.items.length === 0)) notFound();
  return { kind: "list" as const, list };
});

export function categoryMetadata(section: SectionKey) {
  return async ({ params, searchParams }: { params: CategoryParams; searchParams: SearchParams }): Promise<Metadata> => {
    const r = await loadCategory(section, (await params).category, parsePage((await searchParams).page));
    const hub = SECTION_INFO[section].name;
    if (r.kind === "closed") return { title: pageTitle(hub), robots: { index: false, follow: false } };
    const data = r.kind === "columns" ? r.columns : r.list;
    const robots = listRobots(data.noindex);
    return { title: pageTitle(`${data.category.name} · ${data.hub.name}`), ...(robots ? { robots } : {}) };
  };
}

export async function CategoryRoute({ section, params, searchParams }: { section: SectionKey; params: CategoryParams; searchParams: SearchParams }) {
  const r = await loadCategory(section, (await params).category, parsePage((await searchParams).page));
  if (r.kind === "closed") return <ClosedListView section={section} />;
  return r.kind === "columns" ? <ColumnView list={r.columns} /> : <CategoryView list={r.list} />;
}
