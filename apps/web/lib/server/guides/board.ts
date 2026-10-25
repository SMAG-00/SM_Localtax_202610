import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/server/http";

// 감수 가이드 관리 화면 자료 (W11-a a6). 본문(절·사실값)은 싣지 않는다 - 목록은 상태·서명·출처만.
export interface GuideVersionRow {
  id: number;
  guide_id: number;
  version: number;
  status: "draft" | "reviewed" | "published" | "retired";
  title: string;
  tax_scope: "local" | "national" | "both";
  as_of: string | null;
  import_origin: string | null;
  created_at: string;
  signed_by: string | null;
  signed_at: string | null;
  sheet_ref: string | null;
  published_at: string | null;
  guides: { hub: string; topic: string; slug: string } | null;
}
export interface GuideAuditRow {
  id: number;
  at: string;
  guide_version_id: number;
  action: "sign" | "publish";
  outcome: "ok" | "refused";
  code: string;
  actor: string;
  detail: string | null;
}

export async function loadGuidesBoard(db: SupabaseClient): Promise<{ versions: GuideVersionRow[]; audit: GuideAuditRow[] }> {
  const { data, error } = await db
    .from("guide_versions")
    .select("id, guide_id, version, status, title, tax_scope, as_of, import_origin, created_at, signed_by, signed_at, sheet_ref, published_at, guides(hub, topic, slug)")
    .order("id", { ascending: false })
    .limit(200);
  if (error) throw dbError(error, "guide_versions 조회");
  const { data: audit, error: ae } = await db
    .from("guides_audit")
    .select("id, at, guide_version_id, action, outcome, code, actor, detail")
    .order("id", { ascending: false })
    .limit(40);
  if (ae) throw dbError(ae, "guides_audit 조회");
  return { versions: (data ?? []) as unknown as GuideVersionRow[], audit: (audit ?? []) as GuideAuditRow[] };
}
