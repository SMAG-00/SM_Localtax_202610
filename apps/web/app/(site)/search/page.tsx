import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { SearchUnavailable, SearchView } from "@/components/site/SearchView";
import type { SearchParams } from "@/components/site/routes";
import { getSearchPage, isUnavailable, parseSearchParams, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle, queryValue } from "@/lib/site/hub-view";
import { searchTitle } from "@/lib/site/search-view";

// 통합 검색 화면 (/search — SRCH-01 · SRCH-02, docs/dev/W2-d_설계.md 8장). 기능 키 search가 꺼져 있으면 404(링크도 0 — HOME-02).
// 요청 때 그리고 캐시하지 않는다(검색 함수는 no-store, 화면은 요청마다 — 발행 취소·비공개가 다음 검색에 바로 빠진다).
// 검색 결과 쪽은 색인하지 않는다(noindex — 얇은 쪽, 설계 12장 #13). 공개 데이터를 읽지 못하면 머리와 안내 한 줄(200 — 다른 목록 화면과 같다).
// 검색어는 저장하지 않고 서버 기록에도 남기지 않는다 — 측정 이벤트는 길이·수·참거짓만 (설계 10장)

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const o = parseSearchParams(await searchParams);
  return { title: pageTitle(searchTitle(o.q)), robots: { index: false, follow: false } };
}

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const raw = await searchParams;
  const data = await readPublic("검색", () => getSearchPage(parseSearchParams(raw)), () => UNAVAILABLE);
  if (isUnavailable(data)) return <SearchUnavailable />;
  if (data === null) notFound();
  // 검색어 칸을 비운 채 보냈다(q= 또는 공백뿐) — 입력창 아래 안내 (주소에 q가 아예 없으면 첫 화면)
  const blankSubmitted = queryValue(raw.q) !== undefined && data.options.q === "";
  return <SearchView data={data} blankSubmitted={blankSubmitted} />;
}
