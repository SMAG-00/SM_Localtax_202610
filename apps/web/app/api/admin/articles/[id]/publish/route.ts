import { stageSkipProblem, taxReviewReasons } from "@ltr/editorial";
import { isRegionalRow } from "@/lib/admin/review-form";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { withPublishRecord } from "@/lib/server/articles/content";
import { gateReport, seoCheckRow } from "@/lib/server/articles/report";
import { isSelfPublished } from "@/lib/server/articles/mapping";
import { articleResource, loadArticle, loadArticleGraph, requirePersonForUser } from "@/lib/server/articles/repository";
import { gateFor, nowIso, serviceDb } from "@/lib/server/articles/service";
import { signaturePublishErrors } from "@/lib/server/articles/signature";
import { articleSummary, updateArticle } from "@/lib/server/articles/writes";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, parseId } from "@/lib/server/http";
import { scheduleAiBox } from "@/lib/server/ops-ai/editorial";

// 기사 발행 (ART-01 · OPT-03) — 간편 발행(2026-10-31 PO 결정): 작성자(기자·편집 책임자)가 자기 기사를 바로 발행하고, 편집 책임자는 모든 기사를 발행한다.
//  · 이 버전의 편집 승인이 없으면 발행자 이름으로 편집 승인(desk_edit approve, checklist.publishApproval)을 함께 남긴다 — 작성자 본인이면 authorPublish.
//    편집 책임자·세무 감수위원이 반려·보류한 버전은 발행하지 않는다(409). 지역 기사·금융 사례처럼 DB가 편집 승인 확인 항목을 요구하는 기사는 DB 문장 그대로 409
//  · 세무 감수 대상 이유가 있는데 감수 기록이 없으면 작성자 책임 발행 — 발행 기록 authorResponsibility, 감사 로그 '작성자 책임 발행 (세무 감수 대체)'
//  · 판정은 간편 발행 정책(@ltr/editorial SIMPLE_PUBLISH_BLOCKERS) — 최적화 점검(seo-lint) + 편집 판정(editorial)을 돌려 점검 이력(seo_checks)을 남기고,
//  · 차단 항목이 있으면 422 { failed: 차단 ID[], findings } — 기사는 그대로
//  · 없으면 게재 상태 published, 최초 발행일 기록(한 번 정해지면 바뀌지 않는다), 경고는 발행 기록(check_log.publish)·감사 로그에 남긴다
//  · 편집국 외 역할의 발행 시도는 403 + 감사 로그 (NAV-06) · 칼럼(opinion) 필자 본인의 발행도 403 + 감사 로그 (BR-08 — DB 트리거가 발행 기록으로 다시 막는다)
//  · 본인 발행 (2026-10-31 PO 결정) — 작성자 본인의 본인 발행 승인으로 통과한 기사는 발행 기록(check_log.publish.selfPublish)·감사 로그 사유에 '본인 발행'을 남긴다
//  · 시그니처 연재 회차는 경력 연수 표기 0·「그때와 지금」 비교 항목 1개 이상이어야 한다 — 422 { errors } (W3 8단계)
//  · 지역 기사는 승인(approved) 단계를 거쳐야 처음 공개한다 — 판정을 통과해도 단계를 건너뛰면 409 { failed: ["reg1_14.stage-skip"] } (REG1-14 · W4 8단계, DB articles_stage_order도 막는다)
//  · 별도 상품 검토 큐에 열린 항목이 있는 원고는 DB가 공개를 거부한다 — 409 (DB 문장 그대로)
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id);
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.article(id);
  const denied = await authorize(viewer, "article.publish", target);
  if (denied) return denied;

  const db = serviceDb();
  const before = await loadArticle(db, id);
  const authorDenied = await authorize(viewer, "article.publish", target, await articleResource(db, before));
  if (authorDenied) return authorDenied;
  if (before.status === "published") return errorJson(409, "이미 발행된 기사입니다 — 고치려면 수정(수정 종류·사유)을 쓰세요");
  if (before.status === "deleted") return errorJson(409, "삭제된 기사는 다시 발행할 수 없습니다");
  const signatureErrors = await signaturePublishErrors(db, before);
  if (signatureErrors.length) return errorJson(422, "시그니처 연재 회차를 발행할 수 없습니다", { errors: signatureErrors });

  const now = nowIso();
  const graph = await loadArticleGraph(db, before);
  const gate = await gateFor(db, graph, now);
  // 본인 발행 (2026-10-31 PO 결정) — 이 버전의 편집 승인이 작성자 본인의 본인 발행 승인이면 발행 기록·감사 로그에 표시한다
  const selfPublished = isSelfPublished(graph);

  const { data: check, error: checkError } = await db.from("seo_checks").insert(seoCheckRow(gate, gate.canPublish)).select("id").single();
  if (checkError || !check) throw dbError(checkError ?? {}, "seo_checks 추가");
  const seoCheckId = (check as { id: number }).id;

  if (!gate.canPublish) {
    return errorJson(422, `발행할 수 없습니다 — 차단 항목 ${gate.failed.length}개`, { seoCheckId, ...gateReport(gate) });
  }
  if (before.editorial_status === "rejected" || before.editorial_status === "held") {
    return errorJson(409, "편집 책임자가 반려·보류한 원고입니다 — 고친 뒤 다시 저장하면 발행할 수 있습니다", { seoCheckId });
  }
  if (before.tax_review_status === "rejected" || before.tax_review_status === "held") {
    return errorJson(409, "세무 감수위원이 반려·보류한 원고입니다 — 고친 뒤 다시 저장하거나 감수를 다시 받으면 발행할 수 있습니다", { seoCheckId });
  }
  const isAuthor = graph.author?.staff_user_id != null && graph.author.staff_user_id === viewer.userId;
  // 세무 감수 대상인데 감수 기록이 없으면 작성자 책임 발행 (세무 감수 대체 — 2026-10-31 PO 결정)
  const authorResponsibility = taxReviewReasons(gate.article).length > 0 && before.tax_review_status !== "approved";
  let current = before;
  if (before.editorial_status !== "approved") {
    // 이 버전의 편집 승인을 발행자 이름으로 함께 남긴다 — 보도기사 목록(reported_approved)·지역 기사 단계 순서가 이 기록을 본다
    const reviewer = await requirePersonForUser(db, viewer.userId);
    const checklist = { publishApproval: true, ...(isAuthor ? { authorPublish: true } : {}), ...(authorResponsibility ? { authorResponsibility: true } : {}) };
    const { data: review, error: reviewError } = await db
      .from("editorial_reviews")
      .insert({ article_id: id, version: before.version, kind: "desk_edit", reviewer_id: reviewer.id, decision: "approve", checklist })
      .select("id")
      .single();
    if (reviewError || !review) {
      const mapped = dbError(reviewError ?? {}, "editorial_reviews 발행 승인");
      if (mapped.status >= 500) throw mapped;
      return errorJson(409, `이 기사는 편집 책임자의 확인 항목이 필요합니다 — ${mapped.message}`, { seoCheckId });
    }
    await writeAudit(db, {
      actor: actorOf(viewer),
      action: "review.desk_edit",
      target,
      before: { status: before.status, editorialStatus: before.editorial_status },
      after: { reviewId: (review as { id: number }).id, version: before.version, decision: "approve", checklist },
      reason: isAuthor ? "작성자 발행 — 발행과 함께 편집 승인" : "편집 책임자 발행 — 발행과 함께 편집 승인",
    });
    current = await loadArticle(db, id);
    // 지역 기사는 승인 단계를 거쳐 공개한다 (REG1-14 — DB articles_stage_order) — 편집 승인이 생겼으니 승인 단계로 먼저 옮긴다
    if (isRegionalRow(current) && current.first_published_at === null && current.status !== "approved") {
      const toApproved = stageSkipProblem({ from: current.status, to: "approved", regional: true, firstPublished: false, editorialStatus: current.editorial_status, taxReviewStatus: current.tax_review_status });
      if (toApproved) return errorJson(409, toApproved, { seoCheckId, failed: ["reg1_14.stage-skip"] });
      current = await updateArticle(db, current, { status: "approved" }, "articles 승인 단계");
    }
  }
  const stage = stageSkipProblem({
    from: current.status,
    to: "published",
    regional: isRegionalRow(current),
    firstPublished: current.first_published_at !== null,
    editorialStatus: current.editorial_status,
    taxReviewStatus: current.tax_review_status,
  });
  if (stage) return errorJson(409, stage, { seoCheckId, failed: ["reg1_14.stage-skip"] });

  const marks = { ...(selfPublished ? { selfPublish: true } : {}), ...(isAuthor ? { authorPublish: true } : {}), ...(authorResponsibility ? { authorResponsibility: true } : {}) };
  const record = { at: now, version: current.version, by: actorOf(viewer), seoCheckId, warnings: gate.warnings, ...marks };
  const article = await updateArticle(
    db,
    current,
    { status: "published", first_published_at: current.first_published_at ?? now, check_log: withPublishRecord(current.check_log, record) },
    "articles 발행",
  );
  await writeAudit(db, {
    actor: actorOf(viewer),
    action: "article.publish",
    target,
    before: { status: before.status, version: before.version, firstPublishedAt: before.first_published_at },
    after: { status: article.status, version: article.version, firstPublishedAt: article.first_published_at, seoCheckId, warnings: gate.warnings, ...marks },
    reason: `${authorResponsibility ? "작성자 책임 발행 (세무 감수 대체)" : selfPublished ? "본인 발행" : isAuthor ? "작성자 발행" : "발행"}${gate.warnings.length ? ` — 경고 ${gate.warnings.length}개 기록` : ""}`,
  });
  // 편집 승인되면 AI 요약 상자 초안을 응답 뒤에 만든다 (W12-f O3 — 편집 승인 기록과 같은 자리, 꺼져 있으면 호출 0)
  if (before.editorial_status !== "approved") await scheduleAiBox(db, id);
  return json({ article: articleSummary(article), seoCheckId, warnings: gate.warnings });
}, { revalidatesPublic: true });
