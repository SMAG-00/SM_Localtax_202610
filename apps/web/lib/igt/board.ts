import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/server/http";

// 상속·증여세 감수 화면이 읽는 자료 (FAM-12) - 본문(body)·사례 입력(case_input)은 목록에 싣지 않는다.

export interface IgtVersionRow {
  id: number;
  version: string;
  status: "draft" | "reviewed" | "active" | "retired";
  source_ref: string;
  basis_note: string | null;
  created_by: string;
  created_at: string;
  signed_by: string | null;
  signed_at: string | null;
  sheet_ref: string | null;
  activated_by: string | null;
  activated_at: string | null;
}
export interface IgtAuditRow {
  id: number;
  at: string;
  version: string | null;
  action: "sign" | "approve";
  outcome: "ok" | "refused";
  code: string;
  actor: string;
  detail: string | null;
}
export interface IgtGateLine {
  tax_kind: "gift" | "inheritance";
  ruleset_version: string | null;
  engine_hash: string | null;
  run_at: string | null;
  official_cases: number;
  official_matched: number;
  sample_cases: number;
  sample_matched: number;
  is_open: boolean;
}
export interface IgtCaseLine {
  id: number;
  case_key: string;
  tax_kind: "gift" | "inheritance";
  sample_kind: "official" | "review_sample";
  synthetic: boolean;
  confirmed_at: string | null;
  retired_at: string | null;
  mismatch_cause: string | null;
}
export interface IgtBoard {
  versions: IgtVersionRow[];
  audit: IgtAuditRow[];
  gate: IgtGateLine[];
  cases: IgtCaseLine[];
}

export async function loadIgtBoard(db: SupabaseClient): Promise<IgtBoard> {
  const [v, a, g, c] = await Promise.all([
    db.from("igt_rulesets").select("id, version, status, source_ref, basis_note, created_by, created_at, signed_by, signed_at, sheet_ref, activated_by, activated_at").order("id", { ascending: false }).limit(50),
    db.from("rules_audit").select("id, at, version, action, outcome, code, actor, detail").eq("kind", "igt_ruleset").order("id", { ascending: false }).limit(40),
    db.from("calc_gate_status").select("tax_kind, ruleset_version, engine_hash, run_at, official_cases, official_matched, sample_cases, sample_matched, is_open").in("tax_kind", ["gift", "inheritance"]),
    db.from("accuracy_cases").select("id, case_key, tax_kind, sample_kind, synthetic, confirmed_at, retired_at, mismatch_cause").in("tax_kind", ["gift", "inheritance"]).order("id", { ascending: false }).limit(200),
  ]);
  if (v.error) throw dbError(v.error, "igt_rulesets 조회");
  if (a.error) throw dbError(a.error, "rules_audit 조회");
  if (g.error) throw dbError(g.error, "calc_gate_status 조회");
  if (c.error) throw dbError(c.error, "accuracy_cases 조회");
  return { versions: v.data as IgtVersionRow[], audit: a.data as IgtAuditRow[], gate: g.data as IgtGateLine[], cases: c.data as IgtCaseLine[] };
}
