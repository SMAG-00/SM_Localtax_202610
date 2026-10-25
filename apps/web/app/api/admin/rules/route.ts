import { RULES_OPS, RULE_KIND_RPC, RULE_KIND_TABLE, parseApprove, parseCreate, parseSign } from "@/lib/accuracy/input";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { loadRulesBoard } from "@/lib/server/accuracy/board";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { revalidatePublicData } from "@/lib/server/public/cache";

// 룰셋·판정표·지방세 달력 관리 (W10-a a6 - PRD-02 RULE-02·03·04, docs/dev/W10-a_설계.md 11.2). 경로는 하나: 초안 -> 감수 서명 -> 관리자 승인.
//  · GET - 목록과 최근 감사 (ruleset.read - 세무 감수위원·관리자). 본문은 싣지 않는다.
//  · POST op=create {kind, version, source_ref, basis_event_id?|basis_note, body}  초안 만들기 (ruleset.approve - 관리자). 값은 붙여 넣은 JSON을 검사만 한다
//  · POST op=sign {kind, id, sheet_ref}  감수 서명 (ruleset.sign - 세무 감수위원만, 관리자도 403 + 거부 감사)
//  · POST op=approve {kind, id}          활성화 승인 (ruleset.approve - 관리자만, 403 + 거부 감사). 서명 없음·근거 개정 단계 부족은 409 + rules_audit 거부 1행
// 스크립트로 활성화하는 경로는 없다 - 활성화는 DB 함수 approve_*()만 한다 (service_role도 직접 UPDATE 권한 없음).
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "ruleset.read", "rules:list");
  if (denied) return denied;
  return json(await loadRulesBoard(serviceDb()));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!(RULES_OPS as readonly string[]).includes(op)) return invalid([`op: ${RULES_OPS.join("·")} 중 하나입니다`]);
  const action = op === "sign" ? "ruleset.sign" : "ruleset.approve";
  const denied = await authorize(viewer, action, `rules:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "create") {
    const kind = String(body.kind);
    const p = parseCreate(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.from(p.value.table).insert({ ...p.value.row, created_by: actor }).select("id, version, status").single();
    if (error) {
      if (error.code === "23514" || error.code === "P0001") return invalid([error.message]);
      if (error.code === "23505") return errorJson(409, "같은 버전이 이미 있습니다 - 차수를 올려 새 버전으로 만드세요 (덮어쓰기 금지)");
      if (error.code === "23503") return invalid(["basis_event_id: 그런 개정 단계 기록이 없습니다"]);
      throw dbError(error, `${p.value.table} 추가`);
    }
    await writeAudit(db, { actor, action: "rules.draft.create", target: `${p.value.table}:${(data as { id: number }).id}`, before: null, after: { kind, version: p.value.row.version }, reason: "초안 만들기(서명 전 비활성)" });
    return json({ created: data }, 201);
  }

  if (op === "sign") {
    const p = parseSign(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.rpc(RULE_KIND_RPC[p.value.kind].sign, { p_id: p.value.id, p_signer: actor, p_sheet_ref: p.value.sheetRef });
    if (error) throw dbError(error, "감수 서명");
    const r = data as { ok: boolean; code: string; message: string };
    return r.ok ? json({ signed: true, table: RULE_KIND_TABLE[p.value.kind] }) : errorJson(409, r.message, { code: r.code });
  }

  const p = parseApprove(body);
  if (!p.ok) return invalid(p.errors);
  const { data, error } = await db.rpc(RULE_KIND_RPC[p.value.kind].approve, { p_id: p.value.id, p_approver: actor });
  if (error) throw dbError(error, "활성화 승인");
  const r = data as { ok: boolean; code: string; message: string };
  if (!r.ok) return errorJson(409, r.message, { code: r.code });
  revalidatePublicData();
  return json({ activated: true, table: RULE_KIND_TABLE[p.value.kind] });
});
