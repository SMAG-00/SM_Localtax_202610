import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { SeminarDetailPage } from "@/components/site/EducationViews";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getSeminarDetail } from "@/lib/server/public/education";
import { pageTitle } from "@/lib/site/hub-view";

// 세미나 상세 (/edu/seminars/[slug] - W10-g). 연사 이해관계 공개·협찬 표기가 없는 세미나는 공개되지 않는다(DB 제약). Event 구조화 데이터는 화면 배지와 같은 상태 칸에서 나온다.
export const metadata: Metadata = { title: pageTitle("세미나") };

export default async function SeminarPage({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const view = await readPublic("세미나 상세", () => getSeminarDetail(slug), () => UNAVAILABLE);
  if (isUnavailable(view)) return <UnavailablePage />;
  if (!view.open || !view.seminar) notFound();
  return <SeminarDetailPage view={view} />;
}
