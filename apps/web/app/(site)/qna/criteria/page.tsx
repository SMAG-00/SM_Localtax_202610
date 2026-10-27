import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { QnaCriteriaPageView } from "@/components/site/QnaViews";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getQnaCriteria } from "@/lib/server/public/qna";
import { pageTitle } from "@/lib/site/hub-view";

// 활동 전문가 노출 기준 (/qna/criteria - W13-g QNA-08). 값은 설정 qna_criteria 그대로.
export const metadata: Metadata = { title: pageTitle("활동 전문가 노출 기준") };

export default async function QnaCriteriaPage() {
  await connection();
  const view = await readPublic("라운지 기준", () => getQnaCriteria(), () => UNAVAILABLE);
  if (isUnavailable(view)) return <UnavailablePage />;
  if (!view.open) notFound();
  return <QnaCriteriaPageView view={view} />;
}
