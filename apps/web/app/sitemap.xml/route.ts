import { SITEMAP_MAX_URLS, chunkEntries, renderSitemapIndex, renderUrlset } from "@/lib/seo/sitemap";
import { indexingGate, loadPublicArticles, loadSitemapEntries } from "@/lib/server/seo/load";
import { closed, unavailable, xml } from "@/lib/server/seo/respond";
import { PublicDataError } from "@/lib/server/public/db";

// 일반 사이트맵 (OPT-01 · SEO-01) — 색인 대상 공개 페이지만. 5만 주소를 넘으면 색인 파일 + /sitemap/N.xml 조각
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await indexingGate();
  if (!gate.open || !gate.site || !gate.settings) return closed();
  try {
    const entries = await loadSitemapEntries(gate.settings, await loadPublicArticles());
    const parts = chunkEntries(entries, SITEMAP_MAX_URLS);
    if (parts.length === 1) return xml(renderUrlset(gate.site, parts[0]!));
    return xml(renderSitemapIndex(gate.site, parts.map((_, i) => `/sitemap/${i + 1}.xml`)));
  } catch (err) {
    if (err instanceof PublicDataError) return unavailable();
    throw err;
  }
}
