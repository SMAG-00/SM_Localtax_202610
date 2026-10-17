import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { ADMIN_PATH_HEADER } from "@/lib/admin/headers";
import { adminProxyDecision, hasAuthCookie } from "@/lib/admin/proxy-rules";
import { authCookieOptions, isHttps } from "@/lib/server/cookie-options";

// 백오피스 화면 경로(/admin/…) 막기 — 낙관적 확인 (Next.js 인증 안내 "Optimistic checks with Proxy").
//  · 로그인 쿠키가 없으면 로그인 화면으로 (돌아올 주소 next 포함). 로그인 화면은 그대로 둔다.
//  · 쿠키가 있으면 세션을 읽어 만료된 토큰만 새로 받아 쿠키에 쓴다(DB 조회 없음). 세션을 못 읽으면 로그인 화면으로.
//  · 실제 로그인 확인·역할 판정은 서버 컴포넌트·라우트 처리기의 DAL(lib/server/dal.ts)과 접근 판정 한 함수(lib/access.ts)가 한다.
//  · 모든 백오피스 응답에 검색 노출 차단 머리글을 붙인다.
// 서버 전용 표식(server-only)이 있는 모듈은 여기서 불러오지 않는다 — 환경변수는 직접 읽는다.

function noindex(response: NextResponse): NextResponse {
  response.headers.set("x-robots-tag", "noindex, nofollow");
  return response;
}

function toLogin(request: NextRequest, location: string): NextResponse {
  return noindex(NextResponse.redirect(new URL(location, request.url)));
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const decision = adminProxyDecision({ pathname, search, cookieNames: request.cookies.getAll().map((c) => c.name) });
  if (decision.kind === "login") return toLogin(request, decision.location);

  const forward = new Headers(request.headers);
  forward.set(ADMIN_PATH_HEADER, `${pathname}${search}`);
  let response = NextResponse.next({ request: { headers: forward } });
  if (decision.kind === "login-page") return noindex(response);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // 설정이 없으면 화면이 503을 보인다 (DAL)
  if (!url || !anonKey) return noindex(response);

  const supabase = createServerClient(url, anonKey, {
    cookieOptions: authCookieOptions(isHttps(request.headers, request.url)),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        // 새 토큰은 이 요청의 화면 렌더(서버 컴포넌트)와 브라우저 쿠키에 함께 넣는다
        for (const { name, value } of list) {
          if (value) request.cookies.set(name, value);
          else request.cookies.delete(name);
        }
        forward.set("cookie", request.cookies.getAll().map((c) => `${c.name}=${c.value}`).join("; "));
        response = NextResponse.next({ request: { headers: forward } });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  // getSession은 쿠키 속 토큰을 읽고 만료됐을 때만 Auth 서버에 새 토큰을 받는다 — 여기서 사용자 정보는 쓰지 않는다
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    const fallback = adminProxyDecision({ pathname, search, cookieNames: [] });
    const redirect = toLogin(request, fallback.kind === "login" ? fallback.location : "/admin/login");
    for (const c of request.cookies.getAll()) if (hasAuthCookie([c.name])) redirect.cookies.set(c.name, "", { path: "/", maxAge: 0 });
    return redirect;
  }
  return noindex(response);
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
