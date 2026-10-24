import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { handle, json } from "@/lib/server/http";
import { loadRevenue } from "@/lib/server/store/board";
import { parseDays } from "@/lib/store/rules";

// 스토어 수익 대시보드 (W8 - PRD-01C BIZ-09). 상품 x 위치 x 출처 기사별 카드 누름·주문 링크 누름 수 (최근 7·30·90일, 봇·편집국 제외).
// 금액·공헌이익은 1단계에 없다(결제 없음). 읽기 전용 - 상품 담당·관리자 (docs/dev/W8_설계.md 11장).
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "product.manage", "store:revenue");
  if (denied) return denied;
  const days = parseDays(new URL(request.url).searchParams.get("days"));
  return json(await loadRevenue(serviceDb(), days));
});
