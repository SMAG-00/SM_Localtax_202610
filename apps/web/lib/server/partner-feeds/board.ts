import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/server/http";

// 제휴 피드·라이선스 관리 화면 자료 (W13-i). service_role로 읽는 관리자 화면 전용. 키 해시·원문 칸은 읽지 않는다.
export interface FeedRow { id: number; partner_id: number; contract_id: number; scope: string; issued_at: string; revoked_at: string | null }
export interface UsageRow { id: number; feed_id: number; at: string; response_code: number; item_count: number }
export interface ContractRow { id: number; counterparty: string; kind: string; scope: string; period_start: string; period_end: string; settlement_terms: string | null; rights_ref: string | null; allows_full: boolean; status: string }
export interface ManuscriptRow { id: number; article_id: number; contract_id: number; status: string; posted_url: string | null }

async function rows<T>(q: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>, ctx: string): Promise<T[]> {
  const r = await q;
  if (r.error) throw dbError(r.error, ctx);
  return (r.data ?? []) as T[];
}

export async function loadFeedBoard(db: SupabaseClient) {
  const [feeds, usage, contracts] = await Promise.all([
    rows<FeedRow>(db.from("partner_feeds").select("id, partner_id, contract_id, scope, issued_at, revoked_at").order("id", { ascending: false }).limit(100), "partner_feeds 조회"),
    rows<UsageRow>(db.from("partner_feed_usage").select("id, feed_id, at, response_code, item_count").order("id", { ascending: false }).limit(40), "partner_feed_usage 조회"),
    rows<ContractRow>(db.from("license_contracts").select("id, counterparty, kind, scope, period_start, period_end, settlement_terms, rights_ref, allows_full, status").eq("kind", "data_license").order("id", { ascending: false }).limit(50), "license_contracts 조회"),
  ]);
  return { feeds, usage, contracts };
}

export async function loadLicenseBoard(db: SupabaseClient) {
  const [contracts, manuscripts] = await Promise.all([
    rows<ContractRow>(db.from("license_contracts").select("id, counterparty, kind, scope, period_start, period_end, settlement_terms, rights_ref, allows_full, status").order("id", { ascending: false }).limit(100), "license_contracts 조회"),
    rows<ManuscriptRow>(db.from("naver_series_manuscripts").select("id, article_id, contract_id, status, posted_url").order("id", { ascending: false }).limit(100), "naver_series_manuscripts 조회"),
  ]);
  return { contracts, manuscripts };
}
