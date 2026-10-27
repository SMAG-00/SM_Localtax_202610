import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { QnaQuestionPageView } from "@/components/site/QnaViews";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getQnaQuestion } from "@/lib/server/public/qna";
import { pageTitle } from "@/lib/site/hub-view";
import { UNAVAILABLE_TITLE } from "@/lib/site/public-gate";

// 라운지 질문 상세 (/qna/[id] - W13-g QNA-02·06). 공개 중인 질문만 - 보류·숨김·없는 번호·키 꺼짐은 404.
const load = cache(async (raw: string) => {
  await connection();
  if (!/^[1-9]\d{0,15}$/.test(raw)) notFound();
  return readPublic("라운지 질문", () => getQnaQuestion(Number(raw)), () => UNAVAILABLE);
});

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const view = await load((await params).id);
  if (isUnavailable(view)) return { title: pageTitle(UNAVAILABLE_TITLE), robots: { index: false, follow: false } };
  if (!view.open || !view.question) notFound();
  // 라운지 글은 검색 색인에 넣지 않는다 (QNA-07)
  return { title: pageTitle(`${view.question.title} - 라운지`), robots: { index: false, follow: true } };
}

export default async function QnaQuestionRoute({ params }: Props) {
  const view = await load((await params).id);
  if (isUnavailable(view)) return <UnavailablePage />;
  if (!view.open || !view.question) notFound();
  return <QnaQuestionPageView view={view} />;
}
