import "server-only";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePricing, type Pricing } from "@/lib/assistant/budget";
import { ANSWER_PROMPT, PROMPT_VERSION, ROUTER_PROMPT } from "@/lib/assistant/prompt";
import { anonClient } from "@/lib/server/supabase";

// 도우미 기록·예산·속도 — 공개 키(anon)로 DB 함수만 부른다 (설계 12장 #2). 표를 직접 읽거나 쓰지 않는다. service role 0.

export interface RuntimeState {
  notice: { version: string; approved: boolean; aiNotice: string; firstUse: string[] };
  pricing: Pricing;
  tokensToday: number;
  publicReady: boolean;
}

export function db(): SupabaseClient | null {
  return anonClient({ fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) });
}

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** 런타임 상태 — 읽지 못하면 null (호출하는 쪽이 도우미를 닫는다) */
export async function readRuntime(client: SupabaseClient): Promise<RuntimeState | null> {
  const { data, error } = await client.rpc("assistant_runtime");
  if (error || typeof data !== "object" || data === null) {
    console.error("[assistant] 런타임 상태 읽기 실패:", error?.code);
    return null;
  }
  const d = data as { notice?: Record<string, unknown>; pricing?: unknown; tokens_today?: unknown; public_ready?: unknown };
  const n = d.notice ?? {};
  return {
    notice: {
      version: typeof n.version === "string" ? n.version : "draft",
      approved: n.approved === true,
      aiNotice: typeof n.ai_notice === "string" ? n.ai_notice : "",
      firstUse: asStrings(n.first_use),
    },
    pricing: parsePricing(d.pricing),
    tokensToday: Number(d.tokens_today ?? 0) || 0,
    publicReady: d.public_ready === true,
  };
}

/** 속도 제한 키 — HMAC 해시 32글자 (세션·IP 원문은 DB로 가지 않는다) */
export const rateKey = (secret: string, scope: string, value: string): string => createHmac("sha256", secret).update(`assistant:${scope}:${value}`).digest("hex").slice(0, 32);

export async function rateHit(client: SupabaseClient, keyHash: string, limit: { limit: number; windowSeconds: number }): Promise<{ allowed: boolean; retryAfter: number } | null> {
  const { data, error } = await client.rpc("assistant_rate_hit", { p_key_hash: keyHash, p_window_seconds: limit.windowSeconds, p_limit: limit.limit });
  if (error || typeof data !== "object" || data === null) return null;
  const r = data as { allowed?: boolean; retry_after_seconds?: number };
  return { allowed: r.allowed === true, retryAfter: Number(r.retry_after_seconds ?? 0) || 0 };
}

/** 현재 지시문을 draft로 등록하고 id를 돌려받는다 (같은 본문은 한 줄) */
export async function registerPrompts(client: SupabaseClient): Promise<{ answer: number; router: number } | null> {
  const [a, r] = await Promise.all([
    client.rpc("assistant_register_prompt", { p_role: "answer", p_version: PROMPT_VERSION, p_body: ANSWER_PROMPT }),
    client.rpc("assistant_register_prompt", { p_role: "router", p_version: PROMPT_VERSION, p_body: ROUTER_PROMPT }),
  ]);
  if (a.error || r.error) {
    console.error("[assistant] 지시문 등록 실패:", a.error?.code ?? r.error?.code);
    return null;
  }
  return { answer: Number(a.data), router: Number(r.data) };
}

export async function recordTurn(client: SupabaseClient, payload: Record<string, unknown>): Promise<boolean> {
  const { error } = await client.rpc("assistant_record_turn", { p: payload });
  if (error) {
    // 기록 실패는 답을 막지 않는다. 원문은 로그에 남기지 않는다
    console.error("[assistant] 기록 실패:", error.code);
    return false;
  }
  return true;
}

export const FEEDBACK_KINDS = ["helpful", "not_helpful", "link_click", "expert_click", "support_click"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export async function recordFeedback(client: SupabaseClient, session: string, kind: FeedbackKind): Promise<boolean> {
  const { error } = await client.rpc("assistant_feedback", { p_session: session, p_kind: kind });
  return !error;
}
