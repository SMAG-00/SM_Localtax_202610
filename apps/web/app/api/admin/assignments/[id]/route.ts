import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { parseAssignmentInput } from "@/lib/server/assignment-input";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { HttpError, dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 기사 기획 수정·상태 변경 (NAV-09) — DB가 강제하는 규칙:
//  · 담당 기자·편집자·이해관계·전문 분야 관련성이 비면 assigned 이후로 못 간다
//  · fact_check·review를 거치지 않은 published 거부 (held는 어느 상태에서나)
// 거부되면 409와 그 규칙 문장. 상태 기록(story_assignment_events)은 트리거가 쓴다.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id, "기획");
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.assignment(id);
  const denied = await authorize(viewer, "assignment.update", target);
  if (denied) return denied;
  const parsed = parseAssignmentInput(await readJson(request), "patch");
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });

  const db = serviceDb();
  const { data: current, error: readError } = await db.from("story_assignments").select("*").eq("id", id).maybeSingle();
  if (readError) throw dbError(readError, "story_assignments 읽기");
  if (!current) throw new HttpError(404, "기획을 찾을 수 없습니다");
  const before = current as Record<string, unknown> & { status: string; reject_reason: string | null };
  const columns = parsed.value;
  if (columns.status === "held" && before.status !== "held" && !String(columns.reject_reason ?? before.reject_reason ?? "").trim()) {
    return errorJson(422, "보류(held)에는 반려 사유(rejectReason)가 필요합니다 (NAV-09 월간 점검)");
  }

  const actor = actorOf(viewer);
  const { data, error } = await db
    .from("story_assignments")
    .update({ ...columns, updated_by: actor })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) throw dbError(error ?? {}, "story_assignments 수정");
  const after = data as Record<string, unknown> & { status: string };

  const changed = Object.keys(columns);
  await writeAudit(db, {
    actor,
    action: "assignment.update",
    target,
    before: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
    after: Object.fromEntries(changed.map((k) => [k, after[k] ?? null])),
    reason: columns.status && columns.status !== before.status ? `상태 ${before.status} → ${after.status}` : "기획 수정",
  });
  return json({ assignment: after });
});
