import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/server/http";

// 편집국 AI 관리 화면 자료 (W12-f). 초안·제안·AI 태그 후보·최근 감사. 공개 뷰가 아니라 서버 키로 읽는다.
export interface SummaryRow {
  id: number;
  case_id: number;
  summary_lines: string[];
  result_type: string;
  popularity: number;
  status: string;
  review_item_id: number | null;
  model: string;
  created_at: string;
  warnings: string[];
  docNo: string | null;
  decidedOn: string | null;
  newTagCandidates: { label: string; reason: string }[];
}
export interface AiTagRow { id: number; case_id: number; tag_key: string; status: string; origin: string }
export interface BoxRow { id: number; article_id: number; article_version: number; three_lines: string[]; meaning: string; status: string; review_item_id: number | null; created_at: string; warnings: string[] }
export interface BannerRow { id: number; article_id: number; law_event_id: number; change: string; note: string | null; status: string; created_at: string }
export interface ChannelRow { id: number; title: string; status: string; payload: { channel?: string; length?: number; limit?: number; text?: string; warnings?: string[] } }
export interface AuditRow { id: number; at: string; subject: string; target_id: number; action: string; outcome: string; code: string; actor: string }

async function payloadsOf(db: SupabaseClient, ids: number[]): Promise<Map<number, Record<string, unknown>>> {
  const map = new Map<number, Record<string, unknown>>();
  if (ids.length === 0) return map;
  const it = await db.from("review_items").select("id, payload").in("id", ids);
  if (it.error) throw dbError(it.error, "review_items 조회");
  for (const r of (it.data ?? []) as { id: number; payload: Record<string, unknown> }[]) map.set(r.id, r.payload);
  return map;
}
const idsOf = (rows: { review_item_id: number | null }[]) => rows.map((r) => r.review_item_id).filter((x): x is number => x !== null);

export async function loadDeskBoard(db: SupabaseClient) {
  const sums = await db.from("case_summaries").select("id, case_id, summary_lines, result_type, popularity, status, review_item_id, model, created_at").order("id", { ascending: false }).limit(100);
  if (sums.error) throw dbError(sums.error, "case_summaries 조회");
  const sumRows = (sums.data ?? []) as Omit<SummaryRow, "warnings" | "docNo" | "decidedOn" | "newTagCandidates">[];
  const sumPayloads = await payloadsOf(db, idsOf(sumRows));
  const summaries: SummaryRow[] = sumRows.map((s) => {
    const p = (s.review_item_id !== null ? sumPayloads.get(s.review_item_id) : undefined) ?? {};
    const facts = (p.facts ?? {}) as { docNo?: string; decidedOn?: string };
    return { ...s, warnings: (p.warnings as string[]) ?? [], docNo: facts.docNo ?? null, decidedOn: facts.decidedOn ?? null, newTagCandidates: (p.newTagCandidates as SummaryRow["newTagCandidates"]) ?? [] };
  });
  const tags = await db.from("case_issue_tags").select("id, case_id, tag_key, status, origin").eq("origin", "ai").order("id", { ascending: false }).limit(100);
  if (tags.error) throw dbError(tags.error, "case_issue_tags 조회");
  const boxes = await db.from("article_ai_boxes").select("id, article_id, article_version, three_lines, meaning, status, review_item_id, created_at").order("id", { ascending: false }).limit(100);
  if (boxes.error) throw dbError(boxes.error, "article_ai_boxes 조회");
  const boxData = (boxes.data ?? []) as Omit<BoxRow, "warnings">[];
  const boxPayloads = await payloadsOf(db, idsOf(boxData));
  const boxRows: BoxRow[] = boxData.map((b) => ({ ...b, warnings: ((b.review_item_id !== null ? boxPayloads.get(b.review_item_id) : undefined)?.warnings as string[]) ?? [] }));
  const banners = await db.from("impact_banners").select("id, article_id, law_event_id, change, note, status, created_at").order("id", { ascending: false }).limit(100);
  if (banners.error) throw dbError(banners.error, "impact_banners 조회");
  const channels = await db.from("review_items").select("id, title, status, payload").eq("kind", "channel_draft").order("id", { ascending: false }).limit(60);
  if (channels.error) throw dbError(channels.error, "채널 원고 조회");
  const audit = await db.from("issue_audit").select("id, at, subject, target_id, action, outcome, code, actor").in("subject", ["case_summary", "article_ai_box", "impact_banner"]).order("id", { ascending: false }).limit(40);
  if (audit.error) throw dbError(audit.error, "issue_audit 조회");
  return {
    summaries,
    aiTags: (tags.data ?? []) as AiTagRow[],
    boxes: boxRows,
    banners: (banners.data ?? []) as BannerRow[],
    channels: (channels.data ?? []) as ChannelRow[],
    audit: (audit.data ?? []) as AuditRow[],
  };
}
