import { evaluatePublish } from "@ltr/editorial";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { POST_PUBLISH_BLOCKERS } from "@/lib/server/articles/gate";
import { parseArticleInput } from "@/lib/server/articles/input";
import { toArticleForPublish } from "@/lib/server/articles/mapping";
import { planEdit } from "@/lib/server/articles/plan";
import { currentRevisionId, loadArticle, loadArticleGraph, loadGateSettings } from "@/lib/server/articles/repository";
import { afterSave, findingsError, nowIso, saveContext, serviceDb } from "@/lib/server/articles/service";
import { articleSummary, recordCorrection, saveNewVersion, updateArticle, type CorrectionRecord } from "@/lib/server/articles/writes";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 정정·반론·추후보도·삭제·제목 변경 결정 (NAV-06 · ART-05) — 편집 책임자만. 이유 필수, 전후 버전·시각·독자 표시 문구를 남긴다.
//  · correction · title_change — changes(제목·요약·본문)로 새 버전을 만들고 전후 수정 이력을 잇는다
//  · rebuttal · follow_up — changes가 있으면 새 버전, 없으면 현재 버전에 기록만
//  · deletion — 게재 상태 deleted(삭제 기사 URL은 410 — 공개 화면 단계), 전 버전 기록
//  · inquiryId — 정정 요청 창구(inquiries)의 요청을 처리 완료로 닫는다
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const KINDS = ["correction", "rebuttal", "follow_up", "deletion", "title_change"] as const;
type Kind = (typeof KINDS)[number];
const CHANGE_KEYS = new Set(["title", "summary", "body"]);

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id);
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.article(id);
  const denied = await authorize(viewer, "correction.decide", target);
  if (denied) return denied;

  const raw = await readJson(request);
  const kind = raw.kind as Kind;
  if (!KINDS.includes(kind)) return errorJson(422, `kind는 ${KINDS.join("·")} 중 하나여야 합니다`);
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  if (!reason) return errorJson(422, "정정·반론·추후보도·삭제·제목 변경에는 이유가 필요합니다 (NAV-06)", { failed: ["nav06.reason-required"] });
  const readerNotice = typeof raw.readerNotice === "string" && raw.readerNotice.trim() ? raw.readerNotice.trim() : reason;
  const inquiryId = raw.inquiryId === undefined || raw.inquiryId === null ? null : raw.inquiryId;
  if (inquiryId !== null && (typeof inquiryId !== "number" || !Number.isSafeInteger(inquiryId) || inquiryId < 1)) return errorJson(422, "inquiryId는 번호여야 합니다");
  const changesRaw = raw.changes ?? null;
  if (changesRaw !== null && (typeof changesRaw !== "object" || Array.isArray(changesRaw))) return errorJson(422, "changes는 객체여야 합니다");
  const changesObj = (changesRaw ?? {}) as Record<string, unknown>;
  const badKeys = Object.keys(changesObj).filter((k) => !CHANGE_KEYS.has(k));
  if (badKeys.length) return errorJson(422, `changes에는 title·summary·body만 씁니다 (${badKeys.join(", ")})`);
  const parsed = parseArticleInput(changesObj, "patch");
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const changes = parsed.value;

  const db = serviceDb();
  const before = await loadArticle(db, id);
  if (before.status === "deleted") return errorJson(409, "이미 삭제된 기사입니다");
  const published = before.first_published_at !== null;
  if (kind !== "deletion" && !published) return errorJson(409, "정정·반론·추후보도·제목 변경은 발행된 기사에만 씁니다 — 발행 전에는 수정하세요");
  if (kind === "title_change" && (changes.title === undefined || changes.title === before.title)) {
    return errorJson(422, "제목 변경에는 새 제목(changes.title)이 필요합니다");
  }
  if (kind === "correction" && Object.keys(changesObj).length === 0) return errorJson(422, "정정에는 고친 내용(changes)이 필요합니다");
  if (kind === "deletion" && Object.keys(changesObj).length > 0) return errorJson(422, "삭제에는 changes를 쓰지 않습니다");

  const actor = actorOf(viewer);
  const now = nowIso();
  let article = before;
  let correction: Omit<CorrectionRecord, "kind">;
  const base = { articleId: id, reason, decidedBy: actor, readerNotice, inquiryId: inquiryId as number | null, publishedAt: now };
  const previous = await currentRevisionId(db, before);
  if (previous === null && kind !== "rebuttal" && kind !== "follow_up") {
    return errorJson(409, "현재 버전의 수정 이력이 없어 전후 버전을 남길 수 없습니다 — 관리자에게 알려 주세요");
  }

  if (kind === "deletion") {
    article = await updateArticle(db, before, { status: "deleted", updated_reason: reason }, "articles 삭제");
    correction = { ...base, beforeRevisionId: previous, afterRevisionId: null };
  } else if (Object.keys(changesObj).length > 0) {
    const updateKind = kind === "correction" ? "correction" : "substantive";
    const plan = planEdit(before, changes, { now, updateKind, reason });
    if (plan.changed.length === 0) return errorJson(422, "changes가 지금 기사와 같습니다");
    const [graph, settings] = await Promise.all([loadArticleGraph(db, before), loadGateSettings(db)]);
    const ctx = saveContext(settings.dictionaries, now);
    const blocked = evaluatePublish(toArticleForPublish({ ...graph, article: plan.candidate }), ctx).blockers.filter((f) => POST_PUBLISH_BLOCKERS.has(f.id));
    if (blocked.length > 0) return findingsError("발행된 기사에 넣을 수 없는 표현이 있습니다", blocked);
    const saved = await saveNewVersion(db, before, plan.columns, { actor, reason, updateKind });
    article = (await afterSave(db, saved.article, settings.dictionaries, false)).article;
    correction = { ...base, beforeRevisionId: saved.previousRevisionId, afterRevisionId: saved.revisionId };
  } else {
    correction = { ...base, beforeRevisionId: previous, afterRevisionId: null };
  }
  const correctionId = await recordCorrection(db, { ...correction, kind });

  if (inquiryId !== null) {
    const resolution = kind === "rebuttal" ? "rebuttal_published" : "correction_published";
    const { error } = await db
      .from("inquiries")
      .update({ status: "done", resolution, resolution_reason: reason, related_article_id: id })
      .eq("id", inquiryId)
      .eq("kind", "correction");
    if (error) throw dbError(error, "inquiries 처리");
  }

  await writeAudit(db, {
    actor,
    action: "correction.decide",
    target,
    before: { status: before.status, version: before.version, title: before.title },
    after: {
      kind,
      correctionId,
      status: article.status,
      version: article.version,
      title: article.title,
      beforeRevisionId: correction.beforeRevisionId,
      afterRevisionId: correction.afterRevisionId,
      inquiryId,
    },
    reason,
  });
  return json({ correction: { id: correctionId, kind, beforeRevisionId: correction.beforeRevisionId, afterRevisionId: correction.afterRevisionId }, article: articleSummary(article) }, 201);
}, { revalidatesPublic: true });
