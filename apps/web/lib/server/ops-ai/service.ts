import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { budgetLevel, costOf, createOpsModel, kstDate, parseBudget, suggestRulesetImpact, type OpsBudget, type OpsModel, type TokenUsage } from "@ltr/workflows/ops";
import { opsAiEnv } from "../env";
import { featureOn, readSetting } from "../brief/policy";

// 운영 AI 작업 (W10-e - AIOPS-01·03·04). AI는 켜져 있을 때만 쓰고, 꺼진 상태(키·모델·예산 설정 없음, 기능 키 꺼짐, 예산 초과)에서도 감지는 그대로 돈다.
//  · O4 브리핑 편집(AIOPS-02)은 주간 브리핑 호와 함께 지웠다 (PO 2026-11-01 - 최신법령·유권해석은 일반 기사로 올린다)
//  · AI 결과는 review_items(kind ai_draft)에만 쓴다 - 공개 표에는 쓰지 않고, 승인 전 공개 0
//  · 실행마다 모델·토큰·비용을 detail._usage로 돌려주면 작업 경로가 agent_runs 비용 칸에 적는다
//  · 월 예산 80% 이상이면 검수 큐에 경보 항목(달마다 1건), 100% 이상이면 AI 호출 0

type Db = SupabaseClient;
const fail = (what: string, e: { code?: string; message: string }) => new Error(`${what}: ${e.code ?? ""} ${e.message}`.trim());

export interface OpsGate {
  run: boolean;
  reason?: "flag_off" | "no_key" | "no_budget" | "budget_exceeded";
  model?: OpsModel;
  budget?: OpsBudget;
}

/** 이번 달(한국) 지출을 합쳐 경보 항목을 만들고 수준을 돌려준다 */
export async function evaluateBudget(db: Db, now: Date, budget: OpsBudget): Promise<{ level: "ok" | "warn" | "exceeded"; spent: number }> {
  const r = await db.rpc("ops_ai_month_cost", { p_at: now.toISOString() });
  if (r.error) throw fail("ops_ai_month_cost", r.error);
  const row = ((r.data ?? []) as { cost_unit: string; total: number | string }[]).find((x) => x.cost_unit === budget.unit);
  const spent = row ? Number(row.total) : 0;
  const level = budgetLevel(spent, budget.limit, budget.warnRatio);
  const month = kstDate(now).slice(0, 7);
  for (const lv of level === "exceeded" ? (["warn", "exceeded"] as const) : level === "warn" ? (["warn"] as const) : []) {
    const ins = await db.from("review_items").insert({
      kind: "pipeline_failure", source_key: `ops_ai_budget:${month}:${lv}`, title: lv === "warn" ? `운영 AI 월 예산 ${Math.round(budget.warnRatio * 100)}% 도달 (${month})` : `운영 AI 월 예산 초과 (${month})`,
      payload: { month, level: lv, unit: budget.unit, limit: budget.limit, spent }, created_by: "job:ops-ai-budget",
    });
    if (ins.error && ins.error.code !== "23505") throw fail("review_items 경보", ins.error);
  }
  return { level, spent };
}

export async function opsGate(db: Db, now: Date): Promise<OpsGate> {
  if (!(await featureOn(db, "ai_ops"))) return { run: false, reason: "flag_off" };
  const env = opsAiEnv();
  const model = createOpsModel({ apiKey: env.apiKey, model: env.model, baseUrl: env.baseUrl });
  if (!model) return { run: false, reason: "no_key" };
  const budget = parseBudget(await readSetting(db, "ops_ai_budget"));
  if (!budget) return { run: false, reason: "no_budget" };
  const { level } = await evaluateBudget(db, now, budget);
  if (level === "exceeded") return { run: false, reason: "budget_exceeded" };
  return { run: true, model, budget };
}

export const usageOf = (gate: OpsGate, used: TokenUsage) => {
  const model = gate.model!.name;
  const cost = costOf(used, model, gate.budget!);
  return { model, inputTokens: used.inputTokens, outputTokens: used.outputTokens, ...(cost === null ? {} : { cost, costUnit: gate.budget!.unit }) };
};
export const sum = (a: TokenUsage, b: TokenUsage): TokenUsage => ({ inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens });

/** 예산 점검 작업 (하루 한 번) */
export async function checkOpsBudget(db: Db, now: Date): Promise<Record<string, unknown>> {
  const budget = parseBudget(await readSetting(db, "ops_ai_budget"));
  if (!budget) return { skipped: "no_budget" };
  const { level, spent } = await evaluateBudget(db, now, budget);
  return { level, spentRatioPercent: Math.round((spent / budget.limit) * 1000) / 10 };
}

/** O1 개정 감지 작업 - 후보를 검수 큐에 올린다(AI 없음). 켜져 있으면 공포·시행 단계 기록에 룰셋 영향 제안 초안을 같은 큐에 올린다 */
export async function detectAmendments(db: Db, now: Date): Promise<Record<string, unknown>> {
  if (!(await featureOn(db, "amendment_auto"))) return { skipped: "flag_off" };
  const d = await db.rpc("amendment_candidates_detect", { p_today: kstDate(now) });
  if (d.error) throw fail("amendment_candidates_detect", d.error);
  const row = ((d.data ?? []) as { created: number; existing: number }[])[0] ?? { created: 0, existing: 0 };
  const out: Record<string, unknown> = { candidatesCreated: row.created, candidatesExisting: row.existing };
  const gate = await opsGate(db, now);
  if (!gate.run) return { ...out, impact: { skipped: gate.reason } };

  // 최근 7일 안에 반영된 공포·시행 단계 기록 중 자동 감지 출처(조문 글자가 DB에 있는 것)만
  const events = await db.from("amendment_events").select("id, stage, review_item_id").in("stage", ["promulgated", "effective"]).eq("origin", "auto").gt("recorded_at", new Date(now.getTime() - 7 * 86_400_000).toISOString());
  if (events.error) throw fail("amendment_events 조회", events.error);
  let used: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let proposed = 0;
  let none = 0;
  for (const e of (events.data ?? []) as { id: number; stage: string; review_item_id: number }[]) {
    const key = `ruleset_impact:${e.id}`;
    const have = await db.from("review_items").select("id").eq("kind", "ai_draft").eq("source_key", key).limit(1);
    if (have.error) throw fail("review_items 조회", have.error);
    if (have.data?.length) continue;
    const item = await db.from("review_items").select("payload").eq("id", e.review_item_id).limit(1);
    const lawEventId = Number((item.data?.[0] as { payload?: { lawEventId?: number } } | undefined)?.payload?.lawEventId);
    const ev = await db.from("law_events").select("version_id").eq("id", lawEventId).limit(1);
    const versionId = (ev.data?.[0] as { version_id: number | null } | undefined)?.version_id;
    if (!versionId) continue;
    const arts = await db.from("law_articles").select("body").eq("version_id", versionId).order("article_no").limit(400);
    const text = ((arts.data ?? []) as { body: string }[]).map((a) => a.body).join("\n").slice(0, 12_000);
    const r = await suggestRulesetImpact(gate.model!, { stage: e.stage, articleText: text });
    if (r.status === "proposed") {
      used = sum(used, r.usage);
      proposed += 1;
      const ins = await db.from("review_items").insert({ kind: "ai_draft", source_key: key, title: "룰셋 영향 제안 (감수위원 확인용 초안)", payload: { amendmentEventId: e.id, stage: e.stage, proposals: r.proposals, dropped: r.dropped, model: gate.model!.name }, created_by: "job:amendment-detect" });
      if (ins.error && ins.error.code !== "23505") throw fail("review_items 저장", ins.error);
    } else if (r.status === "none") {
      used = sum(used, r.usage);
      none += 1;
    }
  }
  return { ...out, impact: { proposed, none }, _usage: usageOf(gate, used) };
}
