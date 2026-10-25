import { requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, readJson } from "@/lib/server/http";
import { featureOn, acceptSeat } from "@/lib/server/org/service";
import { adminClient } from "@/lib/server/supabase";

// 좌석 초대 수락 (W11-f, PAY-04) - 로그인한 회원만. 회원 번호는 서버 세션에서 정하고 요청 본문의 값은 토큰뿐이다.
// 확인표 미승인·계약 종료·만료·이미 쓴 링크·같은 기관 중복 좌석은 DB 함수가 거부한다. 성공하면 그 시점에 권한(source org)이 생긴다.
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const db = adminClient();
  if (!db) return errorJson(503, "서버 설정이 끝나지 않았습니다");
  if (!(await featureOn(db, "institution_subscription"))) return errorJson(404, "찾을 수 없습니다");
  const body = await readJson(request);
  const token = typeof body.token === "string" ? body.token : "";
  const r = await acceptSeat(db, viewer.userId, token);
  if (!r.ok) return errorJson(r.status, r.message, { code: r.code });
  return json({ accepted: true }, 201);
});
