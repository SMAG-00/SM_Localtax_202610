import { RECOVERY_SENT, parseEmailField } from "@/lib/auth/recovery";
import { normalizeEmailKey, throttleKey } from "@/lib/auth/throttle-key";
import { TOO_MANY, readAuthLimits, requestIp, requireGuardSecret, memberAuthOpen, throttleHit } from "@/lib/server/auth-guard";
import { HttpError, errorJson, handle, json } from "@/lib/server/http";
import { readAccountBody, redirect303 } from "@/lib/server/accounts/body";
import { sendMail } from "@/lib/server/mail";
import { siteBase } from "@/lib/server/site-base";
import { adminClient } from "@/lib/server/supabase";

// 비밀번호 찾기 (W2-e 설계 4.2) — 응답은 계정이 있든 없든 같은 문장. 메일은 이메일이 확인된 계정에만 간다(미확인·없는 주소는 아무것도 보내지 않는다).
//  · 닫혀 있으면(members 기능 키 꺼짐 또는 메일 설정 없음) 404 · reset_ip·reset_email 횟수 제한 · 메일 실패는 기록만 하고 같은 문장(실패 여부로 계정 유무가 드러나지 않게)
//  · 링크: generateLink(recovery) → /auth/confirm?type=recovery (버튼 확인) → /reset-password
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  const body = await readAccountBody(request, ["email"]);
  if (body instanceof Response) return body;
  const { isForm } = body;
  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  if (!(await memberAuthOpen(db))) return errorJson(404, "찾을 수 없습니다");
  const secret = requireGuardSecret();

  const email = parseEmailField(body.fields.email);
  if (!email) return isForm ? redirect303("/forgot-password?e=email") : errorJson(422, "이메일 주소 형식을 확인해 주세요", { field: "email" });

  const limits = await readAuthLimits(db);
  const hits = await Promise.all([
    throttleHit(db, "reset_ip", throttleKey(secret, "reset_ip", requestIp(request)), limits.reset_ip),
    throttleHit(db, "reset_email", throttleKey(secret, "reset_email", normalizeEmailKey(email)), limits.reset_email),
  ]);
  const blocked = hits.filter((h) => !h.allowed);
  if (blocked.length > 0) {
    const wait = Math.max(...blocked.map((h) => h.retryAfter));
    if (isForm) return redirect303("/forgot-password?e=too_many", { "retry-after": String(wait) });
    const response = errorJson(429, TOO_MANY, { retry_after_seconds: wait });
    response.headers.set("retry-after", String(wait));
    return response;
  }

  const base = siteBase(request);
  if (!base) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const state = await db.rpc("auth_email_state", { p_email: email });
  if (state.error || typeof state.data !== "string") {
    console.error("[forgot] 계정 상태 확인 실패:", state.error?.code);
    throw new HttpError(503, "지금은 이 기능을 열 수 없습니다");
  }
  if (state.data === "confirmed") {
    const { data, error } = await db.auth.admin.generateLink({ type: "recovery", email });
    if (error || !data?.properties?.hashed_token) {
      console.error("[forgot] 재설정 링크 만들기 실패:", error?.code, error?.status);
    } else {
      const link = `${base}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery`;
      const sent = await sendMail({ to: email, template: "password_reset", vars: { link } });
      if (!sent.ok) console.error("[forgot] 재설정 메일 발송 실패");
    }
  }
  return isForm ? redirect303("/forgot-password?sent=1") : json({ ok: true, message: RECOVERY_SENT });
});
