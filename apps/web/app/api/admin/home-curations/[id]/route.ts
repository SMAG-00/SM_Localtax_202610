import { CURATION_KIND_LABELS, capacityError, duplicateTargetError, parseCurationInput, periodErrors } from "@/lib/admin/home-curation-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { CURATION_COLUMNS, describeCurations, listCurationRows, loadCuration, targetIdOf, type CurationRow } from "@/lib/server/admin/home-curations";
import { kstDate } from "@/lib/server/articles/gate";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { HttpError, dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 홈 배치 카드 고치기·빼기 (HOME-03) — 편집 책임자만(article.home). 고치기는 노출 기간·순서만(종류·대상은 빼고 다시 더한다).
// 기간을 늘려 같은 날 상한을 넘기면 409. 모든 변경은 감사 로그에 전후 값.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id, "홈 배치 카드");
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.homeCuration(id);
  const denied = await authorize(viewer, "article.home", target);
  if (denied) return denied;
  const today = kstDate(nowIso());
  const parsed = parseCurationInput(await readJson(request), "patch", today);
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const changes = parsed.value;

  const db = serviceDb();
  const before = await loadCuration(db, id);
  const period = { starts_on: changes.starts_on ?? before.starts_on, ends_on: changes.ends_on !== undefined ? changes.ends_on : before.ends_on };
  if (changes.starts_on !== undefined || changes.ends_on !== undefined) {
    const problems = periodErrors(period, today);
    if (problems.length) return errorJson(422, "입력값을 확인하세요", { errors: problems });
    const sameKind = (await listCurationRows(db))
      .filter((r) => r.kind === before.kind)
      .map((r) => ({ id: r.id, starts_on: r.starts_on, ends_on: r.ends_on, targetId: targetIdOf(r) }));
    const full = capacityError(before.kind, sameKind, period, id);
    if (full) return errorJson(409, full);
    const dup = duplicateTargetError(sameKind, targetIdOf(before), period, id);
    if (dup) return errorJson(409, dup);
  }

  const columns: Record<string, unknown> = { updated_by: actorOf(viewer) };
  if (changes.starts_on !== undefined) columns.starts_on = changes.starts_on;
  if (changes.ends_on !== undefined) columns.ends_on = changes.ends_on;
  if (changes.sort !== undefined) columns.sort = changes.sort;
  const { data, error } = await db.from("home_curations").update(columns).eq("id", id).select(CURATION_COLUMNS).maybeSingle();
  if (error) throw dbError(error, "home_curations 수정");
  if (!data) throw new HttpError(404, "홈 배치 카드를 찾을 수 없습니다");
  const after = data as CurationRow;
  const changed = Object.keys(columns).filter((k) => k !== "updated_by");
  await writeAudit(db, {
    actor: actorOf(viewer),
    action: "home_curation.update",
    target,
    before: Object.fromEntries(changed.map((k) => [k, before[k as keyof CurationRow] ?? null])),
    after: Object.fromEntries(changed.map((k) => [k, after[k as keyof CurationRow] ?? null])),
    reason: `홈 배치 고치기 — ${CURATION_KIND_LABELS[before.kind]}`,
  });
  const [item] = await describeCurations(db, [after], today);
  return json({ curation: item, changed });
});

export const DELETE = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id, "홈 배치 카드");
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.homeCuration(id);
  const denied = await authorize(viewer, "article.home", target);
  if (denied) return denied;
  const db = serviceDb();
  const before = await loadCuration(db, id);
  const { error, count } = await db.from("home_curations").delete({ count: "exact" }).eq("id", id);
  if (error) throw dbError(error, "home_curations 빼기");
  if (!count) throw new HttpError(404, "홈 배치 카드를 찾을 수 없습니다");
  await writeAudit(db, {
    actor: actorOf(viewer),
    action: "home_curation.delete",
    target,
    before,
    after: null,
    reason: `홈 배치 빼기 — ${CURATION_KIND_LABELS[before.kind]}`,
  });
  return json({ deleted: id });
});
