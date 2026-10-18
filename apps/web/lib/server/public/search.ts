import "server-only";
import { publicSearchDb, rowsOf } from "./db";
import { readPublicSettings } from "./reads";
import { SEARCH_LIMITS, emptySearchResult, searchArgs, toSearchResult, type SearchOptions, type SearchResult, type SearchRow } from "./search-logic";

// 통합 검색 (SRCH-01 · SRCH-02 — docs/dev/W2-d_설계.md 7·8장) — 검색 함수 search_public 하나를 anon 키로 부른다(RLS·칸 권한이 경계,
// 함수도 security invoker). 응답은 캐시하지 않는다(publicSearchDb — no-store): 발행 취소·비공개가 다음 검색에 바로 빠진다.
// 기능 키(주소를 열지)는 다른 공개 화면과 같은 30초 캐시 설정을 읽는다. 검색어는 저장하지 않고 로그에도 남기지 않는다(10장).
// 같은 함수를 AI 도우미 검색 도구(01C CHAT-03)가 부른다 — 결과 모양(SearchRow)은 종류가 늘어도 같다.

/**
 * 검색 — 검색어가 비거나(남는 글자 없음) 종류 없는 탭(행사·전문가 — 01B·01C 전)·건너뛰기 한도를 넘는 쪽이면 DB를 부르지 않고 빈 결과.
 * perKind를 주면 종류별 묶음(전체 탭 — 종류마다 앞 n개, 쪽 없음)
 */
export async function searchSite(options: SearchOptions, mode: { perKind?: number; pageSize?: number } = {}): Promise<SearchResult> {
  const args = searchArgs(options, mode);
  if (!args) return emptySearchResult(options, mode.pageSize ?? SEARCH_LIMITS.pageSize);
  const [settings, rows] = await Promise.all([readPublicSettings(), rowsOf<SearchRow>(publicSearchDb().rpc("search_public", args), "통합 검색")]);
  return toSearchResult(rows, settings.features, options, args);
}
