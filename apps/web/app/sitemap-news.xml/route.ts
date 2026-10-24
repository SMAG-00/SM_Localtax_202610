import { newsSitemapRows, renderNewsSitemap } from "@/lib/seo/sitemap";
import { PUBLICATION_NAME, indexingGate, loadPublicArticles } from "@/lib/server/seo/load";
import { closed, unavailable, xml } from "@/lib/server/seo/respond";
import { PublicDataError } from "@/lib/server/public/db";

// 뉴스 사이트맵 (OPT-01) — 설정 기간(news_sitemap_hours) 안에 발행된 기사만. 광고·공동 기획·협찬·정보 목록 0
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await indexingGate();
  if (!gate.open || !gate.site || !gate.settings) return closed();
  try {
    const rows = newsSitemapRows(await loadPublicArticles(), new Date(), gate.settings.newsHours);
    return xml(renderNewsSitemap(gate.site, rows, PUBLICATION_NAME));
  } catch (err) {
    if (err instanceof PublicDataError) return unavailable();
    throw err;
  }
}
