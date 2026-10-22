// GET /api/search 요청 검사·응답 모양·속도 제한 (SRCH-02 · PRD-01A 6.4 — docs/dev/W2-d_설계.md 2.4·8장) — 순수 함수 (시험 search-request.test.ts)
//  · 쿼리 칸 이름은 검색 화면 주소와 같다(q·tab·section·type·region·from·to·page). 화면은 모르는 값을 닫힌 쪽으로 읽지만,
//    API는 틀린 값을 400과 칸마다 사유로 알린다 — 어떤 입력에도 500을 내지 않는다(DB를 부르기 전에 다 거른다)
//  · 속도 제한은 수집 API(/api/events)와 같은 서버 메모리 토큰 통 — IP는 해시한 열쇠만 들고 있다(lib/analytics/rate-limit.ts)
import { TokenBuckets, type Take } from "@/lib/analytics/rate-limit";
import { SECTION_KEYS, isSectionKey } from "./constants";
import { SEARCH_CONTENT_TYPES, SEARCH_KINDS, SEARCH_MAX_PAGE, SEARCH_TABS, TAB_KINDS, regionClassified, type SearchContentType, type SearchKind, type SearchOptions, type SearchResult, type SearchTab } from "./search-logic";
import { SEARCH_LIMITS } from "./search-normalize";

/** 설계 2.4 */
export const SEARCH_API = { params: ["q", "tab", "section", "type", "region", "from", "to", "page"], ipPerMinute: 120 } as const;

export type SearchRequest = { ok: true; options: SearchOptions } | { ok: false; errors: string[] };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function isDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/** 쿼리 → 검색 옵션. 틀린 칸이 있으면 칸마다 사유 (모두) */
export function parseSearchRequest(params: URLSearchParams): SearchRequest {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  for (const key of params.keys()) seen.set(key, (seen.get(key) ?? 0) + 1);
  for (const [key, n] of seen) {
    if (!(SEARCH_API.params as readonly string[]).includes(key)) errors.push(`${key}: 모르는 칸입니다 — ${SEARCH_API.params.join("·")}`);
    else if (n > 1) errors.push(`${key}: 같은 칸을 두 번 보냈습니다`);
  }
  if (errors.length) return { ok: false, errors };
  const get = (k: string) => params.get(k);

  const q = (get("q") ?? "").trim();
  const qChars = Array.from(q).length;
  if (qChars === 0) errors.push("q: 검색어가 필요합니다");
  else if (qChars > SEARCH_LIMITS.queryChars) errors.push(`q: 검색어는 ${SEARCH_LIMITS.queryChars}자까지입니다 (지금 ${qChars}자)`);

  const tabRaw = get("tab");
  const tabOk = tabRaw === null || (SEARCH_TABS as readonly string[]).includes(tabRaw);
  const tab: SearchTab = tabRaw !== null && tabOk ? (tabRaw as SearchTab) : "all";
  if (!tabOk) errors.push(`tab: ${SEARCH_TABS.join("·")} 중 하나입니다`);
  const section = get("section");
  if (section !== null && !isSectionKey(section)) errors.push(`section: ${SECTION_KEYS.join("·")} 중 하나입니다`);
  const type = get("type");
  if (type !== null && !(SEARCH_CONTENT_TYPES as readonly string[]).includes(type)) errors.push(`type: ${SEARCH_CONTENT_TYPES.join("·")} 중 하나입니다`);
  const region = get("region");
  if (region !== null && !/^\d{10}$/.test(region)) errors.push("region: 법정동코드 10자리입니다");
  const from = get("from");
  const to = get("to");
  const fromOk = from === null || isDate(from);
  const toOk = to === null || isDate(to);
  if (!fromOk) errors.push("from: 날짜(YYYY-MM-DD)입니다");
  if (!toOk) errors.push("to: 날짜(YYYY-MM-DD)입니다");
  if (fromOk && toOk && from !== null && to !== null && to < from) errors.push("to: 기간의 끝이 시작보다 앞입니다");
  const pageRaw = get("page");
  let page = 1;
  if (pageRaw !== null) {
    if (!/^[1-9]\d{0,4}$/.test(pageRaw) || Number(pageRaw) > SEARCH_MAX_PAGE) errors.push(`page: 1~${SEARCH_MAX_PAGE} 정수입니다`);
    else if (tabOk && tab === "all" && Number(pageRaw) > 1) errors.push("page: 전체 탭은 종류별 묶음이라 쪽이 없습니다 — 종류 탭(tab)을 고르세요");
    else page = Number(pageRaw);
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    options: {
      q,
      tab,
      section: isSectionKey(section) ? section : null,
      contentType: (type as SearchContentType | null) ?? null,
      region,
      from,
      to,
      page,
    },
  };
}

/**
 * 응답 본문 — 고른 탭의 전체 수는 탭 숫자(그 탭 종류의 합). 지역 분류 여부는 search_submitted와 같은 뜻(실제 분류 — W4 10단계),
 * `classification`(지역 후보·주제·동명 여부·결과 0건 제안 검색어)은 분류를 붙인 결과에만
 */
export function searchResponseBody(result: SearchResult, o: SearchOptions) {
  const total = TAB_KINDS[o.tab].reduce((n, k: SearchKind) => n + (result.counts[k] ?? 0), 0);
  return {
    query: result.query,
    terms: result.terms,
    tab: o.tab,
    page: result.page,
    pageSize: result.pageSize,
    total,
    hasMore: result.hasMore,
    counts: Object.fromEntries(SEARCH_KINDS.map((k) => [k, result.counts[k] ?? 0])) as Record<SearchKind, number>,
    regionClassified: regionClassified(result),
    classification: result.classification,
    items: result.items,
  };
}

/** IP 열쇠 하나의 토큰 — 상한 SEARCH_API.ipPerMinute */
export function takeSearchToken(limiter: TokenBuckets, key: string, nowMs: number): Take {
  return limiter.take(key, SEARCH_API.ipPerMinute, nowMs);
}
