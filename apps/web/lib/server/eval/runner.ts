import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFetchClient, type ModelClient } from "@/lib/assistant/anthropic";
import { readAgentConfig } from "@/lib/agent/ask-config";
import { budgetState } from "@/lib/agent/ask-limits";
import { EMPTY_DICTIONARY } from "@/lib/agent/clarify";
import { EMPTY_COPY } from "@/lib/agent/fixed-copy";
import type { AgentDeps } from "@/lib/agent/flow";
import { defaultForbidden, defaultPersonNames } from "@/lib/agent/validators";
import { fakeAnswer, FAKE_INDEX_VERSION, FAKE_MODEL_ID, FAKE_PROMPT_VERSION, type FakeAnswer } from "@/lib/eval/fake-model";
import { answerWithAgent, changeReasons, selectItems, type ChangeReason, type ListKind, type RunConditions, type RunnerItem } from "@/lib/eval/runner";
import { anthropicApiKey, anthropicBaseUrl, anthropicWorkspaceId } from "@/lib/server/assistant/env";
import { agentEnv } from "@/lib/server/agent/env";
import { readRuntime } from "@/lib/server/agent/store";
import { createAgentToolbox } from "@/lib/server/agent/toolbox";
import { dbError } from "@/lib/server/http";

// 평가 실행기 (W12-e e4, EVAL-03·ASK-17). 답변 공급자: fake(가짜 모델) · fixture(같은 판의 마지막 live_api 실행 답변을 그대로 다시 쓰기 - 채점·게이트 경로 점검용) · live_api(실제 지방세봇 흐름 + 실제 모델 API).
// 실제 API는 관리자가 누른 실행(op=run_set, source=live_api)에서만 부른다. 시험 파일은 이 경로를 가짜 모델 서버로만 돈다.
type Db = SupabaseClient;
export type AnswerSource = "fake" | "fixture" | "live_api";
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const MAX_OUTPUT_TOKENS = 2000;

/** 지금 조건 - 모델은 환경 설정, 지시문은 마지막 등록 버전, 색인은 가장 새 청크 판, 룰셋·판정표는 활성 본문 해시 묶음 */
export async function currentConditions(db: Db): Promise<RunConditions> {
  const cfg = readAgentConfig(agentEnv());
  const pv = await db.from("prompt_versions").select("version, body_hash").eq("role", "agent_answer").order("id", { ascending: false }).limit(1);
  if (pv.error) throw dbError(pv.error, "prompt_versions 조회");
  const ix = await db.from("chunks").select("index_version").order("id", { ascending: false }).limit(1);
  if (ix.error) throw dbError(ix.error, "chunks 조회");
  const rs = await db.from("rulesets").select("body_sha256").eq("status", "active").order("version");
  if (rs.error) throw dbError(rs.error, "rulesets 조회");
  const dt = await db.from("determination_tables").select("kind, version, body_sha256").eq("status", "active").order("kind").order("version");
  if (dt.error) throw dbError(dt.error, "determination_tables 조회");
  const p = (pv.data?.[0] as { version: string; body_hash: string } | undefined) ?? null;
  const rsRows = (rs.data ?? []) as { body_sha256: string }[];
  const dtRows = (dt.data ?? []) as { kind: string; version: string; body_sha256: string }[];
  return {
    model: cfg.ok ? cfg.config.modelAnswer : "unset",
    prompt_version: p ? `${p.version.slice(0, 45)}:${p.body_hash.slice(0, 12)}` : "unset",
    index_version: ((ix.data?.[0] as { index_version: string } | undefined)?.index_version) ?? "unset",
    ruleset_hash: rsRows.length ? sha(rsRows.map((r) => r.body_sha256).join("|")) : null,
    determination_hash: dtRows.length ? sha(dtRows.map((r) => `${r.kind}:${r.version}:${r.body_sha256}`).join("|")) : null,
  };
}

/** 실제 지방세봇 흐름에 쓰는 의존 객체 (서비스 /api/ask와 같은 조립, 공개 단계·세션·기록은 건너뛴다) */
export async function liveAgentDeps(db: Db): Promise<AgentDeps | null> {
  const cfg = readAgentConfig(agentEnv());
  const rt = await readRuntime(db);
  const apiKey = anthropicApiKey();
  if (!cfg.ok || !rt || !rt.limits || !rt.live || !apiKey) return null;
  const models: ModelClient = createFetchClient({ apiKey, baseUrl: anthropicBaseUrl(), workspaceId: anthropicWorkspaceId(), timeoutMs: 60_000 });
  return {
    config: cfg.config, limits: rt.limits, live: rt.live, officialSearch: rt.officialSearch, models, tools: createAgentToolbox(db), liveFetcher: null, scopeFlags: rt.scopes,
    copy: EMPTY_COPY, dictionary: EMPTY_DICTIONARY, tier: "member", budget: budgetState(rt.spentMonthWon, rt.budget, rt.pricing), pricing: rt.pricing,
    today: new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10), forbidden: defaultForbidden(), personNames: defaultPersonNames(), maxOutputTokens: MAX_OUTPUT_TOKENS,
  };
}

export interface RunOptions {
  setId: number;
  source: AnswerSource;
  kind: "regression" | "gate" | "compare" | "single";
  list: ListKind;
  actor: string;
  triggerReason?: ChangeReason | "manual" | "gate";
  /** live_api일 때만 - 시험은 가짜 모델 서버를 쥔 객체를 넣는다 */
  deps?: AgentDeps | null;
  /** 켠/끈 비교의 '켠' 쪽 표시 - 공식 검색 켬 */
  officialSearch?: boolean;
}

type ItemRow = RunnerItem;
const ITEM_COLS = "id, set_id, item_key, scope, cross_types, expected_behavior, expected_clarify, required_citation_ids, index_exclude_ids, question, is_test";

/** 평가셋 한 판을 돌린다 - 실행 행 -> 문항마다 답변 -> 종료. 문항 하나가 실패해도 나머지를 돌리고 실패 수를 리포트에 남긴다 */
export async function runEvalSet(db: Db, o: RunOptions): Promise<{ run_id: number; answered: number; failed: number }> {
  const set = await db.from("eval_sets").select("id, scope").eq("id", o.setId).single();
  if (set.error || !set.data) throw dbError(set.error ?? { message: "평가셋이 없습니다" }, "eval_sets 조회");
  const all = await db.from("eval_items").select(ITEM_COLS).eq("set_id", o.setId).order("id");
  if (all.error) throw dbError(all.error, "eval_items 조회");
  // 기본·확장은 판의 범위로 정해지므로 판 안의 문항을 모두 돌리고, 색인 제외 목록은 가릴 근거가 있는 문항만 돈다
  const chosen = o.list === "index_exclusion" ? selectItems((all.data ?? []) as ItemRow[], "index_exclusion") : ((all.data ?? []) as ItemRow[]);

  let deps: AgentDeps | null = null;
  let cond: RunConditions;
  let fixtureByItem = new Map<number, FakeAnswer>();
  if (o.source === "live_api") {
    deps = o.deps ?? (await liveAgentDeps(db));
    if (!deps) throw new Error("실제 API 실행에 필요한 모델 설정·키·런타임 설정이 없습니다");
    if (o.officialSearch !== undefined) deps = { ...deps, officialSearch: o.officialSearch };
    cond = await currentConditions(db);
  } else if (o.source === "fixture") {
    const prev = await db.from("eval_runs").select("id, model, prompt_version, index_version, ruleset_hash, determination_hash").eq("set_id", o.setId).eq("answer_source", "live_api").eq("status", "done").order("id", { ascending: false }).limit(1);
    if (prev.error) throw dbError(prev.error, "eval_runs 조회");
    const p = prev.data?.[0] as (RunConditions & { id: number }) | undefined;
    if (!p) throw new Error("다시 쓸 실제 API 실행이 없습니다 - 먼저 live_api로 한 번 돌려야 합니다");
    const ans = await db.from("eval_answers").select("item_id, answer_text, behavior, cited_ids, live_citations, live_without_snapshot").eq("run_id", p.id);
    if (ans.error) throw dbError(ans.error, "eval_answers 조회");
    fixtureByItem = new Map((ans.data ?? []).map((a) => [(a as { item_id: number }).item_id, a as unknown as FakeAnswer]));
    cond = { model: p.model, prompt_version: p.prompt_version, index_version: p.index_version, ruleset_hash: p.ruleset_hash, determination_hash: p.determination_hash };
  } else {
    cond = { model: FAKE_MODEL_ID, prompt_version: FAKE_PROMPT_VERSION, index_version: FAKE_INDEX_VERSION, ruleset_hash: null, determination_hash: null };
  }

  const excluded = [...new Set(chosen.flatMap((i) => i.index_exclude_ids))];
  const run = await db.from("eval_runs").insert({
    set_id: o.setId, kind: o.kind, answer_source: o.source, ...cond, index_excluded: excluded, official_search: Boolean(deps?.officialSearch),
    trigger_reason: o.triggerReason ?? "manual", created_by: o.actor,
  }).select("id").single();
  if (run.error) throw dbError(run.error, "eval_runs 추가");
  const runId = (run.data as { id: number }).id;

  let answered = 0;
  let failed = 0;
  const failures: string[] = [];
  for (const it of chosen) {
    try {
      const a = o.source === "live_api" ? await answerWithAgent(it, deps!) : o.source === "fixture" ? fixtureByItem.get(it.id) : fakeAnswer(it);
      if (!a) throw new Error("다시 쓸 답변이 없는 문항");
      const ins = await db.from("eval_answers").insert({
        run_id: runId, item_id: it.id, answer_text: a.answer_text, behavior: a.behavior, cited_ids: a.cited_ids, live_citations: a.live_citations, live_without_snapshot: a.live_without_snapshot,
      });
      if (ins.error) throw new Error(ins.error.message);
      answered += 1;
    } catch (e) {
      failed += 1;
      failures.push(`${it.item_key}: ${(e as Error).message.slice(0, 80)}`);
    }
  }
  const fin = await db.from("eval_runs").update({
    status: failed === chosen.length && chosen.length > 0 ? "failed" : "done", finished_at: new Date().toISOString(), report: { items: chosen.length, answered, failed, failures: failures.slice(0, 20), list: o.list },
  }).eq("id", runId);
  if (fin.error) throw dbError(fin.error, "eval_runs 종료");
  return { run_id: runId, answered, failed };
}

/** 자동 회귀 감지 (EVAL-03) - 마지막 끝난 실행의 조건과 지금 조건을 견주어 바뀌었으면 검수 큐에 알리고, 설정 eval_regression.enabled가 true일 때만 최신 동결 base 판을 가짜 모델로 회귀 실행한다.
 *  실제 API 회귀는 비용이라 PO가 /admin/quality의 실행 버튼으로 누른다. 같은 지문의 알림은 1건(source_key). */
export async function detectRegression(db: Db, now: Date): Promise<Record<string, unknown>> {
  const cur = await currentConditions(db);
  const last = await db.from("eval_runs").select("model, prompt_version, index_version, ruleset_hash, determination_hash, answer_source").in("answer_source", ["live_api", "fixture"]).eq("status", "done").order("id", { ascending: false }).limit(1);
  if (last.error) throw dbError(last.error, "eval_runs 조회");
  const prev = (last.data?.[0] as RunConditions | undefined) ?? null;
  const reasons = changeReasons(prev, cur);
  if (reasons.length === 0) return { checked: true, changed: false, reasons: [] };
  const fp = sha(JSON.stringify(cur)).slice(0, 16);
  const ins = await db.from("review_items").insert({
    kind: "pipeline_failure", source_key: `eval_regression:${fp}`, title: `평가 조건이 바뀌었습니다 - 회귀 평가가 필요합니다 (${reasons.join(", ")})`,
    payload: { reasons, conditions: cur, at: now.toISOString() }, created_by: "job:quality-daily",
  });
  if (ins.error && ins.error.code !== "23505") throw dbError(ins.error, "review_items 경보");
  const out: Record<string, unknown> = { checked: true, changed: true, reasons, alerted: !ins.error };
  const st = await db.from("settings").select("value").eq("key", "eval_regression").maybeSingle();
  const enabled = (st.data?.value as { enabled?: unknown } | undefined)?.enabled === true;
  if (enabled && !ins.error) {
    const set = await db.from("eval_sets").select("id").eq("scope", "base").eq("status", "frozen").order("id", { ascending: false }).limit(1);
    const id = (set.data?.[0] as { id: number } | undefined)?.id;
    if (id) out.run = await runEvalSet(db, { setId: id, source: "fake", kind: "regression", list: "base", actor: "job:quality-daily", triggerReason: reasons[0] });
  }
  return out;
}
