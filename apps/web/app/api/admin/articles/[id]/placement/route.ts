import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { loadArticle } from "@/lib/server/articles/repository";
import { serviceDb } from "@/lib/server/articles/service";
import { articleSummary, updateArticle } from "@/lib/server/articles/writes";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 기사 정렬·HOT 고정·뉴스 전송 후보 선정 (PRD-00 6장 편집 행위 — 편집 책임자만, 관리자도 editor 필요)
//  · hotPinUntil — HOT 고정 종료 시각(ISO 8601) 또는 null(해제)
//  · navCandidate — 뉴스 전송 후보. 편집 승인된 보도기사(reported_news)만 (NAV-02)
//  · 편집국 외 역할의 시도는 403 + 감사 로그 (NAV-06)
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id);
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.article(id);
  const denied = await authorize(viewer, "article.sort", target);
  if (denied) return denied;

  const raw = await readJson(request);
  const unknown = Object.keys(raw).filter((k) => k !== "hotPinUntil" && k !== "navCandidate");
  if (unknown.length) return errorJson(422, `모르는 칸입니다: ${unknown.join(", ")}`);
  const columns: Record<string, unknown> = {};
  if (raw.hotPinUntil !== undefined) {
    const hotDenied = await authorize(viewer, "article.hot", target);
    if (hotDenied) return hotDenied;
    if (raw.hotPinUntil !== null && (typeof raw.hotPinUntil !== "string" || !ISO_WITH_ZONE.test(raw.hotPinUntil) || Number.isNaN(Date.parse(raw.hotPinUntil)))) {
      return errorJson(422, "hotPinUntil은 시간대가 붙은 ISO 8601 시각이거나 null이어야 합니다");
    }
    columns.hot_pin_until = raw.hotPinUntil;
  }
  if (raw.navCandidate !== undefined) {
    if (typeof raw.navCandidate !== "boolean") return errorJson(422, "navCandidate는 true/false여야 합니다");
    columns.nav_candidate = raw.navCandidate;
  }
  if (Object.keys(columns).length === 0) return errorJson(422, "hotPinUntil 또는 navCandidate가 필요합니다");

  const db = serviceDb();
  const before = await loadArticle(db, id);
  if (before.status !== "published") return errorJson(409, "발행된 기사만 정렬·HOT·후보로 지정할 수 있습니다");
  if (columns.nav_candidate === true && (before.content_type !== "reported_news" || before.editorial_status !== "approved")) {
    return errorJson(422, "뉴스 전송 후보는 편집 승인된 보도기사(reported_news)만 됩니다 (NAV-02)");
  }
  const article = await updateArticle(db, before, columns, "articles 배치");
  await writeAudit(db, {
    actor: actorOf(viewer),
    action: "article.placement",
    target,
    before: { hotPinUntil: before.hot_pin_until, navCandidate: before.nav_candidate },
    after: { hotPinUntil: article.hot_pin_until, navCandidate: article.nav_candidate },
    reason: "기사 배치 변경",
  });
  return json({ article: { ...articleSummary(article), hotPinUntil: article.hot_pin_until, navCandidate: article.nav_candidate } });
});
