import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AgentEntry } from "@/components/site/AgentEntry";
import { SearchUnavailable, SearchView } from "@/components/site/SearchView";
import { ToolCardsRow } from "@/components/site/calc/ToolCardsRow";
import type { CardTool } from "@/lib/calc/tool-cards";
import { getToolCards } from "@/lib/server/public/tool-cards";
import type { SearchParams } from "@/components/site/routes";
import { countPageSearch } from "@/lib/server/analytics/query-terms";
import { getSearchPage, isUnavailable, parseSearchParams, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle, queryValue } from "@/lib/site/hub-view";
import { searchTitle } from "@/lib/site/search-view";

// 통합 검색 화면 (/search — SRCH-01 · SRCH-02, docs/dev/W2-d_설계.md 8장). 기능 키 search가 꺼져 있으면 404(링크도 0 — HOME-02).
// 요청 때 그리고 캐시하지 않는다(검색 함수는 no-store, 화면은 요청마다 — 발행 취소·비공개가 다음 검색에 바로 빠진다).
// 검색 결과 쪽은 색인하지 않는다(noindex — 얇은 쪽, 설계 12장 #13). 공개 데이터를 읽지 못하면 머리와 안내 한 줄(200 — 다른 목록 화면과 같다).
// 검색어 원문은 저장하지 않고 서버 기록에도 남기지 않는다 — 측정 이벤트는 길이·수·참거짓만 (설계 10장).
// 검색어 집계(SRCH-03 — 설계 8.3)는 서버가 가린 값만 응답 뒤에 더한다(봇·편집국·측정 거부·2쪽 이상·같은 검색 안 탭·거르개 바꾸기·30분 안 다시 찾기 0)

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const o = parseSearchParams(await searchParams);
  return { title: pageTitle(searchTitle(o.q)), robots: { index: false, follow: false } };
}

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const raw = await searchParams;
  const requested = parseSearchParams(raw);
  const data = await readPublic("검색", () => getSearchPage(requested), () => UNAVAILABLE);
  if (isUnavailable(data)) return <SearchUnavailable />;
  if (data === null) notFound();
  // 검색을 했으면(남는 글자가 있는 검색어) 집계 — 주소의 검색어 그대로 넘겨 서버가 가린다. 쪽은 요청한 쪽(전체 탭은 화면이 1쪽으로 보여도)
  if (data.result !== null) await countPageSearch(queryValue(raw.q) ?? "", requested.page);
  // 검색어 칸을 비운 채 보냈다(q= 또는 공백뿐) — 입력창 아래 안내 (주소에 q가 아예 없으면 첫 화면)
  const blankSubmitted = queryValue(raw.q) !== undefined && data.options.q === "";
  // 세목 검색어('취득세' 등)면 해당 계산기 도구 카드 1장 (GROW-02 · TX-04) - 게이트 전이면 같은 자리에 SM 카드. 검색어 원문은 쓰지 않고 분류된 주제만 본다
  const keys = new Set((data.result?.classification?.topics ?? []).map((t) => t.key));
  const wanted: CardTool[] = [keys.has("acquisition_tax") ? "acquisition" : null, keys.has("property_tax") ? "holding" : null].filter((t): t is CardTool => t !== null);
  const tools = wanted.length > 0 ? await getToolCards(wanted).catch(() => null) : null;
  return (
    <>
      {tools && tools.cards.length > 0 && (
        <section aria-label="계산기" data-ui="search-tool-cards" className="mx-auto w-full max-w-[1100px] px-4 pt-6">
          <ToolCardsRow cards={tools.cards} smLinks={tools.smLinks} fallbacks={tools.fallbacks} measure="search" />
        </section>
      )}
      {data.options.q !== "" && (
        <div className="mx-auto w-full max-w-[1100px] px-4">
          <AgentEntry entry="search_results" prefill={data.options.q} variant="card" />
        </div>
      )}
      <SearchView data={data} blankSubmitted={blankSubmitted} />
    </>
  );
}
