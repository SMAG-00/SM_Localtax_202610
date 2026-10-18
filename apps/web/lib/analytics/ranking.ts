// 많이 본 기사(ART-11)·상담 사례 HOT(HOME-05) 순위 규칙 (docs/dev/W2-c_설계.md 8.2) — 순수 모듈 (시험 ranking.test.ts). 시각은 UTC 밀리초.
//  · 창 = 집계 시각이 든 시간대의 시작(end)에서 window시간 앞(start)까지의 끝난 시간대 [start, end) — 168시간이면 168시간 전 시간대 포함, 169시간 전 제외
//  · 많이 본 기사 = 창 안 사람 조회 합계 순. 0회·공개 후보 밖(비공개·삭제)·제외 유형(popular_rules.exclude_content_types)은 빠진다
//  · HOT = 편집자 고정(최대 hot_weights.max_pins건, 점수와 관계없이 맨 앞) → 점수(조회×view + 공유×share + 30초 열람×engaged) 순. 0점은 HOT 아님
//  · 같으면 최신 발행이 앞, 발행 시각도 같으면 번호가 큰(나중) 기사가 앞 — 결과가 늘 같다
//  · 가중치·창·건수는 모두 설정에서 온다 (코드 상수 0)
import { HOUR_MS, hourStart } from "./aggregate";
import type { HotWeights, PopularRules } from "./settings";

export interface RankingWindow {
  start: number;
  end: number;
}

export function rankingWindow(now: number, hours: number): RankingWindow {
  const end = hourStart(now);
  return { start: end - hours * HOUR_MS, end };
}

export const inRankingWindow = (hour: number, w: RankingWindow): boolean => hour >= w.start && hour < w.end;

export interface ArticleTotals {
  articleId: number;
  viewsHuman: number;
  shares: number;
  engagedViews: number;
}

/** 시간대 행 → 창 안 기사별 합계 (DB 함수 article_stats_totals와 같은 규칙 — 시험이 경계를 이 함수로 본다) */
export function totalsInWindow(rows: readonly (ArticleTotals & { hour: number })[], w: RankingWindow): ArticleTotals[] {
  const sum = new Map<number, ArticleTotals>();
  for (const r of rows) {
    if (!inRankingWindow(r.hour, w)) continue;
    const t = sum.get(r.articleId) ?? { articleId: r.articleId, viewsHuman: 0, shares: 0, engagedViews: 0 };
    t.viewsHuman += r.viewsHuman;
    t.shares += r.shares;
    t.engagedViews += r.engagedViews;
    sum.set(r.articleId, t);
  }
  return [...sum.values()].sort((a, b) => a.articleId - b.articleId);
}

/** 순위 후보 — 지금 공개된 기사 (집계 배치가 공개 기사 뷰에서 읽는다) */
export interface RankCandidate {
  id: number;
  contentType: string | null;
  publishedAt: string | null;
}

export interface RankedEntry {
  articleId: number;
  rank: number;
  score: number;
  pinned: boolean;
}

const published = (c: RankCandidate) => (c.publishedAt ? Date.parse(c.publishedAt) || 0 : 0);

function order(entries: Array<{ c: RankCandidate; score: number }>) {
  return entries.sort((a, b) => b.score - a.score || published(b.c) - published(a.c) || b.c.id - a.c.id);
}

/** 많이 본 기사 — 사람 조회 순, 최대 limit건 */
export function rankPopular(totals: readonly ArticleTotals[], candidates: readonly RankCandidate[], rules: Pick<PopularRules, "exclude_content_types">, limit: number): RankedEntry[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const excluded = new Set(rules.exclude_content_types);
  const scored = totals.flatMap((t) => {
    const c = byId.get(t.articleId);
    if (!c || t.viewsHuman <= 0 || (c.contentType !== null && excluded.has(c.contentType))) return [];
    return [{ c, score: t.viewsHuman }];
  });
  return order(scored)
    .slice(0, Math.max(0, limit))
    .map((e, i) => ({ articleId: e.c.id, rank: i + 1, score: e.score, pinned: false }));
}

/** HOT 점수 — 조회×view + 공유×share + 30초 이상 열람×engaged */
export const hotScore = (t: ArticleTotals, w: Pick<HotWeights, "view" | "share" | "engaged">): number => t.viewsHuman * w.view + t.shares * w.share + t.engagedViews * w.engaged;

/** 상담 사례 HOT — candidates는 상담 사례 분야의 공개 기사, pinnedIds는 지금 고정 중인 기사 */
export function rankHot(totals: readonly ArticleTotals[], candidates: readonly RankCandidate[], pinnedIds: ReadonlySet<number>, weights: HotWeights, limit: number): RankedEntry[] {
  const scores = new Map(totals.map((t) => [t.articleId, hotScore(t, weights)]));
  const all = candidates.map((c) => ({ c, score: scores.get(c.id) ?? 0 }));
  const pins = order(all.filter((e) => pinnedIds.has(e.c.id))).slice(0, Math.max(0, weights.max_pins));
  const pinned = new Set(pins.map((e) => e.c.id));
  const rest = order(all.filter((e) => !pinned.has(e.c.id) && e.score > 0));
  return [...pins.map((e) => ({ ...e, pinned: true })), ...rest.map((e) => ({ ...e, pinned: false }))]
    .slice(0, Math.max(0, limit))
    .map((e, i) => ({ articleId: e.c.id, rank: i + 1, score: e.score, pinned: e.pinned }));
}

export interface HotPick<T> {
  item: T;
  /** HOT 배지 — 고정이거나 최근 창 안 점수가 있는 기사. 채움 기사는 false */
  hot: boolean;
  pinned: boolean;
}

/**
 * 지방세 허브·상담 사례 목록의 HOT 블록 — 해결 사례 카드 cards장 + HOT 목록 list건, 같은 기사 0.
 *  · 카드 = 순위 목록에서 고정이 아닌 해결 사례(카드로 그릴 수 있는 것) 위에서부터, 모자라면 최신 해결 사례로 채운다(순위 목록의 고정 기사 제외)
 *  · HOT 목록 = 순위 목록에서 카드에 나온 기사를 뺀 앞 list건(HOT 배지), 모자라면 최신 상담 사례로 채운다(배지 없음)
 */
export function selectHotBlock<T extends { id: number; subtype: string }>(input: {
  ranked: readonly { item: T; pinned: boolean }[];
  latest: readonly T[];
  latestSolved: readonly T[];
  canCard: (item: T) => boolean;
  cards: number;
  list: number;
}): { cards: T[]; list: HotPick<T>[] } {
  const pinnedIds = new Set(input.ranked.filter((r) => r.pinned).map((r) => r.item.id));
  const used = new Set<number>();
  const cards: T[] = [];
  const takeCard = (item: T) => {
    if (cards.length >= input.cards || used.has(item.id) || pinnedIds.has(item.id) || item.subtype !== "solved_case" || !input.canCard(item)) return;
    cards.push(item);
    used.add(item.id);
  };
  for (const r of input.ranked) takeCard(r.item);
  for (const item of input.latestSolved) takeCard(item);
  const list: HotPick<T>[] = [];
  for (const r of input.ranked) {
    if (list.length >= input.list) break;
    if (used.has(r.item.id)) continue;
    list.push({ item: r.item, hot: true, pinned: r.pinned });
    used.add(r.item.id);
  }
  for (const item of input.latest) {
    if (list.length >= input.list) break;
    if (used.has(item.id)) continue;
    list.push({ item, hot: false, pinned: false });
    used.add(item.id);
  }
  return { cards, list };
}

/** 기사 사이드바 — 지금 보는 기사를 빼고 앞에서 size건 (ART-11) */
export function sidebarPicks<T extends { id: number }>(items: readonly T[], currentId: number, size: number): T[] {
  return items.filter((i) => i.id !== currentId).slice(0, Math.max(0, size));
}

export type HotPinCheck = { ok: true } | { ok: false; status: 409 | 422; message: string };

/** HOT 고정 판정 (HOME-05 — 상담 사례 분야 기사만, 최대 max_pins건, 3번째 고정은 막힌다). 고정 풀기·지난 시각은 늘 된다 */
export function checkHotPin(input: { inHotCategory: boolean; until: number | null; now: number; otherActivePins: number; maxPins: number }): HotPinCheck {
  if (input.until === null || input.until <= input.now) return { ok: true };
  if (!input.inHotCategory) return { ok: false, status: 422, message: "HOT 고정은 상담 사례(지방세 › 해석) 분야 기사만 할 수 있습니다 (HOME-05)" };
  if (input.otherActivePins >= input.maxPins) {
    return { ok: false, status: 409, message: `HOT 고정은 최대 ${input.maxPins}건입니다 — 다른 기사의 고정을 먼저 풀어 주세요 (HOME-05)` };
  }
  return { ok: true };
}
