import { randomBytes } from "node:crypto";
import { TokenBuckets, ipKey } from "@/lib/analytics/rate-limit";
import { clientIp } from "@/lib/analytics/request";
import { countApiSearch } from "@/lib/server/analytics/query-terms";
import { PublicDataError, searchSite } from "@/lib/server/public";
import { readPublicSettings } from "@/lib/server/public/reads";
import { SEARCH_SCREEN } from "@/lib/server/public/search-logic";
import { parseSearchRequest, searchResponseBody, takeSearchToken } from "@/lib/server/public/search-request";

// 통합 검색 읽기 API (PRD-01A 6.4 · SRCH-02 — docs/dev/W2-d_설계.md 2.4·8장). 검색 화면(/search)과 같은 서버 함수·같은 결과·같은 공개 경계(anon 키).
//  200 결과 · 400 틀린 조건(칸마다 사유) · 404 검색 기능이 닫힘(기능 키 search) · 429 너무 잦음(IP별 1분 상한 — 서버 메모리) · 503 공개 데이터를 읽지 못함
//  · 어떤 입력에도 500을 내지 않는다 — 조건은 DB를 부르기 전에 다 거른다(lib/server/public/search-request.ts)
//  · 캐시하지 않는다(no-store — 비공개로 바뀐 행이 다음 검색에 바로 빠진다). 검색어 원문은 저장하지 않고 기록(로그)에도 남기지 않는다 —
//    검색어 집계(SRCH-03 — 설계 8.3)는 서버가 가린 값만 응답 뒤에 더한다(봇·편집국·측정 거부·2쪽 이상·30분 안 다시 찾기 0)
//  · 속도 제한 열쇠는 IP를 프로세스마다 다른 소금으로 해시한 값 — IP 원문은 메모리에도 들고 있지 않는다 (수집 API와 같은 방식)
export const dynamic = "force-dynamic";

const limiter = new TokenBuckets();
const salt = randomBytes(16).toString("hex");

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", "x-robots-tag": "noindex", ...headers } });
}

export async function GET(request: Request): Promise<Response> {
  const take = takeSearchToken(limiter, ipKey(clientIp(request.headers), salt), Date.now());
  if (!take.ok) return reply(429, { error: "요청이 너무 잦습니다 — 잠시 뒤 다시 찾아 주세요" }, { "retry-after": String(take.retryAfterSeconds) });
  const parsed = parseSearchRequest(new URL(request.url).searchParams);
  if (!parsed.ok) return reply(400, { error: "검색 조건을 확인하세요", errors: parsed.errors });
  try {
    const settings = await readPublicSettings();
    if (!settings.features.search) return reply(404, { error: "검색이 아직 열리지 않았습니다" });
    const o = parsed.options;
    const result = await searchSite(o, o.tab === "all" ? { perKind: SEARCH_SCREEN.allPerKind } : {});
    await countApiSearch(request, o.q, o.page);
    return reply(200, searchResponseBody(result, o));
  } catch (err) {
    if (err instanceof PublicDataError) {
      console.error("[search] 검색 API — 공개 데이터를 읽지 못했습니다:", err.context, err.code ?? "");
      return reply(503, { error: "지금은 검색할 수 없습니다 — 잠시 뒤 다시 찾아 주세요" });
    }
    console.error("[search] 검색 API 처리 중 오류:", err instanceof Error ? err.name : "오류");
    return reply(500, { error: "서버 오류가 났습니다 — 잠시 뒤 다시 찾아 주세요" });
  }
}
