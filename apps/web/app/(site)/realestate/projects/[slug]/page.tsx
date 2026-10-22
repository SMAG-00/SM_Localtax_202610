import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { ProjectDetail } from "@/components/site/ProjectView";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { PROJECTS_TITLE, PROJECT_PUBLIC_LIMITS, PROJECT_SLUG_RE } from "@/lib/server/public/project-logic";
import { getProject } from "@/lib/server/public/projects";
import { pageTitle } from "@/lib/site/hub-view";

// 프로젝트 트래커 상세 (/realestate/projects/[slug] — W4 15단계 · PR-02·03·05). 기능 키 realestate_projects가 꺼져 있거나 공개 전·없는 프로젝트·모양 밖 주소면 404.
// 메타 설명은 편집자가 쓴 요약만(없으면 내지 않는다 — 템플릿 문장 0). 가격 값 0(PR-05 — 공개 뷰에 칸이 없다).
const load = cache(async (slug: string) => {
  await connection();
  if (slug.length > PROJECT_PUBLIC_LIMITS.slugChars || !PROJECT_SLUG_RE.test(slug)) return null;
  return readPublic("프로젝트 트래커 상세", () => getProject(slug), () => UNAVAILABLE);
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const view = await load((await params).slug);
  if (!view || isUnavailable(view)) return { title: pageTitle(PROJECTS_TITLE) };
  return { title: pageTitle(view.card.name), ...(view.card.summary ? { description: view.card.summary } : {}) };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const view = await load((await params).slug);
  if (view === null || isUnavailable(view)) notFound();
  return <ProjectDetail view={view} />;
}
