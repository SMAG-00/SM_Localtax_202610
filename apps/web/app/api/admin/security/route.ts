import { parseCheck, parseId, parseItemDraft, parseRound, SECURITY_OPS } from "@/lib/security/items";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { loadSecurityBoard } from "@/lib/server/security/board";
import { revalidatePublicData } from "@/lib/server/public/cache";

// 보안 정책 페이지 항목·통제 자가 점검 관리 (W12-g g3 - PRD-04 SEC-01, docs/dev/W12-g_설계.md). 권한 security_page.edit (관리자만).
//  · GET - 항목·점검 기록·회차·감사
//  · POST op=draft {item_key, body, confirmed_on, contract_verified?}  항목 초안 (본문은 PO 입력 - 인증 단정 표현은 422)
//  · POST op=publish {id} / op=retire {id}                           게시·내림 (DB 함수가 문구 검사·확인일·계약 확인을 다시 검사, 거부 409 + 감사)
//  · POST op=check {round_no, control_key, control_title, result, checked_on, gap_plan?, due_on?}  통제 점검 한 줄 (추가만)
//  · POST op=complete_round {round_no}                               점검 회차 완료
// 이 경로에 AI는 없다.
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "security_page.edit", "security:list");
  if (denied) return denied;
  return json(await loadSecurityBoard(serviceDb()));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op) as (typeof SECURITY_OPS)[number];
  if (!(SECURITY_OPS as readonly string[]).includes(op)) return invalid([`op: ${SECURITY_OPS.join("·")} 중 하나입니다`]);
  const denied = await authorize(viewer, "security_page.edit", `security:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "draft") {
    const p = parseItemDraft(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.from("security_policy_items").insert({ ...p.value, drafted_by: actor }).select("id, item_key, version, status").single();
    if (error) {
      if (error.code === "23514" || error.code === "P0001") return invalid([error.message]);
      throw dbError(error, "security_policy_items 추가");
    }
    await writeAudit(db, { actor, action: "security_item.draft", target: `security_policy_items:${(data as { id: number }).id}`, before: null, after: { item_key: p.value.item_key }, reason: "보안 정책 항목 초안(게시 전 공개 0)" });
    return json({ created: data }, 201);
  }

  if (op === "check") {
    const p = parseCheck(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.from("security_control_checks").insert({ ...p.value, checked_by: actor }).select("id, round_no, control_key, result").single();
    if (error) {
      if (error.code === "23514" || error.code === "P0001") return invalid([error.message]);
      throw dbError(error, "security_control_checks 추가");
    }
    return json({ created: data }, 201);
  }

  if (op === "complete_round") {
    const p = parseRound(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.rpc("security_self_check_complete", { p_round: p.value.round, p_actor: actor });
    if (error) throw dbError(error, "보안 자가 점검 완료");
    const r = data as { ok: boolean; code: string; message: string };
    if (!r.ok) return errorJson(409, r.message, { code: r.code });
    revalidatePublicData();
    return json({ done: op });
  }

  const p = parseId(body, "보안 정책 항목");
  if (!p.ok) return invalid(p.errors);
  const { data, error } = await db.rpc(op === "publish" ? "security_item_publish" : "security_item_retire", { p_id: p.value.id, p_actor: actor });
  if (error) throw dbError(error, `보안 정책 항목 ${op}`);
  const r = data as { ok: boolean; code: string; message: string };
  if (!r.ok) return errorJson(409, r.message, { code: r.code });
  revalidatePublicData();
  return json({ done: op });
});
