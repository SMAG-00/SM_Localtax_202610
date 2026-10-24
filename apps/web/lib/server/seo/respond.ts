import "server-only";

// 사이트맵·RSS·robots.txt 응답 — 색인 관문이 닫히면 404 + noindex (제출·광고하지 않는다, 내용 미리 보기는 관리자 화면 /admin/seo)
export const XML_HEADERS = { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" } as const;

export const xml = (body: string) => new Response(body, { status: 200, headers: XML_HEADERS });

export const closed = () => new Response("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, nofollow", "cache-control": "no-store" } });

export const unavailable = () => new Response("Service Unavailable", { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, nofollow", "retry-after": "300", "cache-control": "no-store" } });
