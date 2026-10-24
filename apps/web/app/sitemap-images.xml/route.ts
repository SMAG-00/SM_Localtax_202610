import { renderImageSitemap } from "@/lib/seo/sitemap";
import { indexingGate, loadImageEntries, loadPublicArticles } from "@/lib/server/seo/load";
import { closed, unavailable, xml } from "@/lib/server/seo/respond";
import { PublicDataError } from "@/lib/server/public/db";

// 이미지 사이트맵 (OPT-01) — 대표 이미지 권리가 확인된 공개 기사만 (공개 뷰가 권리 미확인 이미지를 이미 거른다)
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await indexingGate();
  if (!gate.open || !gate.site || !gate.settings) return closed();
  try {
    const articles = (await loadPublicArticles()).filter((a) => a.content_type !== "sponsored" && a.label === "none");
    return xml(renderImageSitemap(gate.site, await loadImageEntries(articles, gate.site)));
  } catch (err) {
    if (err instanceof PublicDataError) return unavailable();
    throw err;
  }
}
