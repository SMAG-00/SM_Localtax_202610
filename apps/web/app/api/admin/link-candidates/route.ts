import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, readJson } from "@/lib/server/http";
import { createArticleCandidates, pendingArticleIds, publishApprovedCandidates, releaseHold } from "@/lib/server/links/related-links";

// 기사 링크 후보·해석 문서 공개 보류 (W10-d - ART-12 · TX-10). 편집 책임자·관리자만(review_item.decide - 거부도 감사).
//  · GET ?item=N - 검수 항목의 후보 목록(본문 속 표기 그대로, 양 끝, 출처 auto)
//  · POST op=extract { articleIds? | all: true, limit? } - 기사 본문에서 후보를 만들고 검수 항목을 연다(멱등). 감사 related_links.extract
//  · POST op=publish { id } - 승인된 link_candidates 검수 항목을 반영(확인/반려 + 처리 완료). 승인 전 호출은 409. 감사 related_links.publish
//  · POST op=release_hold { holdId, note } - 공개 보류 풀기(검수 승인 + 주민등록번호 패턴 없음일 때만, 아니면 422). 감사 legal_doc.hold_release
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "review_item.decide", "link_candidates:list");
  if (denied) return denied;
  const item = Number(new URL(request.url).searchParams.get("item"));
  if (!Number.isInteger(item) || item <= 0) return errorJson(422, "입력값을 확인하세요", { errors: ["item: 검수 항목 번호가 필요합니다"] });
  const r = await serviceDb().from("links").select("id, src_kind, src_id, dst_kind, dst_id, dst_article_no, dst_branch_no, relation, origin, status, evidence").eq("review_item_id", item).order("id");
  return json({ links: r.data ?? [] });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  const denied = await authorize(viewer, "review_item.decide", `link_candidates:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "extract") {
    const limit = Number(body.limit ?? 50);
    const ids = body.all === true ? await pendingArticleIds(db, limit) : Array.isArray(body.articleIds) ? body.articleIds.map(Number) : [];
    if (ids.length === 0) return errorJson(422, "입력값을 확인하세요", { errors: ["articleIds 또는 all: true가 필요합니다"] });
    const results = await createArticleCandidates(db, ids, actor);
    await writeAudit(db, { actor, action: "related_links.extract", target: "links:article", before: null, after: { articles: results.length, candidates: results.reduce((s, r) => s + r.newCandidates, 0) }, reason: "기사 조문·사건번호 링크 후보 만들기" });
    return json({ results });
  }
  if (op === "publish") {
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return errorJson(422, "입력값을 확인하세요", { errors: ["id: 검수 항목 번호가 필요합니다"] });
    const result = await publishApprovedCandidates(db, id, actor);
    await writeAudit(db, { actor, action: "related_links.publish", target: `review_items:${id}`, before: null, after: result, reason: "승인된 링크 후보 반영" });
    return json(result);
  }
  if (op === "release_hold") {
    const holdId = Number(body.holdId);
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
    const errors: string[] = [];
    if (!Number.isInteger(holdId) || holdId <= 0) errors.push("holdId: 보류 번호가 필요합니다");
    if (note === "") errors.push("note: 푸는 이유가 필요합니다");
    if (errors.length) return errorJson(422, "입력값을 확인하세요", { errors });
    await releaseHold(db, holdId, note, actor);
    await writeAudit(db, { actor, action: "legal_doc.hold_release", target: `legal_doc_holds:${holdId}`, before: null, after: { released: true }, reason: note });
    return json({ released: true });
  }
  return errorJson(422, "op는 extract·publish·release_hold 중 하나입니다");
});
