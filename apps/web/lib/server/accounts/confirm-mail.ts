import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeEmailKey, throttleKey } from "@/lib/auth/throttle-key";
import type { AuthLimits } from "@/lib/auth/settings";
import { requestIp, throttleHit } from "@/lib/server/auth-guard";
import { sendMail } from "@/lib/server/mail";

/**
 * 확인 안 된 계정에 확인 메일을 다시 보낸다 (confirm_resend 횟수 제한 — 이메일 기준·IP 기준 둘 다 셈).
 * generateLink(magiclink)는 미확인 계정이면 토큰을 새로 만든다(로컬 Auth로 확인: 확인 유형은 magiclink, signup 유형으로는 403) —비밀번호를 받지 않으므로 남이 같은 주소로 비밀번호를 덮어쓸 수 없다(signup 유형은 덮어쓴다).
 * 호출하는 쪽은 결과와 상관없이 같은 문장으로 답한다(계정 유무·제한 걸림을 드러내지 않는다). 반환: 보냈나
 */
export async function resendConfirmMail(db: SupabaseClient, params: { email: string; base: string; request: Request; secret: string; limits: AuthLimits }): Promise<boolean> {
  const { email, base, request, secret, limits } = params;
  const hits = await Promise.all([
    throttleHit(db, "confirm_resend", throttleKey(secret, "confirm_resend", `email:${normalizeEmailKey(email)}`), limits.confirm_resend),
    throttleHit(db, "confirm_resend", throttleKey(secret, "confirm_resend", `ip:${requestIp(request)}`), limits.confirm_resend),
  ]);
  if (hits.some((h) => !h.allowed)) return false;
  const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) {
    console.error("[resend] 확인 링크 만들기 실패:", error?.code, error?.status);
    return false;
  }
  const link = `${base}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=magiclink`;
  const sent = await sendMail({ to: email, template: "signup_resend", vars: { link } });
  return sent.ok;
}
