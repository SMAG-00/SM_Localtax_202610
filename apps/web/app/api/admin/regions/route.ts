import { judgeConflict, parseJudgeInput } from "@/lib/admin/regional-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { loadArticle } from "@/lib/server/articles/repository";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { articleSummary, updateArticle } from "@/lib/server/articles/writes";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, readJson } from "@/lib/server/http";

// 지역 기사 관리 (W4 7단계 — PRD-01B REG1-17, docs/dev/W4_설계.md 4장 `/api/admin/regions` · 6장). 별도 상품 큐·최소선 리포트는 8·11단계가 같은 경로에 더한다.
//  · POST op=judge { articleId, judgement(news_candidate·travel_review·restaurant_pick·event_promo, null = 판정 지우기), note? } — 편집자 판정.
//    편집 책임자·관리자(PO)만(regional.judge — 광고·협찬 담당 등은 403 + 거부 감사). 판정자·시각을 기사에 남기고 감사 article.regional_judgement 1건.
//    지역 기사(지역 태그 또는 지자체뉴스)만 · 공개(예약) 중인 보도·해설에 비보도 판정은 409(먼저 내린다 — DB 트리거도 막는다).
//    비보도 판정 원고는 보도기사·해설로 발행되지 않는다(발행 판정 reg1_17.non-news-judgement · DB 트리거).
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  const target = typeof body.articleId === "number" ? targetOf.article(body.articleId) : "articles:regional";
  // 역할만으로 먼저 판정 — 편집국 외 역할은 기사를 읽기 전에 거부하고 감사 로그에 남긴다
  const denied = await authorize(viewer, "regional.judge", target);
  if (denied) return denied;

  if (op !== "judge") return errorJson(422, "op는 judge여야 합니다 (별도 상품 큐는 8단계)");
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
  return json({ article: { ...articleSummary(article), editorialJudgement: article.editorial_judgement ?? null, judgedBy: article.judged_by ?? null, judgedAt: article.judged_at ?? null } });
}, { revalidatesPublic: true });
