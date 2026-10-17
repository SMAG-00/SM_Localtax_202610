import "server-only";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authCookieOptions, isHttps } from "./cookie-options";
import { supabaseAnonKey, supabaseUrl } from "./env";
import { HttpError } from "./http";

// 편집국 로그인 세션 — @supabase/ssr 쿠키 세션 클라이언트(공개 키). 로그인·로그아웃 라우트와 DAL(lib/server/dal.ts)이 쓴다.
// 라우트 처리기에서는 새 토큰을 응답 쿠키에 쓰고, 서버 컴포넌트 렌더 중에는 쿠키를 쓸 수 없으므로 조용히 넘긴다
// (화면 경로의 세션 갱신은 proxy.ts가 한다).

export async function cookieSessionClient(): Promise<SupabaseClient> {
  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  if (!url || !anonKey) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const [store, headerList] = await Promise.all([cookies(), headers()]);
  return createServerClient(url, anonKey, {
    cookieOptions: authCookieOptions(isHttps(headerList)),
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // 서버 컴포넌트 렌더 중 — 쿠키를 쓸 수 없다
        }
      },
    },
  });
}
