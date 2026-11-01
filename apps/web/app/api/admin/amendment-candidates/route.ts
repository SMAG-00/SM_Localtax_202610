import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, readJson } from "@/lib/server/http";

// 승인된 개정 단계 후보를 개정 트래커에 반영 (W10-e - AIOPS-01). 편집 책임자·관리자만(review_item.decide).
//  · POST { itemId, amendmentId } - 반영 판정(승인 전 거부·중복 거부)은 DB 함수 amendment_candidate_apply가 하고, 이 API는 입력 모양 검사·감사 기록만 한다
//  · 예전에는 브리핑 호 관리 API(/api/admin/brief)의 op=apply_amendment였다. 브리핑 호는 PO 2026-11-01 결정으로 지웠고 이 기능만 옮겼다
export const dynamic = "force-dynamic";

function rpcFail(error: { code?: string; message: string }): Response {
  if (error.code === "23514" || error.code === "42501" || error.code === "P0002") return errorJson(422, "입력값을 확인하세요", { errors: [error.message] });
  console.error("[amendment-candidates] DB 함수 오류:", error.code, error.message);
  return errorJson(500, "서버 오류가 났습니다 - 잠시 뒤 다시 시도하세요");
}

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const denied = await authorize(viewer, "review_item.decide", "amendment_candidate:apply");
  if (denied) return denied;
  const itemId = Number(body.itemId);
  const amendmentId = Number(body.amendmentId);
  if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(amendmentId) || amendmentId <= 0) return errorJson(422, "입력값을 확인하세요", { errors: ["itemId·amendmentId: 번호가 필요합니다"] });
  const db = serviceDb();
  const actor = actorOf(viewer);
  const r = await db.rpc("amendment_candidate_apply", { p_item_id: itemId, p_amendment_id: amendmentId, p_actor: actor });
  if (r.error) {
    await writeAudit(db, { actor, action: "amendment_candidate.apply_denied", target: `review_items:${itemId}`, before: null, after: { error: r.error.message.slice(0, 200) }, reason: "개정 단계 후보 반영 거부" });
    return rpcFail(r.error);
  }
  await writeAudit(db, { actor, action: "amendment_candidate.apply", target: `review_items:${itemId}`, before: null, after: { amendmentEventId: r.data, amendmentId }, reason: "승인된 개정 단계 후보를 개정 트래커에 반영 (origin=auto)" });
  return json({ amendmentEventId: r.data });
});
