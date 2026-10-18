// 1시간 집계 규칙 (docs/dev/W2-c_설계.md 8.2 — ART-11 · HOME-05) — 순수 모듈 (시험 aggregate.test.ts). 시각은 UTC 밀리초.
//  · 시간대 = UTC 정시 [h, h+1시간). article_stats.hour가 같은 값이다
//  · 전체 조회(views_all) = 모든 article_viewed (봇·편집국 포함, 중복 제거 없음)
//  · 사람 값(views_human·shares·engaged_views) = 봇·편집국이 아닌 이벤트. 같은 방문자·같은 기사·같은 이벤트가 마지막 이벤트에서
//    dedupe_minutes분 안에 다시 오면 세지 않는다(세지 않은 반복도 '마지막 이벤트'다 — 계속 새로고침하면 1회). 정확히 dedupe_minutes분 뒤면 다시 1회
//    (세션 경계 '정확히 30분 → 새 세션'과 같은 쪽). 방문자 ID가 없는 이벤트는 중복 제거 없이 센다 (ART-11 '측정 거부 조회')
//  · 시간대 h를 세려면 [h − dedupe_minutes, h+1시간)의 이벤트가 필요하다 — 앞 시간대 이벤트는 이력으로만 본다
//  · 다시 집계할 시간대(planAggregation): 지난 실행이 본 마지막 이벤트 번호 뒤에 들어온 이벤트의 시간대 + 중복 제거가 넘어가는 뒤 시간대
//    + 늘 바로 앞 시간대(시간대 끝에 막 저장된 이벤트) — 지금(끝나지 않은) 시간대는 끝난 뒤에. 집계 창(lookback)보다 오래된 시간대는 다시 세지 않는다

export const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** 한 번에 바꾸는 시간 단위 집계 범위 — 첫 실행(168시간)도 하루씩 나눠 쓴다 */
const MAX_RANGE_HOURS = 24;

export const ARTICLE_EVENT_NAMES = ["article_viewed", "article_engaged", "article_shared"] as const;
export type ArticleEventName = (typeof ARTICLE_EVENT_NAMES)[number];

export const hourStart = (ms: number): number => Math.floor(ms / HOUR_MS) * HOUR_MS;

export interface ArticleEvent {
  id: number;
  name: ArticleEventName;
  /** occurred_at (서버 시각) */
  at: number;
  visitorId: string | null;
  articleId: number;
  isBot: boolean;
  isStaff: boolean;
}

export interface HourStats {
  articleId: number;
  /** 시간대 시작 (UTC 정시) */
  hour: number;
  viewsAll: number;
  viewsHuman: number;
  shares: number;
  engagedViews: number;
}

const toInt = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) ? n : null;
};

/** DB 행(analytics_events — 기사 번호는 props.article_id) → 집계 이벤트. 기사 이벤트가 아니거나 번호·시각을 읽을 수 없으면 null */
export function parseArticleEvent(row: {
  id: unknown;
  name: unknown;
  occurred_at: unknown;
  visitor_id: unknown;
  article_id: unknown;
  is_bot: unknown;
  is_staff: unknown;
}): ArticleEvent | null {
  const id = toInt(row.id);
  const articleId = toInt(row.article_id);
  const at = typeof row.occurred_at === "string" ? Date.parse(row.occurred_at) : NaN;
  if (id === null || articleId === null || articleId < 1 || Number.isNaN(at)) return null;
  if (!(ARTICLE_EVENT_NAMES as readonly unknown[]).includes(row.name)) return null;
  return {
    id,
    name: row.name as ArticleEventName,
    at,
    visitorId: typeof row.visitor_id === "string" && row.visitor_id !== "" ? row.visitor_id : null,
    articleId,
    isBot: row.is_bot === true,
    isStaff: row.is_staff === true,
  };
}

/** 시간대·기사별 집계 — range [from, to) 안 시간대 행만, 시간대·기사 번호 순. 앞 시간대 이벤트는 중복 제거 이력으로만 쓴다 */
export function countArticleHours(events: readonly ArticleEvent[], range: { from: number; to: number }, dedupeMinutes: number): HourStats[] {
  const dedupeMs = Math.max(0, dedupeMinutes) * MINUTE_MS;
  const sorted = [...events].sort((a, b) => a.at - b.at || a.id - b.id);
  const last = new Map<string, number>();
  const out = new Map<string, HourStats>();
  const statOf = (articleId: number, hour: number) => {
    const key = `${hour}:${articleId}`;
    let s = out.get(key);
    if (!s) {
      s = { articleId, hour, viewsAll: 0, viewsHuman: 0, shares: 0, engagedViews: 0 };
      out.set(key, s);
    }
    return s;
  };
  for (const e of sorted) {
    const inRange = e.at >= range.from && e.at < range.to;
    const hour = hourStart(e.at);
    if (inRange && e.name === "article_viewed") statOf(e.articleId, hour).viewsAll += 1;
    if (e.isBot || e.isStaff) continue;
    let counted = true;
    if (e.visitorId !== null) {
      const key = `${e.name}:${e.articleId}:${e.visitorId}`;
      const prev = last.get(key);
      counted = prev === undefined || e.at - prev >= dedupeMs;
      last.set(key, e.at);
    }
    if (!inRange || !counted) continue;
    const s = statOf(e.articleId, hour);
    if (e.name === "article_viewed") s.viewsHuman += 1;
    else if (e.name === "article_shared") s.shares += 1;
    else s.engagedViews += 1;
  }
  return [...out.values()].sort((a, b) => a.hour - b.hour || a.articleId - b.articleId);
}

export interface AggregationPlan {
  /** 다시 집계할 시간대 (오름차순) */
  hours: number[];
  /** 이어진 시간대를 묶은 범위 [from, to) — 하나는 24시간까지 */
  ranges: Array<{ from: number; to: number }>;
  /** 다음 실행이 '이 번호 뒤'를 새 이벤트로 본다 */
  watermark: number;
}

export function planAggregation(input: {
  now: number;
  /** 지난 실행이 남긴 번호 (처음이면 0) */
  watermark: number;
  /** 번호가 watermark 뒤인 기사 이벤트의 시간대 (지금 시간대 앞만 — analytics_article_changes) */
  changedHours: readonly number[];
  /** 번호가 watermark 뒤이고 지금 시간대에 든 이벤트의 가장 작은 번호 */
  pendingMinId: number | null;
  /** 번호가 watermark 뒤인 기사 이벤트의 가장 큰 번호 */
  maxId: number | null;
  /** 순위가 보는 가장 긴 창 (시간) — 이보다 오래된 시간대는 다시 세지 않는다 */
  lookbackHours: number;
  dedupeMinutes: number;
}): AggregationPlan {
  const current = hourStart(input.now);
  const floor = current - input.lookbackHours * HOUR_MS;
  const spill = Math.ceil(Math.max(0, input.dedupeMinutes) / 60);
  const set = new Set<number>([current - HOUR_MS]);
  for (const raw of input.changedHours) {
    const h = hourStart(raw);
    for (let k = 0; k <= spill; k++) set.add(h + k * HOUR_MS);
  }
  const hours = [...set].filter((h) => h >= floor && h < current).sort((a, b) => a - b);
  const ranges: Array<{ from: number; to: number }> = [];
  for (const h of hours) {
    const last = ranges.at(-1);
    if (last && last.to === h && last.to - last.from < MAX_RANGE_HOURS * HOUR_MS) last.to = h + HOUR_MS;
    else ranges.push({ from: h, to: h + HOUR_MS });
  }
  const next = input.pendingMinId !== null ? input.pendingMinId - 1 : (input.maxId ?? input.watermark);
  return { hours, ranges, watermark: Math.max(input.watermark, next) };
}

/** 보존 기한 — 이 시각보다 앞선 원본 이벤트·시간 단위 집계를 지운다 (analytics.retention_days) */
export const retentionCutoff = (now: number, retentionDays: number): number => now - retentionDays * DAY_MS;
