import { authorize, requireViewer } from "@/lib/server/dal";
import { serviceDb } from "@/lib/server/articles/service";
import { openRequestDetail } from "@/lib/server/experts/board";
import { errorJson, handle, json, parseId } from "@/lib/server/http";

// 연락 요청 상세 (W7c - EXPL-19) - GET /api/admin/experts/requests/[id]. 관리자(운영 책임자)만. 열 때마다 열람 감사 1행(expert.request.view).
// 파기된 요청은 이름·연락처·요약이 null이다 (EXPL-21).
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const id = parseId((await params).id, "연락 요청");
  const denied = await authorize(viewer, "settings.edit", `expert_requests:${id}`);
  if (denied) return denied;
  const detail = await openRequestDetail(serviceDb(), id, viewer);
  if (!detail) return errorJson(404, "연락 요청을 찾을 수 없습니다");
  return json({ request: detail });
});
