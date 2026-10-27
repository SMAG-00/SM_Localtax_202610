import { handleCopilotPost } from "@/lib/server/copilot/service";

// 리서치 코파일럿 API (W13-e) - 게이트가 닫혀 있으면 404이고 모델을 부르지 않는다.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  return handleCopilotPost(request);
}
