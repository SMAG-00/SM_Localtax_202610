// 색인 대상이 아닌 경로 (W7 · OPT-08 · SEO-01) — robots.txt Disallow와 사이트맵 제외가 같은 목록을 쓴다. 순수 모듈.
// 도우미 위젯은 별도 URL이 없다 (PRD_최종 §4.2). 크롤러 이름이 아니라 우리 사이트 경로라 코드에 둔다.
export const NON_INDEXABLE_PREFIXES = [
  "/admin",
  "/api",
  "/account",
  "/my",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/auth",
  "/brief/confirm",
  "/brief/unsubscribe",
  "/search",
  "/experts/request",
  "/help",
  "/%5Fdesign",
  "/_design",
] as const;

export function isNonIndexablePath(pathname: string): boolean {
  return NON_INDEXABLE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
