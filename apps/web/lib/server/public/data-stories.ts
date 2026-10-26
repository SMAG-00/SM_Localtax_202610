import "server-only";
import { statsRenderable, type SeriesView } from "@/lib/data-stories/series";
import { publicDb, rowsOf } from "./db";
import { readPublicSettings } from "./reads";

// 데이터 스토리 공개 데이터 (DATA-01 - docs/dev/W12-h_설계.md). 공개 뷰(public_stats_series · public_article_data_charts · public_channel_posts)만 읽는다.
// 뷰는 기능 키가 꺼져 있거나 승인 전이면 0행이다. 화면도 statsRenderable로 출처·기준연도·확인일을 한 번 더 본다. AI는 쓰지 않는다.
const COLS = "id, series_key, title, tax_item, region_code, unit, points, source_name, source_url, base_year, checked_at, status";

function usable(rows: SeriesView[]): SeriesView[] {
  return rows.filter((r) => statsRenderable(r));
}

/** /data 목록 - 시계열마다 현재 승인본 하나. 기능 키가 꺼져 있거나 0개면 null (404) */
export async function listSeries(): Promise<SeriesView[] | null> {
  if (!(await readPublicSettings()).features.data_stories) return null;
  const rows = usable(await rowsOf<SeriesView>(publicDb().from("public_stats_series").select(COLS).eq("status", "approved").order("series_key"), "통계 시계열 목록"));
  return rows.length > 0 ? rows : null;
}

export interface SeriesPage {
  series: SeriesView;
  /** 같은 시계열의 승인된 기준연도 목록 (내림차순) */
  baseYears: number[];
  isCurrent: boolean;
}

/** /data/[key] - base가 없으면 현재 승인본, 있으면 그 기준연도의 가장 새 판. 없거나 렌더 불가면 null */
export async function getSeries(key: string, base: number | null): Promise<SeriesPage | null> {
  if (!(await readPublicSettings()).features.data_stories) return null;
  const rows = usable(await rowsOf<SeriesView>(publicDb().from("public_stats_series").select(COLS).eq("series_key", key).order("base_year", { ascending: false }).order("id", { ascending: false }), "통계 시계열"));
  if (rows.length === 0) return null;
  const current = rows.find((r) => r.status === "approved") ?? null;
  const pick = base === null ? current : rows.find((r) => r.base_year === base) ?? null;
  if (!pick) return null;
  return { series: pick, baseYears: [...new Set(rows.map((r) => r.base_year))], isCurrent: pick.status === "approved" };
}

export interface ArticleChart {
  series: SeriesView;
  caption: string | null;
  newerBaseYear: number | null;
}

/** 기사에 붙은 차트 - 시계열 ID와 기준연도로 고정된 승인본(이전 기준연도여도 그대로). 렌더 불가 시계열은 건너뛴다 */
export async function getArticleCharts(articleId: number): Promise<ArticleChart[]> {
  if (!(await readPublicSettings()).features.data_stories) return [];
  const links = await rowsOf<{ series_id: number; base_year: number; caption: string | null; newer_base_year: number | null }>(
    publicDb().from("public_article_data_charts").select("series_id, base_year, caption, newer_base_year").eq("article_id", articleId).order("position").order("series_id"),
    "기사 차트 연결",
  );
  if (links.length === 0) return [];
  const rows = await rowsOf<SeriesView>(publicDb().from("public_stats_series").select(COLS).in("id", links.map((l) => l.series_id)), "기사 차트 시계열");
  const byId = new Map(usable(rows).map((r) => [r.id, r]));
  return links.flatMap((l) => {
    const s = byId.get(l.series_id);
    return s && s.base_year === l.base_year ? [{ series: s, caption: l.caption, newerBaseYear: l.newer_base_year }] : [];
  });
}

/** 채널 유입 측정 - 게시 기록이 등록된 (채널, 기사 slug) 쌍인가. 기능 키 channel_kit이 꺼져 있으면 항상 false */
export async function isRegisteredChannelPair(channel: string, campaign: string): Promise<boolean> {
  if (!(await readPublicSettings()).features.channel_kit) return false;
  const rows = await rowsOf<{ channel: string }>(publicDb().from("public_channel_posts").select("channel").eq("channel", channel).eq("utm_campaign", campaign).limit(1), "채널 게시 등록");
  return rows.length > 0;
}
