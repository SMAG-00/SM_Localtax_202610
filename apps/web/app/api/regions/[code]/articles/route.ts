import { PublicDataError } from "@/lib/server/public";
import { getRegionArticles } from "@/lib/server/public/region-articles";
import { parseRegionArticlesRequest } from "@/lib/server/public/region-articles-logic";

// 지역 기사 읽기 API (W4 9단계 — PRD-01B 5.6, docs/dev/W4_설계.md 1장 9단계 · 4장). 지역 허브와 같은 공개 경계(anon 키 — RLS)·같은 범위 규칙.
//  200 목록 · 400 틀린 조건(칸마다 사유 — 모르는 칸·목록 밖 topic·page·코드 형식) · 404 지역 허브가 닫힘(기능 키 region_hubs)·오늘 유효한 지역이 아님·끝을 넘긴 쪽
//  503 공개 데이터를 읽지 못함 · 어떤 입력에도 500을 내지 않는다 — 조건은 DB를 부르기 전에 다 거른다(region-articles-logic.ts)
//  · 응답에 기사마다 source·verifiedAt·status (5.6 '공개 응답은 source·verifiedAt·status를 포함')
//  · 캐시하지 않는다(no-store — 비공개로 바뀐 기사가 다음 요청에 바로 빠진다. 서버 안쪽 공개 데이터 캐시는 편집국 쓰기가 바로 만료한다)
export const dynamic = "force-dynamic";

function reply(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  const { code } = await params;
  const parsed = parseRegionArticlesRequest(code, new URL(request.url).searchParams);
  if (!parsed.ok) return reply(400, { error: "조건을 확인하세요", errors: parsed.errors });
  try {
    const body = await getRegionArticles(parsed.code, parsed.topic, parsed.page);
    if (!body) return reply(404, { error: "지역을 찾을 수 없거나 아직 열리지 않았습니다" });
    return reply(200, body);
  } catch (err) {
    if (err instanceof PublicDataError) {
      console.error("[regions] 지역 기사 API — 공개 데이터를 읽지 못했습니다:", err.context, err.code ?? "");
      return reply(503, { error: "지금은 읽을 수 없습니다 — 잠시 뒤 다시 확인해 주세요" });
    }
    console.error("[regions] 지역 기사 API 처리 중 오류:", err instanceof Error ? err.name : "오류");
    return reply(500, { error: "서버 오류가 났습니다 — 잠시 뒤 다시 확인해 주세요" });
  }
}
