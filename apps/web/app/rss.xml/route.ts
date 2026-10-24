import { renderRss, rssRows } from "@/lib/seo/sitemap";
import { PUBLICATION_NAME, indexingGate, loadPublicArticles } from "@/lib/server/seo/load";
import { closed, unavailable, xml } from "@/lib/server/seo/respond";
import { PublicDataError } from "@/lib/server/public/db";

// 전체 RSS (OPT-01) — 광고·공동 기획·협찬·비공개 항목 0, 제목·발행일은 화면과 같다
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await indexingGate();
  if (!gate.open || !gate.site) return closed();
  try {
    const rows = rssRows(await loadPublicArticles(), null);
    return xml(renderRss(gate.site, { title: PUBLICATION_NAME, description: `${PUBLICATION_NAME} 최근 기사`, path: "/rss.xml" }, rows));
  } catch (err) {
    if (err instanceof PublicDataError) return unavailable();
    throw err;
  }
}
