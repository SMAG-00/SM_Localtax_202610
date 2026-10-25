import { requireViewer } from "@/lib/server/dal";
import { getBillingRuntime } from "@/lib/server/billing/runtime";
import { createCheckout } from "@/lib/server/billing/service";
import { errorJson, handle, json, readJson } from "@/lib/server/http";
import { adminClient } from "@/lib/server/supabase";

// 결제 시작 (W10-f, PAY-01·02) - 로그인한 회원만. 주문을 만들고 PG 인증에 필요한 값(주문번호·금액·클라이언트 키)을 돌려준다.
//  · 금액은 요금제 데이터에서 서버가 정한다 - 요청에 금액 칸이 있어도 읽지 않는다. 같은 멱등 키로 다시 부르면 같은 주문.
//  · 기능 키 billing·digital_subscription이 꺼져 있으면 404, 결제 설정이 맞지 않으면 503, 실결제는 commerce_readiness 없으면 403.
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const runtime = getBillingRuntime();
  const db = adminClient();
  if (!runtime || !db) return errorJson(503, "결제 설정이 끝나지 않았습니다");
  const body = await readJson(request);
  const planId = Number(body.planId);
  const idem = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  if (!Number.isInteger(planId) || planId < 1) return errorJson(422, "planId: 요금제를 골라 주세요");
  if (idem.length < 8 || idem.length > 120) return errorJson(422, "idempotencyKey: 8~120자 값이 필요합니다");
  const checkout = await createCheckout(db, runtime.config, viewer.userId, { planId, idempotencyKey: idem, termsAck: body.termsAck === true });
  return json({ checkout }, checkout.replayed ? 200 : 201);
});
