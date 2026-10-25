import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransitionInput } from "@/lib/review/rules";
import { HttpError } from "../http";

// 공통 검수 큐 서버 기능 (W10-c — REV-01~03). 상태 판정은 전부 DB 함수(review_item_transition·review_item_assign)가 하고,
// 여기는 호출·오류 번역·화면용 읽기뿐이다. 후보 내용(payload)은 구조화된 요약이고, 원문 글자는 스냅샷에서 앞부분만 보여 준다(검수자가 비교하려고).

export interface ReviewRow {
  id: number;
  kind: string;
  source_key: string;
  title: string;
  data_source_key: string | null;
  snapshot_id: number | null;
  payload: Record<string, unknown>;
  parts: string[];
  required_checks: string[];
  checked_keys: string[];
  approved_parts: string[] | null;
  status: string;
  attempts: number;
  last_error: string | null;
  reject_reason: string | null;
  assignee: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_by: string;
  created_at: string;
  status_changed_at: string;
}

export const REVIEW_COLUMNS =
  "id, kind, source_key, title, data_source_key, snapshot_id, payload, parts, required_checks, checked_keys, approved_parts, status, attempts, last_error, reject_reason, assignee, decided_by, decided_at, created_by, created_at, status_changed_at";

/** 원문 앞부분만 — 검수 화면의 '원문' 칸 (스냅샷 전체 글자는 DB에 남는다) */
export const ORIGINAL_EXCERPT_CHARS = 3000;

export async function listReviewItems(db: SupabaseClient, opts: { kind?: string; status?: string } = {}) {
  let open = db.from("review_items").select(REVIEW_COLUMNS).in("status", ["drafted", "in_review", "approved", "failed"]).order("status_changed_at").order("id").limit(300);
  if (opts.kind) open = open.eq("kind", opts.kind);
  if (opts.status) open = open.eq("status", opts.status);
  const done = db.from("review_items").select(REVIEW_COLUMNS).in("status", ["published", "rejected"]).order("decided_at", { ascending: false }).limit(20);
  const [o, d] = await Promise.all([open, done]);
  if (o.error) throw new HttpError(500, `review_items 조회 실패: ${o.error.message}`);
  if (d.error) throw new HttpError(500, `review_items 조회 실패: ${d.error.message}`);
  return { open: (o.data ?? []) as unknown as ReviewRow[], done: (d.data ?? []) as unknown as ReviewRow[] };
}

export async function getReviewDetail(db: SupabaseClient, id: number) {
  const item = await db.from("review_items").select(REVIEW_COLUMNS).eq("id", id).limit(1);
  if (item.error) throw new HttpError(500, `review_items 조회 실패: ${item.error.message}`);
  const row = (item.data?.[0] as unknown as ReviewRow | undefined) ?? null;
  if (!row) throw new HttpError(404, "그런 검수 항목이 없습니다");
  const events = await db.from("review_item_events").select("id, action, from_status, to_status, actor, note, at").eq("item_id", id).order("id");
  if (events.error) throw new HttpError(500, `review_item_events 조회 실패: ${events.error.message}`);
  let original: { hash: string; url: string; fetchedAt: string; excerpt: string; truncated: boolean } | null = null;
  if (row.snapshot_id !== null) {
    const snap = await db.from("raw_snapshots").select("url, fetched_at, content_hash, payload").eq("id", row.snapshot_id).limit(1);
    if (snap.error) throw new HttpError(500, `raw_snapshots 조회 실패: ${snap.error.message}`);
    const s = snap.data?.[0] as { url: string; fetched_at: string; content_hash: string; payload: string } | undefined;
    if (s) original = { hash: s.content_hash, url: s.url, fetchedAt: s.fetched_at, excerpt: s.payload.slice(0, ORIGINAL_EXCERPT_CHARS), truncated: s.payload.length > ORIGINAL_EXCERPT_CHARS };
  }
  return { item: row, events: events.data ?? [], original };
}

/** DB 함수 오류 → HTTP: 허용 밖 전이·체크 누락·사유 없음·재시도 초과 = 422(메시지는 DB가 쓴 처리 안내), 없는 항목 404 */
function translate(error: { code?: string; message: string }): HttpError {
  if (error.code === "23514" || error.code === "42501") return new HttpError(422, "입력값을 확인하세요", { errors: [error.message] });
  if (error.code === "P0002") return new HttpError(404, "그런 검수 항목이 없습니다");
  console.error("[review] DB 함수 오류:", error.code, error.message);
  return new HttpError(500, "서버 오류가 났습니다 — 잠시 뒤 다시 시도하세요");
}

export async function transitionReviewItem(db: SupabaseClient, input: TransitionInput, actor: string): Promise<ReviewRow> {
  const r = await db.rpc("review_item_transition", {
    p_id: input.id, p_to: input.to, p_actor: actor, p_reason: input.reason, p_checked: input.to === "approved" ? input.checked : null, p_parts: input.parts,
  });
  if (r.error) throw translate(r.error);
  return r.data as unknown as ReviewRow;
}

export async function assignReviewItem(db: SupabaseClient, id: number, assignee: string, actor: string): Promise<ReviewRow> {
  const r = await db.rpc("review_item_assign", { p_id: id, p_assignee: assignee, p_actor: actor });
  if (r.error) throw translate(r.error);
  return r.data as unknown as ReviewRow;
}
