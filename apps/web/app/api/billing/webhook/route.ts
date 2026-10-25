import { getBillingRuntime } from "@/lib/server/billing/runtime";
import { handleWebhook } from "@/lib/server/billing/service";
import { adminClient } from "@/lib/server/supabase";

// PG 웹훅 (W10-f, PAY-02) - 로그인 없이 받지만 서명이 맞아야 한다. 서명 -> 이벤트 번호 유일 기록(멱등) -> PG 조회 -> 반영.
//  · 서명이 없거나 틀리면 401(DB 쓰기 0). 같은 이벤트가 두 번 와도 결제·권한은 한 번. 본문의 상태·금액은 쓰지 않고 PG 조회 결과로 정한다.
//  · 처리 중 오류는 500으로 돌려 PG가 다시 보내게 한다. 본문은 응답·로그에 되돌려 쓰지 않는다.
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const MAX_BODY = 100_000;

export async function POST(request: Request) {
  const runtime = getBillingRuntime();
  const db = adminClient();
  if (!runtime || !db) return json({ error: "결제 설정이 끝나지 않았습니다" }, 503);
  const raw = await request.text().catch(() => null);
  if (raw === null || raw.length > MAX_BODY) return json({ error: "본문을 읽지 못했습니다" }, 400);
  try {
    const outcome = await handleWebhook(db, runtime.adapter, runtime.config, raw, request.headers);
    return json(outcome.body, outcome.status);
  } catch (err) {
    console.error("[billing] 웹훅 처리 오류:", err instanceof Error ? err.name : "unknown");
    return json({ error: "처리하지 못했습니다" }, 500);
  }
}
