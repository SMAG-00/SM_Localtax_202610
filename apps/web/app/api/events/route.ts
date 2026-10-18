import { collect } from "@/lib/server/analytics/collect";

// 측정 이벤트 수집 (FND-06 · GROW-01 — docs/dev/W2-c_설계.md 5장). 판정은 lib/analytics/ingest.ts 한 곳.
//  202 저장 · 204 측정 거부·GPC(저장 0) · 400 형식 · 403 다른 사이트 · 413 크기 · 415 본문 형식 · 429 속도 · 503 설정·저장 실패
//  IP·User-Agent 원문은 저장하지도 기록하지도 않는다. 응답은 캐시하지 않는다.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let r: Awaited<ReturnType<typeof collect>>;
  try {
    r = await collect(request);
  } catch (err) {
    // 잘못된 입력은 collect가 4xx로 돌려준다 — 여기는 서버 쪽 예외뿐. 요청 내용은 찍지 않는다
    console.error("[analytics] 수집 중 예외:", err instanceof Error ? err.name : "오류");
    return Response.json({ error: "잠시 뒤 다시 보내 주세요" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  const headers = new Headers({ "cache-control": "no-store", ...r.headers });
  for (const c of r.cookies) headers.append("set-cookie", c);
  if (r.body === null) return new Response(null, { status: r.status, headers });
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(r.body), { status: r.status, headers });
}
