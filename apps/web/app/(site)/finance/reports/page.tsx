import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ReportListPage } from "@/components/site/ReportViews";
import { UnavailablePage } from "@/components/site/Unavailable";
import { listReportPreviews } from "@/lib/server/org/reports";
import { pageTitle } from "@/lib/site/hub-view";

// 프리미엄 리포트 목록 (/finance/reports - W11-f BIZ-07). 요청마다 그린다. 기능 키 꺼짐·정책 길이 없음·발행된 리포트 없음은 404.
// 목록에는 미리보기까지만 나가고, 검색 색인(noindex)·사이트맵·RSS에는 넣지 않는다.
export const metadata: Metadata = { title: pageTitle("프리미엄 리포트"), robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ReportsRoute() {
  await connection();
  const items = await listReportPreviews();
  if (items === null) return <UnavailablePage />;
  if (items.length === 0) notFound();
  return <ReportListPage items={items} />;
}
