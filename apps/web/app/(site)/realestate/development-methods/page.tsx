import type { Metadata } from "next";
import { connection } from "next/server";
import { DevMethodsList } from "@/components/site/DevMethodsView";
import { CategoryRoute, categoryMetadata, type SearchParams } from "@/components/site/routes";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getDevMethodsList } from "@/lib/server/public/dev-methods";
import { DEV_METHODS_TITLE } from "@/lib/server/public/dev-methods-logic";
import { pageTitle } from "@/lib/site/hub-view";

// 개발방법 비교 (/realestate/development-methods — W4 19단계 · PR-09·11). 기능 키 dev_methods가 꺼져 있거나 공개된 방법이 없으면 지금까지처럼 하위 분야 목록(CAT-02).
// 켜지면 비교표(고정 편집 순서 × 비교 항목) — 서명된 값만. 요청 때 그린다(키·서명 변화가 다음 요청부터).
const fallbackMeta = categoryMetadata("realestate");
const fallbackParams = Promise.resolve({ category: "development-methods" });

export async function generateMetadata(props: { searchParams: SearchParams }): Promise<Metadata> {
  await connection();
  const view = await readPublic("개발방법 비교", () => getDevMethodsList(), () => UNAVAILABLE);
  if (view === null || isUnavailable(view)) return fallbackMeta({ ...props, params: fallbackParams });
  return { title: pageTitle(DEV_METHODS_TITLE), description: "개발방법을 같은 비교 항목으로 나란히 보여 드립니다. 추천하거나 판정하지 않습니다." };
}

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const view = await readPublic("개발방법 비교", () => getDevMethodsList(), () => UNAVAILABLE);
  if (view === null || isUnavailable(view)) return <CategoryRoute section="realestate" params={fallbackParams} searchParams={searchParams} />;
  return <DevMethodsList view={view} />;
}
