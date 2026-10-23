import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { consecutiveWeekCount, isoWeekKey } from "@/lib/site/iso-week";
import { dbError } from "@/lib/server/http";
import { eventStatusAt, kstDate, recheckDue, type EventStatusKey } from "@/lib/server/public/local-news-logic";
import { summaryHash } from "./similarity";

// 지자체뉴스 관리 보드 (W6 - /admin/local-news, /api/admin/local-news GET). service_role로 읽는다.
// 시·도별 연속 발행 주 수(9.1 4주 연속)·후보·주간 페이지·항목(유사도 결과)·행사·재확인 대상·설정 요약.

type Db = SupabaseClient;
const ITEM_COLUMNS =
  "id, digest_id, candidate_id, region_code, title, source_url, press_org, announced_on, license_type, summary, figures_checked, original_text, sim_status, sim_max, sim_ratio, sim_matches, sim_rules_version, sim_checked_hash, sim_checked_at, assignment_id, position";

export interface BoardItem {
  id: number;
  digest_id: number;
  candidate_id: number | null;
  region_code: string;
  title: string;
  source_url: string;
  press_org: string;
  announced_on: string;
  license_type: string;
  summary: string;
  figures_checked: boolean;
  has_original: boolean;
  sim_status: string | null;
  sim_max: number | null;
  sim_ratio: number | null;
  sim_matches: { index: number; text: string; similarity: number | null; source: string | null }[];
  sim_rules_version: string | null;
  /** 유사도 기록이 지금 요약에 대한 것인가 (요약을 고치면 false) */
  sim_current: boolean;
  assignment_id: number | null;
}

export interface BoardCandidate {
  id: number;
  sido_code: string;
  region_code: string;
  source_id: string;
  title: string;
  press_org: string;
  announced_at: string;
  source_url: string;
  license_type: string;
  status: "new" | "selected" | "dismissed";
}

export interface BoardEvent {
  id: number;
  slug: string;
  series_key: string;
  title: string;
  category: string;
  organizer: string;
  organizer_type: string;
  venue: string;
  region_code: string;
  starts_at: string;
  ends_at: string;
  official_url: string;
  source_name: string;
  confirmed_on: string;
  sponsored: boolean;
  published: boolean;
  status_override: "cancelled" | "changing" | null;
  status_source_url: string | null;
  status: EventStatusKey;
  recheck_due: boolean;
  start_date: string;
}

async function must<T>(res: PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>, context: string): Promise<T> {
  const { data, error } = await res;
  if (error) throw dbError(error, context);
  return (data ?? []) as T;
}

export async function loadLocalNewsBoard(db: Db, now: Date = new Date()) {
  const today = kstDate(now.toISOString());
  const [settingRows, regions, candidates, digests, items, events, history, links] = await Promise.all([
    must<{ key: string; value: unknown }[]>(db.from("settings").select("key, value").in("key", ["feature_flags", "digest_sidos", "digest_summary_max_chars", "digest_sources", "event_recheck", "event_url_blocked_domains"]), "settings 조회"),
    must<{ code: string; name: string; slug: string; valid_to: string | null }[]>(db.from("regions").select("code, name, slug, valid_to").eq("level", "sido").order("code"), "regions 조회"),
    must<(BoardCandidate & { original_text: string | null })[]>(db.from("hot_news_candidates").select("id, sido_code, region_code, source_id, title, press_org, announced_at, source_url, license_type, status, original_text").order("announced_at", { ascending: false }).limit(100), "hot_news_candidates 조회"),
    must<{ id: number; sido_code: string; week_key: string; starts_on: string; ends_on: string; status: string; published_at: string | null }[]>(db.from("weekly_digests").select("id, sido_code, week_key, starts_on, ends_on, status, published_at").order("week_key", { ascending: false }).limit(120), "weekly_digests 조회"),
    must<(Omit<BoardItem, "has_original" | "sim_current"> & { original_text: string | null; sim_checked_hash: string | null })[]>(db.from("digest_items").select(ITEM_COLUMNS).order("digest_id", { ascending: false }).order("id").limit(1000), "digest_items 조회"),
    must<(Omit<BoardEvent, "status" | "recheck_due" | "start_date">)[]>(db.from("local_events").select("*").order("starts_at", { ascending: false }).limit(300), "local_events 조회"),
    must<{ id: number; event_id: number; from_state: string; to_state: string; source_url: string | null; confirmed_at: string | null; changed_by: string; created_at: string }[]>(db.from("event_status_history").select("*").order("id", { ascending: false }).limit(300), "event_status_history 조회"),
    must<{ id: number; event_id: number; target_kind: string; target_id: number; reason: string; confirmed_by: string }[]>(db.from("event_links").select("id, event_id, target_kind, target_id, reason, confirmed_by").order("id").limit(500), "event_links 조회"),
  ]);
  const s = (key: string): unknown => settingRows.find((r) => r.key === key)?.value;
  const flags = (s("feature_flags") ?? {}) as Record<string, boolean>;
  const recheck = (s("event_recheck") ?? { days: 7, hide_stale: false }) as { days: number; hide_stale: boolean };
  const sidoCodes = Array.isArray(s("digest_sidos")) ? (s("digest_sidos") as string[]) : [];

  const boardItems: BoardItem[] = items.map(({ original_text, sim_checked_hash, ...rest }) => ({
    ...rest,
    sim_matches: Array.isArray(rest.sim_matches) ? rest.sim_matches : [],
    has_original: original_text !== null && original_text.trim() !== "",
    sim_current: sim_checked_hash !== null && sim_checked_hash === summaryHash(rest.summary),
  }));
  const boardEvents: BoardEvent[] = events.map((e) => ({
    ...e,
    status: eventStatusAt(e, now),
    recheck_due: recheckDue(e.confirmed_on, recheck.days, today),
    start_date: kstDate(e.starts_at),
  }));

  const sidos = regions
    .filter((r) => r.valid_to === null || r.valid_to >= today)
    .map((r) => {
      const published = digests.filter((d) => d.sido_code === r.code && d.status === "published").map((d) => d.week_key);
      return { code: r.code, name: r.name, slug: r.slug, configured: sidoCodes.includes(r.code), publishedWeeks: published.length, streak: consecutiveWeekCount(published), latestWeek: [...published].sort().pop() ?? null };
    });

  return {
    today,
    currentWeek: isoWeekKey(today),
    flags: { weekly_digest: flags.weekly_digest === true, local_events: flags.local_events === true },
    settings: {
      digestSidos: sidoCodes,
      summaryMax: typeof s("digest_summary_max_chars") === "number" ? (s("digest_summary_max_chars") as number) : 300,
      sources: Array.isArray(s("digest_sources")) ? (s("digest_sources") as { id: string; name: string; host: string; kind: string; basis: string; checked_on: string }[]) : [],
      recheck,
    },
    sidos,
    candidates: candidates.map(({ original_text, ...c }) => ({ ...c, has_original: typeof original_text === "string" && original_text.trim() !== "" })),
    digests: digests.map((d) => ({ ...d, sido_name: regions.find((r) => r.code === d.sido_code)?.name ?? d.sido_code, items: boardItems.filter((i) => i.digest_id === d.id) })),
    events: boardEvents.map((e) => ({ ...e, history: history.filter((h) => h.event_id === e.id), links: links.filter((l) => l.event_id === e.id) })),
    recheckList: boardEvents.filter((e) => e.recheck_due && e.status !== "ended" && e.status !== "cancelled").map((e) => ({ slug: e.slug, title: e.title, confirmed_on: e.confirmed_on })),
  };
}

export type LocalNewsBoard = Awaited<ReturnType<typeof loadLocalNewsBoard>>;
