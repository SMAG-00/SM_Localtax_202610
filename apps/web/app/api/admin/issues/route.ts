import { can, type Action } from "@/lib/access";
import { GRAPH_OPS, parseGraphDraft, parseGraphSign, parseId } from "@/lib/issues/input";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { loadGraphsBoard } from "@/lib/server/issues/board";
import { revalidatePublicData } from "@/lib/server/public/cache";

// 쟁점 연결 지도 관리 (W11-d d5 - PRD-03 LINK-01, docs/dev/W11-d_설계.md 5장). 경로는 하나: 초안 -> 검토 요청 -> 감수 서명 -> 공개.
//  · GET - 목록과 최근 감사 (issue_graph.edit 또는 issue_graph.sign). 노드·연결선 본문은 싣지 않는다.
//  · POST op=create {slug, hub, title, summary?, as_of?, nodes, edges, guide_refs?}  초안 (issue_graph.edit). 노드는 번호만, 없는 조문·결정례·가이드는 DB가 거부한다. 항상 새 버전
//  · POST op=submit {id}            검토 요청 (issue_graph.edit)
//  · POST op=sign {id, sheet_ref}   감수 서명 (issue_graph.sign - 세무 감수위원만, 관리자도 403 + 거부 감사)
//  · POST op=publish {id}           공개 (issue_graph.edit). 서명 없음은 409 + issue_audit 거부 1행
//  · POST op=retire {id}            내리기 (issue_graph.edit)
// 공개는 DB 함수 issue_graph_publish()만 한다 (service_role도 직접 UPDATE 권한 없음). AI는 이 경로에 없다.
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const LIST_ACTIONS: Action[] = ["issue_graph.edit", "issue_graph.sign"];
const ACTION_OF: Record<(typeof GRAPH_OPS)[number], Action> = { create: "issue_graph.edit", submit: "issue_graph.edit", sign: "issue_graph.sign", publish: "issue_graph.edit", retire: "issue_graph.edit" };

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const action = LIST_ACTIONS.find((a) => can(viewer, a)) ?? "issue_graph.edit";
  const denied = await authorize(viewer, action, "issue_graphs:list");
  if (denied) return denied;
  return json(await loadGraphsBoard(serviceDb()));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op) as (typeof GRAPH_OPS)[number];
  if (!(GRAPH_OPS as readonly string[]).includes(op)) return invalid([`op: ${GRAPH_OPS.join("·")} 중 하나입니다`]);
  const denied = await authorize(viewer, ACTION_OF[op], `issue_graphs:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "create") {
    const p = parseGraphDraft(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.from("issue_graphs").insert({ ...p.value, drafted_by: actor }).select("id, slug, version, status").single();
    if (error) {
      if (error.code === "23514" || error.code === "P0001") return invalid([error.message]);
      throw dbError(error, "issue_graphs 추가");
    }
    await writeAudit(db, { actor, action: "issue_graph.draft.create", target: `issue_graphs:${(data as { id: number }).id}`, before: null, after: { slug: p.value.slug, nodes: p.value.nodes.length, edges: p.value.edges.length }, reason: "쟁점 지도 초안 만들기(서명 전 비공개)" });
    return json({ created: data }, 201);
  }

  if (op === "sign") {
    const p = parseGraphSign(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.rpc("issue_graph_sign", { p_id: p.value.id, p_signer: actor, p_sheet_ref: p.value.sheetRef });
    if (error) throw dbError(error, "쟁점 지도 감수 서명");
    const r = data as { ok: boolean; code: string; message: string };
    return r.ok ? json({ signed: true }) : errorJson(409, r.message, { code: r.code });
  }

  const p = parseId(body, "쟁점 지도 버전");
  if (!p.ok) return invalid(p.errors);
  const fn = op === "submit" ? "issue_graph_submit" : op === "publish" ? "issue_graph_publish" : "issue_graph_retire";
  const { data, error } = await db.rpc(fn, op === "publish" ? { p_id: p.value.id, p_publisher: actor } : { p_id: p.value.id, p_actor: actor });
  if (error) throw dbError(error, `쟁점 지도 ${op}`);
  const r = data as { ok: boolean; code: string; message: string };
  if (!r.ok) return errorJson(409, r.message, { code: r.code });
  if (op !== "submit") revalidatePublicData();
  return json({ [op === "submit" ? "submitted" : op === "publish" ? "published" : "retired"]: true });
});
