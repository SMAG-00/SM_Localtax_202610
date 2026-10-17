import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseServiceRoleKey, supabaseUrl } from "./env";

const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/** 공개 키 클라이언트 — RLS가 그대로 적용된다 */
export function anonClient(): SupabaseClient | null {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  return url && key ? createClient(url, key, OPTIONS) : null;
}

/** service role 클라이언트 — 서버 작업(배치 기록·감사 로그)만. AI 도우미(packages/assistant)는 쓰지 않는다 (ENV-03) */
export function adminClient(): SupabaseClient | null {
  const url = supabaseUrl();
  const key = supabaseServiceRoleKey();
  return url && key ? createClient(url, key, OPTIONS) : null;
}
