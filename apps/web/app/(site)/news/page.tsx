import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ClosedListView } from "@/components/site/ClosedListView";
import { NEWS_TITLE, NewsView } from "@/components/site/NewsView";
import type { SearchParams } from "@/components/site/routes";
import { getNewsList, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { isSectionKey } from "@/lib/server/public/constants";
import { pageTitle, parsePage, queryValue } from "@/lib/site/hub-view";

// 뉴스 전체 (/news — CAT-02 · LG-04) — 편집 승인된 취재 기사(reported_news)만. 탭 = [전체] + 허브 4개 (?section=), 쪽 넘김 ?page=.
// 칼럼·해설·광고는 0 (ART-04 — 칼럼은 분야 칼럼 목록). 모르는 분야 값은 전체로 본다. 목록 끝을 넘긴 쪽은 404.
// 공개 데이터를 읽지 못하면 닫힌 목록(머리 + 안내 한 줄, 200 — lib/server/public/fallback.ts)
export const metadata: Metadata = { title: pageTitle(NEWS_TITLE) };

export default async function NewsPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const raw = queryValue(sp.section);
  const page = parsePage(sp.page);
  const news = await readPublic("뉴스 전체", () => getNewsList({ section: isSectionKey(raw) ? raw : null, page }), () => UNAVAILABLE);
  if (isUnavailable(news)) return <ClosedListView section="news" />;
  if (page > 1 && news.items.length === 0) notFound();
  return <NewsView news={news} />;
}
