import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/server/http";

// 쟁점 지도·쟁점 태그 관리 화면 자료 (W11-d d5). 지도 목록은 상태·서명·개수만 싣는다 - 노드 번호 목록은 상세 화면이 아니라 초안 만들 때 편집자가 직접 넣는 값이다.
export interface GraphRow {
  id: number;
  slug: string;
  version: number;
  hub: string;
  title: string;
  status: "draft" | "in_review" | "signed" | "published" | "retired";
  as_of: string | null;
  drafted_by: string;
  signed_by: string | null;
  signed_at: string | null;
  sheet_ref: string | null;
  published_at: string | null;
  stale_reason: string | null;
  nodeCount: number;
  edgeCount: number;
}
export interface IssueAuditRow {
  id: number;
  at: string;
  subject: "issue_tag" | "case_issue_tag" | "issue_graph";
  target_id: number;
  action: string;
  outcome: "ok" | "refused";
  code: string;
  actor: string;
  detail: string | null;
}
export interface TagRow {
  id: number;
  tag_key: string;
  version: number;
  label: string;
  hub: string;
  synonyms: string[];
  status: "proposed" | "approved" | "retired";
  proposed_by: string;
  approved_at: string | null;
}
export interface CaseTagRow {
  id: number;
  case_id: number;
  issue_tag_id: number;
  tag_key: string;
  status: "proposed" | "approved";
  applied_by: string;
  approved_at: string | null;
}

export async function loadGraphsBoard(db: SupabaseClient): Promise<{ graphs: GraphRow[]; audit: IssueAuditRow[] }> {
  const { data, error } = await db
    .from("issue_graphs")
    .select("id, slug, version, hub, title, status, as_of, drafted_by, signed_by, signed_at, sheet_ref, published_at, stale_reason, nodes, edges")
    .order("id", { ascending: false })
    .limit(200);
  if (error) throw dbError(error, "issue_graphs 조회");
  const graphs = ((data ?? []) as unknown as Array<GraphRow & { nodes: unknown[]; edges: unknown[] }>).map(({ nodes, edges, ...rest }) => ({ ...rest, nodeCount: nodes.length, edgeCount: edges.length }));
  const { data: audit, error: ae } = await db.from("issue_audit").select("id, at, subject, target_id, action, outcome, code, actor, detail").eq("subject", "issue_graph").order("id", { ascending: false }).limit(40);
  if (ae) throw dbError(ae, "issue_audit 조회");
  return { graphs, audit: (audit ?? []) as IssueAuditRow[] };
}

export async function loadTagsBoard(db: SupabaseClient): Promise<{ tags: TagRow[]; caseTags: CaseTagRow[]; audit: IssueAuditRow[] }> {
  const { data, error } = await db.from("issue_tags").select("id, tag_key, version, label, hub, synonyms, status, proposed_by, approved_at").order("id", { ascending: false }).limit(300);
  if (error) throw dbError(error, "issue_tags 조회");
  const { data: ct, error: ce } = await db.from("case_issue_tags").select("id, case_id, issue_tag_id, tag_key, status, applied_by, approved_at").order("id", { ascending: false }).limit(300);
  if (ce) throw dbError(ce, "case_issue_tags 조회");
  const { data: audit, error: ae } = await db.from("issue_audit").select("id, at, subject, target_id, action, outcome, code, actor, detail").in("subject", ["issue_tag", "case_issue_tag"]).order("id", { ascending: false }).limit(40);
  if (ae) throw dbError(ae, "issue_audit 조회");
  return { tags: (data ?? []) as TagRow[], caseTags: (ct ?? []) as CaseTagRow[], audit: (audit ?? []) as IssueAuditRow[] };
}
