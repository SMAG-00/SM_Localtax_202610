import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { TaxLifecycleView } from "@/components/site/realestate/TaxLifecycleView";
import { CalcUnavailable } from "@/components/site/calc/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getLifecyclePage } from "@/lib/server/public/realestate-tools";
import { pageTitle } from "@/lib/site/hub-view";

// 부동산 세금 전 주기 (/realestate/tax - RE-01·RE-02). 기능 키 tax_lifecycle이 꺼져 있거나 공개된(서명된) 가이드가 없으면 404. 요청 때 그린다
export const metadata: Metadata = { title: pageTitle("부동산 세금 전 주기"), description: "취득·보유·양도 단계별 세금 해설" };

export default async function Page() {
  await connection();
  const page = await readPublic("세금 전 주기", () => getLifecyclePage(), () => UNAVAILABLE);
  if (isUnavailable(page)) return <CalcUnavailable />;
  if (page === null) notFound();
  return <TaxLifecycleView title={page.title} view={page.view} lastReviewedAt={page.lastReviewedAt} asOf={page.asOf} sm={page.sm} />;
}
