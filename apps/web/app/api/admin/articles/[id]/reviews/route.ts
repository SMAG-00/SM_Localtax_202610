import { REVIEW_DECISIONS, REVIEW_KINDS, hasTaxLensContent, selfPublishProblem, stageSkipProblem, type ReviewDecision, type ReviewKind } from "@ltr/editorial";
import type { Action } from "@/lib/access";
import { contractedPartners, regionalChecklistErrors } from "@/lib/admin/regional-rules";
import { isRegionalRow } from "@/lib/admin/review-form";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { readStoredTaxLens } from "@/lib/server/articles/content";
import { toArticleForPublish, toTaxLens } from "@/lib/server/articles/mapping";
import { articleResource, loadArticle, loadArticleGraph, requirePersonForUser } from "@/lib/server/articles/repository";
import type { ArticleRow } from "@/lib/server/articles/rows";
import { serviceDb } from "@/lib/server/articles/service";
import { articleSummary, updateArticle } from "@/lib/server/articles/writes";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";
import { scheduleAiBox } from "@/lib/server/ops-ai/editorial";

// 편집 승인(desk_edit)·세무 감수(tax_review)·광고 표기 확인(sponsor_check) 기록 (NAV-03 · NAV-12 · CORE-01)
//  · desk_edit — 편집 책임자, 작성 기자 본인 거부(서버가 먼저 막고 DB 트리거도 막는다). checklist.noCausalClaim = '인과 단정 없음'(NAV-10)
//    본인 발행 (2026-10-31 PO 결정): 작성자인 편집 책임자가 checklist.selfPublish = true로 승인하면, 세무 감수가 필요 없는 글(DB not_required)이고
//    칼럼이 아닐 때만 저장한다. 아니면 403 + 이유. 감사 로그 사유에 '본인 발행'을 남긴다
//  · tax_review — 세무 감수위원만. 승인하면 「지방세로 읽기」 박스의 감수 표시를 이 버전으로 켜고 서명 기록(감수위원·시각)을 남긴다
//  · 승인은 기사의 현재 버전에 대한 것이다 — 원고를 고치면 다시 받는다
//  · 편집국 외 역할의 승인 시도는 403 + 감사 로그 (NAV-06)
//  · 지역 기사 단계 순서 (REG1-14 · W4 8단계 — DB articles_stage_order와 같은 규칙): 세무 감수가 반려·보류면 편집 승인을 받아도 승인 단계로 가지 않고,
//    그 뒤 세무 감수 승인이 나면(편집 승인이 있으면) 승인 단계로 간다
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const ACTION_OF: Record<ReviewKind, Action> = {
  desk_edit: "review.desk_edit",
  tax_review: "review.tax_review",
  sponsor_check: "review.sponsor_check",
};

/**
 * 본인 발행을 막는 이유 — null이면 대상. 내용(세금 내용·칼럼 — @ltr/editorial selfPublishProblem)을 먼저 보고,
 * DB 세무 감수 상태가 not_required가 아니면(감수 대기·완료 포함) 거부한다 (DB 트리거 editorial_reviews_guard와 같은 조건)
 */
async function selfPublishProblemFor(db: ReturnType<typeof serviceDb>, article: ArticleRow): Promise<string | null> {
  const problem = selfPublishProblem(toArticleForPublish(await loadArticleGraph(db, article)));
  if (problem !== null) return problem;
  if (article.tax_review_status !== "not_required") return "세금 내용이 있는 글은 본인 발행할 수 없습니다 — 세무 감수와 다른 편집자의 승인이 필요합니다 (세무 감수 대상으로 표시된 글)";
  return null;
}

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
  const resource = await articleResource(db, article);
  // 본인 발행 (2026-10-31 PO 결정): 작성자 본인의 편집 승인은 checklist.selfPublish = true일 때만 판정에 올린다.
  // 작성자가 아닌 사람이 보낸 표시는 기록에 남기지 않는다 — '본인 발행' 기록은 작성자 본인의 승인에만 있다
  const isAuthor = resource.authorUserId !== null && resource.authorUserId === viewer.userId;
  let stored = checklist as Record<string, unknown>;
  if (kind === "desk_edit" && stored.selfPublish === true) {
    if (!isAuthor) {
      stored = { ...stored };
      delete stored.selfPublish;
    } else {
      if (decision !== "approve") return errorJson(422, "본인 발행 표시(selfPublish)는 승인(approve)에만 씁니다 — 반려·보류는 다른 편집자가 합니다");
      resource.selfPublish = { problem: await selfPublishProblemFor(db, article) };
    }
  }
  const selfPublish = resource.selfPublish !== undefined;
  const resourceDenied = await authorize(viewer, action, target, resource);
  if (resourceDenied) return resourceDenied;
  if (article.status === "deleted") return errorJson(409, "삭제된 기사는 검토할 수 없습니다");
  // 지역 기사 편집 승인 (REG1-17 — W4 7단계): 근거·관계·광고 독립성 3항목 확인, 광고·협찬 계약 제휴사를 다룬 원고는 이해관계 표시 (DB 트리거도 막는다)
  if (kind === "desk_edit" && decision === "approve" && article.content_type !== "sponsored" && (article.region_codes.length > 0 || article.section === "local")) {
    const errors = regionalChecklistErrors(stored);
    const covered = article.covered_partner_ids ?? [];
    if (covered.length > 0 && !(article.interest_disclosure ?? "").trim()) {
      const { data: partners, error: partnerError } = await db.from("partners").select("id, name, contract_from, contract_to").in("id", covered);
      if (partnerError) throw dbError(partnerError, "partners 읽기");
      const contracted = contractedPartners((partners ?? []) as { id: number; name: string; contract_from: string | null; contract_to: string | null }[]);
      if (contracted.length > 0) {
        errors.push(`interestDisclosure: 광고·협찬 계약 기록이 있는 제휴사(${contracted.map((p) => p.name).join("·")})를 다룬 원고는 이해관계 표시가 있어야 승인됩니다 (REG1-17 · NAV-06)`);
      }
    }
    if (errors.length) return errorJson(422, "지역 기사 편집 승인 조건을 채우세요 (REG1-17)", { errors });
  }
  const reviewer = await requirePersonForUser(db, viewer.userId);

  const { data, error } = await db
    .from("editorial_reviews")
    .insert({ article_id: id, version: article.version, kind, reviewer_id: reviewer.id, decision, checklist: stored, reason })
    .select("id, version, kind, decision, at")
    .single();
  if (error || !data) throw dbError(error ?? {}, "editorial_reviews 추가");

  // 트리거가 편집 승인·세무 감수 상태 칸을 다시 계산했다 — 그 값 위에서 게재 상태·박스 감수 표시를 바꾼다
  const synced = await loadArticle(db, id);
  const columns: Record<string, unknown> = {};
  const stageOk = (to: string) =>
    stageSkipProblem({
      from: synced.status,
      to,
      regional: isRegionalRow(synced),
      firstPublished: synced.first_published_at !== null,
      editorialStatus: synced.editorial_status,
      taxReviewStatus: synced.tax_review_status,
    }) === null;
  if (kind === "desk_edit") {
    const next = statusAfterDeskEdit(synced.status, decision);
    if (next !== synced.status && (next !== "approved" || stageOk("approved"))) columns.status = next;
  }
  if (kind === "tax_review" && decision === "approve" && isRegionalRow(synced) && synced.editorial_status === "approved" && ["draft", "in_review", "held"].includes(synced.status) && stageOk("approved")) {
    columns.status = "approved";
  }
  if (kind === "tax_review" && decision === "approve") {
    const lens = readStoredTaxLens(synced.tax_lens);
    const asLens = toTaxLens(synced.tax_lens);
    // 서명 기록(서명한 감수위원·시각)을 박스에 남긴다 — 공개 화면의 '감수 ○○'는 이 기록에서만 그린다 (01C BR-03)
    const signedAt = (data as { at?: string }).at ?? new Date().toISOString();
    if (lens && asLens && hasTaxLensContent(asLens)) columns.tax_lens = { ...lens, reviewed: true, reviewed_for_version: synced.version, reviewed_by: Number(reviewer.id), reviewed_at: signedAt };
  }
  const after = Object.keys(columns).length ? await updateArticle(db, synced, columns, "articles 검토 반영") : synced;

  await writeAudit(db, {
    actor: actorOf(viewer),
    action,
    target,
    before: { status: article.status, editorialStatus: article.editorial_status, taxReviewStatus: article.tax_review_status },
    after: {
      reviewId: (data as { id: number }).id,
      version: article.version,
      decision,
      checklist: stored,
      status: after.status,
      editorialStatus: after.editorial_status,
      taxReviewStatus: after.tax_review_status,
      ...(selfPublish ? { selfPublish: true } : {}),
    },
    reason: selfPublish ? `본인 발행 — 작성자 본인이 편집 승인 (${reason ?? `${kind} ${decision}`})` : (reason ?? `${kind} ${decision}`),
  });
  // 편집 승인되면 AI 요약 상자 초안을 응답 뒤에 만든다 (W12-f O3 - 꺼져 있으면 호출 0, 실패해도 승인에는 영향 없음, 초안은 승인 전 공개 0)
  if (kind === "desk_edit" && decision === "approve" && after.editorial_status === "approved") await scheduleAiBox(db, id);
  return json({ review: data, article: articleSummary(after) }, 201);
}, { revalidatesPublic: true });
