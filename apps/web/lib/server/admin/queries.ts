import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssignmentRow } from "@/lib/admin/assignment-form";
import { dbError } from "../http";

// 백오피스 화면 데이터 — service_role로 읽는다. 부르는 화면이 접근 판정(lib/server/admin/pages.ts)을 먼저 통과해야 한다.

type Db = SupabaseClient;

async function rows<T>(query: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>, context: string): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw dbError(error, context);
  return (data ?? []) as T[];
}

async function count(query: PromiseLike<{ count: number | null; error: { code?: string; message?: string } | null }>, context: string): Promise<number> {
  const { count: n, error } = await query;
  if (error) throw dbError(error, context);
  return n ?? 0;
}

/** 기사 목록 한 줄 */
export interface ArticleListRow {
  id: number;
  slug: string;
  title: string;
  section: string;
  content_type: string | null;
  reporting_method: string | null;
  status: string;
  editorial_status: string;
  tax_review_status: string;
  version: number;
  label: string;
  author_id: number | null;
  story_assignment_id: number | null;
  first_published_at: string | null;
  updated_at: string;
}

const ARTICLE_LIST_COLUMNS =
  "id, slug, title, section, content_type, reporting_method, status, editorial_status, tax_review_status, version, label, author_id, story_assignment_id, first_published_at, updated_at";
const LIST_LIMIT = 200;

export interface ArticleFilters {
  status?: string;
  section?: string;
  type?: string;
  /** 작성 기자(인물 번호) */
  authorId?: number;
}

export async function listArticles(db: Db, f: ArticleFilters): Promise<ArticleListRow[]> {
  let q = db.from("articles").select(ARTICLE_LIST_COLUMNS).order("updated_at", { ascending: false }).limit(LIST_LIMIT);
  if (f.status) q = q.eq("status", f.status);
  if (f.section) q = q.eq("section", f.section);
  if (f.type) q = q.eq("content_type", f.type);
  if (f.authorId !== undefined) q = q.eq("author_id", f.authorId);
  return rows<ArticleListRow>(q, "articles 목록");
}

/** 검토 대기 — 편집 승인 대기(검토 중) · 발행 대기(편집 승인됨) · 세무 감수 대기 */
export async function reviewQueues(db: Db) {
  const [desk, approved, tax] = await Promise.all([
    rows<ArticleListRow>(db.from("articles").select(ARTICLE_LIST_COLUMNS).eq("status", "in_review").order("updated_at").limit(LIST_LIMIT), "검토 대기 읽기"),
    rows<ArticleListRow>(db.from("articles").select(ARTICLE_LIST_COLUMNS).eq("status", "approved").order("updated_at").limit(LIST_LIMIT), "발행 대기 읽기"),
    rows<ArticleListRow>(
      db.from("articles").select(ARTICLE_LIST_COLUMNS).eq("tax_review_status", "pending").not("status", "in", "(published,deleted)").order("updated_at").limit(LIST_LIMIT),
      "세무 감수 대기 읽기",
    ),
  ]);
  return { desk, approved, tax };
}

export interface PublishedRow extends ArticleListRow {
  hot_pin_until: string | null;
  nav_candidate: boolean;
}

export async function listPublished(db: Db): Promise<PublishedRow[]> {
  return rows<PublishedRow>(
    db.from("articles").select(`${ARTICLE_LIST_COLUMNS}, hot_pin_until, nav_candidate`).eq("status", "published").order("first_published_at", { ascending: false }).limit(LIST_LIMIT),
    "발행 기사 읽기",
  );
}

export async function dashboardCounts(db: Db, personId: number | null) {
  const articles = () => db.from("articles").select("id", { count: "exact", head: true });
  const [myDrafts, deskWaiting, publishWaiting, taxWaiting, myAssignments] = await Promise.all([
    personId === null ? Promise.resolve(0) : count(articles().eq("author_id", personId).in("status", ["draft", "held"]), "내 초안 세기"),
    count(articles().eq("status", "in_review"), "검토 대기 세기"),
    count(articles().eq("status", "approved"), "발행 대기 세기"),
    count(articles().eq("tax_review_status", "pending").not("status", "in", "(published,deleted)"), "세무 감수 대기 세기"),
    personId === null
      ? Promise.resolve(0)
      : count(db.from("story_assignments").select("id", { count: "exact", head: true }).eq("reporter_id", personId).not("status", "in", "(published,held)"), "내 기획 세기"),
  ]);
  return { myDrafts, deskWaiting, publishWaiting, taxWaiting, myAssignments };
}

const ASSIGNMENT_COLUMNS =
  "id, section, kind, editorial_field, region_code, hypothesis, public_interest, public_question, relevance, method, reporter_id, editor_id, plan, due_at, conflicts, status, reject_reason, updated_at";

export async function listAssignments(db: Db, f: { status?: string; section?: string }): Promise<AssignmentRow[]> {
  let q = db.from("story_assignments").select(ASSIGNMENT_COLUMNS).order("due_at", { ascending: true, nullsFirst: false }).limit(LIST_LIMIT);
  if (f.status) q = q.eq("status", f.status);
  if (f.section) q = q.eq("section", f.section);
  return rows<AssignmentRow>(q, "story_assignments 목록");
}

export async function loadAssignment(db: Db, id: number): Promise<AssignmentRow | null> {
  const list = await rows<AssignmentRow>(db.from("story_assignments").select(ASSIGNMENT_COLUMNS).eq("id", id), "story_assignments 읽기");
  return list[0] ?? null;
}

/** 기획에 연결된 기사 */
export async function articlesForAssignments(db: Db, ids: readonly number[]): Promise<ArticleListRow[]> {
  if (ids.length === 0) return [];
  return rows<ArticleListRow>(db.from("articles").select(ARTICLE_LIST_COLUMNS).in("story_assignment_id", [...ids]), "기획 기사 읽기");
}

export interface StaffPerson {
  id: number;
  name: string;
  roles: string[];
}

/** 편집국 인물 — 계정이 연결된 기자·편집 책임자 (기획 담당 고르기) */
export async function listStaffPeople(db: Db): Promise<StaffPerson[]> {
  return rows<StaffPerson>(
    db.from("people").select("id, name, roles").not("staff_user_id", "is", null).overlaps("roles", ["reporter", "editor"]).order("name"),
    "people 읽기",
  );
}

/** 인물 번호 → 이름 */
export async function peopleNames(db: Db, ids: readonly (number | null)[]): Promise<Record<number, string>> {
  const unique = [...new Set(ids.filter((x): x is number => x !== null))];
  if (unique.length === 0) return {};
  const list = await rows<{ id: number; name: string }>(db.from("people").select("id, name").in("id", unique), "people 읽기");
  return Object.fromEntries(list.map((p) => [p.id, p.name]));
}

export interface CategoryOption {
  id: number;
  section: string;
  slug: string;
  name: string;
}

export async function listCategories(db: Db): Promise<CategoryOption[]> {
  return rows<CategoryOption>(db.from("categories").select("id, section, slug, name").order("section").order("sort"), "categories 읽기");
}

export interface PartnerOption {
  id: number;
  name: string;
  contract_to: string | null;
}

export async function listPartners(db: Db): Promise<PartnerOption[]> {
  return rows<PartnerOption>(db.from("partners").select("id, name, contract_to").order("name"), "partners 읽기");
}

export interface MediaOption {
  id: number;
  path: string;
  alt: string | null;
  rights_status: string;
}

export async function listMedia(db: Db): Promise<MediaOption[]> {
  return rows<MediaOption>(db.from("media").select("id, path, alt, rights_status").order("id", { ascending: false }).limit(LIST_LIMIT), "media 읽기");
}

/** 처리 전 정정·반론 요청 (문의함 '정정·반론') — 정정 결정에서 고른다 */
export async function pendingCorrectionRequests(db: Db, articleId: number): Promise<{ id: number; body: string }[]> {
  return rows<{ id: number; body: string }>(
    db.from("inquiries").select("id, body").eq("kind", "correction").eq("related_article_id", articleId).neq("status", "done").order("created_at"),
    "inquiries 읽기",
  );
}
