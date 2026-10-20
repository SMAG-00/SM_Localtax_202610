import { cookies } from "next/headers";
import { hasAuthCookie } from "@/lib/admin/proxy-rules";
import { checkPassword, PASSWORD_PROBLEM_MESSAGES } from "@/lib/auth/password";
import { RESET_COOKIE, checkResetCookie } from "@/lib/auth/recovery";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { readMemberSettings, requireGuardSecret } from "@/lib/server/auth-guard";
import { getViewer } from "@/lib/server/dal";
import { HttpError, errorJson, handle, json } from "@/lib/server/http";
import { readAccountBody, redirect303 } from "@/lib/server/accounts/body";
import { cookieSessionClient } from "@/lib/server/session";
import { adminClient } from "@/lib/server/supabase";

// 새 비밀번호 정하기 (W2-e 설계 4.2) — /auth/confirm?type=recovery에서 링크를 확인해 세션과 재설정 표시 쿠키를 받은 사람만.
//  그냥 로그인한 세션으로는 현재 비밀번호 없이 바꿀 수 없다(표시 쿠키가 없으면 410). 순서: 같은 사이트 → 세션·표시 쿠키 → 두 칸 일치 → 규칙(2.6) → 비밀번호 변경
//  → 모든 세션 끊기(이 기기 포함) → 표시 쿠키 삭제 → 감사 로그 account.password_reset(비밀번호·이메일 0)
export const dynamic = "force-dynamic";

const MESSAGES = {
  ...PASSWORD_PROBLEM_MESSAGES,
  mismatch: "새 비밀번호 두 칸이 같지 않습니다",
  weak: "이 비밀번호는 쓸 수 없습니다 — 다른 값을 써 주세요",
  expired: "재설정 시간이 지났습니다 — 비밀번호 찾기에서 메일을 다시 받아 주세요",
} as const;
type ResetCode = keyof typeof MESSAGES;

export const POST = handle(async (request: Request) => {
  const body = await readAccountBody(request, ["newPassword", "newPasswordConfirm"]);
  if (body instanceof Response) return body;
  const { isForm } = body;
  const fail = (code: ResetCode, status = 422) => (isForm ? redirect303(code === "expired" ? "/reset-password" : `/reset-password?e=${code}`) : errorJson(status, MESSAGES[code], { code }));

  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const secret = requireGuardSecret();
  const viewer = await getViewer();
  const store = await cookies();
  if (!viewer || !viewer.email || !checkResetCookie(secret, store.get(RESET_COOKIE)?.value, viewer.userId, Date.now())) return fail("expired", 410);

  const { newPassword, newPasswordConfirm } = body.fields;
  if (newPassword !== newPasswordConfirm) return fail("mismatch");
  if (newPassword.length > 1000) return fail("too_long");
  const member = await readMemberSettings(db);
  const rule = checkPassword(newPassword, viewer.email, { minChars: member.passwordMinChars, maxBytes: member.passwordMaxBytes });
  if (!rule.ok) return fail(rule.problem);

  const client = await cookieSessionClient();
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) {
    if (error.code === "weak_password" || error.code === "same_password") return fail("weak");
    console.error("[reset] 비밀번호 변경 실패:", error.code, error.status);
    throw new HttpError(500, "비밀번호를 바꾸지 못했습니다 — 잠시 뒤 다시 시도하세요");
  }
  const { error: signOutError } = await client.auth.signOut({ scope: "global" });
  if (signOutError) console.error("[reset] 모든 세션 끊기 실패:", signOutError.status);
  store.set(RESET_COOKIE, "", { path: "/", maxAge: 0 });
  for (const c of store.getAll()) if (hasAuthCookie([c.name])) store.set(c.name, "", { path: "/", maxAge: 0 });
  await writeAudit(db, { actor: actorOf(viewer), action: "account.password_reset", target: `user:${viewer.userId}`, before: null, after: { allSessionsEnded: !signOutError }, reason: "비밀번호 찾기 재설정" });
  if (signOutError) throw new HttpError(500, "비밀번호는 바꿨지만 로그인된 기기를 모두 끊지 못했습니다 — 관리자에게 알려 주세요");
  return isForm ? redirect303("/login?reset=1") : json({ ok: true, allSessionsEnded: true });
});
