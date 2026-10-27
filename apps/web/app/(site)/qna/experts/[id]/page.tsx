import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { QnaExpertPageView } from "@/components/site/QnaViews";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getQnaExpert } from "@/lib/server/public/qna";
import { pageTitle } from "@/lib/site/hub-view";

// 라운지 전문가 프로필 (/qna/experts/[id] - W13-g QNA-04). 유효한 SM 전문가 연결 + 제재 없음일 때만. 연락처·사무소 0, 1단계 프로필 링크만.
export const metadata: Metadata = { title: pageTitle("라운지 전문가"), robots: { index: false, follow: true } };

export default async function QnaExpertPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const raw = (await params).id;
  if (!/^[1-9]\d{0,15}$/.test(raw)) notFound();
  const view = await readPublic("라운지 전문가", () => getQnaExpert(Number(raw)), () => UNAVAILABLE);
  if (isUnavailable(view)) return <UnavailablePage />;
  if (!view.open || !view.expert) notFound();
  return <QnaExpertPageView view={view} />;
}
