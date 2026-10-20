import "server-only";
import { cookies } from "next/headers";
import { RESET_COOKIE, checkResetCookie } from "@/lib/auth/recovery";
import { getViewer } from "@/lib/server/dal";
import { guardSecret } from "@/lib/server/env";

/** 재설정 표시 쿠키가 지금 로그인한 계정의 것이고 유효 시간 안인가 (W2-e 설계 4.2) — /reset-password 화면이 폼을 보일지 정한다.
 *  지금 시각은 여기서 읽는다(화면 컴포넌트가 그리는 도중에 시각을 읽지 않게 — react-hooks/purity) */
export async function hasValidResetMark(): Promise<boolean> {
  const secret = guardSecret();
  if (!secret) return false;
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return false;
  const store = await cookies();
  return checkResetCookie(secret, store.get(RESET_COOKIE)?.value, viewer.userId, Date.now());
}
