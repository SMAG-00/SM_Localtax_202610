import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { POLICY_DOCS, policyBodyToText, readPolicyBody, type PolicyDocKey, type PolicySection } from "@/lib/policy/docs";
import { dbError } from "../http";

// 정책 문서 편집·게시 (W2-e 6.2) — service_role. 부르는 쪽(API·화면)이 접근 판정을 먼저 통과해야 한다. 본문은 감사 로그에 남기지 않는다.
type Db = SupabaseClient;

export interface PolicyVersionRow {
  id: number;
  doc_key: PolicyDocKey;
  version: number;
  status: "draft" | "published" | "superseded";
  body: unknown;
  change_summary: string | null;
  effective_on: string | null;
  published_at: string | null;
  approved_by: string | null;
  approved_on: string | null;
  approval_note: string | null;
  updated_by: string | null;
  updated_at: string;
}

const COLUMNS = "id, doc_key, version, status, body, change_summary, effective_on, published_at, approved_by, approved_on, approval_note, updated_by, updated_at";

export async function listVersions(db: Db, docKey?: PolicyDocKey): Promise<PolicyVersionRow[]> {
  let q = db.from("policy_versions").select(COLUMNS).order("doc_key").order("version", { ascending: false });
  if (docKey) q = q.eq("doc_key", docKey);
  const { data, error } = await q;
  if (error) throw dbError(error, "정책 문서 목록");
  return (data ?? []) as PolicyVersionRow[];
}

export interface PolicySummary {
  docKey: PolicyDocKey;
  label: string;
  featureKey: string;
  featureOn: boolean;
  publishedVersion: number | null;
  publishedAt: string | null;
  effectiveOn: string | null;
  hasDraft: boolean;
  draftText: string;
  draftVersion: number | null;
  draftEffectiveOn: string | null;
  publishable: boolean;
}

export function summarize(rows: readonly PolicyVersionRow[], flags: Record<string, boolean>): PolicySummary[] {
  return POLICY_DOCS.map((d) => {
    const mine = rows.filter((r) => r.doc_key === d.key);
    const pub = mine.find((r) => r.status === "published");
    const draft = mine.find((r) => r.status === "draft");
    return {
      docKey: d.key,
      label: d.label,
      featureKey: d.feature,
      featureOn: flags[d.feature] === true,
      publishedVersion: pub?.version ?? null,
      publishedAt: pub?.published_at ?? null,
      effectiveOn: pub?.effective_on ?? null,
      hasDraft: !!draft,
      draftText: draft ? policyBodyToText(readPolicyBody(draft.body)) : "",
      draftVersion: draft?.version ?? null,
      draftEffectiveOn: draft?.effective_on ?? null,
      publishable: !!pub,
    };
  });
}

/** 초안 저장 — 초안이 있으면 고치고, 없으면 다음 버전 번호로 새로 만든다 */
export async function saveDraft(db: Db, docKey: PolicyDocKey, body: PolicySection[], effectiveOn: string | null, actor: string): Promise<PolicyVersionRow> {
  const rows = await listVersions(db, docKey);
  const draft = rows.find((r) => r.status === "draft");
  if (draft) {
    const { data, error } = await db.from("policy_versions").update({ body, effective_on: effectiveOn, updated_by: actor }).eq("id", draft.id).eq("status", "draft").select(COLUMNS);
    if (error) throw dbError(error, "정책 초안 저장");
    return (data as PolicyVersionRow[])[0]!;
  }
  const version = Math.max(0, ...rows.map((r) => r.version)) + 1;
  const { data, error } = await db.from("policy_versions").insert({ doc_key: docKey, version, status: "draft", body, effective_on: effectiveOn, updated_by: actor }).select(COLUMNS);
  if (error) throw dbError(error, "정책 초안 만들기");
  return (data as PolicyVersionRow[])[0]!;
}

export interface PublishInput {
  version: number;
  approvedBy: string;
  approvedOn: string;
  approvalNote: string;
  changeSummary: string | null;
  effectiveOn: string | null;
}

/** 게시 — DB 함수가 이전 게시본 내림과 새 게시를 한 번에 한다. 승인 기록이 없으면 DB check가 거부한다(23514) */
export async function publishDraft(db: Db, docKey: PolicyDocKey, input: PublishInput, actor: string): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const { error } = await db.rpc("policy_publish", {
    p_doc_key: docKey,
    p_version: input.version,
    p_approved_by: input.approvedBy,
    p_approved_on: input.approvedOn,
    p_approval_note: input.approvalNote,
    p_change_summary: input.changeSummary,
    p_effective_on: input.effectiveOn,
    p_updated_by: actor,
  });
  if (!error) return { ok: true };
  if (error.code === "23514" || error.code === "P0002") return { ok: false, code: error.code, message: error.message };
  throw dbError(error, "정책 게시");
}
