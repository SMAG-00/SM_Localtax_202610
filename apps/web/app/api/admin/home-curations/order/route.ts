import { orderPlan } from "@/lib/admin/category-rules";
import { CURATION_KIND_LABELS, curationStatus, parseCurationOrder } from "@/lib/admin/home-curation-rules";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { listCurationRows } from "@/lib/server/admin/home-curations";
import { kstDate } from "@/lib/server/articles/gate";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 홈 배치 순서 (HOME-03 '편집자가 순서를 정한다') — { kind, ids: 그 종류의 노출 중·예정 카드 전부를 새 순서대로 }. 끝난 카드는 순서에 넣지 않는다.
// 새 순서는 10 간격. PostgREST에는 트랜잭션이 없어 한 줄씩 고치고, 중간에 실패하면 앞서 고친 줄을 되돌린다. 감사 로그 한 줄에 전후 순서.
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const raw = await readJson(request);
  const target = `home_curations:order:${typeof raw.kind === "string" ? raw.kind : "invalid"}`;
  const denied = await authorize(viewer, "article.home", target);
  if (denied) return denied;
  const parsed = parseCurationOrder(raw);
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const { kind, ids } = parsed.value;

  const db = serviceDb();
  const today = kstDate(nowIso());
  const rows = (await listCurationRows(db)).filter((r) => r.kind === kind && curationStatus(r, today) !== "expired");
  const plan = orderPlan(rows, ids);
  if (!plan.ok) return errorJson(422, "입력값을 확인하세요", { errors: [`order.ids: ${CURATION_KIND_LABELS[kind]}의 노출 중·예정 카드 전부(${rows.length}장)를 순서대로 보내야 합니다`] });

  const update = async (id: number, sort: number) => {
    const { error } = await db.from("home_curations").update({ sort, updated_by: actorOf(viewer) }).eq("id", id);
    if (error) throw dbError(error, "home_curations 순서");
  };
  const done: { id: number; sort: number }[] = [];
  try {
    for (const change of plan.value) {
      const before = rows.find((r) => r.id === change.id)!;
      await update(change.id, change.sort);
      done.push({ id: change.id, sort: before.sort });
    }
  } catch (err) {
    for (const undo of done.reverse()) await update(undo.id, undo.sort).catch(() => undefined);
    throw err;
  }

  const after = (await listCurationRows(db)).filter((r) => r.kind === kind && curationStatus(r, today) !== "expired");
  if (plan.value.length > 0) {
    await writeAudit(db, {
      actor: actorOf(viewer),
      action: "home_curation.reorder",
      target,
      before: { order: rows.map((r) => ({ id: r.id, sort: r.sort })) },
      after: { order: after.map((r) => ({ id: r.id, sort: r.sort })) },
      reason: `홈 배치 순서 바꾸기 — ${CURATION_KIND_LABELS[kind]}`,
    });
  }
  return json({ kind, order: after.map((r) => r.id), changed: plan.value.length });
});
