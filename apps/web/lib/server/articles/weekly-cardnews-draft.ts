import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Viewer } from "@/lib/access";
import { actorOf, targetOf, writeAudit } from "../audit";
import { HttpError, dbError } from "../http";
import { EMPTY_CHECKLISTS } from "./content";
import { parseArticleInput } from "./input";
import { planCreate } from "./plan";
import { loadGateSettings, requirePersonForUser } from "./repository";
import type { ArticleRow } from "./rows";
import { afterSave } from "./service";
import { articleSummary, saveFirstRevision } from "./writes";
import {
  PICK_MODE_NOTES,
  buildWeeklyCardNewsInput,
  pickWeeklyArticles,
  weekRangeLabel,
  weeklyCardNewsSlug,
  weeklyWindow,
  type WeeklyCandidate,
  type WeeklyPickMode,
} from "./weekly-cardnews";

// 이번 주 카드뉴스 초안 만들기 — DB 읽기·쓰기 (고르기·만들기 규칙은 순수 모듈 weekly-cardnews.ts).
//  · 후보 = 공개 기사 뷰(public_articles — 발행·대표 사진 권리 확인 또는 없음·무료)에서 지난 7일 안에 처음 발행된 기사
//  · 조회 = 시간 단위 집계(article_stats)의 사람 조회 합계 — 많이 본 기사 순위와 같은 DB 함수 article_stats_totals
//  · 제외 유형 = 설정 popular_rules.exclude_content_types (많이 본 기사와 같은 값). 설정을 못 읽으면 씨앗 값
//  · 저장 = 기사 작성 API(POST /api/admin/articles)와 같은 길 — 입력 검사·작성 계획·첫 수정 이력·저장 뒤 점검·감사 로그. 상태는 초안
type Db = SupabaseClient;

/** popular_rules 씨앗(마이그레이션 20261018000014)의 제외 유형 — 설정 행을 못 읽을 때만 */
const SEED_EXCLUDE_CONTENT_TYPES = ["digest", "sponsored"] as const;
const CANDIDATE_LIMIT = 1000;
const MAX_SLUG_TRIES = 50;

interface CandidateRow {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  format: string;
  content_type: string | null;
  section: string;
  first_published_at: string | null;
  lead_media_id: number | null;
}

async function excludeContentTypes(db: Db): Promise<readonly string[]> {
  const { data, error } = await db.from("settings").select("value").eq("key", "popular_rules").maybeSingle();
  if (error) throw dbError(error, "settings 읽기");
  const v = (data as { value?: { exclude_content_types?: unknown } } | null)?.value?.exclude_content_types;
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : SEED_EXCLUDE_CONTENT_TYPES;
}

async function readCandidates(db: Db, fromIso: string, toIso: string): Promise<WeeklyCandidate[]> {
  const { data, error } = await db
    .from("public_articles")
    .select("id, slug, title, summary, format, content_type, section, first_published_at, lead_media_id")
    .gte("first_published_at", fromIso)
    .lte("first_published_at", toIso)
    .order("first_published_at", { ascending: false })
    .limit(CANDIDATE_LIMIT);
  if (error) throw dbError(error, "공개 기사 읽기");
  const rows = (data ?? []) as CandidateRow[];
  const mediaIds = [...new Set(rows.flatMap((r) => (r.lead_media_id === null ? [] : [Number(r.lead_media_id)])))];
  const rights = new Map<number, string>();
  if (mediaIds.length) {
    const m = await db.from("media").select("id, rights_status").in("id", mediaIds);
    if (m.error) throw dbError(m.error, "media 읽기");
    for (const r of (m.data ?? []) as { id: number; rights_status: string }[]) rights.set(Number(r.id), r.rights_status);
  }
  return rows.map((r) => {
    const mediaId = r.lead_media_id === null ? null : Number(r.lead_media_id);
    return {
      id: Number(r.id),
      slug: r.slug,
      title: r.title,
      summary: r.summary,
      format: r.format,
      contentType: r.content_type,
      section: r.section,
      publishedAt: r.first_published_at,
      leadMedia: mediaId === null ? null : { id: mediaId, rightsStatus: rights.get(mediaId) ?? "unconfirmed" },
    };
  });
}

async function readViews(db: Db, fromIso: string, toIso: string): Promise<Map<number, number>> {
  const { data, error } = await db.rpc("article_stats_totals", { p_from: fromIso, p_to: toIso });
  if (error) throw dbError(error, "기사 조회 집계 읽기");
  const rows = (Array.isArray(data) ? data : []) as { article_id: number; views_human: number }[];
  return new Map(rows.map((r) => [Number(r.article_id), Number(r.views_human)]));
}

/** 아직 쓰지 않은 slug — 기본값, 그다음 -2, -3 … */
async function freeSlug(db: Db, base: string): Promise<string> {
  const { data, error } = await db.from("articles").select("slug").like("slug", `${base}%`).limit(MAX_SLUG_TRIES + 1);
  if (error) throw dbError(error, "articles slug 읽기");
  const used = new Set(((data ?? []) as { slug: string }[]).map((r) => r.slug));
  for (let i = 1; i <= MAX_SLUG_TRIES; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    if (!used.has(slug)) return slug;
  }
  throw new HttpError(409, `오늘 만든 카드뉴스 초안이 ${MAX_SLUG_TRIES}건을 넘었습니다 — 쓰지 않는 초안을 지운 뒤 다시 만드세요`);
}

export interface WeeklyCardNewsResult {
  article: ReturnType<typeof articleSummary>;
  revisionId: number;
  checks: Awaited<ReturnType<typeof afterSave>>["checks"];
  mode: WeeklyPickMode;
  note: string;
  range: string;
  picked: { id: number; slug: string; title: string; views: number }[];
}

/** 이번 주 카드뉴스 초안 한 건 — 권한 판정(article.create)은 부르는 쪽(API)이 먼저 한다 */
export async function createWeeklyCardNewsDraft(db: Db, viewer: Pick<Viewer, "userId">, opts: { now: Date; siteBase: string | null }): Promise<WeeklyCardNewsResult> {
  const author = await requirePersonForUser(db, viewer.userId);
  const now = opts.now.getTime();
  const w = weeklyWindow(now);
  const fromIso = new Date(w.from).toISOString();
  const toIso = new Date(w.to).toISOString();
  const [candidates, views, excluded, settings] = await Promise.all([readCandidates(db, fromIso, toIso), readViews(db, fromIso, toIso), excludeContentTypes(db), loadGateSettings(db)]);
  const pick = pickWeeklyArticles(candidates, views, { now, excludeContentTypes: excluded });
  if (!pick.ok) throw new HttpError(422, pick.error);

  const slug = await freeSlug(db, weeklyCardNewsSlug(now));
  const parsed = parseArticleInput(buildWeeklyCardNewsInput(pick.value, { slug, siteBase: opts.siteBase }), "create");
  if (!parsed.ok) throw new HttpError(422, `카드뉴스 초안이 기사 입력 규칙에 맞지 않습니다 — ${parsed.errors.join(" · ")}`);

  const { columns } = planCreate(parsed.value, author.id, EMPTY_CHECKLISTS);
  const { data, error } = await db.from("articles").insert(columns).select("*").single();
  if (error || !data) throw dbError(error ?? {}, "articles 추가");
  const created = data as ArticleRow;
  const actor = actorOf(viewer);
  const revisionId = await saveFirstRevision(db, created, actor);
  const { article, checks } = await afterSave(db, created, settings.dictionaries, false);

  const mode = pick.value.mode;
  const note = PICK_MODE_NOTES[mode];
  const range = weekRangeLabel(pick.value.window);
  const picked = pick.value.articles.map((a) => ({ id: a.id, slug: a.slug, title: a.title, views: a.views }));
  await writeAudit(db, {
    actor,
    action: "article.create",
    target: targetOf.article(article.id),
    before: null,
    after: { ...articleSummary(article), revisionId, authorId: author.id, weeklyCardNews: { mode, from: fromIso, to: toIso, picked } },
    reason: `이번 주 카드뉴스 초안 만들기 (${range}) — ${note}`,
  });
  return { article: articleSummary(article), revisionId, checks, mode, note, range, picked };
}
