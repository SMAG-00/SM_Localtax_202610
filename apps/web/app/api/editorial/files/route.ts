import { authorize, requireViewer } from "@/lib/server/dal";
import { deskId, signedFileUrl } from "@/lib/server/editorial/desk";
import { serviceDb } from "@/lib/server/articles/service";
import { errorJson, handle } from "@/lib/server/http";

// 결과물·첨부 파일 열기 (PO 2026-11-18) — ?package=<묶음 id>&path=<상대 경로> 또는 ?request=<요청 id>&path=<첨부 경로>.
// 비공개 버킷의 5분 서명 주소로 보낸다. 그림·PDF는 브라우저에서 열고, 나머지(md·html·docx·xlsx 등)는 내려받기.
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const url = new URL(request.url);
  const pkg = url.searchParams.get("package");
  const req = url.searchParams.get("request");
  const path = url.searchParams.get("path") ?? "";
  if ((pkg === null) === (req === null) || path === "" || path.length > 500) return errorJson(400, "package 또는 request 하나와 path가 필요합니다");
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const id = deskId((pkg ?? req)!);
  const denied = await authorize(viewer, "editorial_desk.read", pkg ? `editorial_packages:${id}` : `editorial_requests:${id}`);
  if (denied) return denied;
  const signed = await signedFileUrl(serviceDb(), pkg ? "package" : "attachment", id, path);
  return new Response(null, { status: 302, headers: { location: signed, "cache-control": "no-store" } });
});
