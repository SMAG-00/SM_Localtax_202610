import type { Metadata } from "next";
import { connection } from "next/server";
import { InterpretationList } from "@/components/site/InterpretationView";
import { CategoryRoute, categoryMetadata, type SearchParams } from "@/components/site/routes";
import { getInterpretationList, isUnavailable, parseInterpretationFilter, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle } from "@/lib/site/hub-view";

// 해석 해설 목록 (/tax/interpretations — TX-09 · W3 5단계). 기능 키 interpretations가 꺼져 있으면 지금까지처럼 하위 분야 목록(CAT-04)으로 보인다.
// 필터는 URL 쿼리(type·tax·provision) — GET 폼이라 JS가 꺼져도 동작한다.
const fallbackMeta = categoryMetadata("tax");

export async function generateMetadata(props: { params: Promise<{ category: string }>; searchParams: SearchParams }): Promise<Metadata> {
  await connection();
  const view = await readPublic("해석 해설 목록", async () => getInterpretationList(parseInterpretationFilter(await props.searchParams)), () => UNAVAILABLE);
  if (view === null || isUnavailable(view)) return fallbackMeta({ ...props, params: Promise.resolve({ category: "interpretations" }) });
  return { title: pageTitle("해석 해설"), description: "예규·유권해석·심판·판례 원문과 세무 감수를 거친 해설을 찾아봅니다." };
}

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const view = await readPublic("해석 해설 목록", async () => getInterpretationList(parseInterpretationFilter(await searchParams)), () => UNAVAILABLE);
  if (view === null || isUnavailable(view)) return <CategoryRoute section="tax" params={Promise.resolve({ category: "interpretations" })} searchParams={searchParams} />;
  return <InterpretationList view={view} />;
}
