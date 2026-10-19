import { cookieSessionClient } from "@/lib/server/session";
import { isSameSiteRequest } from "@/lib/server/dal";
import { TOO_MANY, loginFailed, loginGate, loginKeysFor, loginSucceeded, readAuthLimits } from "@/lib/server/auth-guard";
import { errorJson, handle, HttpError, json, readJson } from "@/lib/server/http";
import { adminClient } from "@/lib/server/supabase";

// 로그인 (이메일 + 비밀번호) — Supabase Auth 비밀번호 로그인, 세션은 httpOnly 쿠키(@supabase/ssr)에 둔다. 편집국·회원이 같은 길을 쓴다.
//  · 실패하면 어느 칸이 틀렸는지 알리지 않는 같은 문장 하나 (계정 존재 여부를 드러내지 않는다)
//  · 같은 사이트에서 온 JSON 요청만 받는다 (로그인 CSRF 방어 — 다른 사이트의 폼 전송은 Origin·content-type에서 막힌다)
//  · 역할 확인은 로그인 뒤 화면·API의 DAL이 한다 (역할이 없는 계정은 로그인해도 쓸 수 있는 화면이 없다)
//  · 시도 제한 (W2-e 4.1): 비밀번호를 확인하기 전에 세 겹(이메일+IP 짝 · 이메일 · IP)을 DB 표로 확인해 막혔으면 429 + retry-after.
//    실패하면 세 겹 모두 세고, 성공하면 짝·이메일 횟수를 지운다. 계정이 실제로 있는지와 상관없이 보낸 이메일 글자로 센다.
//    해시 열쇠(GUARD_SECRET)·설정(auth_limits)·DB를 쓸 수 없으면 제한 없이 열지 않고 닫는다(503)
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

  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const keys = loginKeysFor(email, request);
  const limits = await readAuthLimits(db);
  const gate = await loginGate(db, keys, limits);
  if (gate.blocked) {
    const response = errorJson(429, TOO_MANY, { retry_after_seconds: gate.retryAfter });
    response.headers.set("retry-after", String(gate.retryAfter));
    return response;
  }

  const client = await cookieSessionClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    await loginFailed(db, keys, limits);
    return errorJson(401, FAILED);
  }
  await loginSucceeded(db, keys);
  return json({ ok: true });
});
