import "server-only";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { isValidOn, regionHref } from "@/lib/site/region-route";
import { publicDb, rowsOf } from "./db";
import { readRegions } from "./reads";
import { regionalLinkItems, type LinkTargets, type PublicLinkRow, type RegionalLinkItem } from "./regional-links-logic";

// 공개 지역 연결 읽기 (W4 13단계 — PRD-01B REG1-10, docs/dev/W4_설계.md 1장 13단계 · 12장 100번~). anon 키 — 공개 뷰 public_regional_links(확인된 연결 중
// 두 끝이 지금 공개인 것만)와 도착 행(공개 기사·공개 기사의 출처·행정구역 — RLS가 경계)을 읽어 regional-links-logic.ts가 화면 항목으로 바꾼다.
// 기사 상세(공통 경로)가 부른다 — 연결을 읽지 못하면 연결 0으로 그린다(기사 화면은 그대로, 서버 기록에만 남긴다).

const RAW_LIMIT = 50;

export async function readArticleLinks(articleId: number, now: Date = new Date()): Promise<RegionalLinkItem[]> {
  try {
    const db = publicDb();
    const rows = await rowsOf<PublicLinkRow>(
      db.from("public_regional_links").select("id, from_type, from_id, to_type, to_id, relation, confirmed_at").eq("from_type", "article").eq("from_id", String(articleId)).order("confirmed_at", { ascending: false }).limit(RAW_LIMIT),
      "지역 연결",
    );
    if (rows.length === 0) return [];
    const idsOf = (t: string) => [...new Set(rows.filter((r) => r.to_type === t).map((r) => Number(r.to_id)))];
    const articleIds = idsOf("article");
    const sourceIds = idsOf("official_source");
    const needRegions = rows.some((r) => r.to_type === "region");
    const [articles, sources, reviewing, regions] = await Promise.all([
      articleIds.length ? rowsOf<{ id: number; slug: string; title: string; content_type: string | null }>(db.from("public_articles").select("id, slug, title, content_type").in("id", articleIds), "연결 기사") : Promise.resolve([]),
      sourceIds.length
        ? rowsOf<{ id: number; title: string | null; source_url: string | null; source_name: string | null; reference_date: string | null }>(
            db.from("article_sources").select("id, title, source_url, source_name, reference_date").in("id", sourceIds),
            "연결 공식 자료",
          )
        : Promise.resolve([]),
      sourceIds.length ? rowsOf<{ source_id: number }>(db.from("public_source_reviews").select("source_id").in("source_id", sourceIds), "연결 공식 자료 검토 중") : Promise.resolve([]),
      needRegions ? readRegions() : Promise.resolve([]),
    ]);
    const today = isoToKstDate(now.toISOString());
    const byCode = new Map(regions.map((r) => [r.code, r]));
    const regionTargets = new Map<string, { name: string; href: string }>();
    for (const r of regions) {
      if (!rows.some((x) => x.to_type === "region" && x.to_id === r.code) || !isValidOn(r, today)) continue;
      const parent = r.parent_code ? byCode.get(r.parent_code) : undefined;
      if (r.level === "sigungu" && !parent) continue;
      regionTargets.set(r.code, { name: parent ? `${parent.name} ${r.name}` : r.name, href: parent ? regionHref(parent.slug, r.slug) : regionHref(r.slug) });
    }
    const under = new Set(reviewing.map((x) => String(x.source_id)));
    const targets: LinkTargets = {
      articles: new Map(articles.map((a) => [String(a.id), a])),
      sources: new Map(sources.map((s) => [String(s.id), { ...s, under_review: under.has(String(s.id)) }])),
      regions: regionTargets,
    };
    return regionalLinkItems(rows, targets);
  } catch (err) {
    console.error("[public] 지역 연결을 읽지 못해 연결 0으로 그립니다:", err instanceof Error ? err.message : String(err));
    return [];
  }
}
