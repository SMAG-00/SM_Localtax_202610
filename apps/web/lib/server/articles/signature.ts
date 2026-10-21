import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { episodeTextErrors, type SeriesKey } from "@/lib/brand/claim";
import { dbError } from "@/lib/server/http";
import type { ArticleRow } from "./rows";

// 시그니처 연재 회차 — 편집국 저장·발행 검사 (W3 8단계 — BR-04, docs/dev/W3_설계.md 2.6). DB 트리거(signature_article_guard)가 마지막으로 다시 막는다.
//  · 회차 글(제목·요약·주소·본문)에 경력 연수 표기 0, 기사 연재 이름 칸 비움
//  · 「그때와 지금」 회차는 출처·기준연도가 있는 비교 항목 1개 이상이어야 발행

export interface EpisodeRef {
  seriesKey: SeriesKey;
  episode: number;
}

export async function loadEpisode(db: SupabaseClient, articleId: number): Promise<EpisodeRef | null> {
  const { data, error } = await db.from("signature_episodes").select("series_key, episode").eq("article_id", articleId).maybeSingle();
  if (error) throw dbError(error, "signature_episodes 조회");
  if (!data) return null;
  const row = data as { series_key: SeriesKey; episode: number };
  return { seriesKey: row.series_key, episode: Number(row.episode) };
}

/** 회차 글 검사 — 기사 한 판(저장 전 후보 포함)의 칸별 오류 */
export function episodeRowErrors(row: Pick<ArticleRow, "title" | "summary" | "slug" | "body" | "series_title">): string[] {
  return episodeTextErrors({ title: row.title, summary: row.summary, slug: row.slug, body: row.body, seriesTitle: row.series_title });
}

/** 발행 전 검사 — 시그니처 회차가 아니면 빈 목록 */
export async function signaturePublishErrors(db: SupabaseClient, row: ArticleRow): Promise<string[]> {
  const ep = await loadEpisode(db, row.id);
  if (!ep) return [];
  const errors = episodeRowErrors(row);
  if (ep.seriesKey === "then_now") {
    const { count, error } = await db.from("then_now_items").select("id", { count: "exact", head: true }).eq("article_id", row.id);
    if (error) throw dbError(error, "then_now_items 개수");
    if (!count) errors.push("thenNow: 「그때와 지금」 회차는 출처·기준연도가 있는 비교 항목이 1개 이상이어야 발행합니다");
  }
  return errors;
}
