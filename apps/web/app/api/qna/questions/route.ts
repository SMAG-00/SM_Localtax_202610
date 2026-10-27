import { handle } from "@/lib/server/http";
import { postQuestion } from "@/lib/server/qna/member";

// 라운지 회원 쓰기 (W13-g) - 규칙은 lib/server/qna/member.ts
export const dynamic = "force-dynamic";
export const POST = handle(async (request: Request) => postQuestion(request));
