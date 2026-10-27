import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { absolute } from "@/lib/server/articles/mapping";
import { siteUrl } from "@/lib/server/env";
import { HttpError, dbError } from "@/lib/server/http";

// 사진 보관함 읽기·화면 모양 (F1) — media 표를 service_role로 읽는다. 쓰기는 app/api/admin/media/** 가 접근 판정 뒤에 한다.

export const MEDIA_COLUMNS = "id, path, alt, credit, photographer, license, source_url, checked_at, kind, rights_status, created_at, width, height, license_type, license_cleared";

export interface MediaRow {
  id: number;
  path: string;
  alt: string | null;
  credit: string | null;
  photographer: string | null;
  license: string | null;
  source_url: string | null;
  checked_at: string | null;
  kind: string;
  rights_status: string;
  created_at: string;
  width: number | null;
  height: number | null;
  license_type: string | null;
  license_cleared: boolean;
}

/** 응답·화면 모양 — 저장 경로와 그릴 수 있는 주소(url)를 함께 */
export function mediaView(row: MediaRow) {
  return { ...row, id: Number(row.id), url: absolute(siteUrl(), row.path) };
}
export type MediaView = ReturnType<typeof mediaView>;

export async function loadMediaRow(db: SupabaseClient, id: number): Promise<MediaRow> {
  const { data, error } = await db.from("media").select(MEDIA_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw dbError(error, "media 읽기");
  if (!data) throw new HttpError(404, "사진을 찾을 수 없습니다");
  return data as unknown as MediaRow;
}

export async function listMediaRows(db: SupabaseClient, opts: { rights?: string | null; limit?: number } = {}): Promise<MediaRow[]> {
  let q = db.from("media").select(MEDIA_COLUMNS).order("id", { ascending: false }).limit(opts.limit ?? 200);
  if (opts.rights) q = q.eq("rights_status", opts.rights);
  const { data, error } = await q;
  if (error) throw dbError(error, "media 목록");
  return (data ?? []) as unknown as MediaRow[];
}
