import { isNonNewsJudgement } from "@ltr/editorial";
import { judgeConflict, parseCloseInput, parseJudgeInput } from "@/lib/admin/regional-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { loadArticle } from "@/lib/server/articles/repository";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { articleSummary, updateArticle } from "@/lib/server/articles/writes";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { QUEUE_COLUMNS, loadRegionsBoard, type QueueItem } from "@/lib/server/regions/board";

// 지역 기사 관리 (W4 7·8단계 — PRD-01B REG1-14·17, docs/dev/W4_설계.md 4장 `/api/admin/regions` · 6장). 최소선 리포트는 11단계가 같은 경로에 더한다.
// 모두 편집 책임자·관리자(PO)만(regional.judge — 광고·협찬 담당·기자 등은 403 + 거부 감사).
//  · GET — 판정판: 별도 상품 검토 큐(열린 항목 + 최근 닫힌 20건, 원고 제목) · 편집 분야 승인 대기 · 보류 지역 기사
//  · POST op=judge { articleId, judgement(news_candidate·travel_review·restaurant_pick·event_promo, null = 판정 지우기), note? } — 편집자 판정.
//    판정자·시각을 기사에 남기고 감사 article.regional_judgement 1건. 지역 기사(지역 태그 또는 지자체뉴스)만 · 공개(예약) 중인 원고에 비보도 판정은 409
//    (보도·해설 — 7단계, 그 밖의 유형 — 8단계: 큐 원고는 공개 0이므로 먼저 내린다. DB 트리거도 막는다).
//    비보도 판정이 되면 DB 트리거가 별도 상품 검토 큐에 열린 항목 1건을 만들고(이미 열려 있으면 판정만 맞춘다) 감사 separate_product.route 1건,
//    기사 후보·지우기로 바꾸면 열린 항목이 닫힌다(트리거 — 같은 감사 article.regional_judgement에 남는다).
//  · POST op=close { itemId, note } — 별도 상품 검토 닫기(결정 사유 필수 — 광고·협찬 상품 전환·행사안내 등록(W6)·폐기 등). 닫힌 항목 409. 감사 separate_product.close.
//    닫아도 판정은 그대로다 — 보도·해설은 여전히 발행 거부(7단계), 그 밖의 유형은 공개할 수 있다.
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "regional.judge", "separate_product_queue:list");
  if (denied) return denied;
  return json(await loadRegionsBoard(serviceDb()));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  const target =
    op === "close" && typeof body.itemId === "number"
      ? targetOf.separateProduct(body.itemId)
      : typeof body.articleId === "number"
        ? targetOf.article(body.articleId)
        : "articles:regional";
  // 역할만으로 먼저 판정 — 편집국 외 역할은 기사를 읽기 전에 거부하고 감사 로그에 남긴다
  const denied = await authorize(viewer, "regional.judge", target);
  if (denied) return denied;

  if (op === "close") return closeItem(viewer, body);
  if (op !== "judge") return errorJson(422, "op는 judge·close 중 하나여야 합니다");
  const parsed = parseJudgeInput(body);
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const { articleId, judgement, note } = parsed.value;

  const db = serviceDb();
  const before = await loadArticle(db, articleId);
  if (before.status === "deleted") return errorJson(409, "삭제된 기사는 판정할 수 없습니다");
  if (!(before.region_codes.length > 0 || before.section === "local")) {
    return errorJson(422, "지역 기사(지역 태그 또는 지자체뉴스)만 판정합니다 (REG1-17)", { errors: ["articleId: 지역 기사가 아닙니다"] });
  }
  const conflict = judgeConflict(before, judgement);
  if (conflict) return errorJson(409, conflict);
  if ((before.editorial_judgement ?? null) === judgement) return json({ article: articleSummary(before), unchanged: true });

  const actor = actorOf(viewer);
  const now = nowIso();
  const columns = judgement === null ? { editorial_judgement: null, judged_by: null, judged_at: null } : { editorial_judgement: judgement, judged_by: actor, judged_at: now };
  const article = await updateArticle(db, before, columns, "articles 편집자 판정");
  await writeAudit(db, {
    actor,
    action: "article.regional_judgement",
    target: targetOf.article(articleId),
    before: { judgement: before.editorial_judgement ?? null, judgedBy: before.judged_by ?? null, judgedAt: before.judged_at ?? null },
    after: { judgement, judgedBy: columns.judged_by, judgedAt: columns.judged_at },
    reason: note ?? (judgement === null ? "편집자 판정 지우기" : `편집자 판정 ${judgement}`),
  });
  // 비보도 판정 → 별도 상품 검토 큐로 보냄 (항목은 DB 트리거가 만든다 — 같은 판정의 열린 항목은 하나)
  if (isNonNewsJudgement(judgement) && !isNonNewsJudgement(before.editorial_judgement)) {
    await writeAudit(db, {
      actor,
      action: "separate_product.route",
      target: targetOf.article(articleId),
      before: { judgement: before.editorial_judgement ?? null },
      after: { judgement, queue: "open" },
      reason: note ?? `별도 상품 검토 큐로 보냄 — ${judgement}`,
    });
  }
  return json({ article: { ...articleSummary(article), editorialJudgement: article.editorial_judgement ?? null, judgedBy: article.judged_by ?? null, judgedAt: article.judged_at ?? null } });
}, { revalidatesPublic: true });

async function closeItem(viewer: { userId: string }, body: Record<string, unknown>): Promise<Response> {
  const parsed = parseCloseInput(body);
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const { itemId, note } = parsed.value;
  const db = serviceDb();
  const { data, error } = await db.from("separate_product_queue").select(QUEUE_COLUMNS).eq("id", itemId).maybeSingle();
  if (error) throw dbError(error, "separate_product_queue 읽기");
  if (!data) return errorJson(404, "별도 상품 검토 항목이 없습니다");
  const item = data as QueueItem;
  if (item.status !== "open") return errorJson(409, "이미 닫힌 항목입니다 — 다시 판정하면 새 항목이 열립니다");
  const actor = actorOf(viewer);
  const { data: closed, error: closeError } = await db
    .from("separate_product_queue")
    .update({ status: "closed", closed_by: actor, closed_at: nowIso(), note })
    .eq("id", itemId)
    .eq("status", "open")
    .select(QUEUE_COLUMNS)
    .maybeSingle();
  if (closeError) throw dbError(closeError, "separate_product_queue 닫기");
  if (!closed) return errorJson(409, "이미 닫힌 항목입니다 — 다시 판정하면 새 항목이 열립니다");
  await writeAudit(db, {
    actor,
    action: "separate_product.close",
    target: targetOf.separateProduct(itemId),
    before: { status: item.status, articleId: Number(item.article_id), judgement: item.judgement },
    after: { status: "closed", note },
    reason: note,
  });
  return json({ item: closed });
}
