import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/server/http";

// 채널 배포 키트 관리 화면 자료 (W12-h h4). service_role로 읽는다 - 관리자 화면 전용.
export interface ChannelDraftRow {
  id: number;
  title: string;
  status: string;
  article_id: number | null;
  channel: string | null;
  posted_url: string | null;
  posted_at: string | null;
}
export interface ChannelAuditRow {
  id: number;
  at: string;
  review_item_id: number | null;
  action: string;
  outcome: string;
  code: string;
  actor: string;
}
export interface ChannelBoard {
  drafts: ChannelDraftRow[];
  audit: ChannelAuditRow[];
}

export async function loadChannelBoard(db: SupabaseClient): Promise<ChannelBoard> {
  const r = await db.from("review_items").select("id, title, status, payload").eq("kind", "channel_draft").order("id", { ascending: false }).limit(100);
  if (r.error) throw dbError(r.error, "채널 원고 조회");
  const items = (r.data ?? []) as { id: number; title: string; status: string; payload: { articleId?: number; channel?: string } | null }[];
  const p = await db.from("channel_posts").select("review_item_id, posted_url, posted_at").in("review_item_id", items.length > 0 ? items.map((i) => i.id) : [0]);
  if (p.error) throw dbError(p.error, "channel_posts 조회");
  const posted = new Map(((p.data ?? []) as { review_item_id: number; posted_url: string; posted_at: string }[]).map((x) => [x.review_item_id, x]));
  const drafts = items.map((i) => ({ id: i.id, title: i.title, status: i.status, article_id: i.payload?.articleId ?? null, channel: i.payload?.channel ?? null, posted_url: posted.get(i.id)?.posted_url ?? null, posted_at: posted.get(i.id)?.posted_at ?? null }));
  const a = await db.from("channel_audit").select("id, at, review_item_id, action, outcome, code, actor").order("id", { ascending: false }).limit(40);
  if (a.error) throw dbError(a.error, "channel_audit 조회");
  return { drafts, audit: (a.data ?? []) as ChannelAuditRow[] };
}
