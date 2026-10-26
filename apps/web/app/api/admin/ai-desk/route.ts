import { can } from "@/lib/access";
import { DESK_ACTION, DESK_OPS, parseChannels, parseChecked, parseDeskId, parseReason, type DeskOp } from "@/lib/ai-desk/input";
import { actorOf } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { loadDeskBoard } from "@/lib/server/ops-ai/desk-board";
import { approveReviewItem, closeReviewItem, draftArticleAiBox, draftChannelCopies } from "@/lib/server/ops-ai/editorial";
import { revalidatePublicData } from "@/lib/server/public/cache";

// 편집국 AI 승인 (W12-f - PRD-04 AIOPS-07~10 · CASE-05 · ART-13·14, docs/dev/W12-f_설계.md 4장). AI 초안은 여기서 사람이 승인해야만 공개 뷰에 오른다.
//  · GET  - 요지·AI 태그 후보·상자·배너·채널 원고·감사 (case_summary.approve 또는 ai_box.approve)
//  · POST op=approve_summary {id, 체크 4칸} / reject_summary {id, reason} / approve_tag {id}   (case_summary.approve)
//  · POST op=approve_box {id, 체크 4칸} / reject_box {id, reason} / make_box {article_id}      (ai_box.approve)
//  · POST op=approve_banner {id} / reject_banner {id, reason} / retire_banner {id}            (ai_box.approve)
//  · POST op=make_channels {article_id, channels}                                              (ai_box.approve - 채널 글자 수 상한 설정이 있는 채널만)
// 이 경로는 공개 표에 AI 글을 직접 쓰지 않는다 - 승인은 DB 함수(case_summary_approve 등)가 검수 항목 승인 여부와 원문·기사 버전을 확인한다.
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
type R = { ok: boolean; code: string; message: string };

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const action = can(viewer, "case_summary.approve") ? "case_summary.approve" : "ai_box.approve";
  const denied = await authorize(viewer, action, "ai_desk:list");
  if (denied) return denied;
  return json(await loadDeskBoard(serviceDb()));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op) as DeskOp;
  if (!(DESK_OPS as readonly string[]).includes(op)) return invalid([`op: ${DESK_OPS.join("·")} 중 하나입니다`]);
  const denied = await authorize(viewer, DESK_ACTION[op], `ai_desk:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);
  const reply = (r: R) => (r.ok ? json({ done: op }) : errorJson(409, r.message, { code: r.code }));

  // 검수 항목 승인 단계의 거부(체크리스트 부족 등)는 422로 돌려준다
  const guarded = async (fn: () => Promise<Response>): Promise<Response> => {
    try {
      return await fn();
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      if (/체크리스트|허용되지 않은 상태 전이/.test(m)) return errorJson(422, m);
      throw e;
    }
  };

  if (op === "approve_summary" || op === "reject_summary") {
    const p = parseDeskId(body);
    if (!p.ok) return invalid(p.errors);
    if (op === "reject_summary") {
      const why = parseReason(body);
      if (!why.ok) return invalid(why.errors);
      const { data, error } = await db.rpc("case_summary_reject", { p_id: p.value, p_actor: actor, p_reason: why.value });
      if (error) throw dbError(error, "case_summary_reject");
      return reply(data as R);
    }
    const s = await db.from("case_summaries").select("review_item_id").eq("id", p.value).limit(1);
    if (s.error) throw dbError(s.error, "case_summaries 조회");
    const itemId = (s.data?.[0] as { review_item_id: number | null } | undefined)?.review_item_id;
    if (!itemId) return errorJson(404, "요지 초안이 없습니다");
    return guarded(async () => {
      await approveReviewItem(db, itemId, actor, parseChecked(body, "case_summary"));
      const { data, error } = await db.rpc("case_summary_approve", { p_id: p.value, p_actor: actor });
      if (error) throw dbError(error, "case_summary_approve");
      const r = data as R;
      if (r.ok) {
        await closeReviewItem(db, itemId, actor);
        revalidatePublicData();
      }
      return reply(r);
    });
  }

  if (op === "approve_tag") {
    const p = parseDeskId(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.rpc("case_issue_tag_approve", { p_id: p.value, p_actor: actor });
    if (error) throw dbError(error, "case_issue_tag_approve");
    revalidatePublicData();
    return reply(data as R);
  }

  if (op === "approve_box" || op === "reject_box") {
    const p = parseDeskId(body);
    if (!p.ok) return invalid(p.errors);
    if (op === "reject_box") {
      const why = parseReason(body);
      if (!why.ok) return invalid(why.errors);
      const { data, error } = await db.rpc("article_ai_box_reject", { p_id: p.value, p_actor: actor, p_reason: why.value });
      if (error) throw dbError(error, "article_ai_box_reject");
      return reply(data as R);
    }
    const b = await db.from("article_ai_boxes").select("review_item_id").eq("id", p.value).limit(1);
    if (b.error) throw dbError(b.error, "article_ai_boxes 조회");
    const itemId = (b.data?.[0] as { review_item_id: number | null } | undefined)?.review_item_id;
    if (!itemId) return errorJson(404, "요약 상자 초안이 없습니다");
    return guarded(async () => {
      await approveReviewItem(db, itemId, actor, parseChecked(body, "article_ai_box"));
      const { data, error } = await db.rpc("article_ai_box_approve", { p_id: p.value, p_actor: actor });
      if (error) throw dbError(error, "article_ai_box_approve");
      const r = data as R;
      if (r.ok) {
        await closeReviewItem(db, itemId, actor);
        revalidatePublicData();
      }
      return reply(r);
    });
  }

  if (op === "make_box" || op === "make_channels") {
    const p = parseDeskId(body, "article_id");
    if (!p.ok) return invalid(p.errors);
    if (op === "make_box") return json({ result: await draftArticleAiBox(db, p.value, new Date()) });
    const ch = parseChannels(body);
    if (!ch.ok) return invalid(ch.errors);
    return json({ result: await draftChannelCopies(db, p.value, ch.value, new Date()) });
  }

  // 배너
  const p = parseDeskId(body);
  if (!p.ok) return invalid(p.errors);
  if (op === "retire_banner") {
    const { data, error } = await db.rpc("impact_banner_retire", { p_id: p.value, p_actor: actor });
    if (error) throw dbError(error, "impact_banner_retire");
    revalidatePublicData();
    return reply(data as R);
  }
  const approve = op === "approve_banner";
  let reason: string | null = null;
  if (!approve) {
    const why = parseReason(body);
    if (!why.ok) return invalid(why.errors);
    reason = why.value;
  }
  const { data, error } = await db.rpc("impact_banner_decide", { p_id: p.value, p_actor: actor, p_approve: approve, p_reason: reason });
  if (error) throw dbError(error, "impact_banner_decide");
  if (approve) revalidatePublicData();
  return reply(data as R);
});

