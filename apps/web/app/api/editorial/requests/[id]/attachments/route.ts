import { authorize, requireViewer } from "@/lib/server/dal";
import { addAttachment, deskId } from "@/lib/server/editorial/desk";
import { serviceDb } from "@/lib/server/articles/service";
import { errorJson, handle, json } from "@/lib/server/http";

// 첨부 하나 올리기 (multipart, 칸 이름 file) — 작성 중 요청에만, 파일당 4MB·5개 (PO 2026-11-18)
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const id = deskId((await params).id);
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "editorial_desk.request", `editorial_requests:${id}`);
  if (denied) return denied;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return errorJson(422, "file 칸에 파일을 하나 넣어 주세요");
  return json({ request: await addAttachment(serviceDb(), viewer, id, file) }, 201);
});
