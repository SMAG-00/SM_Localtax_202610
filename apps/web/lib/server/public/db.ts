import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonClient } from "../supabase";
import { publicDataFetch } from "./cache";

// 공개 데이터 함수의 DB 접근 — anon 키(RLS가 경계)로만 읽는다 (docs/dev/W2-b_설계.md 4장). service_role은 쓰지 않는다:
// 함수에 필터를 하나 빠뜨려도 초안·비공개 행·내부 칸이 새지 않게 (FND-04 심층 방어).
// 응답은 Next.js 데이터 캐시에 30초까지 둔다 — 편집국 쓰기는 바로 만료한다 (cache-policy.ts, 설계 7.1).

export class PublicDataError extends Error {
  constructor(
    readonly context: string,
    readonly code?: string,
  ) {
    super(`공개 데이터를 읽지 못했습니다 (${context})`);
    this.name = "PublicDataError";
  }
}

export function publicDb(): SupabaseClient {
  const db = anonClient({ fetch: publicDataFetch });
  if (!db) throw new PublicDataError("서버 설정 — NEXT_PUBLIC_SUPABASE_URL·NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return db;
}

type Res = { data: unknown; error: { code?: string; message?: string } | null; count?: number | null };

/** PostgREST 결과 → 행 목록. 오류면 PublicDataError (원문 오류는 서버 로그에만) */
export async function rowsOf<T>(query: PromiseLike<Res>, context: string): Promise<T[]> {
  const { data, error } = await query;
  if (error) {
    console.error(`[public] ${context}:`, error.code, error.message);
    throw new PublicDataError(context, error.code);
  }
  return (data ?? []) as T[];
}

/** 행 목록과 전체 수 (select(..., { count: "exact" })) */
export async function pageOf<T>(query: PromiseLike<Res>, context: string): Promise<{ rows: T[]; total: number }> {
  const res = await query;
  if (res.error) {
    console.error(`[public] ${context}:`, res.error.code, res.error.message);
    throw new PublicDataError(context, res.error.code);
  }
  return { rows: (res.data ?? []) as T[], total: res.count ?? 0 };
}
