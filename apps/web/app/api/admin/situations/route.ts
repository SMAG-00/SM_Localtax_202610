import { can } from "@/lib/access";
import { SITUATION_SECTIONS, hubRows, parseSituationCreate } from "@/lib/admin/situation-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { SITUATION_ADMIN_COLUMNS, describeSituation, hubLimit, linkProblems, listSituationRows, normalizeRow, reviewerNames, type SituationAdminRow } from "@/lib/server/admin/situations";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 상황 카드 (UX-05 · FAM-02 · PRD-01A 3장 백오피스 '상황 카드', docs/dev/W2-b_설계.md 8.3).
//  · 목록 — 쓰는 사람(기자·편집 책임자·관리자)·공개하는 사람(편집 책임자)·감수 서명하는 사람(세무 감수위원). 그 밖은 403
//  · 만들기 — situation.edit. 먼저 확인할 것 정확히 3개(2·4개는 422), 분야 필수, 공개·허브 자리는 만들 때 받지 않는다(감수 뒤)
//  · 모든 변경은 감사 로그(situation.create 등), 쓰기가 성공하면 공개 화면 캐시를 바로 만료한다(설계 7.1)
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  if (!(["situation.edit", "situation.publish", "review.tax_review"] as const).some((a) => can(viewer, a))) {
    const denied = await authorize(viewer, "situation.edit", "situations:list");
    if (denied) return denied;
  }
  const db = serviceDb();
  const [rows, limit] = await Promise.all([listSituationRows(db), hubLimit(db)]);
  const names = await reviewerNames(db, rows.flatMap((r) => (r.reviewer_id === null ? [] : [r.reviewer_id])));
  return json({
    limit,
    situations: rows.map((r) => describeSituation(r, names)),
    hubs: Object.fromEntries(SITUATION_SECTIONS.map((s) => [s, hubRows(rows, s).map((r) => ({ id: r.id, slot: r.hub_slot }))])),
  });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "situation.edit", "situations:new");
  if (denied) return denied;
  const parsed = parseSituationCreate(await readJson(request));
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const input = parsed.value;
  const db = serviceDb();
  const problems = await linkProblems(db, input);
  if (problems.length) return errorJson(422, "연결한 번호를 확인하세요", { errors: problems });

  const actor = actorOf(viewer);
  const { data, error } = await db
    .from("situations")
    .insert({ ...input, visible: false, hub_slot: null, updated_by: actor })
    .select(SITUATION_ADMIN_COLUMNS)
    .single();
  if (error || !data) throw dbError(error ?? {}, "situations 만들기");
  const row = normalizeRow(data as SituationAdminRow);
  await writeAudit(db, { actor, action: "situation.create", target: targetOf.situation(row.id), before: null, after: row, reason: `상황 카드 만들기 — ${row.title}` });
  return json({ situation: describeSituation(row, new Map()) }, 201);
}, { revalidatesPublic: true });
