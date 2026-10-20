import { INQUIRY_READERS } from "@/lib/access";
import { completionBlocked, isInquiryKind, parseInquiryPatch } from "@/lib/admin/inquiry-rules";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { authorize, requireViewer } from "@/lib/server/dal";
import { HttpError, dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";
import { adminClient } from "@/lib/server/supabase";

// 문의 변경 (ADM-03 · 설계 7.3) — PATCH: 상태·담당자·메모(·정정 처리 결과/사유). 종류별 담당 역할만, 변경은 감사 로그 inquiry.update(전후 상태·담당자 uuid, 메모 길이 — 본문·연락처 0)
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id, "문의");
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const target = `inquiries:${id}`;
  const found = await db.from("inquiries").select("id, kind, status, assignee, memo, resolution, resolution_reason").eq("id", id).maybeSingle();
  if (found.error) throw dbError(found.error, "inquiries 읽기");
  const row = found.data as { kind: string; status: string; assignee: string | null; memo: string | null; resolution: string | null; resolution_reason: string | null } | null;
  if (!row || !isInquiryKind(row.kind)) return errorJson(404, "문의를 찾을 수 없습니다");
  const denied = await authorize(viewer, "inquiry.update", target, { kind: "inquiry", inquiryKind: row.kind });
  if (denied) return denied;

  const parsed = parseInquiryPatch(await readJson(request));
  if (!parsed.ok) return errorJson(400, parsed.message);
  const p = parsed.patch;
  const nextStatus = p.status ?? (row.status as "received" | "in_progress" | "done");
  const blocked = completionBlocked(row.kind, nextStatus, p.resolution ?? row.resolution, p.resolutionReason ?? row.resolution_reason);
  if (blocked) return errorJson(422, blocked);

  if (p.assignee) {
    // 담당자는 그 종류를 다룰 역할이 있는 직원만
    const roles = await db.from("staff_roles").select("role").eq("user_id", p.assignee);
    const ok = (roles.data ?? []).some((r: { role: string }) => (INQUIRY_READERS[row.kind as keyof typeof INQUIRY_READERS] as readonly string[]).includes(r.role));
    if (!ok) return errorJson(422, "그 종류의 문의를 다룰 역할이 있는 직원만 담당자로 정할 수 있습니다");
  }

  const update: Record<string, unknown> = {};
  if (p.status !== undefined) update.status = p.status;
  if (p.assignee !== undefined) update.assignee = p.assignee;
  if (p.memo !== undefined) update.memo = p.memo;
  if (p.resolution !== undefined) update.resolution = p.resolution;
  if (p.resolutionReason !== undefined) update.resolution_reason = p.resolutionReason;
  const upd = await db.from("inquiries").update(update).eq("id", id).select("id, status, assignee").single();
  if (upd.error) throw dbError(upd.error, "inquiries 변경");
  const after = upd.data as { status: string; assignee: string | null };
  await writeAudit(db, {
    actor: actorOf(viewer),
    action: "inquiry.update",
    target,
    before: { status: row.status, assignee: row.assignee, memoLength: row.memo?.length ?? 0 },
    after: { status: after.status, assignee: after.assignee, memoLength: p.memo !== undefined ? (p.memo?.length ?? 0) : (row.memo?.length ?? 0) },
    reason: "문의 상태·담당자·메모 변경",
  });
  return json({ ok: true, inquiry: { id, status: after.status, assignee: after.assignee } });
});
