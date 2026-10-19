import { createClient } from "@supabase/supabase-js";
import { checkPassword } from "@/lib/auth/password";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { TOO_MANY, passwordChangeKey, readAuthLimits, readMemberSettings, throttleCheck, throttleClear, throttleHit } from "@/lib/server/auth-guard";
import { getViewer, isSameSiteRequest } from "@/lib/server/dal";
import { supabaseAnonKey, supabaseUrl } from "@/lib/server/env";
import { HttpError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { cookieSessionClient } from "@/lib/server/session";
import { adminClient } from "@/lib/server/supabase";

// 로그인한 상태의 비밀번호 바꾸기 (W2-e 4.2 · /account/password) — 메일이 필요 없고 편집국·관리자·회원 모두 쓴다.
//  순서: 같은 사이트 → 로그인(쿠키 세션) → 시도 횟수 확인(password_change, 계정 기준) → 입력 모양 → 현재 비밀번호 확인(실패는 횟수에 합산)
//        → 새 비밀번호 규칙(2.6) → 비밀번호 변경 → 다른 기기 세션 끊기(이 기기는 유지) → 감사 로그 account.password_changed(비밀번호·이메일 0)
//  · 현재 비밀번호는 세션을 저장하지 않는 별도 클라이언트로 확인한다 — 이 기기의 쿠키 세션을 바꾸지 않는다
//  · 쿠키 세션만 받는다(Bearer 머리글은 보지 않는다): '이 기기'가 어느 세션인지 쿠키 세션으로만 알 수 있다
export const dynamic = "force-dynamic";

const MAX_PASSWORD_INPUT = 1000;
const CURRENT_WRONG = "현재 비밀번호가 맞지 않습니다";

/** 화면이 칸 옆에 문장을 붙일 수 있게 field를 같이 준다 */
const invalid = (field: "currentPassword" | "newPassword" | "newPasswordConfirm", message: string) => errorJson(422, message, { field });

export const POST = handle(async (request: Request) => {
  if (!isSameSiteRequest(request)) return errorJson(403, "다른 사이트에서 온 요청은 받지 않습니다");
  const viewer = await getViewer();
  if (!viewer) return errorJson(401, "로그인이 필요합니다");
  if (!viewer.email) return errorJson(403, "이메일이 없는 계정은 비밀번호를 바꿀 수 없습니다");

  const db = adminClient();
  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  if (!db || !url || !anonKey) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const key = passwordChangeKey(viewer.userId);
  const [limits, member] = await Promise.all([readAuthLimits(db), readMemberSettings(db)]);
  const gate = await throttleCheck(db, "password_change", key, limits.password_change);
  if (gate.blocked) {
    const response = errorJson(429, TOO_MANY, { retry_after_seconds: gate.retryAfter });
    response.headers.set("retry-after", String(gate.retryAfter));
    return response;
  }

  const raw = await readJson(request);
  const fields = (["currentPassword", "newPassword", "newPasswordConfirm"] as const).map((name) => [name, raw[name]] as const);
  for (const [name, value] of fields) {
    if (typeof value !== "string" || value === "") return invalid(name, name === "currentPassword" ? "현재 비밀번호를 넣어 주세요" : name === "newPassword" ? "새 비밀번호를 넣어 주세요" : "새 비밀번호를 한 번 더 넣어 주세요");
    if (value.length > MAX_PASSWORD_INPUT) return invalid(name, "비밀번호가 너무 깁니다");
  }
  const currentPassword = raw.currentPassword as string;
  const newPassword = raw.newPassword as string;
  if (newPassword !== raw.newPasswordConfirm) return invalid("newPasswordConfirm", "새 비밀번호 두 칸이 같지 않습니다");

  // 현재 비밀번호 확인 — 틀리면 횟수를 올린다(훔친 세션으로 비밀번호를 알아내려는 시도 방지)
  const verifier = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error: verifyError } = await verifier.auth.signInWithPassword({ email: viewer.email, password: currentPassword });
  if (verifyError) {
    await throttleHit(db, "password_change", key, limits.password_change);
    return invalid("currentPassword", CURRENT_WRONG);
  }
  if (newPassword === currentPassword) return invalid("newPassword", "현재 비밀번호와 다른 비밀번호를 써 주세요");
  const rule = checkPassword(newPassword, viewer.email, { minChars: member.passwordMinChars, maxBytes: member.passwordMaxBytes });
  if (!rule.ok) return invalid("newPassword", rule.message);

  const client = await cookieSessionClient();
  const { error: updateError } = await client.auth.updateUser({ password: newPassword });
  if (updateError) {
    if (updateError.code === "weak_password" || updateError.code === "same_password") return invalid("newPassword", "이 비밀번호는 쓸 수 없습니다 — 다른 값을 써 주세요");
    console.error("[auth] 비밀번호 변경 실패:", updateError.code, updateError.status);
    throw new HttpError(500, "비밀번호를 바꾸지 못했습니다 — 잠시 뒤 다시 시도하세요");
  }
  // 다른 기기의 세션을 끊는다(이 기기는 그대로) — 비밀번호가 새어 나간 세션이 남아 있지 않게
  const { error: signOutError } = await client.auth.signOut({ scope: "others" });
  if (signOutError) console.error("[auth] 다른 기기 세션 끊기 실패:", signOutError.status);
  await throttleClear(db, "password_change", key);
  await writeAudit(db, {
    actor: actorOf(viewer),
    action: "account.password_changed",
    target: `user:${viewer.userId}`,
    before: null,
    after: { otherSessionsEnded: !signOutError },
    reason: "비밀번호 바꾸기",
  });
  if (signOutError) throw new HttpError(500, "비밀번호는 바꿨지만 다른 기기의 로그인을 끊지 못했습니다 — 다시 로그인해 관리자에게 알려 주세요");
  return json({ ok: true, otherSessionsEnded: true });
});
