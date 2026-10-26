import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/server/http";

// 보안 정책 관리 화면 자료 (W12-g g3). service_role로 읽는다 - 관리자 화면 전용.
export interface SecurityItemRow {
  id: number;
  item_key: string;
  version: number;
  body: string;
  confirmed_on: string;
  contract_verified: boolean;
  status: "draft" | "published" | "retired";
  drafted_by: string;
  published_at: string | null;
}
export interface SecurityCheckRow {
  id: number;
  round_no: number;
  control_key: string;
  control_title: string;
  result: "met" | "gap" | "na";
  checked_on: string;
  gap_plan: string | null;
  due_on: string | null;
}
export interface SecurityRoundRow {
  round_no: number;
  completed_on: string;
  controls: number;
  gaps: number;
}
export interface SecurityAuditRow {
  id: number;
  at: string;
  subject: "item" | "round";
  target_id: number;
  action: string;
  outcome: "ok" | "refused";
  code: string;
  actor: string;
}

export async function loadSecurityBoard(db: SupabaseClient): Promise<{ items: SecurityItemRow[]; checks: SecurityCheckRow[]; rounds: SecurityRoundRow[]; audit: SecurityAuditRow[] }> {
  const [items, checks, rounds, audit] = await Promise.all([
    db.from("security_policy_items").select("id, item_key, version, body, confirmed_on, contract_verified, status, drafted_by, published_at").order("id", { ascending: false }).limit(100),
    db.from("security_control_checks").select("id, round_no, control_key, control_title, result, checked_on, gap_plan, due_on").order("id", { ascending: false }).limit(200),
    db.from("security_self_check_rounds").select("round_no, completed_on, controls, gaps").order("round_no", { ascending: false }).limit(20),
    db.from("security_audit").select("id, at, subject, target_id, action, outcome, code, actor").order("id", { ascending: false }).limit(40),
  ]);
  for (const [r, what] of [[items, "security_policy_items"], [checks, "security_control_checks"], [rounds, "security_self_check_rounds"], [audit, "security_audit"]] as const) {
    if (r.error) throw dbError(r.error, `${what} 조회`);
  }
  return {
    items: (items.data ?? []) as SecurityItemRow[],
    checks: (checks.data ?? []) as SecurityCheckRow[],
    rounds: (rounds.data ?? []) as SecurityRoundRow[],
    audit: (audit.data ?? []) as SecurityAuditRow[],
  };
}
