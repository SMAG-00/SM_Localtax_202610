import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { TotalCostTool } from "@/components/site/realestate/TotalCostTool";
import { CalcUnavailable } from "@/components/site/calc/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getTotalCostPage } from "@/lib/server/public/realestate-tools";
import { pageTitle } from "@/lib/site/hub-view";

// 총비용 시뮬레이터 (/calc/total-cost - RE-05). 기능 키 total_cost·정책 설정·취득 게이트·활성 룰셋이 모두 있어야 열리고 아니면 404. 계산은 브라우저에서만 한다
export const metadata: Metadata = { title: pageTitle("총비용 시뮬레이터"), description: "취득부터 보유 기간까지 지방세와 직접 넣은 가정 비용을 더해 봅니다." };

export default async function Page() {
  await connection();
  const page = await readPublic("총비용 시뮬레이터", () => getTotalCostPage(), () => UNAVAILABLE);
  if (isUnavailable(page)) return <CalcUnavailable />;
  if (page === null) notFound();
  return <TotalCostTool ruleset={page.ruleset} policy={page.policy} open={page.open} sm={page.sm} />;
}
