import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { COLUMNS_TITLE, ColumnsView } from "@/components/site/ColumnsView";
import type { SearchParams } from "@/components/site/routes";
import { getAllColumns, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { isSectionKey } from "@/lib/server/public/constants";
import { ALL_TAB, newsTabs } from "@/lib/server/public/hub-logic";
import { pageTitle, parsePage, queryValue } from "@/lib/site/hub-view";

// 전문가칼럼 (/columns — 헤더 바로 메뉴, PO 2026-11-01) — 공개된 칼럼(opinion) 기사만. 탭 = [전체] + 허브 4개 (?section=), 쪽 넘김 ?page=.
// 모르는 분야 값은 전체로 본다. 목록 끝을 넘긴 쪽은 404. 공개 데이터를 읽지 못하면 빈 목록(서버 로그 [public])
export const metadata: Metadata = { title: pageTitle(COLUMNS_TITLE) };

export default async function ColumnsPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const raw = queryValue(sp.section);
  const page = parsePage(sp.page);
  const columns = await readPublic("전문가칼럼", () => getAllColumns({ section: isSectionKey(raw) ? raw : null, page }), () => UNAVAILABLE);
  if (isUnavailable(columns)) return <ColumnsView columns={{ tabs: newsTabs("/columns"), currentTab: ALL_TAB, section: null, items: [], page: 1, total: 0, hasMore: false }} />;
  if (page > 1 && columns.items.length === 0) notFound();
  return <ColumnsView columns={columns} />;
}
