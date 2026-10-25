import { parseAssign, parseTransition, REVIEW_KINDS, REVIEW_STATUSES } from "@/lib/review/rules";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, readJson } from "@/lib/server/http";
import { assignReviewItem, getReviewDetail, listReviewItems, transitionReviewItem } from "@/lib/server/review/service";

// 공통 검수 큐 (W10-c — PRD-02 REV-01~03). 편집 책임자·관리자만(review_item.decide).
//  · GET — 열린 항목 + 최근 처리 20건. ?id=N이면 한 항목의 후보·원문 앞부분·전이 기록
//  · POST op=transition { id, to, reason?, checked?, parts? } — 상태 전이는 DB 함수가 판정한다(허용 밖 전이·체크 누락·사유 없음·4번째 재시도는 422). 감사 review_item.<목적지>
//  · POST op=assign { id, assignee } — 담당자 배정(열린 항목만). 감사 review_item.assign
// 승인(approved)은 검수 상태만 바꾼다 — 공개 자료 반영은 각 종류의 처리 단위가 승인된 항목만 읽어 한다(승인 전 반영 0).
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "review_item.decide", "review_items:list");
  if (denied) return denied;
  const db = serviceDb();
  const url = new URL(request.url);
  const idParam = url.searchParams.get("id");
  if (idParam !== null) {
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) return errorJson(422, "입력값을 확인하세요", { errors: ["id: 검수 항목 번호가 필요합니다"] });
    return json(await getReviewDetail(db, id));
  }
  const kind = url.searchParams.get("kind") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  if (kind && !(REVIEW_KINDS as readonly string[]).includes(kind)) return errorJson(422, "입력값을 확인하세요", { errors: ["kind: 알 수 없는 종류입니다"] });
  if (status && !(REVIEW_STATUSES as readonly string[]).includes(status)) return errorJson(422, "입력값을 확인하세요", { errors: ["status: 알 수 없는 상태입니다"] });
  return json(await listReviewItems(db, { kind, status }));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  const denied = await authorize(viewer, "review_item.decide", `review_items:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "transition") {
    const p = parseTransition(body);
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const before = await getReviewDetail(db, p.value.id);
    const item = await transitionReviewItem(db, p.value, actor);
    await writeAudit(db, {
      actor,
      action: `review_item.${p.value.to}`,
      target: `review_items:${item.id}`,
      before: { status: before.item.status, attempts: before.item.attempts },
      after: { status: item.status, attempts: item.attempts, checkedKeys: item.checked_keys, approvedParts: item.approved_parts },
      reason: p.value.reason ?? `검수 항목 ${item.kind} ${before.item.status} → ${item.status}`,
    });
    return json({ item });
  }

  if (op === "assign") {
    const p = parseAssign(body);
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const item = await assignReviewItem(db, p.value.id, p.value.assignee, actor);
    await writeAudit(db, { actor, action: "review_item.assign", target: `review_items:${item.id}`, before: null, after: { assignee: item.assignee }, reason: "검수 담당자 배정" });
    return json({ item });
  }

  return errorJson(422, "op는 transition·assign 중 하나입니다");
});
