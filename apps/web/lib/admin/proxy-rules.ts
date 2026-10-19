// 백오피스 화면 경로 막기 규칙 (proxy.ts가 쓴다) — 순수 함수.
// 로그인 쿠키가 없으면 로그인 화면으로 보낸다(낙관적 확인). 쿠키가 있어도 실제 로그인·역할 확인은 서버 컴포넌트·라우트 처리기의
// DAL(lib/server/dal.ts)이 한다 — PRD-00 6장 "미들웨어와 서버 컴포넌트 두 곳에서 막는다".

/** @supabase/ssr 세션 쿠키 — sb-<프로젝트 참조>-auth-token, 길면 .0 .1 … 로 나뉜다 */
const AUTH_COOKIE = /^sb-[A-Za-z0-9-]+-auth-token(\.\d+)?$/;

export const LOGIN_PATH = "/admin/login";

export function hasAuthCookie(names: readonly string[]): boolean {
  return names.some((n) => AUTH_COOKIE.test(n) && !n.endsWith("-code-verifier"));
}

export function isLoginPath(pathname: string): boolean {
  return pathname === LOGIN_PATH || pathname === `${LOGIN_PATH}/`;
}

export type ProxyDecision = { kind: "pass" } | { kind: "login-page" } | { kind: "login"; location: string };

/** 로그인한 상태의 계정 화면(/account…) — 로그인 쿠키가 없으면 로그인 화면으로 (지금 있는 로그인 화면은 편집국 것 하나다 — 회원 /login은 2단계) */
export function isAccountPath(pathname: string): boolean {
  return pathname === "/account" || pathname.startsWith("/account/");
}

export function accountProxyDecision({ pathname, search, cookieNames }: { pathname: string; search: string; cookieNames: readonly string[] }): ProxyDecision {
  if (hasAuthCookie(cookieNames)) return { kind: "pass" };
  return { kind: "login", location: `${LOGIN_PATH}?next=${encodeURIComponent(`${pathname}${search}`)}` };
}

export function adminProxyDecision({ pathname, search, cookieNames }: { pathname: string; search: string; cookieNames: readonly string[] }): ProxyDecision {
  if (isLoginPath(pathname)) return { kind: "login-page" };
  if (hasAuthCookie(cookieNames)) return { kind: "pass" };
  return { kind: "login", location: `${LOGIN_PATH}?next=${encodeURIComponent(`${pathname}${search}`)}` };
}
