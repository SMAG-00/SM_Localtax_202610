// 이번 주 카드뉴스 초안 (PO 결정 2026-10-31 — 디펜스투데이 벤치마킹 '새로 쓰지 않는다') — 순수 모듈 (시험: weekly-cardnews.test.ts).
//  · 고르기: 지난 7일 [지금 - 7일, 지금] 안에 처음 발행된 공개 기사 중 사람 조회(article_stats.views_human) 합계 순 3건.
//    카드뉴스 기사 자신·제외 유형(popular_rules.exclude_content_types — 금주 핫뉴스·광고)·유형 없는 이관 기사는 뺀다.
//    같은 조회 수면 최신 발행이 앞, 발행 시각도 같으면 번호가 큰(나중) 기사가 앞 (많이 본 기사 순위와 같은 규칙).
//    후보 기사 모두 조회 기록이 0이면 최신 발행 순으로 고르고 그렇게 골랐다고 알린다 (mode = "latest").
//  · 만들기: 표지 1장 + 기사 3장 + 마무리 1장 = 5장 (ART-03 5~7장). 장 글자는 기사의 제목·요약·주소와 고정 문구뿐 — AI·새 문장 0.
//    장은 글자 장(HTML 글자)이라 그림이 필요 없다. 대표 사진은 고른 기사 중 권리 확인된 대표 사진이 있을 때만 그 번호를 쓴다.
//  · 결과는 POST /api/admin/articles와 같은 입력 모양 — 서버가 같은 입력 검사(parseArticleInput)를 거쳐 초안으로 저장한다.
import { CARDNEWS_SLIDES } from "@ltr/editorial";

/** 카드뉴스에 넣는 기사 수 — 표지·마무리와 합쳐 5장 (CARDNEWS_SLIDES.min) */
export const WEEKLY_CARDNEWS_PICKS = CARDNEWS_SLIDES.min - 2;
export const WEEK_MS = 7 * 86_400_000;

/** 고르기 후보 — 공개 기사 한 건 (public_articles) */
export interface WeeklyCandidate {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  format: string;
  contentType: string | null;
  section: string;
  /** 최초 발행 시각 (ISO) */
  publishedAt: string | null;
  /** 대표 사진 — 없으면 null. rightsStatus는 media.rights_status */
  leadMedia: { id: number; rightsStatus: string } | null;
}

export interface WeeklyWindow {
  /** UTC 밀리초 — 이 시각 이상 */
  from: number;
  /** UTC 밀리초 — 이 시각 이하 */
  to: number;
}

export type WeeklyPickMode = "views" | "latest";

export interface WeeklyPicked extends WeeklyCandidate {
  views: number;
}

export interface WeeklyPick {
  mode: WeeklyPickMode;
  window: WeeklyWindow;
  articles: WeeklyPicked[];
}

export type WeeklyResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function weeklyWindow(now: number): WeeklyWindow {
  return { from: now - WEEK_MS, to: now };
}

const KST_MS = 9 * 3_600_000;
const kstParts = (ms: number) => {
  const d = new Date(ms + KST_MS).toISOString();
  return { y: d.slice(0, 4), m: d.slice(5, 7), d: d.slice(8, 10) };
};

/** 한국 날짜 범위 — "2026.10.24 ~ 10.31" (해가 바뀌면 끝에도 연도) */
export function weekRangeLabel(w: WeeklyWindow): string {
  const a = kstParts(w.from);
  const b = kstParts(w.to);
  return `${a.y}.${a.m}.${a.d} ~ ${a.y === b.y ? "" : `${b.y}.`}${b.m}.${b.d}`;
}

/** 짧은 범위 — 제목용 "10.24~10.31" */
function shortRange(w: WeeklyWindow): string {
  const a = kstParts(w.from);
  const b = kstParts(w.to);
  return `${a.m}.${a.d}~${b.m}.${b.d}`;
}

/** 초안 slug 기본값 — weekly-cardnews-YYYYMMDD (한국 날짜). 같은 날 또 만들면 서버가 -2, -3을 붙인다 */
export function weeklyCardNewsSlug(now: number): string {
  const p = kstParts(now);
  return `weekly-cardnews-${p.y}${p.m}${p.d}`;
}

const publishedMs = (c: WeeklyCandidate): number | null => {
  if (!c.publishedAt) return null;
  const t = Date.parse(c.publishedAt);
  return Number.isFinite(t) ? t : null;
};

/** 지난 7일 공개 기사에서 3건 고르기 — 조회 기록이 있으면 조회 순, 없으면 최신 순 */
export function pickWeeklyArticles(
  candidates: readonly WeeklyCandidate[],
  views: ReadonlyMap<number, number>,
  opts: { now: number; excludeContentTypes: readonly string[] },
): WeeklyResult<WeeklyPick> {
  const window = weeklyWindow(opts.now);
  const excluded = new Set(opts.excludeContentTypes);
  const eligible = candidates.flatMap((c) => {
    const t = publishedMs(c);
    if (t === null || t < window.from || t > window.to) return [];
    if (c.format === "cardnews" || c.contentType === null || excluded.has(c.contentType)) return [];
    return [{ c, t, views: Math.max(0, views.get(c.id) ?? 0) }];
  });
  if (eligible.length < WEEKLY_CARDNEWS_PICKS) {
    return {
      ok: false,
      error: `지난 7일(${weekRangeLabel(window)}) 동안 발행한 기사가 ${eligible.length}건이라 카드뉴스를 만들 수 없습니다 — 표지·기사·마무리 ${CARDNEWS_SLIDES.min}장을 채우려면 기사가 ${WEEKLY_CARDNEWS_PICKS}건 있어야 합니다`,
    };
  }
  const mode: WeeklyPickMode = eligible.some((e) => e.views > 0) ? "views" : "latest";
  eligible.sort((a, b) => (mode === "views" ? b.views - a.views : 0) || b.t - a.t || b.c.id - a.c.id);
  return { ok: true, value: { mode, window, articles: eligible.slice(0, WEEKLY_CARDNEWS_PICKS).map((e) => ({ ...e.c, views: e.views })) } };
}

/** 고르기 방식 안내 — 화면·감사 로그에 같은 글자 */
export const PICK_MODE_NOTES: Readonly<Record<WeeklyPickMode, string>> = {
  views: "지난 7일 사람 조회 수가 많은 순으로 골랐습니다",
  latest: "조회수 기록이 없어 최신 순으로 골랐습니다",
};

const clip = (s: string, max: number) => ([...s].length > max ? `${[...s].slice(0, max - 1).join("")}…` : s);

/** 기사 분야 — 고른 기사에 가장 많은 분야, 같으면 순위가 앞선 기사의 분야 */
function majoritySection(articles: readonly WeeklyPicked[]): string {
  const count = new Map<string, number>();
  for (const a of articles) count.set(a.section, (count.get(a.section) ?? 0) + 1);
  let best = articles[0]!.section;
  for (const a of articles) if ((count.get(a.section) ?? 0) > (count.get(best) ?? 0)) best = a.section;
  return best;
}

export interface WeeklyDraftOptions {
  slug: string;
  /** 사이트 주소 (끝 '/' 없이) — 없으면 장 글자에 /news/… 경로만 적는다 */
  siteBase: string | null;
}

export const COVER_TITLE = `이번 주 지방세·부동산 소식 ${WEEKLY_CARDNEWS_PICKS}`;
export const CLOSING_TITLE = "더 많은 소식은 사이트에서 읽을 수 있습니다";
export const LINKS_HEADING = "이번 주 소개한 기사";

/** 고른 기사 → 카드뉴스 초안 입력 (POST /api/admin/articles 모양) */
export function buildWeeklyCardNewsInput(pick: WeeklyPick, opts: WeeklyDraftOptions): Record<string, unknown> {
  const base = (opts.siteBase ?? "").replace(/\/+$/, "");
  const range = weekRangeLabel(pick.window);
  const pickedLabel = pick.mode === "views" ? `많이 본 기사 ${pick.articles.length}건` : `새로 발행한 기사 ${pick.articles.length}건`;
  const cover = {
    type: "slide",
    title: COVER_TITLE,
    text: `${range}\n${pickedLabel}`,
    alt: `표지 — ${COVER_TITLE} (${range}, ${pickedLabel})`,
  };
  const articleSlides = pick.articles.map((a, i) => ({
    type: "slide",
    title: clip(a.title.trim(), 200),
    text: [a.summary?.trim() ?? "", `기사 보기: ${base}/news/${a.slug}`].filter(Boolean).join("\n"),
    alt: clip(`${i + 1}번째 기사 — ${a.title.trim()}`, 500),
  }));
  const closing = {
    type: "slide",
    title: CLOSING_TITLE,
    text: `${base}/news`,
    alt: "마무리 — 사이트 주소 안내",
  };
  const links = [
    { type: "heading", level: 2, text: LINKS_HEADING },
    ...pick.articles.map((a) => ({ type: "paragraph", text: `[${a.title.trim().replace(/[[\]\n]/g, "")}](/news/${encodeURIComponent(a.slug)})` })),
  ];
  const lead = pick.articles.find((a) => a.leadMedia?.rightsStatus === "confirmed")?.leadMedia ?? null;
  return {
    slug: opts.slug,
    title: `${COVER_TITLE} (${shortRange(pick.window)})`,
    summary: pick.mode === "views" ? `지난 7일 많이 본 기사 ${pick.articles.length}건을 카드뉴스로 모았습니다` : `지난 7일 새로 발행한 기사 ${pick.articles.length}건을 카드뉴스로 모았습니다`,
    format: "cardnews",
    section: majoritySection(pick.articles),
    contentType: "explainer",
    leadMediaId: lead ? lead.id : null,
    body: { blocks: [cover, ...articleSlides, closing, ...links], claims: [] },
  };
}
