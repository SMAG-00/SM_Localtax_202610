import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/server/http";
import { blindAnswer, finalStatus, nextSlotFor, type BlindAnswer, type GradeRow } from "@/lib/eval/grading";

// 평가·게이트 관리 화면이 읽는 자료 (W12-e e2·e3). 채점 대기열은 채점자 본인 몫만, 다른 채점자 판정·모델 이름·AI 선별 없이(블라인드) 내보낸다.

export interface SetRow { id: number; scope: string; version: string; status: "draft" | "frozen"; note: string | null; created_by: string; created_at: string; frozen_at: string | null }
export interface ItemRow {
  id: number; set_id: number; item_key: string; scope: string; category: string | null; question: string; cross_types: string[]; expected_behavior: string;
  is_test: boolean; origin: string; required_citation_ids: string[];
}
export interface RunRow { id: number; set_id: number; kind: string; answer_source: string; model: string; prompt_version: string; index_version: string; fingerprint: string; status: string; created_by: string; created_at: string }
export interface DisputeRow { answer_id: number; question: string; answer_text: string; first: GradeRow | null; second: GradeRow | null; has_recheck: boolean; recorded_by_viewer: boolean }
export interface ReportRow {
  id: number; kind: string; stage: string | null; scope: string | null; run_id: number; live_run_id: number | null; fingerprint: string; passed: boolean; live_ok: boolean;
  includes_test_items: boolean; evaluation: { passed: boolean; shortfalls: string[] }; metrics: Record<string, unknown>; created_by: string; created_at: string; confirmed_by: string | null; confirmed_at: string | null;
}
export interface AuditRow { id: number; at: string; action: string; outcome: string; code: string; actor: string; report_id: number | null; target: string | null; detail: string | null }

const GRADE_COLS = "answer_id, slot, grader, verdict, fatal_error, citations_supported, clarify_missed, invented_answer, benefit_asserted";

export async function loadEvalBoard(db: SupabaseClient, viewerActor: string) {
  const sets = await db.from("eval_sets").select("id, scope, version, status, note, created_by, created_at, frozen_at").order("id", { ascending: false }).limit(60);
  if (sets.error) throw dbError(sets.error, "eval_sets 조회");
  const items = await db.from("eval_items").select("id, set_id, item_key, scope, category, question, cross_types, expected_behavior, is_test, origin, required_citation_ids").order("id", { ascending: false }).limit(400);
  if (items.error) throw dbError(items.error, "eval_items 조회");
  const runs = await db.from("eval_runs").select("id, set_id, kind, answer_source, model, prompt_version, index_version, fingerprint, status, created_by, created_at").order("id", { ascending: false }).limit(30);
  if (runs.error) throw dbError(runs.error, "eval_runs 조회");

  // 최근 답변 200건과 채점
  const answers = await db
    .from("eval_answers")
    .select("id, run_id, behavior, answer_text, cited_ids, eval_items(question, expected_conclusion, expected_clarify, forbidden_claims, cross_types, expected_behavior, required_citation_ids)")
    .order("id", { ascending: false })
    .limit(200);
  if (answers.error) throw dbError(answers.error, "eval_answers 조회");
  const ids = (answers.data ?? []).map((a) => (a as { id: number }).id);
  const grades = ids.length ? await db.from("eval_grades").select(GRADE_COLS).in("answer_id", ids) : { data: [], error: null };
  if (grades.error) throw dbError(grades.error, "eval_grades 조회");
  const rechecks = ids.length ? await db.from("eval_rechecks").select("answer_id").in("answer_id", ids) : { data: [], error: null };
  if (rechecks.error) throw dbError(rechecks.error, "eval_rechecks 조회");
  const byAnswer = new Map<number, (GradeRow & { answer_id: number })[]>();
  for (const g of (grades.data ?? []) as (GradeRow & { answer_id: number })[]) byAnswer.set(g.answer_id, [...(byAnswer.get(g.answer_id) ?? []), g]);
  const rechecked = new Set((rechecks.data ?? []).map((r) => (r as { answer_id: number }).answer_id));

  const queue: BlindAnswer[] = [];
  const disputes: DisputeRow[] = [];
  const statusCount: Record<string, number> = {};
  for (const raw of answers.data ?? []) {
    const a = raw as unknown as { id: number; behavior: string; answer_text: string; cited_ids: string[]; eval_items: Record<string, unknown> | null };
    const gs = byAnswer.get(a.id) ?? [];
    const st = finalStatus(gs).status;
    statusCount[st] = (statusCount[st] ?? 0) + 1;
    if (nextSlotFor(gs, viewerActor) !== null) queue.push(blindAnswer({ answer_id: a.id, answer_text: a.answer_text, behavior: a.behavior, cited_ids: a.cited_ids, ...(a.eval_items ?? {}) }));
    if (st === "disputed") {
      disputes.push({
        answer_id: a.id, question: String(a.eval_items?.question ?? ""), answer_text: a.answer_text,
        first: gs.find((g) => g.slot === "first") ?? null, second: gs.find((g) => g.slot === "second") ?? null,
        has_recheck: rechecked.has(a.id), recorded_by_viewer: gs.some((g) => g.grader === viewerActor),
      });
    }
  }

  const reports = await db.from("eval_gate_reports").select("id, kind, stage, scope, run_id, live_run_id, fingerprint, passed, live_ok, includes_test_items, evaluation, metrics, created_by, created_at, confirmed_by, confirmed_at").order("id", { ascending: false }).limit(20);
  if (reports.error) throw dbError(reports.error, "eval_gate_reports 조회");
  const audit = await db.from("eval_audit").select("id, at, action, outcome, code, actor, report_id, target, detail").order("id", { ascending: false }).limit(40);
  if (audit.error) throw dbError(audit.error, "eval_audit 조회");
  const settings = await db.from("settings").select("key, value").in("key", ["ask_rollout", "ask_scope_flags", "eval_gate_thresholds"]);
  if (settings.error) throw dbError(settings.error, "settings 조회");
  const setting = Object.fromEntries((settings.data ?? []).map((s) => [(s as { key: string }).key, (s as { value: unknown }).value]));

  return {
    sets: (sets.data ?? []) as SetRow[],
    items: (items.data ?? []) as ItemRow[],
    runs: (runs.data ?? []) as RunRow[],
    queue,
    disputes,
    statusCount,
    reports: (reports.data ?? []) as unknown as ReportRow[],
    audit: (audit.data ?? []) as AuditRow[],
    rollout: ((setting.ask_rollout as { stage?: string } | undefined)?.stage ?? "none") as string,
    scopeFlags: (setting.ask_scope_flags ?? {}) as Record<string, boolean>,
    thresholds: setting.eval_gate_thresholds ?? null,
  };
}
