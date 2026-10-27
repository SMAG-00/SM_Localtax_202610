import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { QnaNewPageView } from "@/components/site/QnaViews";
import type { SearchParams } from "@/components/site/routes";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getQnaList } from "@/lib/server/public/qna";
import { pageTitle, queryValue } from "@/lib/site/hub-view";

// 질문 작성 (/qna/new - W13-g QNA-01). 세목만 쿼리로 받는다(질문 원문은 주소에 싣지 않는다).
export const metadata: Metadata = { title: pageTitle("질문하기 - 라운지"), robots: { index: false, follow: true } };

export default async function QnaNewPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const view = await readPublic("라운지 작성", () => getQnaList(), () => UNAVAILABLE);
  if (isUnavailable(view)) return <UnavailablePage />;
  if (!view.open || !view.notice) notFound();
  return <QnaNewPageView notice={view.notice} links={view.links} taxType={(queryValue(sp.tax) ?? "").slice(0, 30)} />;
}
