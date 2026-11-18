import { authorize, requireViewer } from "@/lib/server/dal";
import { deskId, cancelRequest } from "@/lib/server/editorial/desk";
import { serviceDb } from "@/lib/server/articles/service";
import { handle, json } from "@/lib/server/http";

// 요청 취소 — 작성 중·대기만 (제작 중이면 작업기가 끝까지 처리한다) (PO 2026-11-18). 요청한 본인과 관리자만
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const id = deskId((await params).id);
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "editorial_desk.request", `editorial_requests:${id}`);
  if (denied) return denied;
  return json({ request: await cancelRequest(serviceDb(), viewer, id) });
});
