import { handle } from "@/lib/server/http";
import { postConsentWithdraw } from "@/lib/server/qna/member";

// 해결 사례 소개 동의 철회 (W13-h HOME-11) - 규칙은 lib/server/qna/member.ts. 철회가 홈 카드에 바로 반영되도록 공개 캐시를 만료한다
export const dynamic = "force-dynamic";
export const POST = handle(async (request: Request) => postConsentWithdraw(request), { revalidatesPublic: true });
