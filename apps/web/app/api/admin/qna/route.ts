import { QNA_OPS, parseHide, parseRelease, parseReportHandle, parseSanctionAdd, parseSanctionLift } from "@/lib/admin/qna-rules";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { loadModerationBoard } from "@/lib/server/qna/admin";

// 라운지 관리 (W13-g QNA-03·05) - 편집 책임자·관리자(권한 qna.moderate).
//  · GET - 게시 보류 글(가림이 끝난 본문)·처리 대기 신고(목표 시각 포함)·제재 중 목록
//  · POST op=release {type,id} 보류 풀기 / hide {type,id,reason} 숨김 / report_handle {id,decision,hide,sanction_days,note} / sanction_add {user_id,reason,days} / sanction_lift {id}
// 규칙은 DB RPC가 정본이고 거부는 { ok:false, code }를 404/409/422로 옮긴다. 모든 쓰기는 감사 로그에 남는다.
export const dynamic = "force-dynamic";

const CODE_STATUS: Record<string, number> = { not_found: 404, no_user: 404, not_held: 409, already_handled: 409 };

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "qna.moderate", "qna:list");
  if (denied) return denied;
  return json(await loadModerationBoard(serviceDb()));
});

export const POST = handle(
  async (request: Request) => {
    const viewer = await requireViewer(request);
    if (viewer instanceof Response) return viewer;
    const body = await readJson(request);
    const op = String(body.op);
    if (!(QNA_OPS as readonly string[]).includes(op)) return errorJson(422, "입력값을 확인하세요", { errors: [`op: ${QNA_OPS.join("·")} 중 하나입니다`] });
    const denied = await authorize(viewer, "qna.moderate", `qna:${op}`);
    if (denied) return denied;
    const db = serviceDb();
    const actor = actorOf(viewer);
    const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });

    const rpc = async (fn: string, args: Record<string, unknown>, action: string, target: string, after: unknown, reason: string) => {
      const { data, error } = await db.rpc(fn, args);
      if (error) throw dbError(error, fn);
      const r = data as { ok: boolean; code?: string };
      if (!r.ok) return errorJson(CODE_STATUS[r.code ?? ""] ?? 422, "처리할 수 없습니다", { code: r.code });
      await writeAudit(db, { actor, action, target, before: null, after, reason });
      return json({ ok: true });
    };

    if (op === "release") {
      const p = parseRelease(body);
      if (!p.ok) return invalid(p.errors);
      return rpc("qna_release", { p_type: p.value.type, p_target: p.value.id, p_actor: actor }, "qna.release", `qna_${p.value.type}:${p.value.id}`, { status: "public" }, "게시 보류 풀기 - 가림·표현 확인");
    }
    if (op === "hide") {
      const p = parseHide(body);
      if (!p.ok) return invalid(p.errors);
      return rpc("qna_hide", { p_type: p.value.type, p_target: p.value.id, p_reason: p.value.reason, p_actor: actor }, "qna.hide", `qna_${p.value.type}:${p.value.id}`, { status: "hidden" }, p.value.reason);
    }
    if (op === "report_handle") {
      const p = parseReportHandle(body);
      if (!p.ok) return invalid(p.errors);
      return rpc(
        "qna_report_handle",
        { p_report: p.value.id, p_decision: p.value.decision, p_hide: p.value.hide, p_sanction_days: p.value.sanctionDays, p_note: p.value.note, p_actor: actor },
        "qna.report.handle",
        `qna_reports:${p.value.id}`,
        { decision: p.value.decision, hide: p.value.hide, sanction_days: p.value.sanctionDays },
        p.value.note,
      );
    }
    if (op === "sanction_add") {
      const p = parseSanctionAdd(body);
      if (!p.ok) return invalid(p.errors);
      return rpc("qna_sanction_add", { p_user: p.value.userId, p_reason: p.value.reason, p_days: p.value.days, p_actor: actor }, "qna.sanction.add", `users:${p.value.userId}`, { days: p.value.days }, p.value.reason);
    }
    const p = parseSanctionLift(body);
    if (!p.ok) return invalid(p.errors);
    return rpc("qna_sanction_lift", { p_id: p.value.id, p_actor: actor }, "qna.sanction.lift", `qna_sanctions:${p.value.id}`, { lifted: true }, "제재 해제");
  },
  { revalidatesPublic: true },
);
