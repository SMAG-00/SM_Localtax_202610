import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, dbError } from "../http";
import { readStoredBody } from "./content";
import { currentRevisionId } from "./repository";
import type { ArticleRow } from "./rows";

// 기사 쓰기 — 새 버전(articles.version + 1)과 수정 이력(article_revisions, 추가만)을 함께 남긴다 (ART-05 · NAV-06).
// DB 거래(transaction)를 쓸 수 없으므로(PostgREST) 순서를 정해 두고, 이력 쓰기가 실패하면 기사 칸을 되돌린다.

type Db = SupabaseClient;

/** 응답에 싣는 기사 요약 */
export function articleSummary(a: ArticleRow) {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    status: a.status,
    version: a.version,
    contentType: a.content_type,
    section: a.section,
    editorialStatus: a.editorial_status,
    taxReviewStatus: a.tax_review_status,
    firstPublishedAt: a.first_published_at,
    substantiveUpdatedAt: a.substantive_updated_at,
    updateKind: a.update_kind,
    updatedReason: a.updated_reason,
  };
}

/** 낙관적 잠금으로 기사 칸을 바꾼다 — 그 사이 다른 사람이 버전을 올렸으면 409 */
export async function updateArticle(db: Db, before: Pick<ArticleRow, "id" | "version">, columns: Record<string, unknown>, context: string): Promise<ArticleRow> {
  const { data, error } = await db.from("articles").update(columns).eq("id", before.id).eq("version", before.version).select("*").maybeSingle();
  if (error) throw dbError(error, context);
  if (!data) throw new HttpError(409, "다른 사람이 먼저 고쳤습니다 — 새로 불러온 뒤 다시 저장하세요");
  return data as ArticleRow;
}

export interface RevisionMeta {
  actor: string;
  reason: string | null;
  updateKind: string | null;
}

export interface SavedVersion {
  article: ArticleRow;
  revisionId: number;
  previousRevisionId: number | null;
}

/** 새 버전 저장 — 기사 칸(버전 + 1) → 수정 이력. 이력이 실패하면 기사 칸을 이전 값으로 되돌리고 오류를 낸다 */
export async function saveNewVersion(db: Db, before: ArticleRow, columns: Record<string, unknown>, meta: RevisionMeta): Promise<SavedVersion> {
  const previousRevisionId = await currentRevisionId(db, before);
  const after = await updateArticle(db, before, { ...columns, version: before.version + 1 }, "articles 수정");
  const { data, error } = await db
    .from("article_revisions")
    .insert({
      article_id: after.id,
      version: after.version,
      title: after.title,
      body: readStoredBody(after.body),
      edited_by: meta.actor,
      reason: meta.reason,
      update_kind: meta.updateKind,
    })
    .select("id")
    .single();
  if (error || !data) {
    const revert: Record<string, unknown> = { version: before.version };
    for (const key of Object.keys(columns)) revert[key] = before[key as keyof ArticleRow];
    const { error: revertError } = await db.from("articles").update(revert).eq("id", after.id).eq("version", after.version);
    if (revertError) console.error("[articles] 수정 이력 실패 뒤 되돌리기 실패:", after.id, revertError.code, revertError.message);
    throw error ? dbError(error, "article_revisions 추가") : new HttpError(500, "수정 이력을 남기지 못했습니다");
  }
  return { article: after, revisionId: (data as { id: number }).id, previousRevisionId };
}

/** 첫 버전의 수정 이력 (기사 작성 직후) — 실패하면 방금 만든 기사를 지운다 */
export async function saveFirstRevision(db: Db, article: ArticleRow, actor: string): Promise<number> {
  const { data, error } = await db
    .from("article_revisions")
    .insert({ article_id: article.id, version: article.version, title: article.title, body: readStoredBody(article.body), edited_by: actor, reason: null, update_kind: null })
    .select("id")
    .single();
  if (error || !data) {
    const { error: delError } = await db.from("articles").delete().eq("id", article.id);
    if (delError) console.error("[articles] 첫 수정 이력 실패 뒤 기사 지우기 실패:", article.id, delError.code, delError.message);
    throw error ? dbError(error, "article_revisions 추가") : new HttpError(500, "수정 이력을 남기지 못했습니다");
  }
  return (data as { id: number }).id;
}

export interface CorrectionRecord {
  articleId: number;
  kind: "correction" | "rebuttal" | "follow_up" | "deletion" | "title_change";
  beforeRevisionId: number | null;
  afterRevisionId: number | null;
  reason: string;
  decidedBy: string;
  readerNotice: string | null;
  inquiryId: number | null;
  publishedAt: string;
}

/** 정정 이력 한 줄 (NAV-06, 추가만) */
export async function recordCorrection(db: Db, c: CorrectionRecord): Promise<number> {
  const { data, error } = await db
    .from("article_corrections")
    .insert({
      article_id: c.articleId,
      kind: c.kind,
      before_revision_id: c.beforeRevisionId,
      after_revision_id: c.afterRevisionId,
      reason: c.reason,
      inquiry_id: c.inquiryId,
      decided_by: c.decidedBy,
      published_at: c.publishedAt,
      reader_notice: c.readerNotice,
    })
    .select("id")
    .single();
  if (error || !data) throw error ? dbError(error, "article_corrections 추가") : new HttpError(500, "정정 이력을 남기지 못했습니다");
  return (data as { id: number }).id;
}
