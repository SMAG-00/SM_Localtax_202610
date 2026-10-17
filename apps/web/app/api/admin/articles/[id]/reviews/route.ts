import { REVIEW_DECISIONS, REVIEW_KINDS, hasTaxLensContent, type ReviewDecision, type ReviewKind } from "@ltr/editorial";
import type { Action } from "@/lib/access";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { readStoredTaxLens } from "@/lib/server/articles/content";
import { toTaxLens } from "@/lib/server/articles/mapping";
import { articleResource, loadArticle, requirePersonForUser } from "@/lib/server/articles/repository";
import { serviceDb } from "@/lib/server/articles/service";
import { articleSummary, updateArticle } from "@/lib/server/articles/writes";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 편집 승인(desk_edit)·세무 감수(tax_review)·광고 표기 확인(sponsor_check) 기록 (NAV-03 · NAV-12 · CORE-01)
//  · desk_edit — 편집 책임자, 작성 기자 본인 거부(서버가 먼저 막고 DB 트리거도 막는다). checklist.noCausalClaim = '인과 단정 없음'(NAV-10)
//  · tax_review — 세무 감수위원만. 승인하면 「지방세로 읽기」 박스의 감수 표시를 이 버전으로 켠다
//  · 승인은 기사의 현재 버전에 대한 것이다 — 원고를 고치면 다시 받는다
//  · 편집국 외 역할의 승인 시도는 403 + 감사 로그 (NAV-06)
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const ACTION_OF: Record<ReviewKind, Action> = {
  desk_edit: "review.desk_edit",
  tax_review: "review.tax_review",
  sponsor_check: "review.sponsor_check",
};

/** 편집 승인 결과에 따른 게재 상태 — 발행·삭제된 기사는 그대로 */
function statusAfterDeskEdit(status: string, decision: ReviewDecision): string {
  if (status === "published" || status === "deleted" || status === "scheduled") return status;
  if (decision === "approve") return "approved";
  if (decision === "reject") return "draft";
  return "held";
}

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id);
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.article(id);
  const raw = await readJson(request);
  const kind = raw.kind as ReviewKind;
  if (!(REVIEW_KINDS as readonly unknown[]).includes(kind)) return errorJson(422, `kind는 ${REVIEW_KINDS.join("·")} 중 하나여야 합니다`);
  const action = ACTION_OF[kind];

  // 역할만으로 먼저 판정 — 편집국 외 역할은 기사를 읽기 전에 거부하고 감사 로그에 남긴다
  const roleDenied = await authorize(viewer, action, target);
  if (roleDenied) return roleDenied;

  const decision = raw.decision as ReviewDecision;
  if (!(REVIEW_DECISIONS as readonly unknown[]).includes(decision)) return errorJson(422, `decision은 ${REVIEW_DECISIONS.join("·")} 중 하나여야 합니다`);
  const reason = typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : null;
  if (raw.reason !== undefined && raw.reason !== null && typeof raw.reason !== "string") return errorJson(422, "reason은 글자여야 합니다");
  if (decision !== "approve" && reason === null) return errorJson(422, "반려·보류에는 사유가 필요합니다");
  const checklist = raw.checklist ?? {};
  if (typeof checklist !== "object" || checklist === null || Array.isArray(checklist)) return errorJson(422, "checklist는 객체여야 합니다");

  const db = serviceDb();
  const article = await loadArticle(db, id);
  const resourceDenied = await authorize(viewer, action, target, await articleResource(db, article));
  if (resourceDenied) return resourceDenied;
  if (article.status === "deleted") return errorJson(409, "삭제된 기사는 검토할 수 없습니다");
  const reviewer = await requirePersonForUser(db, viewer.userId);

  const { data, error } = await db
    .from("editorial_reviews")
    .insert({ article_id: id, version: article.version, kind, reviewer_id: reviewer.id, decision, checklist, reason })
    .select("id, version, kind, decision, at")
    .single();
  if (error || !data) throw dbError(error ?? {}, "editorial_reviews 추가");

  // 트리거가 편집 승인·세무 감수 상태 칸을 다시 계산했다 — 그 값 위에서 게재 상태·박스 감수 표시를 바꾼다
  const synced = await loadArticle(db, id);
  const columns: Record<string, unknown> = {};
  if (kind === "desk_edit") {
    const next = statusAfterDeskEdit(synced.status, decision);
    if (next !== synced.status) columns.status = next;
  }
  if (kind === "tax_review" && decision === "approve") {
    const lens = readStoredTaxLens(synced.tax_lens);
    const asLens = toTaxLens(synced.tax_lens);
    if (lens && asLens && hasTaxLensContent(asLens)) columns.tax_lens = { ...lens, reviewed: true, reviewed_for_version: synced.version };
  }
  const after = Object.keys(columns).length ? await updateArticle(db, synced, columns, "articles 검토 반영") : synced;

  await writeAudit(db, {
    actor: actorOf(viewer),
    action,
    target,
    before: { status: article.status, editorialStatus: article.editorial_status, taxReviewStatus: article.tax_review_status },
    after: { reviewId: (data as { id: number }).id, version: article.version, decision, checklist, status: after.status, editorialStatus: after.editorial_status, taxReviewStatus: after.tax_review_status },
    reason: reason ?? `${kind} ${decision}`,
  });
  return json({ review: data, article: articleSummary(after) }, 201);
});
