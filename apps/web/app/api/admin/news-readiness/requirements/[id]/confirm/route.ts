import { CONFIRMED_IMMUTABLE, PLATFORM_LABELS, REQUIREMENT_COLUMNS, confirmProblems, type Platform } from "@/lib/readiness/requirements";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { kstDate } from "@/lib/server/articles/gate";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { loadRequirement, requirementId, rowFromDb } from "@/lib/server/readiness/requirements";

// 규정 버전 확정 — 담당자 승인 (NAV-13). 편집 책임자·관리자(readiness.requirements).
// 본문 { "attested": true } — 담당자가 '공식 규정 원문과 우리 매체의 실제 등록 유형을 확인했다'를 표시해야 한다.
// 원문 URL·확인일(오늘 이전)·등록 유형·적용 시작일·심사 대상 기간·요건이 하나라도 없으면 422(칸 경로가 붙은 문장). 이미 확정이면 409.
// 확정하면 승인자·승인 시각이 남고 그 뒤로는 고칠 수 없다(DB 트리거) — 앞 확정 버전도 그대로 남는다.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const id = requirementId((await params).id);
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.requirement(id);
  const denied = await authorize(viewer, "readiness.requirements", target);
  if (denied) return denied;
  const body = await readJson(request);
  for (const k of Object.keys(body)) if (k !== "attested") return errorJson(422, "입력값을 확인하세요", { errors: [`requirement.${k}: 모르는 칸입니다`] });
  if (body.attested !== undefined && typeof body.attested !== "boolean") return errorJson(422, "입력값을 확인하세요", { errors: ["requirement.attested: true/false여야 합니다"] });

  const db = serviceDb();
  const row = await loadRequirement(db, id);
  if (row.status === "confirmed") return errorJson(409, CONFIRMED_IMMUTABLE);
  const now = nowIso();
  const problems = confirmProblems(row, { attested: body.attested === true }, kstDate(now));
  if (problems.length) return errorJson(422, "확정에 필요한 칸이 비었습니다", { errors: problems });

  const actor = actorOf(viewer);
  const { data, error } = await db
    .from("news_partner_requirements")
    .update({ status: "confirmed", approved_by: actor, approved_at: now, updated_by: actor })
    .eq("id", id)
    .eq("status", "unconfirmed")
    .select(REQUIREMENT_COLUMNS)
    .maybeSingle();
  if (error) throw dbError(error, "news_partner_requirements 확정");
  if (!data) return errorJson(409, CONFIRMED_IMMUTABLE);
  const after = rowFromDb(data as Record<string, unknown>);
  await writeAudit(db, {
    actor,
    action: "news_requirement.confirm",
    target,
    before: { status: row.status, approved_by: null, approved_at: null },
    after: { status: after.status, approved_by: after.approved_by, approved_at: after.approved_at },
    reason: `제휴 규정 버전 확정 — ${PLATFORM_LABELS[after.platform as Platform] ?? after.platform} ${after.version}번 · 원문 ${after.source_url} · 확인일 ${after.checked_at} · 등록 유형 ${after.media_type}`,
  });
  return json({ requirement: after });
});
