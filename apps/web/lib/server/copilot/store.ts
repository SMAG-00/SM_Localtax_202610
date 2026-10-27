import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// 코파일럿 사용량·실행 기록 (W13-e, 210·211) - service_role 함수로만. 질문·메모·답변 글은 넘기지 않는다.

export type Consume = { allowed: true; used: number; limit: number } | { allowed: false; code: "limit_unset" | "limit_reached" | "error"; used: number; limit: number };

export async function consumeRun(admin: SupabaseClient, userId: string, limit: number | null): Promise<Consume> {
  const { data, error } = await admin.rpc("copilot_consume", { p_user: userId, p_limit: limit });
  if (error || typeof data !== "object" || data === null) {
    console.error("[copilot] 한도 차감 실패:", error?.code);
    return { allowed: false, code: "error", used: 0, limit: limit ?? 0 };
  }
  const d = data as { allowed?: unknown; code?: unknown; used?: unknown; limit?: unknown };
  const used = Number(d.used ?? 0) || 0;
  const lim = Number(d.limit ?? 0) || 0;
  if (d.allowed === true) return { allowed: true, used, limit: lim };
  return { allowed: false, code: d.code === "limit_reached" ? "limit_reached" : "limit_unset", used, limit: lim };
}

export async function refundRun(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.rpc("copilot_refund", { p_user: userId });
  if (error) console.error("[copilot] 한도 반환 실패:", error.code);
}

export async function peekRuns(admin: SupabaseClient, userId: string, limit: number | null): Promise<{ used: number; limit: number }> {
  const { data, error } = await admin.rpc("copilot_peek", { p_user: userId, p_limit: limit });
  if (error || typeof data !== "object" || data === null) return { used: 0, limit: limit ?? 0 };
  const d = data as { used?: unknown; limit?: unknown };
  return { used: Number(d.used ?? 0) || 0, limit: Number(d.limit ?? 0) || 0 };
}

export interface RunRecord {
  id: string;
  user_id: string;
  kind: string;
  status: string;
  model: string | null;
  citation_ids: string[];
  validation: Record<string, unknown>;
  tokens_in: number;
  tokens_out: number;
  cost: number;
}

export async function recordRun(admin: SupabaseClient, p: RunRecord): Promise<boolean> {
  const { error } = await admin.rpc("copilot_record_run", { p });
  if (error) console.error("[copilot] 실행 기록 실패:", error.code);
  return !error;
}

export async function summaryAllowedIds(admin: SupabaseClient, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await admin.rpc("copilot_summary_allowed", { p_source_ids: ids });
  if (error || !Array.isArray(data)) {
    console.error("[copilot] 요약 권리 확인 실패:", error?.code);
    return []; // 모르면 요약하지 않는다
  }
  return data.filter((x): x is string => typeof x === "string");
}
