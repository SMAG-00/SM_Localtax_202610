import { parseEmailField } from "@/lib/auth/recovery";
import { CODE_MESSAGES } from "@/lib/auth/signup-input";
import { readAuthLimits, requireGuardSecret, memberAuthOpen } from "@/lib/server/auth-guard";
import { HttpError, errorJson, handle, json } from "@/lib/server/http";
import { readAccountBody, redirect303 } from "@/lib/server/accounts/body";
import { resendConfirmMail } from "@/lib/server/accounts/confirm-mail";
import { siteBase } from "@/lib/server/site-base";
import { adminClient } from "@/lib/server/supabase";

// 확인 메일 다시 받기 (W2-e 설계 4.3, confirm_resend) — 만료된 확인 화면의 버튼. 미확인 계정에만 메일이 가고, 응답은 계정 유무·횟수 제한과 상관없이 같은 문장.
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
  if (!email) return isForm ? redirect303("/auth/confirm?error=expired&type=signup&e=email") : errorJson(422, CODE_MESSAGES.email, { field: "email" });

  const base = siteBase(request);
  if (!base) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const state = await db.rpc("auth_email_state", { p_email: email });
  if (state.error || typeof state.data !== "string") {
    console.error("[resend] 계정 상태 확인 실패:", state.error?.code);
    throw new HttpError(503, "지금은 이 기능을 열 수 없습니다");
  }
  if (state.data === "unconfirmed") {
    const limits = await readAuthLimits(db);
    await resendConfirmMail(db, { email, base, request, secret, limits });
  }
  return isForm ? redirect303("/auth/confirm?error=expired&type=signup&sent=1") : json({ ok: true, message: CODE_MESSAGES.sent });
});
