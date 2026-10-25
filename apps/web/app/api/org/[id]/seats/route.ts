import { requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, readJson } from "@/lib/server/http";
import { UUID_SHAPE } from "@/lib/server/org/logic";
import { featureOn, inviteSeat, orgBoard, requestTaxInvoice, revokeSeat } from "@/lib/server/org/service";
import { adminClient } from "@/lib/server/supabase";

// 기관 관리자 좌석 화면 API (W11-f, PAY-04). 기관 관리자(org_admins)만 - 아니면 404(기관이 있는지도 알리지 않는다).
//  · GET  - 계약 기간·좌석 사용 수·좌석 목록(회원 번호·메일 없음)·세금계산서 요청 목록
//  · POST op=invite       { expiresInDays } 좌석 초대 링크 만들기 - 확인표 미승인·계약 없음·좌석 초과는 DB가 거부. 토큰 원문은 이 응답에서만 한 번
//  · POST op=revoke       { seatId } 좌석 회수 - 회수 시각부터 거부
//  · POST op=tax_invoice  { kind } 세금계산서·영수증 요청 - 공급가액은 계약 금액에서 서버가 정한다(요청의 금액 값 무시)
// 요청 본문의 좌석 수·등급·기관 번호 값은 판정에 쓰지 않는다 (기관 번호는 주소의 값을 관리자 확인에만 쓴다).
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (request: Request, ctx: Ctx) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const { id } = await ctx.params;
  const db = adminClient();
  if (!db) return errorJson(503, "서버 설정이 끝나지 않았습니다");
  if (!UUID_SHAPE.test(id) || !(await featureOn(db, "institution_subscription"))) return errorJson(404, "찾을 수 없습니다");
  const board = await orgBoard(db, viewer.userId, id);
  if (!board) return errorJson(404, "찾을 수 없습니다");
  return json({ board });
});

export const POST = handle(async (request: Request, ctx: Ctx) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const { id } = await ctx.params;
  const db = adminClient();
  if (!db) return errorJson(503, "서버 설정이 끝나지 않았습니다");
  if (!UUID_SHAPE.test(id) || !(await featureOn(db, "institution_subscription"))) return errorJson(404, "찾을 수 없습니다");
  const board = await orgBoard(db, viewer.userId, id);
  if (!board) return errorJson(404, "찾을 수 없습니다");
  const body = await readJson(request);
  const op = String(body.op);
  if (op === "invite") {
    const r = await inviteSeat(db, viewer.userId, id, body.expiresInDays);
    if (!r.ok) return errorJson(r.status, r.message, { code: r.code });
    return json({ seatId: r.value.seatId, token: r.value.token, expiresAt: r.value.expiresAt, acceptPath: `/org/accept?token=${r.value.token}` }, 201);
  }
  if (op === "revoke") {
    const seatId = typeof body.seatId === "string" ? body.seatId : "";
    // 이 기관의 좌석만 - 다른 기관 좌석 번호를 보내면 404
    if (!UUID_SHAPE.test(seatId) || !board.seats.some((s) => s.id === seatId)) return errorJson(404, "그런 좌석이 없습니다");
    const r = await revokeSeat(db, viewer.userId, seatId);
    if (!r.ok) return errorJson(r.status, r.message, { code: r.code });
    return json({ revoked: seatId });
  }
  if (op === "tax_invoice") {
    const r = await requestTaxInvoice(db, viewer.userId, id, body.kind);
    if (!r.ok) return errorJson(r.status, r.message, { code: r.code });
    return json({ id: r.value.id }, 201);
  }
  return errorJson(422, "op: invite·revoke·tax_invoice 중 하나입니다");
});
