import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { parseAssignmentInput } from "@/lib/server/assignment-input";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 기사 기획 캘린더 등록 (NAV-09) — 기자·편집 책임자·관리자. 상태 규칙은 DB가 강제하고, 거부되면 409와 그 규칙 문장을 돌려준다.
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "assignment.create", "story_assignments:new");
  if (denied) return denied;
  const parsed = parseAssignmentInput(await readJson(request), "create");
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  if (parsed.value.status === "held" && !String(parsed.value.reject_reason ?? "").trim()) {
    return errorJson(422, "보류(held)에는 반려 사유(rejectReason)가 필요합니다 (NAV-09 월간 점검)");
  }

  const db = serviceDb();
  const actor = actorOf(viewer);
  const { data, error } = await db
    .from("story_assignments")
    .insert({ ...parsed.value, updated_by: actor })
    .select("*")
    .single();
  if (error || !data) throw dbError(error ?? {}, "story_assignments 추가");
  const row = data as { id: number; status: string; section: string };
  await writeAudit(db, {
    actor,
    action: "assignment.create",
    target: targetOf.assignment(row.id),
    before: null,
    after: { status: row.status, section: row.section },
    reason: "기사 기획 등록",
  });
  return json({ assignment: row }, 201);
});
