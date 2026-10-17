// 편집국 세션 쿠키 설정 — 로그인·로그아웃 라우트, DAL, proxy.ts가 같이 쓴다. proxy.ts가 불러오므로 server-only 표식을 두지 않는다
// (값을 읽지 않는 순수 함수다). 쿠키는 httpOnly(브라우저 스크립트가 못 읽음)·SameSite=Lax, https 요청이면 Secure.

export function authCookieOptions(secure: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/" };
}

/** https 요청인가 — 앞단 프록시(Vercel·사내 프록시)가 붙인 x-forwarded-proto를 먼저 본다 */
export function isHttps(headerList: Pick<Headers, "get">, url?: string): boolean {
  const forwarded = headerList.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  if (url) {
    try {
      return new URL(url).protocol === "https:";
    } catch {
      return false;
    }
  }
  return false;
}
