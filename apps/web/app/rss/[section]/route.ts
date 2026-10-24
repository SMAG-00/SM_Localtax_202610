import { renderRss, rssRows } from "@/lib/seo/sitemap";
import { PUBLICATION_NAME, indexingGate, loadPublicArticles } from "@/lib/server/seo/load";
import { closed, unavailable, xml } from "@/lib/server/seo/respond";
import { PublicDataError } from "@/lib/server/public/db";
import { SECTION_INFO, isSectionKey } from "@/lib/server/public/constants";

// 분야별 RSS (OPT-01) — /rss/tax.xml · realestate · finance · local. 분야 이름은 SECTION_INFO 한 표에서 읽는다
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ section: string }> }) {
  const m = /^([a-z]+)\.xml$/.exec((await params).section);
  const gate = await indexingGate();
  if (!m || !isSectionKey(m[1]) || !gate.open || !gate.site) return closed();
  const key = m[1];
  try {
    const rows = rssRows(await loadPublicArticles(), key);
    return xml(renderRss(gate.site, { title: `${PUBLICATION_NAME} · ${SECTION_INFO[key].name}`, description: `${SECTION_INFO[key].name} 최근 기사`, path: `/rss/${key}.xml` }, rows));
  } catch (err) {
    if (err instanceof PublicDataError) return unavailable();
    throw err;
  }
}
