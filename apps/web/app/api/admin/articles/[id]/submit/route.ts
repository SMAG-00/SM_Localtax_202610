import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { articleResource, loadArticle } from "@/lib/server/articles/repository";
import { serviceDb } from "@/lib/server/articles/service";
import { articleSummary, updateArticle } from "@/lib/server/articles/writes";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, parseId } from "@/lib/server/http";

// 검토 요청 — 초안(draft)·보류(held) → 검토 중(in_review). 편집 승인·발행은 편집 책임자가 따로 한다.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id);
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const db = serviceDb();
  const target = targetOf.article(id);
  const before = await loadArticle(db, id);
  const denied = await authorize(viewer, "article.submit", target, await articleResource(db, before));
  if (denied) return denied;

  if (before.status === "in_review") return json({ article: articleSummary(before), unchanged: true });
  if (before.status !== "draft" && before.status !== "held") {
    return errorJson(409, `지금 상태(${before.status})에서는 검토를 요청할 수 없습니다 — 초안·보류 기사만`);
  }
  const article = await updateArticle(db, before, { status: "in_review" }, "articles 검토 요청");
  await writeAudit(db, {
    actor: actorOf(viewer),
    action: "article.submit",
    target,
    before: { status: before.status, version: before.version },
    after: { status: article.status, version: article.version },
    reason: "검토 요청",
  });
  return json({ article: articleSummary(article) });
});
