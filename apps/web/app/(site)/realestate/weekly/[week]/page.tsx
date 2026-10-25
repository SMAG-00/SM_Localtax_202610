import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { siteUrl } from "@/lib/server/env";
import { RealestateWeeklyView } from "@/components/site/RealestateWeeklyView";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getRealestateWeekly } from "@/lib/server/public/realestate-weekly";
import { weekLabel } from "@/lib/server/public/realestate-weekly-logic";
import { readPublicSettings } from "@/lib/server/public/reads";
import { pageTitle } from "@/lib/site/hub-view";

// 이번 주 재테크 포인트 호별 화면 (PR-15) - 주소 /realestate/weekly/2026-43. 발행된 호만, 없으면 404
export async function generateMetadata({ params }: { params: Promise<{ week: string }> }): Promise<Metadata> {
  const { week } = await params;
  return { title: pageTitle(`이번 주 재테크 포인트 ${weekLabel(week) ?? ""}`.trim()) };
}

export default async function RealestateWeeklyIssuePage({ params }: { params: Promise<{ week: string }> }) {
  await connection();
  const { week } = await params;
  if (weekLabel(week) === null) notFound();
  const data = await readPublic("이번 주 재테크 포인트", async () => ({ issue: await getRealestateWeekly(week), calcOpen: (await readPublicSettings()).features.calc }), () => UNAVAILABLE);
  if (isUnavailable(data) || !data.issue) notFound();
  return (
    <RealestateWeeklyView issue={data.issue} calcOpen={data.calcOpen} site={siteUrl()} />
  );
}
