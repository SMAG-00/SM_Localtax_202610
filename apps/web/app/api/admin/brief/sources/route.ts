import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, readJson } from "@/lib/server/http";
import { parseActiveInput, parseCalendarInput, parseOngoingInput } from "@/lib/brief/sources-input";

// 브리핑 원천 표 관리 (W10-e SM 이식) - 달력(알아둘 날짜)·진행 중 개정안·수집 대상. 편집 책임자·관리자만(review_item.decide).
//  · GET - 세 표 전체
//  · POST op=calendar_save / calendar_active / ongoing_save / ongoing_active / target_enabled
// 수집 대상을 켜는 것과 수집기가 도는 것은 별개입니다 - 수집은 data_sources가 허용·계약 확인(data_source_runnable)이어야만 합니다.
export const dynamic = "force-dynamic";

const bad = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
function dbFail(error: { code?: string; message: string }): Response {
  if (error.code === "23514" || error.code === "23503") return bad([error.message]);
  console.error("[brief-sources] DB 오류:", error.code, error.message);
  return errorJson(500, "서버 오류가 났습니다 - 잠시 뒤 다시 시도하세요");
}

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "review_item.decide", "brief_sources:list");
  if (denied) return denied;
  const db = serviceDb();
  const [cal, ong, tgt] = await Promise.all([
    db.from("brief_calendar_items").select("*").order("id"),
    db.from("brief_ongoing_items").select("*").order("id"),
    db.from("brief_collect_targets").select("*").order("key"),
  ]);
  const err = cal.error ?? ong.error ?? tgt.error;
  if (err) return dbFail(err);
  return json({ calendar: cal.data ?? [], ongoing: ong.data ?? [], targets: tgt.data ?? [] });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  const denied = await authorize(viewer, "review_item.decide", `brief_sources:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "calendar_save") {
    const p = parseCalendarInput(body);
    if (!p.ok) return bad(p.errors);
    const { id, ...fields } = p.value;
    const r = id === null ? await db.from("brief_calendar_items").insert(fields).select("id").single() : await db.from("brief_calendar_items").update(fields).eq("id", id).select("id").single();
    if (r.error) return dbFail(r.error);
    await writeAudit(db, { actor, action: "brief_sources.calendar_save", target: `brief_calendar_items:${(r.data as { id: number }).id}`, before: null, after: { mode: fields.is_always ? "always" : fields.is_yearly ? "yearly" : "once" }, reason: "알아둘 날짜 입력" });
    return json({ id: (r.data as { id: number }).id }, id === null ? 201 : 200);
  }
  if (op === "ongoing_save") {
    const p = parseOngoingInput(body);
    if (!p.ok) return bad(p.errors);
    const { id, ...fields } = p.value;
    const r = id === null ? await db.from("brief_ongoing_items").insert(fields).select("id").single() : await db.from("brief_ongoing_items").update(fields).eq("id", id).select("id").single();
    if (r.error) return dbFail(r.error);
    await writeAudit(db, { actor, action: "brief_sources.ongoing_save", target: `brief_ongoing_items:${(r.data as { id: number }).id}`, before: null, after: { stage: fields.stage, as_of: fields.as_of }, reason: "진행 중 개정안 입력" });
    return json({ id: (r.data as { id: number }).id }, id === null ? 201 : 200);
  }
  if (op === "calendar_active" || op === "ongoing_active") {
    const p = parseActiveInput(body, "id");
    if (!p.ok) return bad(p.errors);
    const table = op === "calendar_active" ? "brief_calendar_items" : "brief_ongoing_items";
    const r = await db.from(table).update({ active: p.value.active }).eq("id", p.value.id as number).select("id").single();
    if (r.error) return dbFail(r.error);
    await writeAudit(db, { actor, action: `brief_sources.${op}`, target: `${table}:${p.value.id}`, before: null, after: { active: p.value.active }, reason: "브리핑 원천 켜기·끄기" });
    return json({ ok: true });
  }
  if (op === "target_enabled") {
    const p = parseActiveInput(body, "key");
    if (!p.ok) return bad(p.errors);
    const r = await db.from("brief_collect_targets").update({ enabled: p.value.active }).eq("key", p.value.key as string).select("key").single();
    if (r.error) return dbFail(r.error);
    await writeAudit(db, { actor, action: "brief_sources.target_enabled", target: `brief_collect_targets:${p.value.key}`, before: null, after: { enabled: p.value.active }, reason: "수집 대상 켜기·끄기 (수집은 원천 허용 확인 뒤에만)" });
    return json({ ok: true });
  }
  return errorJson(422, "알 수 없는 작업입니다");
});
