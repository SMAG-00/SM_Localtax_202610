import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/server/http";
import { detectRegression } from "@/lib/server/eval/runner";

// 품질 콘솔 읽기·작업 (W12-e e5, QUAL-01~04). 표본·차단 로그는 마스킹본만 다룬다. 경보 계산은 DB 함수가 한다.
type Db = SupabaseClient;

export interface AlertRow { id: number; kind: string; alert_key: string; detail: Record<string, unknown>; created_at: string; acked_by: string | null; acked_at: string | null }

export async function loadQualityBoard(db: Db) {
  const q = async <T>(p: PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>, what: string): Promise<T[]> => {
    const r = await p;
    if (r.error) throw dbError(r.error, what);
    return r.data ?? [];
  };
  const alerts = await q<AlertRow>(db.from("quality_alerts").select("id, kind, alert_key, detail, created_at, acked_by, acked_at").order("id", { ascending: false }).limit(60), "quality_alerts 조회");
  const blocked = await q<Record<string, unknown>>(db.from("quality_blocked_log").select("message_id, created_at, scope, tier, kind, fallback_reason, regenerated, failure_codes").order("created_at", { ascending: false }).limit(50), "quality_blocked_log 조회");
  const live = await q<Record<string, unknown>>(db.from("quality_live_log").select("tool_call_id, message_id, created_at, tool, ok, latency_ms, target_type, snapshot_id").order("created_at", { ascending: false }).limit(50), "quality_live_log 조회");
  const cost = await q<{ day: string; tier: string; turns: number; cost: number; cost_per_turn: number }>(db.from("quality_cost_daily").select("day, tier, turns, cost, cost_per_turn").order("day", { ascending: false }).limit(30), "quality_cost_daily 조회");
  const sample = await q<{ message_id: number; created_at: string; scope: string; tier: string; question_masked: string | null; answer_masked: string | null; judgments: number }>(
    db.from("quality_sample_candidates").select("message_id, created_at, scope, tier, question_masked, answer_masked, judgments").eq("judgments", 0).order("created_at", { ascending: false }).limit(30),
    "quality_sample_candidates 조회",
  );
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const judged = await db.from("quality_judgments").select("id", { count: "exact", head: true }).gte("judged_at", `${today}T00:00:00+09:00`);
  if (judged.error) throw dbError(judged.error, "quality_judgments 집계");
  const sets = await q<{ id: number; scope: string; version: string }>(db.from("eval_sets").select("id, scope, version").eq("status", "frozen").order("id", { ascending: false }).limit(20), "eval_sets 조회");
  return { alerts, blocked, live, cost, sample, judgedToday: judged.count ?? 0, frozenSets: sets };
}

/** 작업 quality-daily - DB 경보 검사(차단율·예산·표본 부족) + 평가 조건 변경 감지(회귀) */
export async function runQualityDaily(db: Db, now: Date): Promise<Record<string, unknown>> {
  const r = await db.rpc("quality_daily_run", { p_now: now.toISOString() });
  if (r.error) throw dbError(r.error, "quality_daily_run");
  const regression = await detectRegression(db, now);
  return { ...(r.data as Record<string, unknown>), regression };
}
