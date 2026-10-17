import { orderPlan, parseCategoryOrder } from "@/lib/admin/category-rules";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { listCategoryRows, updateCategory } from "@/lib/server/admin/backoffice";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, readJson } from "@/lib/server/http";

// 하위 분야 순서 바꾸기 (CAT-01 "분야를 추가·정렬하면 코드 배포 없이 메뉴·허브에 반영") — { section, ids: 그 분야 하위 분야 전부를 새 순서대로 }.
// 새 순서는 10 간격. PostgREST에는 트랜잭션이 없어 한 줄씩 고치고, 중간에 실패하면 앞서 고친 줄을 되돌린다.
// 감사 로그 한 줄에 전후 순서를 남긴다.
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const parsedRaw = await readJson(request);
  const parsed = parseCategoryOrder(parsedRaw);
  const target = `categories:order:${typeof parsedRaw.section === "string" ? parsedRaw.section : "invalid"}`;
  const denied = await authorize(viewer, "category.edit", target);
  if (denied) return denied;
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const { section, ids } = parsed.value;

  const db = serviceDb();
  const rows = await listCategoryRows(db, section);
  const plan = orderPlan(rows, ids);
  if (!plan.ok) return errorJson(422, "입력값을 확인하세요", { errors: plan.errors });

  const done: { id: number; sort: number }[] = [];
  try {
    for (const change of plan.value) {
      const before = rows.find((r) => r.id === change.id)!;
      await updateCategory(db, change.id, { sort: change.sort });
      done.push({ id: change.id, sort: before.sort });
    }
  } catch (err) {
    for (const undo of done.reverse()) await updateCategory(db, undo.id, { sort: undo.sort }).catch(() => undefined);
    throw err;
  }

  const after = await listCategoryRows(db, section);
  if (plan.value.length > 0) {
    await writeAudit(db, {
      actor: actorOf(viewer),
      action: "category.reorder",
      target,
      before: { order: rows.map((r) => ({ id: r.id, sort: r.sort })) },
      after: { order: after.map((r) => ({ id: r.id, sort: r.sort })) },
      reason: "하위 분야 순서 바꾸기",
    });
  }
  return json({ section, categories: after, changed: plan.value.length });
}, { revalidatesPublic: true });
