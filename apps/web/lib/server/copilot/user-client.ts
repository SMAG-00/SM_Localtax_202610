import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl } from "@/lib/server/env";
import { cookieSessionClient } from "@/lib/server/session";

// 로그인한 본인 권한으로 읽는 클라이언트 (W13-e) - agent_search가 auth.uid()로 프리미엄 등급을 정하므로 service role이 아니라 본인 세션으로 부른다.

export async function userScopedClient(request: Request): Promise<SupabaseClient | null> {
  const header = request.headers.get("authorization");
  if (header === null) return cookieSessionClient().catch(() => null);
  const m = header.match(/^Bearer\s+(\S+)$/);
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!m || !url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${m[1]}` } } });
}
