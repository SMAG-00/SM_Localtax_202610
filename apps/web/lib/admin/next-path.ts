// 로그인 뒤 돌아갈 주소(next) — 같은 사이트의 /admin 아래 상대 경로만 받는다 (열린 리디렉션 방지).
// 브라우저 주소 해석(WHATWG URL)과 같은 방법으로 풀어 본 뒤, 바깥 주소·상위 경로·로그인 화면 되돌이는 /admin으로 바꾼다.

export const ADMIN_HOME = "/admin";
const LOGIN = "/admin/login";
const BASE = "http://admin-next.invalid";
const MAX = 2000;
// 탭·줄바꿈은 주소 해석에서 지워져 '//'를 만들 수 있다 — 제어 문자는 처음부터 받지 않는다
const CONTROL = /[\u0000-\u001f\u007f]/;

export function safeNextPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX) return ADMIN_HOME;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || CONTROL.test(raw)) return ADMIN_HOME;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return ADMIN_HOME;
  }
  if (url.origin !== BASE) return ADMIN_HOME;
  const path = url.pathname;
  if (path !== ADMIN_HOME && !path.startsWith(`${ADMIN_HOME}/`)) return ADMIN_HOME;
  if (path === LOGIN || path.startsWith(`${LOGIN}/`)) return ADMIN_HOME;
  return `${path}${url.search}${url.hash}`;
}
