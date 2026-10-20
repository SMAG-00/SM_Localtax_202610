import { isInquiryKind } from "@/lib/admin/inquiry-rules";
import { authorize, requireViewer } from "@/lib/server/dal";
import { HttpError, dbError, errorJson, handle } from "@/lib/server/http";
import { adminClient } from "@/lib/server/supabase";

// 첨부 내려받기 (설계 7.4) — 비공개 버킷의 5분짜리 서명 주소(항상 내려받기 형태)로 보낸다. 바이러스 검사를 하지 않으므로 화면 안에서 열지 않는다
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; n: string }> };

export const GET = handle(async (request: Request, { params }: Ctx) => {
  const p = await params;
  const id = Number(p.id);
  const n = Number(p.n);
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(n) || n < 0) return errorJson(400, "번호가 올바르지 않습니다");
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const found = await db.from("inquiries").select("kind, attachments").eq("id", id).maybeSingle();
  if (found.error) throw dbError(found.error, "inquiries 읽기");
  const row = found.data as { kind: string; attachments: { path: string; name: string }[] } | null;
  if (!row || !isInquiryKind(row.kind)) return errorJson(404, "문의를 찾을 수 없습니다");
  const denied = await authorize(viewer, "inquiry.read", `inquiries:${id}`, { kind: "inquiry", inquiryKind: row.kind });
  if (denied) return denied;
  const file = row.attachments[n];
  if (!file) return errorJson(404, "첨부 파일이 없습니다");
  const signed = await db.storage.from("inquiry-attachments").createSignedUrl(file.path, 300, { download: file.name });
  if (signed.error || !signed.data) return errorJson(503, "첨부 파일을 열 수 없습니다");
  return new Response(null, { status: 302, headers: { location: signed.data.signedUrl, "cache-control": "no-store" } });
});
