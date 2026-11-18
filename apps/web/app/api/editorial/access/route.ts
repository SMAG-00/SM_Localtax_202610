import { can } from "@/lib/access";
import { getViewer } from "@/lib/server/dal";
import { handle, json } from "@/lib/server/http";

// 헤더 '편집위원' 메뉴를 보일지 (PO 2026-11-18) — 공개 헤더가 브라우저에서 부른다. 로그인 안 함·권한 없음·확인 실패는 모두 false(200)라
// 방문자 화면에 오류가 생기지 않는다. 공용 캐시에 두지 않는다(사람마다 다름).
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await getViewer(request).catch(() => null);
  const allowed = viewer !== null && can(viewer, "editorial_desk.read");
  const response = json({ allowed });
  response.headers.set("cache-control", "private, no-store");
  return response;
});
