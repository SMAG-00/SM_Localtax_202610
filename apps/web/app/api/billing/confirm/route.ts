import { requireViewer } from "@/lib/server/dal";
import { getBillingRuntime } from "@/lib/server/billing/runtime";
import { completeCheckout } from "@/lib/server/billing/service";
import { errorJson, handle, json, readJson } from "@/lib/server/http";
import { adminClient } from "@/lib/server/supabase";

// 결제 마무리 (W10-f, PAY-02) - 브라우저가 PG 인증을 마치고 받은 authKey 또는 paymentKey 문자열만 받는다.
//  · 요청에 상태·금액·성공 여부 칸이 있어도 읽지 않는다 (복귀 주소 값만으로 권한 0). 서버가 PG에 승인/빌링 결제를 요청하고 다시 조회한 결과로만 반영한다.
//  · 본인 주문만 (남의 주문번호는 404). 이미 끝난 주문은 현재 상태만 돌려준다 (멱등).
export const dynamic = "force-dynamic";

const KEY = /^[A-Za-z0-9_\-:.]{6,200}$/;

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const runtime = getBillingRuntime();
  const db = adminClient();
  if (!runtime || !db) return errorJson(503, "결제 설정이 끝나지 않았습니다");
  const body = await readJson(request);
  const orderNo = typeof body.orderNo === "string" ? body.orderNo : "";
  const paymentKey = typeof body.paymentKey === "string" ? body.paymentKey : undefined;
  const authKey = typeof body.authKey === "string" ? body.authKey : undefined;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(orderNo)) return errorJson(422, "orderNo: 주문번호 모양이 맞지 않습니다");
  if ((paymentKey && !KEY.test(paymentKey)) || (authKey && !KEY.test(authKey))) return errorJson(422, "인증 값 모양이 맞지 않습니다");
  const result = await completeCheckout(db, runtime.adapter, runtime.config, viewer.userId, { orderNo, paymentKey, authKey });
  return json(result);
});
