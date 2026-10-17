import { CHECKS_COUNT } from "@/lib/admin/situation-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { SITUATION_ADMIN_COLUMNS, describeSituation, loadSituation, normalizeRow, personOf, reviewerNames, type SituationAdminRow } from "@/lib/server/admin/situations";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 상황 카드 세무 감수 서명 (PRD-01A 1.3 '상황 카드 먼저 확인할 것' 감수 대상 · FAM-02 '감수 승인 뒤 공개') — 세무 감수위원(reviewer)만.
// 거부는 403 + 감사 로그(review.tax_review.denied). 본문 { updatedAt } = 감수위원이 읽은 판 — 그 사이 누가 고쳤으면 409(새로 읽고 다시 감수).
// 서명은 감수 기록(reviewer_id = 감수위원의 인물 · reviewed_at = 지금)만 쓴다. 공개는 편집 책임자가 따로 한다.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id, "상황 카드");
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.situation(id);
  const denied = await authorize(viewer, "review.tax_review", target);
  if (denied) return denied;
  const body = await readJson(request);
  for (const key of Object.keys(body)) if (key !== "updatedAt") return errorJson(422, "입력값을 확인하세요", { errors: [`review.${key}: 모르는 칸입니다`] });
  if (typeof body.updatedAt !== "string" || Number.isNaN(Date.parse(body.updatedAt))) {
    return errorJson(422, "입력값을 확인하세요", { errors: ["review.updatedAt: 감수한 판의 수정 시각이 필요합니다"] });
  }

  const db = serviceDb();
  const before = await loadSituation(db, id);
  if (Date.parse(before.updated_at) !== Date.parse(body.updatedAt)) {
    return errorJson(409, "감수하는 동안 내용이 바뀌었습니다 — 새로 읽고 다시 감수하세요");
  }
  const count = Array.isArray(before.checks) ? before.checks.length : 0;
  if (count !== CHECKS_COUNT) return errorJson(422, `먼저 확인할 것이 정확히 ${CHECKS_COUNT}개여야 감수할 수 있습니다 — 지금 ${count}개`);
  const personId = await personOf(db, viewer.userId);
  if (personId === null) return errorJson(422, "감수자 인물 기록(people)이 없습니다 — 관리자에게 인물 등록을 요청하세요");

  const reviewedAt = nowIso();
  const { data, error } = await db
    .from("situations")
    .update({ reviewer_id: personId, reviewed_at: reviewedAt, updated_by: actorOf(viewer) })
    .eq("id", id)
    .eq("updated_at", before.updated_at)
    .select(SITUATION_ADMIN_COLUMNS)
    .maybeSingle();
  if (error) throw dbError(error, "situations 감수 서명");
  if (!data) return errorJson(409, "감수하는 동안 내용이 바뀌었습니다 — 새로 읽고 다시 감수하세요");
  const after = normalizeRow(data as SituationAdminRow);
  await writeAudit(db, {
    actor: actorOf(viewer),
    action: "situation.review",
    target,
    before: { reviewer_id: before.reviewer_id, reviewed_at: before.reviewed_at },
    after: { reviewer_id: after.reviewer_id, reviewed_at: after.reviewed_at, checks: after.checks, checklist: after.checklist, mistakes: after.mistakes },
    reason: `상황 카드 세무 감수 서명 — ${after.title}`,
  });
  const names = await reviewerNames(db, [personId]);
  return json({ situation: describeSituation(after, names) });
}, { revalidatesPublic: true });
