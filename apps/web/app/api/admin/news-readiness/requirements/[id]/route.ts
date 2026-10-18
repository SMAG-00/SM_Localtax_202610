import { CONFIRMED_IMMUTABLE, parseRequirementInput, REQUIREMENT_COLUMNS, type RequirementRow } from "@/lib/readiness/requirements";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { loadRequirement, requirementId, rowFromDb } from "@/lib/server/readiness/requirements";

// 작성 중 규정 버전 고치기 (NAV-13) — 편집 책임자·관리자(readiness.requirements). 확정된 버전은 409 — 바뀐 규정은 새 버전으로(앞 버전은 남는다).
// DB 트리거도 확정 버전 고치기를 막는다(같은 순간에 확정된 경우 — 고치기 0행 → 409).
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const id = requirementId((await params).id);
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.requirement(id);
  const denied = await authorize(viewer, "readiness.requirements", target);
  if (denied) return denied;
  const parsed = parseRequirementInput(await readJson(request), "patch");
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const columns = parsed.value;

  const db = serviceDb();
  const before = await loadRequirement(db, id);
  if (before.status === "confirmed") return errorJson(409, CONFIRMED_IMMUTABLE);
  const merged = { ...before, ...columns } as RequirementRow;
  if (merged.effective_from && merged.effective_to && merged.effective_to < merged.effective_from) {
    return errorJson(422, "입력값을 확인하세요", { errors: ["requirement.effectiveTo: 적용 끝날이 시작일보다 앞입니다"] });
  }
  const actor = actorOf(viewer);
  const { data, error } = await db
    .from("news_partner_requirements")
    .update({ ...columns, updated_by: actor })
    .eq("id", id)
    .eq("status", "unconfirmed")
    .select(REQUIREMENT_COLUMNS)
    .maybeSingle();
  if (error) throw dbError(error, "news_partner_requirements 수정");
  if (!data) return errorJson(409, CONFIRMED_IMMUTABLE);
  const after = rowFromDb(data as Record<string, unknown>);
  const changed = Object.keys(columns) as (keyof RequirementRow)[];
  await writeAudit(db, {
    actor,
    action: "news_requirement.update",
    target,
    before: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
    after: Object.fromEntries(changed.map((k) => [k, after[k] ?? null])),
    reason: `작성 중 규정 버전 고치기 — ${after.platform} ${after.version}번`,
  });
  return json({ requirement: after });
});
