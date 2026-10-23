import { handleAssistantPost } from "@/lib/server/assistant/service";

// AI 도우미 질문 (CHAT-01~12) — 처리는 lib/server/assistant/service.ts. 색인 금지 머리글·캐시 금지는 응답마다 붙는다.
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleAssistantPost(request);
}
