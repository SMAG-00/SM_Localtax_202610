import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { hasAuthCookie } from "@/lib/admin/proxy-rules";
import { WITHDRAW_BLOCKED, withdrawBlocked } from "@/lib/auth/recovery";
import { throttleKey } from "@/lib/auth/throttle-key";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { TOO_MANY, readAuthLimits, requireGuardSecret, throttleCheck, throttleClear, throttleHit } from "@/lib/server/auth-guard";
import { getViewer } from "@/lib/server/dal";
import { supabaseAnonKey, supabaseUrl } from "@/lib/server/env";
import { HttpError, errorJson, handle, json } from "@/lib/server/http";
import { readAccountBody, redirect303 } from "@/lib/server/accounts/body";
import { cookieSessionClient } from "@/lib/server/session";
import { adminClient } from "@/lib/server/supabase";

// 탈퇴 (W2-e 설계 9.3) — 현재 비밀번호를 다시 확인한 뒤 동의·프로필·Auth 계정을 지운다(동의 기록도 즉시 삭제 — PO 결정). 세션도 함께 끝난다.
//  · 편집국 역할이 있는 계정·관리자 계정은 막는다(403) — 역할 회수가 먼저
//  · 현재 비밀번호가 틀리면 횟수를 올린다(password_change 범위, 키는 탈퇴 전용) — 5번까지 허용, 6번째 429
//  · 감사 로그 account.withdrawn — actor·target은 user:<uuid>뿐, 이메일 0
export const dynamic = "force-dynamic";

const WRONG = "현재 비밀번호가 맞지 않습니다";

export const POST = handle(async (request: Request) => {
  const body = await readAccountBody(request, ["currentPassword"]);
  if (body instanceof Response) return body;
  const { isForm } = body;
  const viewer = await getViewer();
  if (!viewer) return errorJson(401, "로그인이 필요합니다");
  if (!viewer.email) return errorJson(403, "이메일이 없는 계정은 탈퇴할 수 없습니다");
  if (withdrawBlocked(viewer)) return isForm ? redirect303("/my/withdraw") : errorJson(403, WITHDRAW_BLOCKED);

  const db = adminClient();
  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  if (!db || !url || !anonKey) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const key = throttleKey(requireGuardSecret(), "password_change", `withdraw:${viewer.userId}`);
  const limits = await readAuthLimits(db);
  const gate = await throttleCheck(db, "password_change", key, limits.password_change);
  if (gate.blocked) {
    if (isForm) return redirect303("/my/withdraw?e=too_many", { "retry-after": String(gate.retryAfter) });
    const response = errorJson(429, TOO_MANY, { retry_after_seconds: gate.retryAfter });
    response.headers.set("retry-after", String(gate.retryAfter));
    return response;
  }

  const password = body.fields.currentPassword;
  if (password === "" || password.length > 1000) return isForm ? redirect303("/my/withdraw?e=wrong") : errorJson(422, WRONG, { field: "currentPassword" });
  const verifier = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error: verifyError } = await verifier.auth.signInWithPassword({ email: viewer.email, password });
  if (verifyError) {
    await throttleHit(db, "password_change", key, limits.password_change);
    return isForm ? redirect303("/my/withdraw?e=wrong") : errorJson(422, WRONG, { field: "currentPassword" });
  }

  // 동의·프로필을 먼저 지우고 계정을 지운다(계정 삭제가 실패해도 개인정보 행은 남지 않는다)
  const consents = await db.from("consents").delete().eq("user_id", viewer.userId);
  const profiles = await db.from("profiles").delete().eq("id", viewer.userId);
  if (consents.error || profiles.error) {
    console.error("[withdraw] 개인정보 행 삭제 실패:", consents.error?.code, profiles.error?.code);
    throw new HttpError(500, "탈퇴를 처리하지 못했습니다 — 잠시 뒤 다시 시도하세요");
  }
  const removed = await db.auth.admin.deleteUser(viewer.userId);
  if (removed.error) {
    console.error("[withdraw] 계정 삭제 실패:", removed.error.code, removed.error.status);
    throw new HttpError(500, "탈퇴를 처리하지 못했습니다 — 잠시 뒤 다시 시도하세요");
  }
  await throttleClear(db, "password_change", key).catch(() => undefined);
  await writeAudit(db, { actor: actorOf(viewer), action: "account.withdrawn", target: `user:${viewer.userId}`, before: null, after: { consentsDeleted: true, profileDeleted: true }, reason: "회원 탈퇴" }).catch((e: unknown) => console.error("[withdraw] 감사 로그 쓰기 실패:", e instanceof Error ? e.message : "unknown"));

  const client = await cookieSessionClient();
  await client.auth.signOut({ scope: "local" }).catch(() => undefined);
  const store = await cookies();
  for (const c of store.getAll()) if (hasAuthCookie([c.name])) store.set(c.name, "", { path: "/", maxAge: 0 });
  return isForm ? redirect303("/login?withdrawn=1") : json({ ok: true });
});
