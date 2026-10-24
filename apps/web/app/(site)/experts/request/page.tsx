import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ExpertRequestPageView } from "@/components/site/ExpertViews";
import type { SearchParams } from "@/components/site/routes";
import { UnavailablePage } from "@/components/site/Unavailable";
import { REQUEST_SOURCES } from "@/lib/experts/logic";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getExpertRequestForm } from "@/lib/server/public/experts";
import { pageTitle, queryValue } from "@/lib/site/hub-view";

// SM 전문가 연락 요청 양식 (/experts/request - W7c EXPL-13). 기능 키 expert_requests 꺼짐은 404(빈 링크 0). 개인 정보가 들어가는 화면이라 색인하지 않는다.
// 진입 출처는 ?source=(assistant·experts·article) - 모르는 값은 experts
export const metadata: Metadata = { title: pageTitle("SM 전문가 연락 요청"), robots: { index: false, follow: false } };

export default async function ExpertRequestPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const view = await readPublic("전문가 연락 요청 양식", () => getExpertRequestForm(), () => UNAVAILABLE);
  if (isUnavailable(view)) return <UnavailablePage />;
  if (!view.open) notFound();
  const source = queryValue(sp.source) ?? "";
  return (
    <ExpertRequestPageView
      view={view}
      source={(REQUEST_SOURCES as readonly string[]).includes(source) ? source : "experts"}
      query={{ sent: queryValue(sp.sent), e: queryValue(sp.e), field: queryValue(sp.field), withdrawn: queryValue(sp.withdrawn) }}
    />
  );
}
