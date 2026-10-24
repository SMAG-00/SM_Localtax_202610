import { targetOf } from "@/lib/server/audit";
import { gateReport } from "@/lib/server/articles/report";
import { parseArticleInput } from "@/lib/server/articles/input";
import { planEdit } from "@/lib/server/articles/plan";
import { articleResource, loadArticle, loadArticleGraph, loadGateSettings } from "@/lib/server/articles/repository";
import { gateFor, nowIso, serviceDb } from "@/lib/server/articles/service";
import { articleSummary } from "@/lib/server/articles/writes";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 발행 판정 미리 보기 (편집 화면 점검 패널, OPT-03) — 발행 API와 같은 판정을 돌리고 아무것도 쓰지 않는다
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
  const gate = await gateFor(db, await loadArticleGraph(db, row), nowIso());
  return json({ article: articleSummary(row), ...gateReport(gate) });
});

// 저장 전 입력 기준 점검 (OPT-03 "편집 중 저장하지 않아도 입력이 멈추면 패널 결과가 다시 계산됩니다") —
// 저장 요청(PATCH)과 같은 본문을 받아 메모리에서 합친 원고로 같은 발행 판정을 돌린다. 아무것도 쓰지 않는다(점검 기록 seo_checks도 남기지 않음).
// 발행은 이 결과가 아니라 저장된 버전을 서버가 다시 판정한 결과가 정한다.
export const POST = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id);
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const db = serviceDb();
  const row = await loadArticle(db, id);
  const denied = await authorize(viewer, "article.edit", targetOf.article(id), await articleResource(db, row));
  if (denied) return denied;
  if (row.status === "deleted") return errorJson(409, "삭제된 기사는 점검할 수 없습니다");
  const parsed = parseArticleInput(await readJson(request), "patch");
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const now = nowIso();
  const plan = planEdit(row, parsed.value, { now, updateKind: null, reason: null });
  const [graph, settings] = await Promise.all([loadArticleGraph(db, plan.candidate), loadGateSettings(db)]);
  const gate = await gateFor(db, graph, now, settings);
  return json({ article: articleSummary(row), draft: true, ...gateReport(gate) });
});
