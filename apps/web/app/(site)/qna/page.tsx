import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { QnaListPageView } from "@/components/site/QnaViews";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getQnaList } from "@/lib/server/public/qna";
import { pageTitle } from "@/lib/site/hub-view";

// 지방세 고민 해결 라운지 목록 (/qna - W13-g QNA-01·06·08). 기능 키 qna 꺼짐·중립성 고지 미승인은 404.
export const metadata: Metadata = { title: pageTitle("지방세 고민 해결 라운지") };

export default async function QnaPage() {
  await connection();
  const view = await readPublic("라운지 목록", () => getQnaList(), () => UNAVAILABLE);
  if (isUnavailable(view)) return <UnavailablePage />;
  if (!view.open) notFound();
  return <QnaListPageView view={view} />;
}
