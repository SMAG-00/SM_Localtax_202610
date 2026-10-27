import { parseJudge, QUALITY_OPS } from "@/lib/eval/quality";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { runEvalSet } from "@/lib/server/eval/runner";
import { loadQualityBoard, runQualityDaily } from "@/lib/server/quality/service";

// 품질 콘솔 (W12-e e5 - QUAL-01~04). 권한 quality.review(세무 감수위원·관리자). 실제 API 실행(run_set source=live_api)은 관리자만(eval.gate_approve).
//  · GET  - 경보·차단 로그·실시간 조회 기록·비용·표본 후보
//  · POST op=judge(표본 판정) · ack(경보 확인) · run_daily(검사 즉시 실행) · run_set(평가셋 실행: fake|fixture|live_api)
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "quality.review", "quality:list");
  if (denied) return denied;
  return json(await loadQualityBoard(serviceDb()));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!(QUALITY_OPS as readonly string[]).includes(op)) return errorJson(422, "입력값을 확인하세요", { errors: [`op: ${QUALITY_OPS.join("·")} 중 하나입니다`] });
  const denied = await authorize(viewer, op === "run_set" && body.source === "live_api" ? "eval.gate_approve" : "quality.review", `quality:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "judge") {
    const p = parseJudge(body);
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const { data, error } = await db.rpc("quality_judge", { p_message: p.value.message_id, p_judge: actor, p_verdict: p.value.verdict, p_note: p.value.note, p_candidate: p.value.eval_candidate });
    if (error) throw dbError(error, "quality_judge");
    const r = data as { ok: boolean; code: string; message: string };
    return r.ok ? json({ ok: true }, 201) : errorJson(409, r.message, { code: r.code });
  }
  if (op === "ack") {
    const id = Number(body.alert_id);
    if (!Number.isInteger(id) || id < 1) return errorJson(422, "입력값을 확인하세요", { errors: ["alert_id: 경보 번호가 올바르지 않습니다"] });
    const { data, error } = await db.rpc("quality_alert_ack", { p_id: id, p_actor: actor });
    if (error) throw dbError(error, "quality_alert_ack");
    if (data !== true) return errorJson(409, "이미 확인했거나 없는 경보입니다");
    await writeAudit(db, { actor, action: "quality.alert.ack", target: `quality_alerts:${id}`, before: null, after: null, reason: "품질 경보 확인" });
    return json({ ok: true });
  }
  if (op === "run_daily") return json(await runQualityDaily(db, new Date()));
  // run_set
  const setId = Number(body.set_id);
  const source = String(body.source);
  const list = String(body.list ?? "base");
  if (!Number.isInteger(setId) || setId < 1 || !["fake", "fixture", "live_api"].includes(source) || !["base", "extended", "index_exclusion"].includes(list)) {
    return errorJson(422, "입력값을 확인하세요", { errors: ["set_id·source(fake|fixture|live_api)·list(base|extended|index_exclusion)를 확인하세요"] });
  }
  try {
    const r = await runEvalSet(db, {
      setId, source: source as "fake" | "fixture" | "live_api", kind: body.kind === "compare" ? "compare" : "regression", list: list as "base" | "extended" | "index_exclusion", actor,
      officialSearch: typeof body.official_search === "boolean" ? body.official_search : undefined,
    });
    await writeAudit(db, { actor, action: "eval.run_set", target: `eval_sets:${setId}`, before: null, after: { source, list, ...r }, reason: "평가셋 실행" });
    return json({ run: r }, 201);
  } catch (e) {
    return errorJson(409, (e as Error).message);
  }
});
