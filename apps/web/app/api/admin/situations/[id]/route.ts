import { can, type Viewer } from "@/lib/access";
import { REVIEWED_FIELDS, changesReviewedFields, hubSlotError, parseSituationPatch } from "@/lib/admin/situation-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { SITUATION_ADMIN_COLUMNS, describeSituation, hubLimit, linkProblems, listSituationRows, loadSituation, normalizeRow, reviewerNames, type SituationAdminRow } from "@/lib/server/admin/situations";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { HttpError, dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 상황 카드 하나 (UX-05) — 읽기(쓰는 사람·공개하는 사람·감수위원)와 고치기.
// 고치기는 내용 칸(situation.edit — 기자·편집 책임자·관리자)과 공개·허브 칸(situation.publish — 편집 책임자)을 따로 판정한다.
//  · 감수 대상 칸(먼저 확인할 것·일반적 체크리스트·자주 틀리는 점)을 고치면 DB가 감수 기록을 지운다 → 응답 reviewCleared.
//    공개 중인 상황은 먼저 내려야 고칠 수 있다(409 — 고치면 공개 조건이 깨진다. DB 제약도 막는다)
//  · 공개는 감수 서명이 있어야(409), 허브 자리는 상한(설정 — 초기값 4)까지 — 5번째 카드는 409(DB 트리거도 막는다)
//  · 감사 로그: 내용 situation.update · 공개 situation.publish · 내리기 situation.unpublish · 허브 자리 situation.hub (전후 값)
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function readable(viewer: Viewer, target: string): Promise<Response | null> {
  if ((["situation.edit", "situation.publish", "review.tax_review"] as const).some((a) => can(viewer, a))) return null;
  return authorize(viewer, "situation.edit", target);
}

export const GET = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id, "상황 카드");
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await readable(viewer, targetOf.situation(id));
  if (denied) return denied;
  const db = serviceDb();
  const row = await loadSituation(db, id);
  const names = await reviewerNames(db, row.reviewer_id === null ? [] : [row.reviewer_id]);
  return json({ situation: describeSituation(row, names), row });
});

const pick = (row: SituationAdminRow, keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, row[k as keyof SituationAdminRow] ?? null]));

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id, "상황 카드");
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.situation(id);
  const parsed = parseSituationPatch(await readJson(request));
  if (!parsed.ok) {
    // 권한 없는 사람에게 칸 검사 결과를 먼저 보이지 않는다
    const denied = await readable(viewer, target);
    return denied ?? errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  }
  const { content, placement } = parsed.value;
  if (Object.keys(content).length) {
    const denied = await authorize(viewer, "situation.edit", target);
    if (denied) return denied;
  }
  if (Object.keys(placement).length) {
    const denied = await authorize(viewer, "situation.publish", target);
    if (denied) return denied;
  }

  const db = serviceDb();
  const before = await loadSituation(db, id);
  const section = content.section ?? before.section;
  const reviewedChange = changesReviewedFields(before, content);
  const willBeVisible = placement.visible ?? before.visible;
  const willHaveSlot = placement.hub_slot !== undefined ? placement.hub_slot : before.hub_slot;

  if (reviewedChange && willBeVisible) {
    return errorJson(409, "공개 중인 상황의 먼저 확인할 것·일반적 체크리스트·자주 틀리는 점은 고칠 수 없습니다 — 먼저 내린 뒤 고치고, 다시 세무 감수를 받으세요 (감수 대상 문장)", {
      errors: REVIEWED_FIELDS.filter((k) => content[k] !== undefined).map((k) => `situation.${k}: 감수 대상 칸`),
    });
  }
  if (placement.visible === true && !before.visible && (before.reviewed_at === null || reviewedChange)) {
    return errorJson(409, "세무 감수 서명이 있어야 공개할 수 있습니다 — 세무 감수위원에게 감수를 요청하세요 (UX-05 · FAM-02)");
  }
  if (content.section !== undefined && content.section !== before.section && willHaveSlot !== null && placement.hub_slot === undefined) {
    return errorJson(409, "허브에 놓인 상황의 분야를 바꾸려면 먼저 허브에서 빼세요");
  }
  if (willHaveSlot !== null && (placement.hub_slot !== undefined || section !== before.section)) {
    const [rows, limit] = await Promise.all([listSituationRows(db), hubLimit(db)]);
    const problem = hubSlotError(rows, { id, section }, willHaveSlot, limit);
    if (problem) return errorJson(409, problem);
  }
  const links = await linkProblems(db, content);
  if (links.length) return errorJson(422, "연결한 번호를 확인하세요", { errors: links });

  const actor = actorOf(viewer);
  const columns: Record<string, unknown> = { ...content, ...placement, updated_by: actor };
  const { data, error } = await db.from("situations").update(columns).eq("id", id).select(SITUATION_ADMIN_COLUMNS).maybeSingle();
  if (error) throw dbError(error, "situations 고치기");
  if (!data) throw new HttpError(404, "상황 카드를 찾을 수 없습니다");
  const after = normalizeRow(data as SituationAdminRow);
  const reviewCleared = before.reviewed_at !== null && after.reviewed_at === null;

  const contentKeys = Object.keys(content);
  if (contentKeys.length) {
    const keys = reviewCleared ? [...contentKeys, "reviewer_id", "reviewed_at"] : contentKeys;
    await writeAudit(db, {
      actor,
      action: "situation.update",
      target,
      before: pick(before, keys),
      after: pick(after, keys),
      reason: `상황 카드 고치기 — ${after.title}${reviewCleared ? " (감수 대상 문장이 바뀌어 감수 기록이 지워짐)" : ""}`,
    });
  }
  if (placement.visible !== undefined && placement.visible !== before.visible) {
    await writeAudit(db, {
      actor,
      action: placement.visible ? "situation.publish" : "situation.unpublish",
      target,
      before: { visible: before.visible },
      after: { visible: after.visible },
      reason: `${placement.visible ? "상황 카드 공개" : "상황 카드 내리기"} — ${after.title}`,
    });
  }
  if (placement.hub_slot !== undefined && placement.hub_slot !== before.hub_slot) {
    await writeAudit(db, {
      actor,
      action: "situation.hub",
      target,
      before: { section: before.section, hub_slot: before.hub_slot },
      after: { section: after.section, hub_slot: after.hub_slot },
      reason: after.hub_slot === null ? `허브에서 빼기 — ${after.title}` : `허브 ${after.hub_slot}번 자리 — ${after.title}`,
    });
  }
  const names = await reviewerNames(db, after.reviewer_id === null ? [] : [after.reviewer_id]);
  return json({ situation: describeSituation(after, names), reviewCleared, changed: [...contentKeys, ...Object.keys(placement)] });
}, { revalidatesPublic: true });
