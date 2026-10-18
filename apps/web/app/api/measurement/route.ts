import { MEASUREMENT_PAGE, choiceCookies, parseChoice } from "@/lib/analytics/consent";
import { isSameSite, mediaType, readLimited, sameSiteHosts } from "@/lib/analytics/request";
import { isHttps } from "@/lib/server/cookie-options";
import { siteUrl } from "@/lib/server/env";

// 측정 거부·허용 (GROW-01 '측정 거부(바닥글 설정)' — docs/dev/W2-c_설계.md 5.1). DB를 읽지 않는다 — DB가 꺼져도 거부할 수 있다.
//  · 폼(`choice=refuse|allow`, 스크립트 없이 동작) → 303으로 측정 거부 화면에 돌아간다 · JSON(`{ "choice": … }`) → 200
//  · 다른 사이트에서 온 요청은 403 — 남의 거부를 풀거나 몰래 거부시키지 못하게
export const dynamic = "force-dynamic";

const FORMS = new Set(["application/x-www-form-urlencoded", "application/json"]);
const MAX_BYTES = 1024;

const json = (body: unknown, status: number, cookies: string[] = []) => {
  const headers = new Headers({ "cache-control": "no-store", "content-type": "application/json; charset=utf-8" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
};

export async function POST(request: Request): Promise<Response> {
  if (!isSameSite(request.headers, sameSiteHosts(request, siteUrl()))) {
    return json({ error: "다른 사이트에서 온 요청은 받지 않습니다" }, 403);
  }
  const type = mediaType(request.headers);
  if (!FORMS.has(type)) return json({ error: "본문은 폼 또는 application/json이어야 합니다" }, 415);
  const read = await readLimited(request, MAX_BYTES);
  if (!read.ok) return json({ error: "본문이 너무 큽니다" }, 413);
  const choice = parseChoice(type, read.text);
  if (!choice) return json({ error: "choice는 refuse 또는 allow여야 합니다" }, 400);
  const cookies = choiceCookies(choice, isHttps(request.headers, request.url));
  if (type === "application/json") return json({ choice }, 200, cookies);
  const headers = new Headers({ "cache-control": "no-store", location: `${MEASUREMENT_PAGE}?done=${choice}` });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 303, headers });
}
