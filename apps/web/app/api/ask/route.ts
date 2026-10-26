import { handleAskPost } from "@/lib/server/agent/service";

// 지방세봇 질문 (W12-b - ASK-01, PRD-04 6.13) - 서버 전송 이벤트(SSE). 처리는 lib/server/agent/service.ts.
// 공개 단계가 열리기 전에는 404 (게이트 전 시험은 /admin/eval).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function POST(request: Request) {
  return handleAskPost(request);
}
