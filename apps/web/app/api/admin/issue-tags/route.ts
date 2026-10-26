import { can, type Action } from "@/lib/access";
import { parseCaseTagApply, parseId, parseTagPropose, TAG_OPS } from "@/lib/issues/input";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { loadTagsBoard } from "@/lib/server/issues/board";
import { revalidatePublicData } from "@/lib/server/public/cache";

// 쟁점 태그 사전·결정례 태그 관리 (W11-d d2·d5 - PRD-03 AIOPS-12, docs/dev/W11-d_설계.md 3장). 편집자가 제안·붙이고, 승인해야 목록(TRU-05·RDV-08)에 오른다.
//  · GET - 태그·결정례 태그·최근 감사 (issue_graph.edit 또는 issue_tag.approve)
//  · POST op=propose {tag_key, label, hub, synonyms?}  새 태그 또는 새 버전 제안 (issue_graph.edit)
//  · POST op=apply {case_id, issue_tag_id}             결정례·해석에 승인된 태그 붙이기(제안 상태) (issue_graph.edit)
//  · POST op=approve {id} / op=retire {id}             태그 승인·폐기 (issue_tag.approve)
//  · POST op=approve_case {id}                         결정례 태그 승인 (issue_tag.approve)
// 이 경로에 AI는 없다 (4단계 AIOPS-07이 같은 표에 origin ai 후보를 따로 쓴다).
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const LIST_ACTIONS: Action[] = ["issue_graph.edit", "issue_tag.approve"];
const ACTION_OF: Record<(typeof TAG_OPS)[number], Action> = { propose: "issue_graph.edit", apply: "issue_graph.edit", approve: "issue_tag.approve", retire: "issue_tag.approve", approve_case: "issue_tag.approve" };

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const action = LIST_ACTIONS.find((a) => can(viewer, a)) ?? "issue_graph.edit";
  const denied = await authorize(viewer, action, "issue_tags:list");
  if (denied) return denied;
  return json(await loadTagsBoard(serviceDb()));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op) as (typeof TAG_OPS)[number];
  if (!(TAG_OPS as readonly string[]).includes(op)) return invalid([`op: ${TAG_OPS.join("·")} 중 하나입니다`]);
  const denied = await authorize(viewer, ACTION_OF[op], `issue_tags:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "propose") {
    const p = parseTagPropose(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.from("issue_tags").insert({ ...p.value, proposed_by: actor }).select("id, tag_key, version, status").single();
    if (error) {
      if (error.code === "23514" || error.code === "P0001") return invalid([error.message]);
      throw dbError(error, "issue_tags 추가");
    }
    await writeAudit(db, { actor, action: "issue_tag.propose", target: `issue_tags:${(data as { id: number }).id}`, before: null, after: { tag_key: p.value.tag_key, hub: p.value.hub }, reason: "쟁점 태그 제안(승인 전 목록 0)" });
    return json({ created: data }, 201);
  }

  if (op === "apply") {
    const p = parseCaseTagApply(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.from("case_issue_tags").insert({ case_id: p.value.caseId, issue_tag_id: p.value.issueTagId, applied_by: actor }).select("id, status").single();
    if (error) {
      if (error.code === "23505") return errorJson(409, "같은 결정례에 같은 쟁점 태그가 이미 있습니다");
      if (error.code === "23503" || error.code === "23514") return invalid([error.message]);
      throw dbError(error, "case_issue_tags 추가");
    }
    return json({ created: data }, 201);
  }

  const p = parseId(body, op === "approve_case" ? "결정례 태그" : "쟁점 태그");
  if (!p.ok) return invalid(p.errors);
  const fn = op === "approve" ? "issue_tag_approve" : op === "retire" ? "issue_tag_retire" : "case_issue_tag_approve";
  const { data, error } = await db.rpc(fn, { p_id: p.value.id, p_actor: actor });
  if (error) throw dbError(error, `쟁점 태그 ${op}`);
  const r = data as { ok: boolean; code: string; message: string };
  if (!r.ok) return errorJson(409, r.message, { code: r.code });
  revalidatePublicData();
  return json({ done: op });
});
