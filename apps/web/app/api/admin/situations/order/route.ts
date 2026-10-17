import { hubOrderPlan, hubRows, parseHubOrder } from "@/lib/admin/situation-rules";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { listSituationRows } from "@/lib/server/admin/situations";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 허브 상황 카드 순서 (UX-05 '카드 순서·문구를 바꾸면 배포 없이 반영') — 편집 책임자만(situation.publish, 거부는 403 + 감사 로그).
// { section, ids: 그 분야 허브 카드 전부를 새 순서대로 } → 자리 1..n. 같은 분야 같은 자리는 DB가 막으므로(unique) 바뀌는 카드의 자리를 먼저 비우고
// 새 자리를 채운다. PostgREST에는 트랜잭션이 없어 중간에 실패하면 앞서 고친 자리를 되돌린다. 감사 로그 한 줄에 전후 순서.
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const raw = await readJson(request);
  const target = `situations:order:${typeof raw.section === "string" ? raw.section : "invalid"}`;
  const denied = await authorize(viewer, "situation.publish", target);
  if (denied) return denied;
  const parsed = parseHubOrder(raw);
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const { section, ids } = parsed.value;

  const db = serviceDb();
  const current = hubRows(await listSituationRows(db), section);
  const plan = hubOrderPlan(current, ids);
  if (!plan.ok) return errorJson(422, "입력값을 확인하세요", { errors: plan.errors });

  const actor = actorOf(viewer);
  const setSlot = async (id: number, slot: number | null) => {
    const { error } = await db.from("situations").update({ hub_slot: slot, updated_by: actor }).eq("id", id);
    if (error) throw dbError(error, "situations 허브 순서");
  };
  const touched: { id: number; slot: number | null }[] = [];
  try {
    for (const change of plan.value) {
      touched.push({ id: change.id, slot: current.find((r) => r.id === change.id)!.hub_slot });
      await setSlot(change.id, null);
    }
    for (const change of plan.value) await setSlot(change.id, change.slot);
  } catch (err) {
    for (const undo of touched) await setSlot(undo.id, null).catch(() => undefined);
    for (const undo of touched) await setSlot(undo.id, undo.slot).catch(() => undefined);
    throw err;
  }

  const after = hubRows(await listSituationRows(db), section);
  if (plan.value.length > 0) {
    await writeAudit(db, {
      actor,
      action: "situation.reorder",
      target,
      before: { order: current.map((r) => ({ id: r.id, hub_slot: r.hub_slot })) },
      after: { order: after.map((r) => ({ id: r.id, hub_slot: r.hub_slot })) },
      reason: `허브 상황 카드 순서 바꾸기 — ${section}`,
    });
  }
  return json({ section, order: after.map((r) => r.id), changed: plan.value.length });
}, { revalidatesPublic: true });
