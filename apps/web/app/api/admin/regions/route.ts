import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json } from "@/lib/server/http";
import { loadRegionIndexReport } from "@/lib/server/regions/report";

// 지역 관리 API — 편집 책임자·관리자(regional.judge)만.
//  · GET ?view=report — 시범 지역 최소선 판정 리포트(시범 지역마다 자체 취재 수·공식 자료 수와 최소선, 시·도 분포, 전국 색인 대상 수). 다른 view 값은 422
// 별도 상품 검토 큐(판정판 GET·op=judge·op=close)는 2026-11-18 PO 결정으로 걷어냈다 — DB 트리거도 migration 20261118000244가 지웠다.
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const view = new URL(request.url).searchParams.get("view");
  const denied = await authorize(viewer, "regional.judge", "region_index_status:report");
  if (denied) return denied;
  if (view !== "report") return errorJson(422, "view는 report만 있습니다");
  return json({ report: await loadRegionIndexReport(serviceDb()) });
});
