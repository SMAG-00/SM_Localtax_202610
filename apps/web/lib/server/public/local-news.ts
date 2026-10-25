import "server-only";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { eventSourceInfo, type EventSourceInfo } from "@/lib/field-data/event-source";
import { isoWeekRange } from "@/lib/site/iso-week";
import { matchRegion, regionRoute, type RegionRouteRow } from "@/lib/site/region-route";
import { publicDb, rowsOf } from "./db";
import {
  cardsInMonth,
  eventCard,
  eventsBlock,
  monthRange,
  regionCodeSet,
  selectEvents,
  weeklyBlock,
  type DigestItemRow,
  type DigestRow,
  type EventCard,
  type EventRow,
  type EventsBlockView,
  type MonthRange,
  type WeeklyBlockView,
} from "./local-news-logic";
import { readPublicSettings, readRegions } from "./reads";

// 지자체뉴스 W6 공개 읽기 (LG-01 · LG-09 · LG-10 · LG-12 · LG-14 · REG-04). 공개 뷰 public_* 만 anon 키로 읽는다.
// 기능 키 weekly_digest·local_events가 꺼져 있으면 DB 뷰가 0행이지만 여기서도 먼저 막는다(화면은 404).
// 규칙(정렬·기간·달력·허브 블록)은 local-news-logic.ts 한 곳.

const todayKst = (now: Date) => isoToKstDate(now.toISOString());
const EVENT_COLUMNS =
  "id, slug, series_key, title, category, organizer, organizer_type, venue, region_code, starts_at, ends_at, official_url, source_name, confirmed_on, sponsored, status_source_url, status_confirmed_at, status, recheck_due, hide_stale, license_type, image_url";
type PublicEventRow = EventRow & { hide_stale: boolean };

export async function localEventsOpen(): Promise<boolean> {
  return (await readPublicSettings()).features.local_events;
}
export async function weeklyDigestOpen(): Promise<boolean> {
  return (await readPublicSettings()).features.weekly_digest;
}

async function readEventRows(): Promise<PublicEventRow[]> {
  return rowsOf<PublicEventRow>(publicDb().from("public_local_events").select(EVENT_COLUMNS).order("starts_at").limit(2000), "행사안내 공개 뷰");
}

/** 지역 매개값(시·도 slug, 시·도/시·군·구 slug, 또는 10자리 코드) → 지역 코드. 알 수 없으면 null, 빈 값이면 undefined(전국) */
export function resolveRegionParam(param: string | null | undefined, regions: readonly RegionRouteRow[], today: string): string | null | undefined {
  if (param === null || param === undefined || param.trim() === "") return undefined;
  const p = param.trim();
  if (/^\d{10}$/.test(p)) return regions.some((r) => r.code === p) ? p : null;
  const route = regionRoute(`/local/${p}`);
  if (!route) return null;
  const m = matchRegion(route, regions, today);
  return m.kind === "current" ? (m.sigungu ?? m.sido).code : null;
}

export interface EventListView {
  open: boolean;
  today: string;
  range: MonthRange;
  month: string | null;
  regionCode: string | null;
  regionName: string | null;
  cards: EventCard[];
  /** 달마다 (달력 + 목록) */
  months: { month: string; cards: EventCard[] }[];
  archive: EventCard[];
  /** 시·도 필터 칩 */
  sidos: { code: string; name: string }[];
  /** 알 수 없는 지역 매개값이 들어왔다 */
  badRegion: boolean;
}

/** 행사 목록·달력 (REG-04) — 같은 함수가 GET /api/local/events 응답도 만든다 */
export async function getEventList(params: { region?: string | null; month?: string | null; now?: Date } = {}): Promise<EventListView> {
  const now = params.now ?? new Date();
  const today = todayKst(now);
  const range = monthRange(today, params.month);
  const closed: EventListView = { open: false, today, range, month: null, regionCode: null, regionName: null, cards: [], months: [], archive: [], sidos: [], badRegion: false };
  if (!(await localEventsOpen())) return closed;
  const [rows, regions] = await Promise.all([readEventRows(), readRegions()]);
  const code = resolveRegionParam(params.region, regions, today);
  const hideStale = rows.some((r) => r.hide_stale);
  const regionCodes = code ? regionCodeSet(code, regions) : null;
  const cards = selectEvents(rows, { today, regionCodes: code === null ? new Set<string>() : regionCodes, range, hideStale });
  const archive = selectEvents(rows, { today, regionCodes: code === null ? new Set<string>() : regionCodes, range: null, archive: true }).slice(0, 30);
  const region = code ? regions.find((r) => r.code === code) : undefined;
  return {
    open: true,
    today,
    range,
    month: params.month ?? null,
    regionCode: code ?? null,
    regionName: region?.name ?? null,
    cards,
    months: range.months.map((month) => ({ month, cards: cardsInMonth(cards, month) })),
    archive,
    sidos: regions.filter((r) => r.level === "sido" && (r.valid_to === null || r.valid_to >= today)).map((r) => ({ code: r.code, name: r.name })),
    badRegion: code === null,
  };
}

export interface EventDetailView {
  card: EventCard;
  row: EventRow;
  regionName: string | null;
  statusSourceUrl: string | null;
  statusConfirmedOn: string | null;
  /** W10-h 연동 출처 줄 - 공공누리 유형 글자와 (권리 확인분만) 이미지 */
  source: EventSourceInfo;
  links: { id: number; kind: "project" | "article"; label: string; href: string; reason: string }[];
}

/** 행사 상세 (끝난 회차도 200) — 키 꺼짐·비공개·없는 slug는 null */
export async function getEventDetail(slug: string): Promise<EventDetailView | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || !(await localEventsOpen())) return null;
  const rows = await rowsOf<PublicEventRow>(publicDb().from("public_local_events").select(EVENT_COLUMNS).eq("slug", slug).limit(1), "행사 상세");
  const row = rows[0];
  if (!row) return null;
  const [regions, links] = await Promise.all([
    readRegions(),
    rowsOf<{ id: number; target_kind: "project" | "article"; target_slug: string; target_label: string; reason: string }>(
      publicDb().from("public_event_links").select("id, target_kind, target_slug, target_label, reason").eq("event_id", row.id).order("id"),
      "행사 연결",
    ),
  ]);
  return {
    card: eventCard(row),
    row,
    regionName: regions.find((r) => r.code === row.region_code)?.name ?? null,
    statusSourceUrl: row.status === "cancelled" || row.status === "changing" ? row.status_source_url : null,
    statusConfirmedOn: row.status_confirmed_at ? isoToKstDate(row.status_confirmed_at) : null,
    source: eventSourceInfo(row),
    links: links.map((l) => ({ id: l.id, kind: l.target_kind, label: l.target_label, reason: l.reason, href: l.target_kind === "project" ? `/realestate/projects/${l.target_slug}` : `/news/${l.target_slug}` })),
  };
}

export interface WeeklyPageView {
  sidoName: string;
  sidoSlug: string;
  weekKey: string;
  range: { start: string; end: string };
  publishedOn: string;
  meta: string;
  items: DigestItemRow[];
  /** 같은 시·도의 다른 발행 주 (아카이브 링크) */
  otherWeeks: string[];
}

/** 주간 페이지 /local/[sido]/weekly/[yyyy-ww] — 존재하지 않는 주·발행 안 된 주·키 꺼짐·시·도 아님은 null(404). 발행된 주는 다음 주가 시작돼도 200(아카이브) */
export async function getWeeklyPage(sidoSlug: string, weekKey: string, now: Date = new Date()): Promise<WeeklyPageView | null> {
  const range = isoWeekRange(weekKey);
  if (!range || !(await weeklyDigestOpen())) return null;
  const regions = await readRegions();
  const route = regionRoute(`/local/${sidoSlug}`);
  const match = route ? matchRegion(route, regions, todayKst(now)) : null;
  if (!match || match.kind !== "current") return null;
  const digests = await rowsOf<DigestRow>(publicDb().from("public_weekly_digests").select("id, sido_code, week_key, starts_on, ends_on, published_at").eq("sido_code", match.sido.code).order("week_key", { ascending: false }), "주간 페이지");
  const digest = digests.find((d) => d.week_key === weekKey);
  if (!digest) return null;
  const items = await rowsOf<DigestItemRow>(
    publicDb().from("public_digest_items").select("id, digest_id, region_code, title, source_url, press_org, announced_on, license_type, summary, position").eq("digest_id", digest.id).order("position").order("id"),
    "주간 페이지 항목",
  );
  return {
    sidoName: match.sido.name,
    sidoSlug: match.sido.slug,
    weekKey,
    range,
    publishedOn: isoToKstDate(digest.published_at),
    meta: `${weekKey} · ${digest.starts_on} ~ ${digest.ends_on} · 발행 ${isoToKstDate(digest.published_at)}`,
    items,
    otherWeeks: digests.filter((d) => d.week_key !== weekKey).map((d) => d.week_key),
  };
}

/** 지역 허브 ①④ 블록 — 키가 꺼진 블록은 null(요소 0). 읽지 못하면 던진다(호출하는 쪽이 닫힌 쪽으로 처리) */
export async function getHubLocalNews(input: { sido: RegionRouteRow; sigungu: RegionRouteRow | null; regions: readonly RegionRouteRow[]; now?: Date }): Promise<{ weekly: WeeklyBlockView | null; events: EventsBlockView | null }> {
  const settings = await readPublicSettings();
  const today = todayKst(input.now ?? new Date());
  const [weekly, events] = await Promise.all([
    (async () => {
      if (!settings.features.weekly_digest) return null;
      const digests = await rowsOf<DigestRow>(publicDb().from("public_weekly_digests").select("id, sido_code, week_key, starts_on, ends_on, published_at").eq("sido_code", input.sido.code).order("week_key", { ascending: false }).limit(1), "허브 금주 핫뉴스");
      if (!digests.length) return null;
      const items = await rowsOf<DigestItemRow>(
        publicDb().from("public_digest_items").select("id, digest_id, region_code, title, source_url, press_org, announced_on, license_type, summary, position").eq("digest_id", digests[0]!.id).order("position").order("id"),
        "허브 금주 핫뉴스 항목",
      );
      return weeklyBlock({ sidoSlug: input.sido.slug, sidoName: input.sido.name, sigungu: input.sigungu ? { code: input.sigungu.code, name: input.sigungu.name } : null, digests, items });
    })(),
    (async () => {
      if (!settings.features.local_events) return null;
      const rows = await readEventRows();
      const code = (input.sigungu ?? input.sido).code;
      return eventsBlock(rows, regionCodeSet(code, input.regions), today, rows.some((r) => r.hide_stale));
    })(),
  ]);
  return { weekly, events };
}
