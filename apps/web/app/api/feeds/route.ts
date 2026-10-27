import { brand } from "@ltr/ui";
import { serveFeed } from "@/lib/partner-feeds/serve";
import { siteUrl } from "@/lib/server/env";
import { serviceDb } from "@/lib/server/articles/service";
import { handle } from "@/lib/server/http";

// 제휴 피드 (W13-i PART-01, docs/dev/W13-i_설계.md 3장). 로그인이 아니라 발급 키(Authorization: Bearer pf_<번호>.<비밀>)로 연다.
// 키 확인·한도·내용 선택은 DB 함수 partner_feed_serve 하나가 하고, 이 경로는 service role로 그 함수만 부른다 (익명 DB 함수 0).
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const url = new URL(request.url);
  const out = await serveFeed(serviceDb(), {
    authorization: request.headers.get("authorization"),
    format: url.searchParams.get("format"),
    limit: url.searchParams.get("limit"),
    pepper: process.env.PARTNER_FEED_KEY_PEPPER,
    siteUrl: siteUrl(),
    siteName: brand.operatorName,
  });
  return new Response(out.body, { status: out.status, headers: out.headers });
});
