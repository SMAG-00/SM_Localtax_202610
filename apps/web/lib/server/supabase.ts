import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseServiceRoleKey, supabaseUrl } from "./env";

const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/** 공개 키 클라이언트 — RLS가 그대로 적용된다. fetch를 넘기면 그 함수로 요청한다 (공개 데이터의 캐시 — lib/server/public/cache.ts) */
export function anonClient(options: { fetch?: typeof fetch } = {}): SupabaseClient | null {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) return null;
  return createClient(url, key, options.fetch ? { ...OPTIONS, global: { fetch: options.fetch } } : OPTIONS);
}

/** service role 클라이언트 — 서버 작업(배치 기록·감사 로그)만. AI 도우미(packages/assistant)는 쓰지 않는다 (ENV-03) */
export function adminClient(): SupabaseClient | null {
  const url = supabaseUrl();
  const key = supabaseServiceRoleKey();
  return url && key ? createClient(url, key, OPTIONS) : null;
}
