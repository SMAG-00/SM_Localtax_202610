import "server-only";
import { cache } from "react";
import type { ArticleListItem } from "./cards";
import { LIMITS } from "./constants";
import { pageOf, publicDb, rowsOf } from "./db";
import { readArticleList } from "./reads";
import { ARTICLE_BLOCKS, blockTopics, parseLocalBlockFields, type BlockArticles, type LocalBlockFields } from "./region-hub-logic";
import type { LocalTopic } from "@ltr/ui";

// 지자체 허브 블록 읽기 (W4 4단계 — 규칙은 region-hub-logic.ts). 공개 데이터 함수라 anon 키로만 읽는다.
//  · 설정 local_block_fields — 마이그레이션 …40의 공개 정책(이 키 한 줄)으로 읽는다. 행이 없거나 모양이 틀리면 null → 기사 블록 0(닫힌 쪽)
//  · 블록 기사 = 지자체뉴스 분야 + 블록 편집 분야 + 지역 태그 범위, 블록마다 4장(LIMITS.localBlock). 금주 핫뉴스(digest)·이관 미분류 0(readArticleList 규칙)
// 설정 쓰기(/api/admin/settings/local_block_fields)는 공개 데이터 캐시를 바로 만료한다 — 대응을 바꾸면 다음 요청부터.

/** 블록 ↔ 편집 분야 대응 (요청 안에서 한 번) */
export const readLocalBlockFields = cache(async (): Promise<LocalBlockFields | null> => {
  const rows = await rowsOf<{ key: string; value: unknown }>(publicDb().from("settings").select("key, value").eq("key", "local_block_fields"), "지자체 허브 블록 대응");
  return parseLocalBlockFields(rows[0]?.value);
});

/** 블록별 기사 — 고른 분야를 담지 않는 블록은 읽지 않는다 */
export async function readBlockArticles(fields: LocalBlockFields, topic: LocalTopic | null, regionCodes: readonly string[]): Promise<BlockArticles> {
  const db = publicDb();
  const entries = await Promise.all(
    ARTICLE_BLOCKS.map(async (block): Promise<[string, ArticleListItem[]] | null> => {
      const topics = blockTopics(fields, block, topic);
      if (topics.length === 0) return null;
      const { items } = await readArticleList(db, { section: "local", editorialFields: topics, regionCodes, limit: LIMITS.localBlock });
      return [block, items];
    }),
  );
  return Object.fromEntries(entries.filter((e) => e !== null)) as BlockArticles;
}

/** 지역 범위의 지자체뉴스 기사 수 (편집 분야와 상관없이 — 빈 지역 noindex·상위 안내 판정, REG1-01) */
export async function countRegionArticles(regionCodes: readonly string[]): Promise<number> {
  const { total } = await pageOf(
    publicDb()
      .from("public_articles")
      .select("id", { count: "exact", head: true })
      .eq("section", "local")
      .not("content_type", "is", null)
      .neq("content_type", "digest")
      .overlaps("region_codes", [...regionCodes]),
    "지역 기사 수",
  );
  return total;
}
