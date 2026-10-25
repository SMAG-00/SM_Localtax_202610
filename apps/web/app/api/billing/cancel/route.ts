import { requireViewer } from "@/lib/server/dal";
import { cancelSubscription } from "@/lib/server/billing/service";
import { errorJson, handle, json, readJson } from "@/lib/server/http";
import { adminClient } from "@/lib/server/supabase";

// 구독 해지 (W10-f, PAY-05) - 본인 구독만. 자동갱신을 끄고 남은 기간 끝까지 이용, 끝나면 권한이 저절로 끝난다. 같은 요청을 다시 보내도 같은 결과.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const db = adminClient();
  if (!db) return errorJson(503, "서버 설정이 끝나지 않았습니다");
  const body = await readJson(request);
  const id = typeof body.subscriptionId === "string" ? body.subscriptionId : "";
  if (!UUID.test(id)) return errorJson(422, "subscriptionId: 구독 번호 모양이 맞지 않습니다");
  const result = await cancelSubscription(db, viewer.userId, id);
  return json(result);
});
