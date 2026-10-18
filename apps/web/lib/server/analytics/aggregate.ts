import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ARTICLE_EVENT_NAMES, countArticleHours, hourStart, parseArticleEvent, planAggregation, retentionCutoff, type ArticleEvent } from "@/lib/analytics/aggregate";
import { rankHot, rankPopular, rankingWindow, type ArticleTotals, type RankCandidate, type RankedEntry, type RankingWindow } from "@/lib/analytics/ranking";
import { parseCheckedSettings, type AnalyticsSettingKey } from "@/lib/analytics/settings";
import { HOT_CATEGORY } from "../public/constants";

// 측정 집계 배치의 바깥 일 (docs/dev/W2-c_설계.md 8.2) — 규칙은 lib/analytics/aggregate.ts·ranking.ts(순수 함수) 한 곳.
//  · service_role로만 읽고 쓴다 (원본 analytics_events·article_stats는 anon·authenticated 0). 공개 화면은 article_rankings의 순위 칸만 anon으로 읽는다
//  · popular-hourly: 바뀐 시간대 찾기 → 시간대마다 이벤트를 읽어 다시 세기 → article_stats 바꾸기(멱등) → 순위 두 개 바꾸기(한 트랜잭션씩)
//  · analytics-retention: 보존 기한(analytics.retention_days)보다 오래된 원본 이벤트·시간 단위 집계를 나눠 지운다
//  · 설정(popular_rules·hot_weights·analytics)이 없거나 모양이 틀리면 실패로 끝낸다 — 순위를 바꾸지 않는다(지난 순위가 그대로 보인다)
//  · 오류 문장에는 DB 오류 코드만 — 이벤트 값·방문자 ID는 남기지 않는다

export const POPULAR_JOB = "popular-hourly";
/** API 한 번에 받는 행 (Supabase max_rows 1,000) */
const PAGE = 1000;
/** in.(…) 한 번에 넣는 번호 수 — 주소 길이 */
const ID_CHUNK = 200;
/** 순위 표에 두는 건수 (DB check rank 1~100) — 화면 건수(설정)보다 넉넉히 두어, 비공개로 빠진 기사가 있어도 목록이 차게 한다 */
const STORE_LIMIT = 100;
/** 보존 기한 정리 — 한 번에 지우는 행 · 한 실행의 최대 횟수 (남으면 다음 날 이어서) */
const PURGE_BATCH = 5000;
const PURGE_ROUNDS = 20;

type Db = SupabaseClient;
const iso = (ms: number) => new Date(ms).toISOString();
const fail = (what: string, error: { code?: string } | null | undefined) => new Error(`${what} 실패 (${error?.code ?? "응답 없음"})`);

async function readSettings<K extends AnalyticsSettingKey>(db: Db, keys: readonly K[]) {
  const { data, error } = await db.from("settings").select("key, value").in("key", [...keys]);
  if (error) throw fail("집계 설정 읽기", error);
  const parsed = parseCheckedSettings((data ?? []) as { key: string; value: unknown }[], keys);
  if (!parsed.ok) throw new Error(`집계 설정 문제 — ${parsed.problems.join(" / ")}`);
  return parsed.values;
}

async function rpc<T>(db: Db, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw fail(fn, error);
  return data as T;
}

/** 지난 성공 실행이 남긴 이벤트 번호 — 없으면 0 (집계 창 전체를 센다) */
async function lastWatermark(db: Db): Promise<number> {
  const { data, error } = await db.from("agent_runs").select("detail").eq("job", POPULAR_JOB).eq("status", "succeeded").order("id", { ascending: false }).limit(1);
  if (error) throw fail("지난 집계 기록 읽기", error);
  const w = (data?.[0]?.detail as { watermark?: unknown } | null | undefined)?.watermark;
  return typeof w === "number" && Number.isSafeInteger(w) && w >= 0 ? w : 0;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** [from, to) 기사 이벤트 — 번호 순으로 끝까지 */
async function readEvents(db: Db, from: number, to: number): Promise<ArticleEvent[]> {
  const out: ArticleEvent[] = [];
  let after = 0;
  for (;;) {
    const { data, error } = await db
      .from("analytics_events")
      .select("id, name, occurred_at, visitor_id, is_bot, is_staff, article_id:props->article_id")
      .in("name", [...ARTICLE_EVENT_NAMES])
      .gte("occurred_at", iso(from))
      .lt("occurred_at", iso(to))
      .gt("id", after)
      .order("id")
      .limit(PAGE);
    if (error) throw fail("측정 이벤트 읽기", error);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    for (const r of rows) {
      const e = parseArticleEvent(r as Parameters<typeof parseArticleEvent>[0]);
      if (e) out.push(e);
    }
    if (rows.length < PAGE) return out;
    after = Number(rows.at(-1)!.id);
  }
}

const chunks = <T>(list: readonly T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

interface CandidateRow {
  id: number;
  content_type: string | null;
  first_published_at: string | null;
  category_id: number | null;
}

/** 지금 공개된 목록 기사(유형 있음 · 금주 핫뉴스 아님) — 공개 기사 뷰(public_articles) */
async function readCandidates(db: Db, ids: readonly number[], categoryId?: number): Promise<RankCandidate[]> {
  const out: RankCandidate[] = [];
  for (const part of chunks(ids, ID_CHUNK)) {
    let q = db.from("public_articles").select("id, content_type, first_published_at, category_id").in("id", part).not("content_type", "is", null).neq("content_type", "digest");
    if (categoryId !== undefined) q = q.eq("category_id", categoryId);
    const { data, error } = await q;
    if (error) throw fail("공개 기사 읽기", error);
    for (const r of (data ?? []) as CandidateRow[]) out.push({ id: Number(r.id), contentType: r.content_type, publishedAt: r.first_published_at });
  }
  return out;
}

async function windowTotals(db: Db, w: RankingWindow): Promise<ArticleTotals[]> {
  const rows = await rpc<Array<{ article_id: number; views_human: number; shares: number; engaged_views: number }>>(db, "article_stats_totals", { p_from: iso(w.start), p_to: iso(w.end) });
  return (rows ?? []).map((r) => ({ articleId: Number(r.article_id), viewsHuman: Number(r.views_human), shares: Number(r.shares), engagedViews: Number(r.engaged_views) }));
}

async function replaceRanking(db: Db, list: "popular" | "hot", entries: readonly RankedEntry[], w: RankingWindow, now: Date, version: string): Promise<number> {
  const rows = entries.map((e) => ({ rank: e.rank, article_id: e.articleId, pinned: e.pinned, score: e.score }));
  return rpc<number>(db, "article_rankings_replace", {
    p_list: list,
    p_rows: rows,
    p_window_start: iso(w.start),
    p_window_end: iso(w.end),
    p_computed_at: now.toISOString(),
    p_settings_version: version,
  });
}

/** 상담 사례 HOT 분야 번호 — 없거나 숨긴 분야면 null (HOT 순위 0건) */
async function hotCategoryId(db: Db): Promise<number | null> {
  const { data, error } = await db.from("categories").select("id").eq("section", HOT_CATEGORY.section).eq("slug", HOT_CATEGORY.slug).eq("visible", true).limit(1);
  if (error) throw fail("상담 사례 분야 읽기", error);
  return data?.[0] ? Number(data[0].id) : null;
}

/** 지금 HOT 고정 중인 공개 기사 (hot_pin_until이 지금보다 뒤) */
async function activePins(db: Db, categoryId: number, now: Date): Promise<number[]> {
  const { data, error } = await db.from("articles").select("id").eq("status", "published").eq("category_id", categoryId).gt("hot_pin_until", now.toISOString());
  if (error) throw fail("HOT 고정 읽기", error);
  return (data ?? []).map((r) => Number(r.id));
}

/** popular-hourly — 시간 단위 집계를 바꾸고 순위 두 개를 다시 매긴다. 결과(detail)는 실행 기록에 남고, watermark는 다음 실행이 읽는다 */
export async function aggregatePopular(db: Db, now: Date): Promise<Record<string, unknown>> {
  const { popular_rules: rules, hot_weights: weights } = await readSettings(db, ["popular_rules", "hot_weights"] as const);
  const watermark = await lastWatermark(db);
  const current = hourStart(now.getTime());
  const lookbackHours = Math.max(rules.window_hours, weights.window_days * 24);
  const changes = await rpc<{ hours: string[]; pending_min_id: number | null; max_id: number | null }>(db, "analytics_article_changes", {
    p_after_id: watermark,
    p_since: iso(current - lookbackHours * 3_600_000),
    p_before: iso(current),
  });
  const plan = planAggregation({
    now: now.getTime(),
    watermark,
    changedHours: (changes.hours ?? []).map((h) => Date.parse(h)),
    pendingMinId: num(changes.pending_min_id),
    maxId: num(changes.max_id),
    lookbackHours,
    dedupeMinutes: rules.dedupe_minutes,
  });

  let statRows = 0;
  for (const range of plan.ranges) {
    const events = await readEvents(db, range.from - rules.dedupe_minutes * 60_000, range.to);
    const stats = countArticleHours(events, range, rules.dedupe_minutes);
    statRows += await rpc<number>(db, "article_stats_replace", {
      p_from: iso(range.from),
      p_to: iso(range.to),
      p_rows: stats.map((s) => ({ article_id: s.articleId, hour: iso(s.hour), views_all: s.viewsAll, views_human: s.viewsHuman, shares: s.shares, engaged_views: s.engagedViews })),
      p_computed_at: now.toISOString(),
    });
  }

  // 많이 본 기사 — 최근 window_hours시간 사람 조회
  const popularWindow = rankingWindow(now.getTime(), rules.window_hours);
  const popularTotals = await windowTotals(db, popularWindow);
  const popularCandidates = await readCandidates(db, popularTotals.filter((t) => t.viewsHuman > 0).map((t) => t.articleId));
  const popular = rankPopular(popularTotals, popularCandidates, rules, STORE_LIMIT);
  const popularCount = await replaceRanking(db, "popular", popular, popularWindow, now, rules.version);

  // 상담 사례 HOT — 최근 window_days일 점수 + 편집자 고정
  const hotWindow = rankingWindow(now.getTime(), weights.window_days * 24);
  const categoryId = await hotCategoryId(db);
  let hot: RankedEntry[] = [];
  if (categoryId !== null) {
    const hotTotals = await windowTotals(db, hotWindow);
    const pins = await activePins(db, categoryId, now);
    const ids = [...new Set([...hotTotals.map((t) => t.articleId), ...pins])];
    const hotCandidates = await readCandidates(db, ids, categoryId);
    hot = rankHot(hotTotals, hotCandidates, new Set(pins), weights, STORE_LIMIT);
  }
  const hotCount = await replaceRanking(db, "hot", hot, hotWindow, now, weights.version);

  return {
    watermark: plan.watermark,
    hours: plan.hours.length,
    statRows,
    windowEnd: iso(current),
    popular: { count: popularCount, settings: rules.version },
    hot: { count: hotCount, settings: weights.version },
  };
}

/** analytics-retention — 보존 기한보다 오래된 원본 이벤트·시간 단위 집계를 나눠 지운다. 다 못 지우면 done=false (다음 실행이 이어서) */
export async function purgeAnalytics(db: Db, now: Date): Promise<Record<string, unknown>> {
  const { analytics } = await readSettings(db, ["analytics"] as const);
  const cutoff = retentionCutoff(now.getTime(), analytics.retention_days);
  const statsCutoff = hourStart(cutoff);
  const purge = async (fn: string, before: number) => {
    let removed = 0;
    for (let round = 0; round < PURGE_ROUNDS; round++) {
      const n = await rpc<number>(db, fn, { p_before: iso(before), p_limit: PURGE_BATCH });
      removed += n;
      if (n < PURGE_BATCH) return { removed, done: true };
    }
    return { removed, done: false };
  };
  const events = await purge("analytics_events_purge", cutoff);
  const stats = await purge("article_stats_purge", statsCutoff);
  return { retentionDays: analytics.retention_days, cutoff: iso(cutoff), events: events.removed, stats: stats.removed, done: events.done && stats.done };
}
