import { guardSecret } from "@/lib/server/env";
import { unsubscribeUser } from "@/lib/server/notify/service";
import { adminClient } from "@/lib/server/supabase";
import { verifyNotifyToken } from "@/lib/notify/logic";

// 알림 수신 거부 (W13-d, NOTI-01) - 메일 링크의 버튼 한 번으로 모든 알림 종류를 끈다. 로그인 불필요, 서명된 토큰만 본다.
// 링크를 미리 열어 보기만 해서는 거부되지 않는다(페이지는 버튼을 보여 줄 뿐 POST만 거부한다).
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const db = adminClient();
  const secret = guardSecret();
  if (!db || !secret) return new Response(null, { status: 303, headers: { location: "/notifications/unsubscribe?error=expired" } });
  const token = (await request.formData().catch(() => null))?.get("token");
  const userId = typeof token === "string" ? verifyNotifyToken(secret, token) : null;
  if (!userId) return new Response(null, { status: 303, headers: { location: "/notifications/unsubscribe?error=expired" } });
  await unsubscribeUser(db, userId);
  return new Response(null, { status: 303, headers: { location: "/notifications/unsubscribe?done=1", "cache-control": "no-store" } });
}
