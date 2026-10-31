import type { ArticleResource } from "@/lib/access";
import { serviceDb } from "@/lib/server/articles/service";
import { createWeeklyCardNewsDraft } from "@/lib/server/articles/weekly-cardnews-draft";
import { authorize, requireViewer } from "@/lib/server/dal";
import { handle, json } from "@/lib/server/http";
import { siteBase } from "@/lib/server/site-base";

// 이번 주 카드뉴스 초안 만들기 (PO 결정 2026-10-31) — 지난 7일 공개 기사 중 많이 본 3건(조회 기록이 없으면 최신 3건)으로
// 카드뉴스 5장 초안을 만든다. 권한은 기사 초안 작성과 같다(article.create — 기자·편집 책임자·관리자). 작성자 = 로그인한 계정의 인물.
// 초안은 보통 기사와 같이 점검·검토 요청·편집 승인·발행을 거친다. 본문 없이 부른다.
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const resource: ArticleResource = { kind: "article", authorUserId: viewer.userId, contentType: "explainer", published: false };
  const denied = await authorize(viewer, "article.create", "articles:new", resource);
  if (denied) return denied;
  const result = await createWeeklyCardNewsDraft(serviceDb(), viewer, { now: new Date(), siteBase: siteBase(request) });
  return json(result, 201);
});
