import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ReportDetailPage } from "@/components/site/ReportViews";
import { resolveReport } from "@/lib/server/org/reports";
import { pageTitle } from "@/lib/site/hub-view";

// 프리미엄 리포트 상세 (/finance/reports/[slug] - W11-f BIZ-07). 요청마다 그린다(공유 캐시 0 - 좌석 회원 다음 요청이 비좌석이어도 본문이 남지 않는다).
// 본문은 서버가 리포트 권한을 판정한 요청에만 들어간다. 제목·메타에는 미리보기·본문 글자를 넣지 않는다.
export const metadata: Metadata = { title: pageTitle("프리미엄 리포트"), robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ReportRoute({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const state = await resolveReport(slug);
  if (!state) notFound();
  return <ReportDetailPage state={state} />;
}
