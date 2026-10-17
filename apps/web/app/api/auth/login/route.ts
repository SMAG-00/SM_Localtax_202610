import { cookieSessionClient } from "@/lib/server/session";
import { isSameSiteRequest } from "@/lib/server/dal";
import { errorJson, handle, json, readJson } from "@/lib/server/http";

// 편집국 로그인 (이메일 + 비밀번호) — Supabase Auth 비밀번호 로그인, 세션은 httpOnly 쿠키(@supabase/ssr)에 둔다.
//  · 실패하면 어느 칸이 틀렸는지 알리지 않는 같은 문장 하나 (계정 존재 여부를 드러내지 않는다)
//  · 같은 사이트에서 온 JSON 요청만 받는다 (로그인 CSRF 방어 — 다른 사이트의 폼 전송은 Origin·content-type에서 막힌다)
//  · 역할 확인은 로그인 뒤 화면·API의 DAL이 한다 (역할이 없는 계정은 로그인해도 쓸 수 있는 화면이 없다)
export const dynamic = "force-dynamic";

const FAILED = "이메일 또는 비밀번호가 맞지 않습니다";
const MAX_EMAIL = 320;
const MAX_PASSWORD = 1000;

export const POST = handle(async (request: Request) => {
  if (!isSameSiteRequest(request)) return errorJson(403, "다른 사이트에서 온 요청은 받지 않습니다");
  const raw = await readJson(request);
  const email = typeof raw.email === "string" ? raw.email.trim() : "";
  const password = typeof raw.password === "string" ? raw.password : "";
  if (!email || !password || email.length > MAX_EMAIL || password.length > MAX_PASSWORD) return errorJson(401, FAILED);

  const client = await cookieSessionClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) return errorJson(401, FAILED);
  return json({ ok: true });
});
