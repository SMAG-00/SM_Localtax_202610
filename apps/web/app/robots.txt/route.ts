import { robotsTxt } from "@/lib/seo/sitemap";
import { indexingGate } from "@/lib/server/seo/load";

// robots.txt (OPT-08 · SEO-04) — settings.crawler_policy에서 만든다. SITE_INDEXING=off이거나 정책이 갖춰지지 않았으면 전체 차단(닫힌 쪽)이고 Sitemap 줄이 없다.
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await indexingGate();
  const body = robotsTxt({ open: gate.open, policy: gate.settings?.crawlerPolicy, site: gate.site });
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=300" } });
}
