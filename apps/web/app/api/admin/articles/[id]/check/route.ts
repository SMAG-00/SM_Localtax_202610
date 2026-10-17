import { targetOf } from "@/lib/server/audit";
import { gateReport } from "@/lib/server/articles/report";
import { articleResource, loadArticle, loadArticleGraph } from "@/lib/server/articles/repository";
import { gateFor, nowIso, serviceDb } from "@/lib/server/articles/service";
import { articleSummary } from "@/lib/server/articles/writes";
import { authorize, requireViewer } from "@/lib/server/dal";
import { handle, json, parseId } from "@/lib/server/http";

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
