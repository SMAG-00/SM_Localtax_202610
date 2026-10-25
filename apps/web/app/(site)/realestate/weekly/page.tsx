import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { siteUrl } from "@/lib/server/env";
import { ComingSoon } from "@/components/site/ComingSoon";
import { RealestateWeeklyView } from "@/components/site/RealestateWeeklyView";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getRealestateWeekly } from "@/lib/server/public/realestate-weekly";
import { readPublicSettings } from "@/lib/server/public/reads";
import { pageTitle } from "@/lib/site/hub-view";

// 금주 부동산 재테크 최신 호 (PR-15). 기능 키 realestate_weekly가 꺼지거나 발행된 호가 없으면 404 (공개 뷰가 0행). 요청 때 그린다.
export const metadata: Metadata = {
  title: pageTitle("금주 부동산 재테크"),
  description: "이번 주 부동산재테크 기사와 세금 관점의 한 줄입니다. 투자 권유가 아닙니다.",
};

export default async function RealestateWeeklyPage() {
  await connection();
  const data = await readPublic("금주 부동산 재테크", async () => {
    const features = (await readPublicSettings()).features;
    return { issue: await getRealestateWeekly(), calcOpen: features.calc, menu: features.shortcuts };
  }, () => UNAVAILABLE);
  if (isUnavailable(data)) notFound();
  // 바로가기(메뉴)가 켜져 있으면 발행된 호가 없어도 404 대신 준비 중 안내 (PO 2026-10-26)
  if (!data.issue) {
    if (!data.menu) notFound();
    return <ComingSoon title="금주 부동산 재테크" notice="금주 부동산 재테크를 준비하고 있습니다." links={[{ href: "/realestate", label: "부동산재테크 보기" }]} />;
  }
  return (
    <RealestateWeeklyView issue={data.issue} calcOpen={data.calcOpen} site={siteUrl()} />
  );
}
