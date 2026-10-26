import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AGENT_ANSWER_PROMPT, AGENT_PROMPT_VERSION, AGENT_UTILITY_PROMPT } from "@/lib/agent/instructions";
import { parseAskLimits, parseBudget, parseLivePolicy, parseOfficialSearch, parsePricingAsk, parseScopeFlags, type AskBudget, type AskLimits, type AskPricing, type LivePolicy, type ScopeFlags } from "@/lib/agent/ask-limits";

// 지방세봇 기록·런타임 - 공개 키(anon) + DB 함수만 부른다 (4단계 설계 3장: 서버는 공개 키 + 입력 모양을 검사하는 security definer 함수로만 기록, service role 0).

export interface AgentRuntime {
  taxbot: boolean;
  stage: "none" | "4a" | "4b" | "4c";
  scopes: ScopeFlags;
  limits: AskLimits | null;
  live: LivePolicy | null;
  officialSearch: boolean;
  budget: AskBudget | null;
  pricing: AskPricing | null;
  spentMonthWon: number;
}

const STAGES = ["none", "4a", "4b", "4c"] as const;

export async function readRuntime(client: SupabaseClient): Promise<AgentRuntime | null> {
  const { data, error } = await client.rpc("agent_runtime");
  if (error || typeof data !== "object" || data === null) {
    console.error("[agent] 런타임 상태 읽기 실패:", error?.code);
    return null;
  }
  const d = data as Record<string, unknown>;
  const stage = (STAGES as readonly unknown[]).includes(d.stage) ? (d.stage as AgentRuntime["stage"]) : "none";
  return {
    taxbot: d.taxbot === true,
    stage,
    scopes: parseScopeFlags(d.scopes),
    limits: parseAskLimits(d.limits),
    live: parseLivePolicy(d.live_policy),
    officialSearch: parseOfficialSearch(d.official_search),
    budget: parseBudget(d.budget),
    pricing: parsePricingAsk(d.pricing),
    spentMonthWon: Number(d.spent_month_won ?? 0) || 0,
  };
}

export async function sessionState(client: SupabaseClient, sessionId: string): Promise<{ turns: number; clarifyRounds: number } | null> {
  const { data, error } = await client.rpc("agent_session_state", { p_session: sessionId });
  if (error || typeof data !== "object" || data === null) return null;
  const d = data as { turns?: unknown; clarify_rounds?: unknown };
  return { turns: Number(d.turns ?? 0) || 0, clarifyRounds: Number(d.clarify_rounds ?? 0) || 0 };
}

/** 현재 지시문을 draft로 등록하고 id를 돌려받는다 (같은 본문은 한 줄) */
export async function registerPrompts(client: SupabaseClient): Promise<{ answer: number; utility: number } | null> {
  const [a, u] = await Promise.all([
    client.rpc("agent_register_prompt", { p_role: "agent_answer", p_version: AGENT_PROMPT_VERSION, p_body: AGENT_ANSWER_PROMPT }),
    client.rpc("agent_register_prompt", { p_role: "agent_utility", p_version: AGENT_PROMPT_VERSION, p_body: AGENT_UTILITY_PROMPT }),
  ]);
  if (a.error || u.error) {
    console.error("[agent] 지시문 등록 실패:", a.error?.code ?? u.error?.code);
    return null;
  }
  return { answer: Number(a.data), utility: Number(u.data) };
}

export async function recordTurn(client: SupabaseClient, payload: Record<string, unknown>): Promise<boolean> {
  const { error } = await client.rpc("agent_record_turn", { p: payload });
  if (error) {
    // 기록 실패는 응답을 막지 않는다. 원문은 로그에 남기지 않는다
    console.error("[agent] 기록 실패:", error.code);
    return false;
  }
  return true;
}
