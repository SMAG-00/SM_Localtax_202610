import { parseRequirementInput } from "@/lib/readiness/requirements";
import { PLATFORM_LABELS, REQUIREMENT_COLUMNS, type Platform } from "@/lib/readiness/requirements";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { kstDate } from "@/lib/server/articles/gate";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { listRequirementRows, loadRequirement, rowFromDb } from "@/lib/server/readiness/requirements";

// 제휴 규정 버전 (NAV-13 — docs/dev/W2-c_설계.md 8.5) — 목록은 편집 책임자·관리자(readiness.read), 새 버전은 같은 사람들(readiness.requirements).
// 새 버전은 작성 중(unconfirmed)으로만 만든다 — 확정은 /confirm에서 확정 조건을 검사한 뒤. 버전 번호는 DB 트리거가 플랫폼마다 1부터 매긴다.
// 확정된 버전을 바탕으로 새 버전을 적으면(supersedesId) 같은 플랫폼만 — 앞 버전은 그대로 남는다. 모든 변경은 감사 로그.
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "readiness.read", "news_partner_requirements:list");
  if (denied) return denied;
  return json({ today: kstDate(nowIso()), requirements: await listRequirementRows(serviceDb()) });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "readiness.requirements", "news_partner_requirements:new");
  if (denied) return denied;
  const parsed = parseRequirementInput(await readJson(request), "create");
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const columns = parsed.value;
  const db = serviceDb();
  if (columns.supersedes_id !== undefined) {
    const base = await loadRequirement(db, columns.supersedes_id as number).catch(() => null);
    if (!base) return errorJson(422, "이어받는 규정 버전을 찾을 수 없습니다", { errors: ["requirement.supersedesId: 이어받는 규정 버전을 찾을 수 없습니다"] });
    if (base.platform !== columns.platform) {
      return errorJson(422, "이어받는 규정 버전은 같은 플랫폼이어야 합니다", { errors: ["requirement.supersedesId: 이어받는 규정 버전은 같은 플랫폼이어야 합니다"] });
    }
  }
  const actor = actorOf(viewer);
  const { data, error } = await db
    .from("news_partner_requirements")
    .insert({ ...columns, status: "unconfirmed", created_by: actor, updated_by: actor })
    .select(REQUIREMENT_COLUMNS)
    .single();
  if (error || !data) throw dbError(error ?? {}, "news_partner_requirements 추가");
  const row = rowFromDb(data as Record<string, unknown>);
  await writeAudit(db, {
    actor,
    action: "news_requirement.create",
    target: targetOf.requirement(row.id),
    before: null,
    after: row,
    reason: `제휴 규정 버전 등록 — ${PLATFORM_LABELS[row.platform as Platform] ?? row.platform} ${row.version}번${row.supersedes_id ? ` (이어받음: ${row.supersedes_id})` : ""}`,
  });
  return json({ requirement: row }, 201);
});
