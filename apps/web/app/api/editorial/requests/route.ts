import { parseRequestInput } from "@/lib/editorial/request-input";
import { authorize, requireViewer } from "@/lib/server/dal";
import { createRequest, listRequests } from "@/lib/server/editorial/desk";
import { serviceDb } from "@/lib/server/articles/service";
import { errorJson, handle, json, readJson } from "@/lib/server/http";

// 편집위원 데스크 요청 (PO 2026-11-18) — 목록(GET)·새 요청(POST, 작성 중 상태로 만든 뒤 첨부를 올리고 submit으로 대기열에 넣는다)
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "editorial_desk.read", "editorial_requests");
  if (denied) return denied;
  return json({ requests: await listRequests(serviceDb()) });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "editorial_desk.request", "editorial_requests");
  if (denied) return denied;
  const parsed = parseRequestInput(await readJson(request));
  if (!parsed.ok) return errorJson(422, parsed.errors[0]!, { errors: parsed.errors });
  return json({ request: await createRequest(serviceDb(), viewer, parsed.value) }, 201);
});
