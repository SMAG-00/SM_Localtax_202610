import { cookieSessionClient } from "@/lib/server/session";
import { isSameSiteRequest } from "@/lib/server/dal";
import { memberNextPath } from "@/lib/auth/member-next";
import { TOO_MANY, loginFailed, loginGate, loginKeysFor, loginSucceeded, readAuthLimits } from "@/lib/server/auth-guard";
import { errorJson, handle, HttpError, json, readJson } from "@/lib/server/http";
import { adminClient } from "@/lib/server/supabase";

// 로그인 (이메일 + 비밀번호) — Supabase Auth 비밀번호 로그인, 세션은 httpOnly 쿠키(@supabase/ssr)에 둔다. 편집국(JSON)·회원(/login 일반 HTML 폼)이 같은 길을 쓴다.
//  · 실패하면 어느 칸이 틀렸는지 알리지 않는 같은 문장 하나 (계정 존재 여부를 드러내지 않는다)
//  · 같은 사이트에서 온 요청만 받는다 (로그인 CSRF 방어). 폼 전송은 Origin 머리글이 반드시 있어야 한다
//  · 역할 확인은 로그인 뒤 화면·API의 DAL이 한다 (역할이 없는 계정은 로그인해도 쓸 수 있는 화면이 없다)
//  · 시도 제한 (W2-e 4.1): 비밀번호를 확인하기 전에 세 겹(이메일+IP 짝 · 이메일 · IP)을 DB 표로 확인해 막혔으면 429 + retry-after.
//    실패하면 세 겹 모두 세고, 성공하면 짝·이메일 횟수를 지운다. 계정이 실제로 있는지와 상관없이 보낸 이메일 글자로 센다.
//    해시 열쇠(GUARD_SECRET)·설정(auth_limits)·DB를 쓸 수 없으면 제한 없이 열지 않고 닫는다(503)
//  · 폼으로 오면(W2-e 4.4) 성공은 next(사이트 안 경로만, 아니면 /my)로 303, 실패는 /login?e=…로 303
export const dynamic = "force-dynamic";

const FAILED = "이메일 또는 비밀번호가 맞지 않습니다";
const MAX_EMAIL = 320;
const MAX_PASSWORD = 1000;

async function attempt(request: Request, raw: Record<string, unknown>): Promise<Response> {
  if (!isSameSiteRequest(request)) return errorJson(403, "다른 사이트에서 온 요청은 받지 않습니다");
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
}

export const POST = handle(async (request: Request) => {
  const isForm = (request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded");
  if (!isForm) return attempt(request, await readJson(request));

  if (request.headers.get("origin") === null) return errorJson(403, "다른 사이트에서 온 요청은 받지 않습니다");
  const params = new URLSearchParams(await request.text());
  const next = memberNextPath(params.get("next"));
  const result = await attempt(request, { email: params.get("email") ?? "", password: params.get("password") ?? "" });
  const redirect = (location: string) => new Response(null, { status: 303, headers: { location } });
  // 로그인 쿠키는 attempt 안에서 쿠키 저장소에 이미 써 두었다 — 새 응답에도 같이 실린다
  if (result.status === 200) return redirect(next);
  const code = result.status === 401 ? "failed" : result.status === 429 ? "too_many" : "unavailable";
  const retry = result.headers.get("retry-after");
  const response = redirect(`/login?e=${code}&next=${encodeURIComponent(next)}`);
  if (retry) response.headers.set("retry-after", retry);
  return response;
});
