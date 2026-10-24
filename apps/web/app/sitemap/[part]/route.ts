import { SITEMAP_MAX_URLS, chunkEntries, renderUrlset } from "@/lib/seo/sitemap";
import { indexingGate, loadPublicArticles, loadSitemapEntries } from "@/lib/server/seo/load";
import { closed, unavailable, xml } from "@/lib/server/seo/respond";
import { PublicDataError } from "@/lib/server/public/db";

// 일반 사이트맵 조각 — /sitemap/1.xml … (주소가 5만 개를 넘을 때만 색인 파일이 가리킨다)
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ part: string }> }) {
  const m = /^([1-9][0-9]{0,2})\.xml$/.exec((await params).part);
  const gate = await indexingGate();
  if (!m || !gate.open || !gate.site || !gate.settings) return closed();
  try {
    const parts = chunkEntries(await loadSitemapEntries(gate.settings, await loadPublicArticles()), SITEMAP_MAX_URLS);
    const part = parts.length > 1 ? parts[Number(m[1]) - 1] : undefined;
    return part ? xml(renderUrlset(gate.site, part)) : closed();
  } catch (err) {
    if (err instanceof PublicDataError) return unavailable();
    throw err;
  }
}
