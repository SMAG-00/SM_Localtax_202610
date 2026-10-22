import type { Metadata } from "next";
import { connection } from "next/server";
import { ProjectList } from "@/components/site/ProjectView";
import { CategoryRoute, categoryMetadata, type SearchParams } from "@/components/site/routes";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { PROJECTS_TITLE, parseProjectFilter } from "@/lib/server/public/project-logic";
import { getProjectList } from "@/lib/server/public/projects";
import { pageTitle } from "@/lib/site/hub-view";

// 프로젝트 트래커 목록 (/realestate/projects — W4 15단계 · PR-01·02). 기능 키 realestate_projects가 꺼져 있으면 지금까지처럼 하위 분야 목록(CAT-02)으로 보인다
// — 트래커를 열기 전에 하위 분야 주소가 깨지지 않게(W3 /tax/amendments와 같은 방식). 거르개 ?region=·?type=·?stage=는 링크(JS 없이), 모양 밖 값은 전체.
// 거른 목록 주소는 검색 노출 제외(빈 목록·같은 내용 색인 0 — CAT-02). 요청 때 그린다(단계 기록이 바뀌면 다음 요청부터).
const fallbackMeta = categoryMetadata("realestate");
const fallbackParams = Promise.resolve({ category: "projects" });

export async function generateMetadata(props: { searchParams: SearchParams }): Promise<Metadata> {
  await connection();
  const filter = parseProjectFilter(await props.searchParams);
  const view = await readPublic("프로젝트 트래커 목록", () => getProjectList(filter), () => UNAVAILABLE);
  if (view === null || isUnavailable(view)) return fallbackMeta({ ...props, params: fallbackParams });
  const filtered = filter.region !== null || filter.type !== null;
  return {
    title: pageTitle(PROJECTS_TITLE),
    description: "지역 개발 프로젝트의 단계를 고시 원문으로 확인합니다.",
    ...(filtered || view.items.length === 0 ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const view = await readPublic("프로젝트 트래커 목록", async () => getProjectList(parseProjectFilter(await searchParams)), () => UNAVAILABLE);
  if (view === null || isUnavailable(view)) return <CategoryRoute section="realestate" params={fallbackParams} searchParams={searchParams} />;
  return <ProjectList view={view} />;
}
