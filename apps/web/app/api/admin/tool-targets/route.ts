import { parseGuideInput } from "@/lib/calc/admin-helpers";
import { parseToolTarget } from "@/lib/calc/tool-target";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 계산기 연결 관리 (GROW-02 기사별 도구 지정 · WETAX-02 위택스 이용 안내). 편집 책임자(link.manage)만.
// body.op = set_target | clear_target | upsert_guide | delete_guide. 값은 사람이 넣은 것만 저장하고(기본값 0), 검사는 lib/calc.
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const denied = await authorize(viewer, "link.manage", `calc_links:${String(body.op)}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (body.op === "set_target") {
    const p = parseToolTarget({ articleId: body.articleId, tool: body.tool, prefillText: body.prefillText });
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const v = p.value;
    const art = await db.from("articles").select("id, status").eq("id", v.articleId).limit(1);
    if (art.error) throw dbError(art.error, "articles 조회");
    if (!art.data?.length) return errorJson(404, "그런 기사가 없습니다");
    const { data, error } = await db
      .from("article_tool_targets")
      .upsert({ article_id: v.articleId, tool: v.tool, prefill: v.prefill, updated_by: actor, updated_at: nowIso() }, { onConflict: "article_id" })
      .select("article_id, tool, prefill")
      .single();
    if (error || !data) throw dbError(error ?? {}, "article_tool_targets 저장");
    await writeAudit(db, { actor, action: "link.manage", target: `article_tool_target:${v.articleId}`, before: null, after: data, reason: "기사 도구 지정" });
    return json({ target: data });
  }

  if (body.op === "clear_target") {
    const id = Number(body.articleId);
    if (!Number.isSafeInteger(id) || id <= 0) return errorJson(422, "입력값을 확인하세요", { errors: ["articleId: 기사 번호를 확인하세요"] });
    const { error } = await db.from("article_tool_targets").delete().eq("article_id", id);
    if (error) throw dbError(error, "article_tool_targets 삭제");
    await writeAudit(db, { actor, action: "link.manage", target: `article_tool_target:${id}`, before: null, after: null, reason: "기사 도구 지정 해제" });
    return json({ cleared: id });
  }

  if (body.op === "upsert_guide") {
    const p = parseGuideInput(body);
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const v = p.value;
    const { data, error } = await db
      .from("wetax_guides")
      .upsert({ key: v.key, label: v.label, body: v.body, source: v.source, confirmed_on: v.confirmedOn, active: v.active, sort: v.sort }, { onConflict: "key" })
      .select("key, label, source, confirmed_on, active")
      .single();
    if (error || !data) throw dbError(error ?? {}, "wetax_guides 저장");
    await writeAudit(db, { actor, action: "link.manage", target: `wetax_guide:${v.key}`, before: null, after: data, reason: "위택스 이용 안내 편집" });
    return json({ guide: data });
  }

  if (body.op === "delete_guide") {
    const key = typeof body.key === "string" ? body.key : "";
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) return errorJson(422, "입력값을 확인하세요", { errors: ["key: 확인하세요"] });
    const { error } = await db.from("wetax_guides").delete().eq("key", key);
    if (error) throw dbError(error, "wetax_guides 삭제");
    await writeAudit(db, { actor, action: "link.manage", target: `wetax_guide:${key}`, before: null, after: null, reason: "위택스 이용 안내 삭제" });
    return json({ deleted: key });
  }

  return errorJson(400, "알 수 없는 요청입니다");
});
