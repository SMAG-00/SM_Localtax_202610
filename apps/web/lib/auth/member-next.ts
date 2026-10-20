// 회원 로그인 뒤 돌아갈 주소(next) — 같은 사이트의 /my · /help · /news · /account 아래 상대 경로만 받는다. 그 밖은 /my (W2-e 4.4). 순수 함수.
export const MEMBER_HOME = "/my";
const ROOTS = ["/my", "/help", "/news", "/account"] as const;
const BASE = "http://member-next.invalid";
const CONTROL = /[\u0000-\u001f\u007f]/;

export function memberNextPath(raw: unknown): string {
  if (typeof raw !== "string" || raw === "" || raw.length > 2000) return MEMBER_HOME;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || CONTROL.test(raw)) return MEMBER_HOME;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return MEMBER_HOME;
  }
  if (url.origin !== BASE) return MEMBER_HOME;
  if (!ROOTS.some((r) => url.pathname === r || url.pathname.startsWith(`${r}/`))) return MEMBER_HOME;
  return `${url.pathname}${url.search}${url.hash}`;
}
