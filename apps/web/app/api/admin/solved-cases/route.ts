import { SOLVED_OPS, parseApproveInput, parseCaseInput, parseClassifyReview, parseUnpublishInput } from "@/lib/qna/solved";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { loadSolvedBoard } from "@/lib/server/qna/solved";

// 홈 해결 사례·질문 분류 큐 관리 (W13-h HOME-11 · AIOPS-15) - 편집 책임자·관리자(권한 solved_case.approve).
//  · GET - 후보(동의한 채택 질문)·카드 상태·분류 제안 큐
//  · POST op=save {question_id,situation,issue,result,lesson} 초안 저장 / approve {id,mask_confirmed} 승인 / unpublish {id,reason} 내림 / classify_review {id,decision,final_tax_type}
// 규칙은 DB RPC가 정본이다 (동의 없음·가림 확인 없음·네 칸 비어 있음 거부). 카드 문장은 사람이 쓴다 - 모델 호출 0. 모든 쓰기는 감사 로그에 남는다.
export const dynamic = "force-dynamic";

const CODE_STATUS: Record<string, number> = { not_found: 404, not_draft: 409, no_consent: 409, not_resolved: 409 };

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "solved_case.approve", "solved_case:list");
  if (denied) return denied;
  return json(await loadSolvedBoard(serviceDb()));
});

export const POST = handle(
  async (request: Request) => {
    const viewer = await requireViewer(request);
    if (viewer instanceof Response) return viewer;
    const body = await readJson(request);
    const op = String(body.op);
    if (!(SOLVED_OPS as readonly string[]).includes(op)) return errorJson(422, "입력값을 확인하세요", { errors: [`op: ${SOLVED_OPS.join("·")} 중 하나입니다`] });
    const denied = await authorize(viewer, "solved_case.approve", `solved_case:${op}`);
    if (denied) return denied;
    const db = serviceDb();
    const actor = actorOf(viewer);
    const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });

    const rpc = async (fn: string, args: Record<string, unknown>, action: string, target: string, after: unknown, reason: string) => {
      const { data, error } = await db.rpc(fn, args);
      if (error) throw dbError(error, fn);
      const r = data as { ok: boolean; code?: string; id?: number };
      if (!r.ok) return errorJson(CODE_STATUS[r.code ?? ""] ?? 422, "처리할 수 없습니다", { code: r.code });
      await writeAudit(db, { actor, action, target, before: null, after, reason });
      return json({ ok: true, id: r.id ?? null });
    };

    if (op === "save") {
      const p = parseCaseInput(body);
      if (!p.ok) return invalid(p.errors);
      const v = p.value;
      return rpc("qna_solved_case_save", { p_question: v.questionId, p_situation: v.situation, p_issue: v.issue, p_result: v.result, p_lesson: v.lesson, p_actor: actor }, "solved_case.save", `qna_questions:${v.questionId}`, { status: "draft" }, "해결 사례 카드 초안 저장");
    }
    if (op === "approve") {
      const p = parseApproveInput(body);
      if (!p.ok) return invalid(p.errors);
      return rpc("qna_solved_case_approve", { p_id: p.value.id, p_mask_confirmed: true, p_actor: actor }, "solved_case.approve", `qna_solved_cases:${p.value.id}`, { status: "approved", mask_confirmed: true }, "개인정보 가림 확인 후 승인");
    }
    if (op === "unpublish") {
      const p = parseUnpublishInput(body);
      if (!p.ok) return invalid(p.errors);
      return rpc("qna_solved_case_unpublish", { p_id: p.value.id, p_reason: p.value.reason, p_actor: actor }, "solved_case.unpublish", `qna_solved_cases:${p.value.id}`, { status: "unpublished" }, p.value.reason);
    }
    const p = parseClassifyReview(body);
    if (!p.ok) return invalid(p.errors);
    return rpc("qna_classify_review", { p_id: p.value.id, p_decision: p.value.decision, p_final_tax_type: p.value.finalTaxType, p_actor: actor }, "qna.classify.review", `qna_classifications:${p.value.id}`, { decision: p.value.decision, final_tax_type: p.value.finalTaxType }, "분류 제안 검토");
  },
  { revalidatesPublic: true },
);
