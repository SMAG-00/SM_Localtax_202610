import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, readJson } from "@/lib/server/http";
import { publishFieldItem, runRightsCheck } from "@/lib/server/field-data/service";

// 분야 데이터 후보 처리 (W10-h - PR-06 · LG-15 · DF-06). 편집 책임자·관리자만(review_item.decide). 후보의 승인·반려는 /api/admin/review-items 가 하고, 여기는 그 뒤 단계다.
//  · POST op=rights-check { id } - 제4유형 후보의 공개 본문 유사도 검사(통과 기록을 남김). 본문이 없으면 검사할 것이 없다
//  · POST op=publish { id } - 승인된 후보 공개 반영. 승인 전·제4유형 통과 기록 없음·유형 없음·원천 이용 조건 불허는 422 (DB 함수가 판정). 감사 field_data.publish
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  const denied = await authorize(viewer, "review_item.decide", `field_data:${op}`);
  if (denied) return denied;
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return errorJson(422, "입력값을 확인하세요", { errors: ["id: 검수 항목 번호가 필요합니다"] });
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "rights-check") {
    const verdict = await runRightsCheck(db, id, actor);
    await writeAudit(db, { actor, action: "field_data.rights_check", target: `review_items:${id}`, before: null, after: { status: verdict?.status ?? "no_body" }, reason: "제4유형 공개 본문 유사도 검사" });
    return json({ verdict });
  }
  if (op === "publish") {
    const result = await publishFieldItem(db, id, actor);
    await writeAudit(db, { actor, action: "field_data.publish", target: `review_items:${id}`, before: null, after: { action: result.action, target: result.target ?? null }, reason: "승인된 분야 데이터 후보 공개 반영" });
    return json({ result });
  }
  return errorJson(422, "op는 rights-check·publish 중 하나입니다");
});
