import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { curationStatus, type CurationKind, type CurationStatus } from "@/lib/admin/home-curation-rules";
import { AMENDMENT_STAGE_LABELS } from "@/lib/admin/settings-rules";
import { HttpError, dbError } from "../http";

// 홈 배치 백오피스 데이터 (HOME-03 · ADM-01) — service_role로 읽고 쓴다. 부르는 쪽(API·화면)이 접근 판정(article.home)을 먼저 통과해야 한다.
// 공개 홈에 실제로 보이는 모습은 공개 데이터 함수(lib/server/public getHomeAmendments — anon)로 따로 계산한다.

type Db = SupabaseClient;

export interface CurationRow {
  id: number;
  kind: CurationKind;
  amendment_id: number | null;
  article_id: number | null;
  sort: number;
  starts_on: string;
  ends_on: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export const CURATION_COLUMNS = "id, kind, amendment_id, article_id, sort, starts_on, ends_on, created_by, updated_by, created_at, updated_at";

export interface TrackerTarget {
  id: number;
  title: string;
  slug: string;
  status: string;
  /** 현재 단계 화면 글자 (없으면 '기록 전') */
  stageLabel: string;
}

export interface StoryTarget {
  id: number;
  title: string;
  slug: string;
  status: string;
  contentType: string | null;
  format: string;
}

export interface CurationItem {
  id: number;
  kind: CurationKind;
  targetId: number;
  sort: number;
  startsOn: string;
  endsOn: string | null;
  status: CurationStatus;
  target: { title: string; slug: string; detail: string; public: boolean } | null;
}

const num = (v: unknown) => Number(v);

export async function listCurationRows(db: Db): Promise<CurationRow[]> {
  const { data, error } = await db.from("home_curations").select(CURATION_COLUMNS).order("kind").order("sort").order("id");
  if (error) throw dbError(error, "home_curations 목록");
  return ((data ?? []) as CurationRow[]).map((r) => ({ ...r, id: num(r.id), amendment_id: r.amendment_id === null ? null : num(r.amendment_id), article_id: r.article_id === null ? null : num(r.article_id) }));
}

export async function loadCuration(db: Db, id: number): Promise<CurationRow> {
  const { data, error } = await db.from("home_curations").select(CURATION_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw dbError(error, "home_curations 읽기");
  if (!data) throw new HttpError(404, "홈 배치 카드를 찾을 수 없습니다");
  const r = data as CurationRow;
  return { ...r, id: num(r.id), amendment_id: r.amendment_id === null ? null : num(r.amendment_id), article_id: r.article_id === null ? null : num(r.article_id) };
}

export const targetIdOf = (r: Pick<CurationRow, "kind" | "amendment_id" | "article_id">): number => num(r.kind === "tracker" ? r.amendment_id : r.article_id);

const STORY_CANDIDATES = 100;

/** 트래커 후보 — 공개 개정안 (현재 단계 글자와 함께) */
export async function trackerTargets(db: Db, ids?: readonly number[]): Promise<TrackerTarget[]> {
  let q = db.from("amendments").select("id, slug, title, status").order("id", { ascending: false });
  q = ids ? q.in("id", [...ids]) : q.eq("status", "public").limit(200);
  const { data, error } = await q;
  if (error) throw dbError(error, "amendments 후보");
  const rows = (data ?? []) as { id: number; slug: string; title: string; status: string }[];
  if (rows.length === 0) return [];
  const stages = await db.from("amendment_current_stages").select("amendment_id, current_stage").in("amendment_id", rows.map((r) => num(r.id)));
  if (stages.error) throw dbError(stages.error, "개정 현재 단계");
  const stageOf = new Map(((stages.data ?? []) as { amendment_id: number; current_stage: string }[]).map((s) => [num(s.amendment_id), s.current_stage]));
  return rows.map((r) => {
    const stage = stageOf.get(num(r.id));
    return { id: num(r.id), slug: r.slug, title: r.title, status: r.status, stageLabel: stage ? (AMENDMENT_STAGE_LABELS[stage as keyof typeof AMENDMENT_STAGE_LABELS] ?? stage) : "기록 전" };
  });
}

/** 스토리 후보 — 발행된 기사 가운데 광고·금주 핫뉴스·유형 미분류가 아닌 것(최신 발행 순) */
export async function storyTargets(db: Db, ids?: readonly number[]): Promise<StoryTarget[]> {
  let q = db.from("articles").select("id, slug, title, status, content_type, format").order("first_published_at", { ascending: false, nullsFirst: false }).order("id", { ascending: false });
  q = ids ? q.in("id", [...ids]) : q.eq("status", "published").not("content_type", "is", null).not("content_type", "in", "(sponsored,digest)").limit(STORY_CANDIDATES);
  const { data, error } = await q;
  if (error) throw dbError(error, "articles 후보");
  return ((data ?? []) as { id: number; slug: string; title: string; status: string; content_type: string | null; format: string }[]).map((r) => ({
    id: num(r.id),
    slug: r.slug,
    title: r.title,
    status: r.status,
    contentType: r.content_type,
    format: r.format,
  }));
}

/** 목록 행 → 화면 항목 (대상 제목·공개 여부·상태) */
export async function describeCurations(db: Db, rows: readonly CurationRow[], today: string): Promise<CurationItem[]> {
  const trackerIds = [...new Set(rows.filter((r) => r.kind === "tracker").map(targetIdOf))];
  const storyIds = [...new Set(rows.filter((r) => r.kind === "story").map(targetIdOf))];
  const [trackers, stories] = await Promise.all([
    trackerIds.length ? trackerTargets(db, trackerIds) : Promise.resolve([]),
    storyIds.length ? storyTargets(db, storyIds) : Promise.resolve([]),
  ]);
  const t = new Map(trackers.map((x) => [x.id, x]));
  const s = new Map(stories.map((x) => [x.id, x]));
  return rows.map((r) => {
    const targetId = targetIdOf(r);
    const tracker = r.kind === "tracker" ? t.get(targetId) : undefined;
    const story = r.kind === "story" ? s.get(targetId) : undefined;
    const target = tracker
      ? { title: tracker.title, slug: tracker.slug, detail: `현재 단계 ${tracker.stageLabel}`, public: tracker.status === "public" }
      : story
        ? { title: story.title, slug: story.slug, detail: story.format === "general" ? "일반" : story.format, public: story.status === "published" }
        : null;
    return { id: r.id, kind: r.kind, targetId, sort: r.sort, startsOn: r.starts_on, endsOn: r.ends_on, status: curationStatus(r, today), target };
  });
}
