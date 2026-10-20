import { isInquiryKind } from "@/lib/admin/inquiry-rules";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { authorize, requireViewer } from "@/lib/server/dal";
import { HttpError, dbError, errorJson, handle, json, parseId } from "@/lib/server/http";
import { adminClient } from "@/lib/server/supabase";

// 연락처 보기 (ADM-03 · 설계 7.3) — [연락처 보기]를 누를 때마다 감사 로그 inquiry.contact_view 1건(문의 번호만 — 연락처 값 0)을 남기고 연락처를 돌려준다.
// 감사 로그를 먼저 남기고 실패하면 연락처를 돌려주지 않는다. 보존 기한이 지나 비운 문의는 빈 값
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id, "문의");
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const found = await db.from("inquiries").select("kind, contact_email, contact_name, organization").eq("id", id).maybeSingle();
  if (found.error) throw dbError(found.error, "inquiries 읽기");
  const row = found.data as { kind: string; contact_email: string | null; contact_name: string | null; organization: string | null } | null;
  if (!row || !isInquiryKind(row.kind)) return errorJson(404, "문의를 찾을 수 없습니다");
  const target = `inquiries:${id}`;
  const denied = await authorize(viewer, "inquiry.contact_view", target, { kind: "inquiry", inquiryKind: row.kind });
  if (denied) return denied;
  await writeAudit(db, { actor: actorOf(viewer), action: "inquiry.contact_view", target, before: null, after: null, reason: "문의 연락처 보기" });
  return json({ contact: { email: row.contact_email, name: row.contact_name, organization: row.organization } });
});
