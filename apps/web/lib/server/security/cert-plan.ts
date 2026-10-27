import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/server/http";

// 정보보호 인증 추진 계획 서버 입출력 (W13-j, SEC-02). service_role로 읽는다 - 관리자 화면과 기관 판매 게이트 전용.
export interface CertPlanRow {
  id: number;
  cert_kind: "iso27001" | "ismsp" | "other";
  other_kind_name: string | null;
  scope: string;
  target_start_on: string;
  target_end_on: string;
  cost_estimate_krw: number;
  owner_name: string;
  entity_name: string | null;
  risk_assessed_on: string | null;
  note: string | null;
  status: "draft" | "approved" | "superseded" | "withdrawn";
  drafted_by: string;
  approved_at: string | null;
}
export interface CertAuditRow {
  id: number;
  at: string;
  plan_id: number;
  action: "approve" | "withdraw";
  outcome: "ok" | "refused";
  code: string;
  actor: string;
}

export async function loadCertPlanBoard(db: SupabaseClient): Promise<{ plans: CertPlanRow[]; audit: CertAuditRow[]; gateOpen: boolean }> {
  const [plans, audit, gate] = await Promise.all([
    db.from("security_cert_plans").select("id, cert_kind, other_kind_name, scope, target_start_on, target_end_on, cost_estimate_krw, owner_name, entity_name, risk_assessed_on, note, status, drafted_by, approved_at").order("id", { ascending: false }).limit(50),
    db.from("security_cert_audit").select("id, at, plan_id, action, outcome, code, actor").order("id", { ascending: false }).limit(40),
    db.rpc("security_cert_gate_open"),
  ]);
  if (plans.error) throw dbError(plans.error, "security_cert_plans 조회");
  if (audit.error) throw dbError(audit.error, "security_cert_audit 조회");
  if (gate.error) throw dbError(gate.error, "security_cert_gate_open");
  return { plans: (plans.data ?? []) as CertPlanRow[], audit: (audit.data ?? []) as CertAuditRow[], gateOpen: gate.data === true };
}

/** 기관 결제 화면의 입력 (SEC-02 보안 게이트). 승인된 인증 추진 계획이 있을 때만 true - 없으면 기관 결제 화면·경로는 열지 않는다. 읽기 실패는 false(닫힘) */
export async function institutionCheckoutAllowed(db: SupabaseClient): Promise<boolean> {
  const { data, error } = await db.rpc("security_cert_gate_open");
  return !error && data === true;
}
