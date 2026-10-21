import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { ArticleView } from "@/components/site/ArticleView";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { LegalDocBlock } from "@/components/site/InterpretationView";
import { getArticleDetail, getArticleLegalDocs, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle } from "@/lib/site/hub-view";
import { UNAVAILABLE_TITLE } from "@/lib/site/public-gate";

// 기사 상세 (/news/[slug] — ART-02 · ART-03 카드뉴스 · ART-04 칼럼 · CAT-05 해결 사례) — 분야·유형·형식과 상관없이 기사 상세 경로는 이것 하나다.
//  · 발행되지 않은(초안·검토·보류) 기사와 없는 주소는 404, 삭제된 기사 주소는 410 + 삭제 안내(proxy.ts — 화면보다 먼저 정한다)
//  · 발행된 기사의 주소(slug)는 바꿀 수 없다(편집국 API 409 — W2-a) → 옛 주소가 생기지 않아 301이 없다. 이관 기사의 옛 주소 301은 W9 MIG-02
//  · 공개 데이터를 읽지 못하면 proxy가 503 "잠시 뒤 다시 확인해 주세요"를 먼저 보낸다 — 확인을 지난 뒤 읽기가 실패하면 같은 안내를 이 화면이 그린다
//  · 요청 때 그린다 — 편집국 쓰기는 공개 데이터 캐시를 바로 만료한다(설계 7.1)
const SLUG = /^[^\s/]+$/;

const load = cache(async (slug: string) => {
  await connection();
  if (!SLUG.test(slug)) notFound();
  return readPublic("기사 상세", () => getArticleDetail(slug), () => UNAVAILABLE);
});

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = await load((await params).slug);
  if (isUnavailable(a)) return { title: pageTitle(UNAVAILABLE_TITLE), robots: { index: false, follow: false } };
  if (!a) notFound();
  const canonical = /^https?:\/\//.test(a.share.url) ? a.share.url : undefined;
  return {
    title: pageTitle(a.title),
    description: a.share.description || undefined,
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: {
      type: "article",
      title: a.title,
      ...(a.share.description ? { description: a.share.description } : {}),
      ...(canonical ? { url: canonical } : {}),
      ...(a.share.image ? { images: [a.share.image] } : {}),
      ...(a.firstPublishedAt ? { publishedTime: a.firstPublishedAt } : {}),
      ...(a.substantiveUpdatedAt ? { modifiedTime: a.substantiveUpdatedAt } : {}),
    },
  };
}

export default async function ArticlePage({ params }: Props) {
  const a = await load((await params).slug);
  if (isUnavailable(a)) return <UnavailablePage />;
  if (!a) notFound();
  // 해석 해설이면 원문 블록을 해설 본문과 따로 앞에 둔다 (W3 5단계 — 공개 가능한 원문만, 기능 키 꺼짐이면 없음)
  const docs = await readPublic("기사 원문 연결", () => getArticleLegalDocs(a.id), () => ({ subject: [], related: [] }));
  return (
    <>
      <LegalDocBlock subject={docs.subject} related={docs.related} />
      <ArticleView article={a} today={isoToKstDate(new Date().toISOString())} />
    </>
  );
}
