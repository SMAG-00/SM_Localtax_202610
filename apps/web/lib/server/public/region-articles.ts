import "server-only";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { isValidOn } from "@/lib/site/region-route";
import { LOCAL_TOPICS } from "./constants";
import { publicDb, rowsOf } from "./db";
import { readArticleList, readPublicSettings, readRegions } from "./reads";
import { REGION_ARTICLES_API, regionArticleItems, type RegionArticlesBody } from "./region-articles-logic";
import { regionArticleCodes } from "./region-logic";
import { REGIONAL_ARTICLE_TYPES, type RegionSourceRow } from "./region-official-logic";
import { SOURCE_COLUMNS, num } from "./rows";
import type { LocalTopic } from "@ltr/ui";

// 지역 기사 읽기 (GET /api/regions/{code}/articles — W4 9단계, 규칙은 region-articles-logic.ts). 공개 데이터 함수라 anon 키로만 읽는다.
//  · 기능 키 region_hubs가 꺼졌거나 오늘 유효한 지역이 아니면 null → 404 (설계 4장 '기능 키가 꺼지면 null → 404')
//  · 끝을 넘긴 쪽(2쪽 이상인데 0건)도 null → 404 (목록 화면과 같은 규칙)
//  · 출처는 그 쪽 기사들의 공식 자료(article_sources — 공개 기사 행만, RLS)·열린 원문 검수(뷰 public_source_reviews)만 읽는다

export async function getRegionArticles(code: string, topic: LocalTopic | null, page: number, now: Date = new Date()): Promise<RegionArticlesBody | null> {
  const [settings, regions] = await Promise.all([readPublicSettings(), readRegions()]);
  if (!settings.features.region_hubs) return null;
  const today = isoToKstDate(now.toISOString());
  const region = regions.find((r) => r.code === code);
  if (!region || !isValidOn(region, today) || (region.level !== "sido" && region.level !== "sigungu")) return null;
  const db = publicDb();
  const size = REGION_ARTICLES_API.pageSize;
  const { items, total } = await readArticleList(db, {
    regionCodes: regionArticleCodes(region, regions),
    editorialFields: topic ? [topic] : LOCAL_TOPICS.map((t) => t.topic),
    contentTypes: REGIONAL_ARTICLE_TYPES,
    limit: size,
    offset: (page - 1) * size,
    count: true,
  });
  if (page > 1 && items.length === 0) return null;
  const ids = items.map((a) => a.id);
  const [sources, reviews] = ids.length
    ? await Promise.all([
        rowsOf<RegionSourceRow>(db.from("article_sources").select(`${SOURCE_COLUMNS}, snapshot_id`).in("article_id", ids).order("id"), "지역 기사 출처"),
        rowsOf<{ source_id: number }>(db.from("public_source_reviews").select("source_id").in("article_id", ids), "지역 기사 검토 중"),
      ])
    : [[], []];
  return {
    region: { code: region.code, name: region.name, level: region.level },
    topic,
    page,
    pageSize: size,
    total,
    hasMore: page * size < total,
    items: regionArticleItems(items, sources, new Set(reviews.map((r) => num(r.source_id)))),
  };
}
