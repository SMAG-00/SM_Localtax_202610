import "server-only";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { trackerState, type ArticleListItem, type TrackerState } from "./cards";
import { amendmentHref } from "./constants";
import { publicDb, rowsOf } from "./db";
import { readArticleList, readPublicSettings } from "./reads";
import { AMENDMENT_COLUMNS, AMENDMENT_EVENT_COLUMNS, num, type AmendmentEventRow, type AmendmentRow } from "./rows";
import type { SupabaseClient } from "@supabase/supabase-js";

// 개정 트래커 공개 화면 데이터 (TX-07·08 — docs/dev/W3_설계.md 1장 3·4단계). 공개 뷰(RLS)만 읽는다.
// 현재 단계·`확정 아님`·`시행 예정`은 저장하지 않고 단계 기록(amendment_events)과 설정(amendment_confirmed_stage)에서 계산한다(trackerState).
// 기능 키 amendments가 꺼져 있으면 null → 화면은 404.

export interface AmendmentWithEvents extends AmendmentRow {
  events: AmendmentEventRow[];
}

/** 기사에 연결된 공개 개정안 + 단계 기록 — 기사 머리의 단일 지정(amendment_id)과 연결 표 article_amendments의 합 (중복 제거) */
export async function linkedAmendments(db: SupabaseClient, articleId: number, legacyId: number | null): Promise<AmendmentWithEvents[]> {
  const links = await rowsOf<{ amendment_id: number }>(db.from("article_amendments").select("amendment_id").eq("article_id", articleId), "기사-개정안 연결");
  const ids = [...new Set([...(legacyId === null ? [] : [legacyId]), ...links.map((l) => num(l.amendment_id))])];
  if (ids.length === 0) return [];
  const [rows, events] = await Promise.all([
    rowsOf<AmendmentRow>(db.from("amendments").select(AMENDMENT_COLUMNS).in("id", ids), "개정 트래커"),
    rowsOf<AmendmentEventRow>(db.from("amendment_events").select(AMENDMENT_EVENT_COLUMNS).in("amendment_id", ids), "개정 단계 기록"),
  ]);
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows
    .map((r) => ({ ...r, events: events.filter((e) => num(e.amendment_id) === num(r.id)) }))
    .sort((a, b) => (order.get(num(a.id)) ?? 0) - (order.get(num(b.id)) ?? 0));
}

export interface AmendmentCard {
  id: number;
  slug: string;
  title: string;
  lawNames: string[];
  summary: string | null;
  href: string;
  state: TrackerState;
}

export interface AmendmentListView {
  today: string;
  items: AmendmentCard[];
}

export interface AmendmentDetailView {
  today: string;
  item: AmendmentCard;
  /** 연결 기사 (공개 기사만 — 기사 머리 지정 + 연결 표) */
  articles: ArticleListItem[];
}

const toCard = (r: AmendmentWithEvents, confirmStage: TrackerState["confirmStage"], today: string): AmendmentCard => ({
  id: num(r.id),
  slug: r.slug,
  title: r.title,
  lawNames: r.law_names ?? [],
  summary: r.summary ?? null,
  href: amendmentHref(r.slug),
  state: trackerState(r.events, confirmStage, today),
});

/** 현재 단계 날짜가 늦은 것부터, 단계 기록이 없는 것은 뒤 (같으면 번호가 큰 것) */
export function sortTrackers(items: readonly AmendmentCard[]): AmendmentCard[] {
  return [...items].sort((a, b) => (b.state.currentOn ?? "").localeCompare(a.state.currentOn ?? "") || b.id - a.id);
}

export async function getAmendmentList(now: Date = new Date()): Promise<AmendmentListView | null> {
  const settings = await readPublicSettings();
  if (!settings.features.amendments) return null;
  const db = publicDb();
  const today = isoToKstDate(now.toISOString());
  const rows = await rowsOf<AmendmentRow>(db.from("amendments").select(AMENDMENT_COLUMNS).order("id", { ascending: false }).limit(200), "개정 트래커");
  const events = rows.length ? await rowsOf<AmendmentEventRow>(db.from("amendment_events").select(AMENDMENT_EVENT_COLUMNS).in("amendment_id", rows.map((r) => num(r.id))), "개정 단계 기록") : [];
  const withEvents = rows.map((r) => ({ ...r, events: events.filter((e) => num(e.amendment_id) === num(r.id)) }));
  return { today, items: sortTrackers(withEvents.map((r) => toCard(r, settings.confirmStage, today))) };
}

export async function getAmendment(slug: string, now: Date = new Date()): Promise<AmendmentDetailView | null> {
  const settings = await readPublicSettings();
  if (!settings.features.amendments) return null;
  const db = publicDb();
  const today = isoToKstDate(now.toISOString());
  const [row] = await rowsOf<AmendmentRow>(db.from("amendments").select(AMENDMENT_COLUMNS).eq("slug", slug).limit(1), "개정 트래커");
  if (!row) return null;
  const id = num(row.id);
  const [events, links, legacy] = await Promise.all([
    rowsOf<AmendmentEventRow>(db.from("amendment_events").select(AMENDMENT_EVENT_COLUMNS).eq("amendment_id", id), "개정 단계 기록"),
    rowsOf<{ article_id: number }>(db.from("article_amendments").select("article_id").eq("amendment_id", id), "기사-개정안 연결"),
    readArticleList(db, { amendmentId: id, limit: 50 }),
  ]);
  const linkedIds = links.map((l) => num(l.article_id));
  const linked = linkedIds.length ? await readArticleList(db, { ids: linkedIds, limit: 50 }) : { items: [] as ArticleListItem[], total: 0 };
  const seen = new Set<number>();
  const articles = [...legacy.items, ...linked.items].filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  return { today, item: toCard({ ...row, events }, settings.confirmStage, today), articles };
}
