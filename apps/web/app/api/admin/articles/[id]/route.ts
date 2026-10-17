import { evaluatePublish, validateRevisionForSave, validateSolvedCaseForSave, validateTaxLensForSave, type UpdateKind } from "@ltr/editorial";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { parseChecklistsInput, readChecklists } from "@/lib/server/articles/content";
import { loadEditorView } from "@/lib/server/articles/editor-view";
import { POST_PUBLISH_BLOCKERS } from "@/lib/server/articles/gate";
import { parseArticleInput } from "@/lib/server/articles/input";
import { toArticleForPublish } from "@/lib/server/articles/mapping";
import { planEdit } from "@/lib/server/articles/plan";
import { articleResource, currentRevisionId, loadArticle, loadArticleGraph, loadGateSettings } from "@/lib/server/articles/repository";
import type { ArticleRow } from "@/lib/server/articles/rows";
import { afterSave, findingsError, nowIso, saveContext, serviceDb } from "@/lib/server/articles/service";
import { articleSummary, recordCorrection, saveNewVersion } from "@/lib/server/articles/writes";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 기사 한 건 — GET: 편집 화면용 전체 기록(편집국만 — 백오피스 편집기와 같은 모양, editor-view.ts) · PATCH: 수정 (ART-05 · NAV-06)
//  · 발행 전: 자유 수정, 저장마다 새 버전 + 수정 이력. 편집 승인은 다시 받는다.
//  · 발행 뒤: 편집 책임자만, 수정 종류(실질 수정·오탈자·정정)와 사유 필수. 오탈자는 실질 수정일(dateModified)을 바꾸지 않는다.
//    정정·제목 변경은 정정 이력(article_corrections)에 전후 버전과 함께 남는다. 금지·공포 표현·개인정보 형식은 발행 뒤에도 막는다.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id);
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const db = serviceDb();
  const row = await loadArticle(db, id);
  const denied = await authorize(viewer, "article.read", targetOf.article(id), await articleResource(db, row));
  if (denied) return denied;

  return json(await loadEditorView(db, row));
});

/** 감사 로그에 남길 바뀐 칸 — 본문은 수정 이력 번호로 대신한다 */
function columnDiff(before: ArticleRow, columns: Record<string, unknown>) {
  const old: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(columns)) {
    if (key === "body") continue;
    old[key] = before[key as keyof ArticleRow] ?? null;
    next[key] = value;
  }
  return { old, next };
}

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id);
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const db = serviceDb();
  const target = targetOf.article(id);
  const before = await loadArticle(db, id);
  const resource = await articleResource(db, before);
  const denied = await authorize(viewer, "article.edit", target, resource);
  if (denied) return denied;

  const parsed = parseArticleInput(await readJson(request), "patch");
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const input = parsed.value;
  if (input.contentType !== undefined && input.contentType !== before.content_type) {
    const typeDenied = await authorize(viewer, "article.edit", target, { ...resource, contentType: input.contentType });
    if (typeDenied) return typeDenied;
  }
  if (before.status === "deleted") return errorJson(409, "삭제된 기사는 고칠 수 없습니다");
  if (input.expectedVersion !== undefined && input.expectedVersion !== before.version) {
    return errorJson(409, `다른 사람이 먼저 고쳤습니다 — 지금 버전 ${before.version}`, { version: before.version });
  }

  const published = before.first_published_at !== null;
  let updateKind: UpdateKind | null = null;
  const reason = input.reason?.trim() ? input.reason.trim() : null;
  if (published) {
    if (input.slug !== undefined && input.slug !== before.slug) {
      return errorJson(409, "발행된 기사의 주소(slug)는 바꿀 수 없습니다 — 영속 URL (NAV-05)");
    }
    const revision = validateRevisionForSave({ updateKind: input.updateKind, reason: input.reason });
    if (!revision.ok) return findingsError("발행된 기사를 고치려면 수정 종류와 사유가 필요합니다 (ART-05)", revision.findings);
    updateKind = input.updateKind as UpdateKind;
  }

  let checklists;
  if (input.checklists !== undefined) {
    const r = parseChecklistsInput(input.checklists, readChecklists(before.check_log));
    if (!r.ok) return errorJson(422, "입력값을 확인하세요", { errors: r.errors });
    checklists = r.value;
  }

  const now = nowIso();
  const plan = planEdit(before, input, { now, updateKind, reason, checklists });
  if (plan.changed.length === 0) return json({ article: articleSummary(before), unchanged: true });
  if (plan.omissionReasonChanged) {
    const skipDenied = await authorize(viewer, "article.tax_lens_skip", target);
    if (skipDenied) return skipDenied;
  }

  const [graph, settings] = await Promise.all([loadArticleGraph(db, before), loadGateSettings(db)]);
  const ctx = saveContext(settings.dictionaries, now);
  if (input.taxLens) {
    const v = validateTaxLensForSave({ ...input.taxLens, reviewed: false, reviewedForVersion: null }, ctx);
    if (!v.ok) return findingsError("「지방세로 읽기」 박스가 저장 규칙에 맞지 않습니다 (CORE-01)", v.findings);
  }
  if (input.solvedCase) {
    const v = validateSolvedCaseForSave(input.solvedCase);
    if (!v.ok) return findingsError("해결 사례에 개인정보 형식이 있습니다 (CAT-05)", v.findings);
  }
  if (published) {
    const candidate = toArticleForPublish({ ...graph, article: plan.candidate });
    const blocked = evaluatePublish(candidate, ctx).blockers.filter((f) => POST_PUBLISH_BLOCKERS.has(f.id));
    if (blocked.length > 0) return findingsError("발행된 기사에 넣을 수 없는 표현이 있습니다", blocked);
    if ((updateKind === "correction" || plan.titleChanged) && (await currentRevisionId(db, before)) === null) {
      return errorJson(409, "현재 버전의 수정 이력이 없어 정정 전후 버전을 남길 수 없습니다 — 관리자에게 알려 주세요");
    }
  }

  const actor = actorOf(viewer);
  const saved = await saveNewVersion(db, before, plan.columns, { actor, reason, updateKind });

  // 발행 뒤 정정·제목 변경은 정정 이력에 전후 버전과 함께 (NAV-06)
  const corrections: { id: number; kind: string }[] = [];
  if (published && reason) {
    const kinds = [...(updateKind === "correction" ? (["correction"] as const) : []), ...(plan.titleChanged ? (["title_change"] as const) : [])];
    for (const kind of kinds) {
      const correctionId = await recordCorrection(db, {
        articleId: id,
        kind,
        beforeRevisionId: saved.previousRevisionId,
        afterRevisionId: saved.revisionId,
        reason,
        decidedBy: actor,
        readerNotice: reason,
        inquiryId: null,
        publishedAt: now,
      });
      corrections.push({ id: correctionId, kind });
    }
  }

  const { article, checks } = await afterSave(db, saved.article, settings.dictionaries, !published);
  const diff = columnDiff(before, plan.columns);
  await writeAudit(db, {
    actor,
    action: "article.edit",
    target,
    before: { version: before.version, revisionId: saved.previousRevisionId, status: before.status, ...diff.old },
    after: { version: article.version, revisionId: saved.revisionId, status: article.status, changed: plan.changed, corrections, ...diff.next },
    reason: reason ?? (published ? "발행 뒤 수정" : "발행 전 수정"),
  });
  return json({ article: articleSummary(article), revisionId: saved.revisionId, changed: plan.changed, corrections, checks });
});
