import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/server/http";
import type { GateRow } from "@/lib/accuracy/gate";
import { RULE_KINDS, RULE_KIND_TABLE, type RuleKind } from "@/lib/accuracy/input";

// 룰셋·정확도 관리 화면이 읽는 자료 (W10-a a6). 본문(body)·사례 입력(case_input)은 목록에 싣지 않는다 - 크고, 사례 입력은 화면에 되풀이할 이유가 없다.

export interface RuleVersionRow {
  id: number;
  kind: RuleKind;
  /** 판정표만: refund·reduction */
  table_kind: string | null;
  version: string;
  status: "draft" | "reviewed" | "active" | "retired";
  source_ref: string;
  basis_event_id: number | null;
  basis_note: string | null;
  created_by: string;
  created_at: string;
  signed_by: string | null;
  signed_at: string | null;
  sheet_ref: string | null;
  activated_by: string | null;
  activated_at: string | null;
  retired_at: string | null;
}

export interface RulesAuditRow {
  id: number;
  at: string;
  kind: string;
  target_id: number;
  version: string | null;
  action: string;
  outcome: string;
  code: string;
  actor: string;
  basis_event_id: number | null;
  detail: string | null;
}

const COLUMNS = "id, version, status, source_ref, basis_event_id, basis_note, created_by, created_at, signed_by, signed_at, sheet_ref, activated_by, activated_at, retired_at";

export async function loadGateRows(db: SupabaseClient): Promise<GateRow[]> {
  const { data, error } = await db.from("calc_gate_status").select("*").order("tax_kind").order("cause_group");
  if (error) throw dbError(error, "calc_gate_status 조회");
  return (data ?? []) as GateRow[];
}

export async function loadRulesBoard(db: SupabaseClient) {
  const versions: RuleVersionRow[] = [];
  for (const kind of RULE_KINDS) {
    const { data, error } = await db
      .from(RULE_KIND_TABLE[kind])
      .select(kind === "determination_table" ? `${COLUMNS}, kind` : COLUMNS)
      .order("version", { ascending: false })
      .limit(100);
    if (error) throw dbError(error, `${RULE_KIND_TABLE[kind]} 조회`);
    for (const r of (data ?? []) as unknown as (Omit<RuleVersionRow, "kind" | "table_kind"> & { kind?: string })[]) {
      const { kind: tableKind, ...rest } = r;
      versions.push({ ...rest, kind, table_kind: tableKind ?? null });
    }
  }
  const { data: audit, error: ae } = await db
    .from("rules_audit")
    .select("id, at, kind, target_id, version, action, outcome, code, actor, basis_event_id, detail")
    .order("id", { ascending: false })
    .limit(40);
  if (ae) throw dbError(ae, "rules_audit 조회");
  return { versions, audit: (audit ?? []) as RulesAuditRow[] };
}

export interface CaseSummary {
  id: number;
  case_key: string;
  tax_kind: string;
  cause: string | null;
  sample_kind: string;
  official_basis: string;
  official_total: number;
  synthetic: boolean;
  mismatch_cause: string | null;
  mismatch_note: string | null;
  entered_by: string;
  entered_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  retired_at: string | null;
}

export interface RunSummary {
  id: number;
  ruleset_version: string;
  engine_hash: string;
  status: string;
  triggered_by: string;
  case_count: number;
  matched_count: number;
  run_at: string;
}

export async function loadAccuracyBoard(db: SupabaseClient) {
  const gate = await loadGateRows(db);
  const { data: cases, error: ce } = await db
    .from("accuracy_cases")
    .select("id, case_key, tax_kind, cause, sample_kind, official_basis, official_total, synthetic, mismatch_cause, mismatch_note, entered_by, entered_at, confirmed_by, confirmed_at, retired_at")
    .order("id", { ascending: false })
    .limit(300);
  if (ce) throw dbError(ce, "accuracy_cases 조회");
  const { data: runs, error: re } = await db
    .from("accuracy_runs")
    .select("id, ruleset_version, engine_hash, status, triggered_by, case_count, matched_count, run_at")
    .order("id", { ascending: false })
    .limit(10);
  if (re) throw dbError(re, "accuracy_runs 조회");
  return { gate, cases: (cases ?? []) as CaseSummary[], runs: (runs ?? []) as RunSummary[] };
}
