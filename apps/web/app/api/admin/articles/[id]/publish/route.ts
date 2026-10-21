import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { withPublishRecord } from "@/lib/server/articles/content";
import { gateReport, seoCheckRow } from "@/lib/server/articles/report";
import { articleResource, loadArticle, loadArticleGraph } from "@/lib/server/articles/repository";
import { gateFor, nowIso, serviceDb } from "@/lib/server/articles/service";
import { signaturePublishErrors } from "@/lib/server/articles/signature";
import { articleSummary, updateArticle } from "@/lib/server/articles/writes";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, parseId } from "@/lib/server/http";

// 기사 발행 (ART-01 · OPT-03) — 편집 책임자만. 최적화 점검(seo-lint) + 편집 판정(editorial)을 돌려 점검 이력(seo_checks)을 남기고,
//  · 차단 항목이 있으면 422 { failed: 차단 ID[], findings } — 기사는 그대로
//  · 없으면 게재 상태 published, 최초 발행일 기록(한 번 정해지면 바뀌지 않는다), 경고는 발행 기록(check_log.publish)·감사 로그에 남긴다
//  · 편집국 외 역할의 발행 시도는 403 + 감사 로그 (NAV-06) · 칼럼(opinion) 필자 본인의 발행도 403 + 감사 로그 (BR-08 — DB 트리거가 발행 기록으로 다시 막는다)
//  · 시그니처 연재 회차는 경력 연수 표기 0·「그때와 지금」 비교 항목 1개 이상이어야 한다 — 422 { errors } (W3 8단계)
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
  const gate = await gateFor(db, await loadArticleGraph(db, before), now);

  const { data: check, error: checkError } = await db.from("seo_checks").insert(seoCheckRow(gate, gate.canPublish)).select("id").single();
  if (checkError || !check) throw dbError(checkError ?? {}, "seo_checks 추가");
  const seoCheckId = (check as { id: number }).id;

  if (!gate.canPublish) {
    return errorJson(422, `발행할 수 없습니다 — 차단 항목 ${gate.failed.length}개`, { seoCheckId, ...gateReport(gate) });
  }

  const record = { at: now, version: before.version, by: actorOf(viewer), seoCheckId, warnings: gate.warnings };
  const article = await updateArticle(
    db,
    before,
    { status: "published", first_published_at: before.first_published_at ?? now, check_log: withPublishRecord(before.check_log, record) },
    "articles 발행",
  );
  await writeAudit(db, {
    actor: actorOf(viewer),
    action: "article.publish",
    target,
    before: { status: before.status, version: before.version, firstPublishedAt: before.first_published_at },
    after: { status: article.status, version: article.version, firstPublishedAt: article.first_published_at, seoCheckId, warnings: gate.warnings },
    reason: gate.warnings.length ? `발행 — 경고 ${gate.warnings.length}개 기록` : "발행",
  });
  return json({ article: articleSummary(article), seoCheckId, warnings: gate.warnings });
}, { revalidatesPublic: true });
