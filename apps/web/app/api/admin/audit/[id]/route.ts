import { targetOf } from "@/lib/server/audit";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";
import { adminClient } from "@/lib/server/supabase";
import { HttpError } from "@/lib/server/http";

// 감사 기록 수정·삭제 (ADM-04 끝 문장 · W2-e 설계 10.2) — PATCH(고치기, 이유 필수) · DELETE(지우기, 이유 필수)
//  · 감사 기록 관리자(PO — AUDIT_ADMIN_EMAILS)만. 관리자 목록에 있어도 아니면 authorize()가 403 + 감사 로그 audit.amend.denied 정확히 1건
//  · 허용되면 DB 함수 audit_log_amend · audit_log_delete(service_role만)를 부른다 — 누가(actor)는 로그인한 사람에서 채우고, 바꾼 사실은 DB가 audit_log_changes에 남긴다
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const target = (id: number) => `audit_logs:${id}`;
void targetOf;

async function gate(request: Request, params: Ctx["params"]) {
  const id = parseId((await params).id);
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "audit.amend", target(id));
  if (denied) return denied;
  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  return { id, viewer, db };
}

const reasonOf = (body: Record<string, unknown>): string | null => (typeof body.reason === "string" && body.reason.trim() !== "" ? body.reason.trim() : null);

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const g = await gate(request, params);
  if (g instanceof Response) return g;
  const body = (await readJson(request)) as Record<string, unknown>;
  const reason = reasonOf(body);
  if (!reason) return errorJson(400, "이유(reason)는 필수입니다");
  const changes = body.changes;
  if (typeof changes !== "object" || changes === null || Array.isArray(changes) || Object.keys(changes).length === 0) return errorJson(400, "고칠 내용(changes)이 필요합니다");
  const { data, error } = await g.db.rpc("audit_log_amend", { p_id: g.id, p_changes: changes, p_actor: `admin:${g.viewer.email}`, p_reason: reason });
  if (error) throw dbError(error, "감사 기록 수정");
  return json({ ok: true, changeId: data });
});

export const DELETE = handle(async (request: Request, { params }: Ctx) => {
  const g = await gate(request, params);
  if (g instanceof Response) return g;
  const reason = reasonOf((await readJson(request)) as Record<string, unknown>);
  if (!reason) return errorJson(400, "이유(reason)는 필수입니다");
  const { data, error } = await g.db.rpc("audit_log_delete", { p_id: g.id, p_actor: `admin:${g.viewer.email}`, p_reason: reason });
  if (error) throw dbError(error, "감사 기록 삭제");
  return json({ ok: true, changeId: data });
});
