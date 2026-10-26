import type { SupabaseClient } from "@supabase/supabase-js";
import type { Action } from "@/lib/access";
import { thresholdsProblem } from "@/lib/eval/gate";
import { nextSlotFor, type GradeRow } from "@/lib/eval/grading";
import { EVAL_OPS, parseCompile, parseGrade, parseId, parseItem, parseRecheck, parseRollout, parseScopeApprove, parseSetAdd, parseSetCopy, parseThird, parseThresholds, type EvalOp } from "@/lib/eval/rules";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { loadEvalBoard } from "@/lib/server/eval/board";
import { runSingle } from "@/lib/server/eval/run";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 평가·게이트 관리 (W12-e e2·e3 - PRD-04 EVAL-01·02·04, docs/dev/W12-e_설계.md). 열기·닫기는 승인 함수(DB)만 한다 - 여기서 설정을 직접 바꾸지 않는다.
//  · GET  - 평가셋·문항·실행·내 채점 대기열(블라인드)·불일치·리포트·감사 (eval.author·eval.grade·eval.gate_approve 중 하나)
//  · POST op=set_add|set_freeze|set_copy|item_add|item_update|run_single  (eval.author)
//  · POST op=grade|recheck|third_grade                                     (eval.grade) 채점 자리(첫째·둘째)는 서버가 정한다
//  · POST op=report_compile|report_confirm|thresholds_save                 (eval.gate_approve)
//  · POST op=rollout_approve (ask_rollout.approve) · scope_approve (ask_scope.approve) - 거부는 409 + code, 감사 1행은 DB가 남긴다
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const ACTION: Record<EvalOp, Action> = {
  set_add: "eval.author", set_freeze: "eval.author", set_copy: "eval.author", item_add: "eval.author", item_update: "eval.author", run_single: "eval.author",
  grade: "eval.grade", recheck: "eval.grade", third_grade: "eval.grade",
  report_compile: "eval.gate_approve", report_confirm: "eval.gate_approve", thresholds_save: "eval.gate_approve",
  rollout_approve: "ask_rollout.approve", scope_approve: "ask_scope.approve",
};

/** DB 함수 결과 { ok, code, message } -> 응답 */
function rpcResult(data: unknown, okBody: (d: Record<string, unknown>) => Record<string, unknown> = (d) => d): Response {
  const r = data as { ok: boolean; code: string; message: string } & Record<string, unknown>;
  return r.ok ? json(okBody(r)) : errorJson(409, r.message, { code: r.code });
}
/** 가드 트리거·check 위반은 입력 문제(422), 권한 위반은 409 */
function writeError(error: { code?: string; message: string }, what: string): Response {
  if (error.code === "23514" || error.code === "23505") return invalid([error.message]);
  if (error.code === "42501") return errorJson(409, error.message);
  throw dbError(error, what);
}

async function gradesOf(db: SupabaseClient, answerId: number): Promise<(GradeRow & { answer_id: number })[]> {
  const { data, error } = await db.from("eval_grades").select("answer_id, slot, grader, verdict, fatal_error, citations_supported, clarify_missed, invented_answer, benefit_asserted").eq("answer_id", answerId);
  if (error) throw dbError(error, "eval_grades 조회");
  return (data ?? []) as (GradeRow & { answer_id: number })[];
}

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = (await authorize(viewer, "eval.grade", "eval:list")) && (await authorize(viewer, "eval.author", "eval:list")) && (await authorize(viewer, "eval.gate_approve", "eval:list"));
  if (denied) return denied;
  return json(await loadEvalBoard(serviceDb(), actorOf(viewer)));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!(EVAL_OPS as readonly string[]).includes(op)) return invalid([`op: ${EVAL_OPS.join("·")} 중 하나입니다`]);
  const denied = await authorize(viewer, ACTION[op as EvalOp], `eval:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "set_add") {
    const p = parseSetAdd(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.from("eval_sets").insert({ ...p.value, created_by: actor }).select("id").single();
    if (error) return writeError(error, "eval_sets 추가");
    await writeAudit(db, { actor, action: "eval.set.add", target: `eval_sets:${(data as { id: number }).id}`, before: null, after: p.value, reason: "평가셋 추가(초안)" });
    return json({ created: data }, 201);
  }
  if (op === "set_freeze") {
    const id = parseId(body);
    if (!id.ok) return invalid(id.errors);
    const { data, error } = await db.rpc("eval_set_freeze", { p_set_id: id.value, p_actor: actor });
    if (error) throw dbError(error, "평가셋 동결");
    await writeAudit(db, { actor, action: "eval.set.freeze", target: `eval_sets:${id.value}`, before: null, after: data, reason: "평가셋 동결 시도" });
    return rpcResult(data);
  }
  if (op === "set_copy") {
    const p = parseSetCopy(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.rpc("eval_set_copy", { p_from_set_id: p.value.id, p_new_version: p.value.version, p_actor: actor });
    if (error) throw dbError(error, "평가셋 복사");
    await writeAudit(db, { actor, action: "eval.set.copy", target: `eval_sets:${p.value.id}`, before: null, after: data, reason: "평가셋 새 판 복사" });
    return rpcResult(data);
  }
  if (op === "item_add" || op === "item_update") {
    const p = parseItem(body, op === "item_add");
    if (!p.ok) return invalid(p.errors);
    const v = p.value;
    const now = new Date().toISOString();
    const cols = {
      category: v.category, question: v.question, cross_types: v.cross_types, expected_behavior: v.expected_behavior, required_requirements: v.required_requirements,
      expected_clarify: v.expected_clarify, expected_conclusion: v.expected_conclusion, required_citation_ids: v.required_citation_ids, forbidden_claims: v.forbidden_claims,
      index_exclude_ids: v.index_exclude_ids, is_test: v.is_test, origin: v.origin,
      anonymized_by: v.anonymized ? actor : null, anonymized_at: v.anonymized ? now : null, rights_confirmed_by: v.rights_confirmed ? actor : null, rights_confirmed_at: v.rights_confirmed ? now : null,
    };
    if (op === "item_add") {
      const set = await db.from("eval_sets").select("scope").eq("id", v.set_id).maybeSingle();
      if (set.error) throw dbError(set.error, "eval_sets 조회");
      if (!set.data) return errorJson(404, "평가셋이 없습니다");
      const { data, error } = await db.from("eval_items").insert({ ...cols, set_id: v.set_id, item_key: v.item_key, scope: (set.data as { scope: string }).scope, created_by: actor }).select("id").single();
      if (error) return writeError(error, "eval_items 추가");
      // 감사에는 질문·정답을 싣지 않는다 - 관리 번호와 분류만
      await writeAudit(db, { actor, action: "eval.item.add", target: `eval_items:${(data as { id: number }).id}`, before: null, after: { item_key: v.item_key, is_test: v.is_test, origin: v.origin }, reason: "평가 문항 추가" });
      return json({ created: data }, 201);
    }
    const id = parseId(body);
    if (!id.ok) return invalid(id.errors);
    const { data, error } = await db.from("eval_items").update(cols).eq("id", id.value).select("id");
    if (error) return writeError(error, "eval_items 수정");
    if (!data || data.length === 0) return errorJson(404, "문항이 없습니다");
    await writeAudit(db, { actor, action: "eval.item.update", target: `eval_items:${id.value}`, before: null, after: { is_test: v.is_test, origin: v.origin }, reason: "평가 문항 수정(초안 판만)" });
    return json({ updated: true });
  }
  if (op === "run_single") {
    const id = parseId(body, "item_id");
    if (!id.ok) return invalid(id.errors);
    return json({ run: await runSingle(db, id.value, actor) }, 201);
  }

  if (op === "grade" || op === "third_grade") {
    const p = op === "grade" ? parseGrade(body) : parseThird(body);
    if (!p.ok) return invalid(p.errors);
    const grades = await gradesOf(db, p.value.answer_id);
    const slot = op === "third_grade" ? "third" : nextSlotFor(grades, actor);
    if (!slot) return errorJson(409, "이 답변은 이미 채점했거나 두 자리가 모두 찼습니다");
    const { answer_id, ...rest } = p.value;
    const { error } = await db.from("eval_grades").insert({ ...rest, answer_id, slot, grader: actor });
    if (error) return writeError(error, "eval_grades 추가");
    return json({ graded: true, slot }, 201);
  }
  if (op === "recheck") {
    const p = parseRecheck(body);
    if (!p.ok) return invalid(p.errors);
    const grades = await gradesOf(db, p.value.answer_id);
    const f = grades.find((g) => g.slot === "first");
    const s = grades.find((g) => g.slot === "second");
    if (!f || !s) return errorJson(409, "두 채점이 모두 있는 답변만 재확인합니다");
    if (actor !== f.grader && actor !== s.grader) return errorJson(409, "원문 재확인은 두 채점자 중 한 사람이 두 사람의 확인을 기록합니다");
    const { error } = await db.from("eval_rechecks").insert({ answer_id: p.value.answer_id, rechecked_by: [f.grader, s.grader], note: p.value.note, recorded_by: actor });
    if (error) return writeError(error, "eval_rechecks 추가");
    return json({ rechecked: true }, 201);
  }

  if (op === "report_compile") {
    const p = parseCompile(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.rpc("eval_gate_report_compile", { p_kind: p.value.kind, p_stage: p.value.stage, p_scope: p.value.scope, p_run_id: p.value.run_id, p_live_run_id: p.value.live_run_id, p_actor: actor });
    if (error) throw dbError(error, "게이트 리포트 만들기");
    return rpcResult(data);
  }
  if (op === "report_confirm") {
    const id = parseId(body, "report_id");
    if (!id.ok) return invalid(id.errors);
    const { data, error } = await db.rpc("eval_gate_report_confirm", { p_report_id: id.value, p_actor: actor });
    if (error) throw dbError(error, "게이트 리포트 확정");
    return rpcResult(data);
  }
  if (op === "rollout_approve") {
    const p = parseRollout(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.rpc("ask_rollout_approve", { p_stage: p.value.stage, p_report_id: p.value.report_id, p_actor: actor, p_fingerprint: p.value.fingerprint });
    if (error) throw dbError(error, "공개 단계 승인");
    await writeAudit(db, { actor, action: "ask.rollout.approve", target: "settings:ask_rollout", before: null, after: { stage: p.value.stage, report_id: p.value.report_id, result: data }, reason: "지방세봇 공개 단계 변경 시도" });
    return rpcResult(data);
  }
  if (op === "scope_approve") {
    const p = parseScopeApprove(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.rpc("ask_scope_approve", { p_scope: p.value.scope, p_enabled: p.value.enabled, p_report_id: p.value.report_id, p_actor: actor, p_fingerprint: p.value.fingerprint });
    if (error) throw dbError(error, "범위 플래그 승인");
    await writeAudit(db, { actor, action: "ask.scope.approve", target: "settings:ask_scope_flags", before: null, after: { scope: p.value.scope, enabled: p.value.enabled, result: data }, reason: "지방세봇 범위 플래그 변경 시도" });
    return rpcResult(data);
  }
  // thresholds_save
  const p = parseThresholds(body);
  if (!p.ok) return invalid(p.errors);
  const problem = thresholdsProblem(p.value);
  if (problem) return invalid([`value: ${problem}`]);
  const { error } = await db.from("settings").update({ value: p.value, updated_by: actor }).eq("key", "eval_gate_thresholds");
  if (error) return writeError(error, "게이트 값 저장");
  await writeAudit(db, { actor, action: "eval.thresholds.save", target: "settings:eval_gate_thresholds", before: null, after: p.value, reason: "평가 게이트 값 저장 (4c 하한 통과)" });
  return json({ saved: true });
});
