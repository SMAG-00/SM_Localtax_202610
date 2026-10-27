import "server-only";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAskModeGate, type AskModeGate } from "@/lib/agent/rollout";
import { parseConsume, type QuotaDecision, type Tier } from "@/lib/agent/quota";

// W12-d 서버 함수 모음 - 모드 공개 판정(anon 함수)과 한도·세션·기록·파기(service_role 전용 함수). 질문·답변 글은 로그에 남기지 않는다.

export async function readModeGate(client: SupabaseClient): Promise<AskModeGate> {
  const { data, error } = await client.rpc("public_ask_mode");
  if (error) console.error("[agent] 모드 판정 읽기 실패:", error.code);
  return parseAskModeGate(error ? null : data);
}

/** 한도 대상 값: 회원은 사용자 ID, 비회원은 IP의 HMAC(원본 IP 저장 0) */
export function quotaSubject(p: { userId: string | null; ip: string; secret: string }): string {
  if (p.userId) return `u:${p.userId}`;
  return `g:${createHmac("sha256", p.secret).update(p.ip).digest("hex").slice(0, 40)}`;
}

export async function consumeQuota(admin: SupabaseClient, subject: string, tier: Tier): Promise<QuotaDecision> {
  const { data, error } = await admin.rpc("agent_quota_consume", { p_subject: subject, p_tier: tier });
  if (error) {
    console.error("[agent] 한도 차감 실패:", error.code);
    return parseConsume(null, tier);
  }
  return parseConsume(data, tier);
}

export async function refundQuota(admin: SupabaseClient, subject: string): Promise<void> {
  const { error } = await admin.rpc("agent_quota_refund", { p_subject: subject });
  if (error) console.error("[agent] 한도 반환 실패:", error.code);
}

export async function peekQuota(admin: SupabaseClient, subject: string, tier: Tier): Promise<{ used: number; limit: number | null; remaining: number | null } | null> {
  const { data, error } = await admin.rpc("agent_quota_peek", { p_subject: subject, p_tier: tier });
  if (error || typeof data !== "object" || data === null) return null;
  const d = data as { used?: unknown; limit?: unknown; remaining?: unknown };
  return { used: Number(d.used ?? 0) || 0, limit: typeof d.limit === "number" ? d.limit : null, remaining: typeof d.remaining === "number" ? d.remaining : null };
}

export async function openSession(admin: SupabaseClient, p: { sessionId: string; userId: string | null; mode: string; entry: string | null; internal: boolean; retainDays: number; save: boolean }): Promise<{ save: boolean } | null> {
  const { data, error } = await admin.rpc("agent_session_open", { p_session: p.sessionId, p_user: p.userId, p_mode: p.mode, p_entry: p.entry, p_internal: p.internal, p_retain_days: p.retainDays, p_save: p.save });
  if (error || typeof data !== "object" || data === null) {
    console.error("[agent] 세션 열기 실패:", error?.code);
    return null;
  }
  return { save: (data as { save?: unknown }).save !== false };
}

export async function submitFeedback(client: SupabaseClient, p: { sessionId: string; turn: number; kind: string; reason: string | null }): Promise<boolean> {
  const { data, error } = await client.rpc("agent_feedback_submit", { p_session: p.sessionId, p_turn: p.turn, p_kind: p.kind, p_reason: p.reason });
  return !error && data === true;
}

export async function saveOff(admin: SupabaseClient, p: { sessionId: string; userId: string | null; remember: boolean }): Promise<boolean> {
  const { data, error } = await admin.rpc("agent_session_save_off", { p_session: p.sessionId, p_user: p.userId, p_remember: p.remember });
  return !error && data === true;
}

export interface MySession { id: string; last_at: string; retain_until: string; save_enabled: boolean; turn_count: number; first_question: string | null }

export async function listMySessions(admin: SupabaseClient, userId: string, query: string | null): Promise<MySession[]> {
  const { data, error } = await admin.rpc("agent_my_sessions", { p_user: userId, p_query: query, p_limit: 50 });
  return !error && Array.isArray(data) ? (data as MySession[]) : [];
}

export async function deleteMySession(admin: SupabaseClient, userId: string, sessionId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("agent_session_delete", { p_user: userId, p_session: sessionId });
  return !error && data === true;
}

export async function memberSaveGet(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("agent_member_save_get", { p_user: userId });
  return error ? true : data !== false;
}

export async function memberSaveSet(admin: SupabaseClient, userId: string, save: boolean): Promise<boolean> {
  const { error } = await admin.rpc("agent_member_save_set", { p_user: userId, p_save: save });
  return !error;
}

/** 작업 agent-purge - 기한 지난 대화 글 비우기 (수만 돌려준다) */
export async function purgeAgentConversations(admin: SupabaseClient, now: Date): Promise<Record<string, unknown>> {
  const { data, error } = await admin.rpc("agent_purge", { p_now: now.toISOString() });
  if (error) throw new Error(`agent_purge 실패: ${error.code ?? "unknown"}`);
  return (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
}

/** 세션 상태 - 회원 세션도 읽는다(service_role 전용 함수, 소유자 일치 때만) */
export async function sessionStateFor(admin: SupabaseClient, sessionId: string, userId: string | null): Promise<{ turns: number; clarifyRounds: number } | null> {
  const { data, error } = await admin.rpc("agent_session_state_for", { p_session: sessionId, p_user: userId });
  if (error || typeof data !== "object" || data === null) return null;
  const d = data as { turns?: unknown; clarify_rounds?: unknown };
  return { turns: Number(d.turns ?? 0) || 0, clarifyRounds: Number(d.clarify_rounds ?? 0) || 0 };
}
