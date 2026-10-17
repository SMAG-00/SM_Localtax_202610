import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { NEWS_TITLE, NewsView } from "@/components/site/NewsView";
import type { SearchParams } from "@/components/site/routes";
import { getNewsList } from "@/lib/server/public";
import { isSectionKey } from "@/lib/server/public/constants";
import { pageTitle, parsePage, queryValue } from "@/lib/site/hub-view";

// 뉴스 전체 (/news — CAT-02 · LG-04) — 편집 승인된 취재 기사(reported_news)만. 탭 = [전체] + 허브 4개 (?section=), 쪽 넘김 ?page=.
// 모르는 분야 값은 전체로 본다. 목록 끝을 넘긴 쪽은 404. 공개 데이터를 읽지 못하면 error.tsx(다시 불러오기).
export const metadata: Metadata = { title: pageTitle(NEWS_TITLE) };

export default async function NewsPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const raw = queryValue(sp.section);
  const page = parsePage(sp.page);
  const news = await getNewsList({ section: isSectionKey(raw) ? raw : null, page });
  if (page > 1 && news.items.length === 0) notFound();
  return <NewsView news={news} />;
}
