import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { groupRegionalDesk, type RegionalDeskRow } from "@/lib/admin/regional-rules";
import { dbError } from "../http";

// /admin/regions 판정판 읽기 (W4 8단계 — PRD-01B REG1-14·17, docs/dev/W4_설계.md 5장 관리자 `/admin/regions` · 6장 regional.judge)
//  · 별도 상품 검토 큐 — 열린 항목 전부(오래된 것부터) + 최근 닫힌 20건, 원고 제목·상태를 붙인다
//  · 편집 분야 승인 대기·보류 — 공개 전 지역 기사(지역 태그 또는 지자체뉴스, 광고·협찬 제외) 최근 100건을 편집 승인 상태로 나눈다
// 관리 API(GET /api/admin/regions)와 관리 화면이 같은 함수를 쓴다. 공개 화면은 이 표를 읽지 않는다(큐 원고는 DB가 공개를 막는다).

export interface QueueItem {
  id: number;
  article_id: number;
  judgement: string;
  judged_by: string;
  at: string;
  status: string;
  note: string | null;
  closed_by: string | null;
  closed_at: string | null;
}

export interface QueueItemView extends QueueItem {
  article: { id: number; title: string; slug: string; status: string; content_type: string | null } | null;
}

export interface RegionsBoard {
  open: QueueItemView[];
  closed: QueueItemView[];
  awaiting: RegionalDeskRow[];
  held: RegionalDeskRow[];
}

export const QUEUE_COLUMNS = "id, article_id, judgement, judged_by, at, status, note, closed_by, closed_at";
const DESK_COLUMNS = "id, title, status, editorial_status, editorial_field, editorial_judgement, updated_at";
const DESK_LIMIT = 100;
const CLOSED_LIMIT = 20;

export async function loadRegionsBoard(db: SupabaseClient): Promise<RegionsBoard> {
  const [open, closed, desk] = await Promise.all([
    db.from("separate_product_queue").select(QUEUE_COLUMNS).eq("status", "open").order("at").order("id"),
    db.from("separate_product_queue").select(QUEUE_COLUMNS).eq("status", "closed").order("closed_at", { ascending: false }).limit(CLOSED_LIMIT),
    db
      .from("articles")
      .select(DESK_COLUMNS)
      .not("status", "in", "(published,scheduled,deleted)")
      .or("section.eq.local,region_codes.neq.{}")
      .or("content_type.is.null,content_type.neq.sponsored")
      .order("updated_at", { ascending: false })
      .limit(DESK_LIMIT),
  ]);
  if (open.error) throw dbError(open.error, "separate_product_queue 열린 항목");
  if (closed.error) throw dbError(closed.error, "separate_product_queue 닫힌 항목");
  if (desk.error) throw dbError(desk.error, "articles 지역 기사");
  const openRows = (open.data ?? []) as QueueItem[];
  const closedRows = (closed.data ?? []) as QueueItem[];
  const ids = [...new Set([...openRows, ...closedRows].map((r) => Number(r.article_id)))];
  const articles = ids.length ? await db.from("articles").select("id, title, slug, status, content_type").in("id", ids) : { data: [], error: null };
  if (articles.error) throw dbError(articles.error, "articles 큐 원고");
  const byId = new Map(((articles.data ?? []) as NonNullable<QueueItemView["article"]>[]).map((a) => [Number(a.id), a]));
  const view = (r: QueueItem): QueueItemView => ({ ...r, article: byId.get(Number(r.article_id)) ?? null });
  const { awaiting, held } = groupRegionalDesk((desk.data ?? []) as RegionalDeskRow[], new Set(openRows.map((r) => Number(r.article_id))));
  return { open: openRows.map(view), closed: closedRows.map(view), awaiting, held };
}
