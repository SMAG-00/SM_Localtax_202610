import { can, type Action } from "@/lib/access";
import { ORDINANCE_OPS, parseLinkId, parseRegister, parseStatus, parseSummary } from "@/lib/ordinances/input";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { revalidatePublicData } from "@/lib/server/public/cache";
import { loadOrdinancesBoard } from "@/lib/server/ordinances/board";
import { registerOrdinance } from "@/lib/server/ordinances/service";

// 조례 연결 관리 (W11-e e6 - PRD-03 RDV-06 · TX-13). 시·도 도시정비 조례와 시·군·구 감면·세율 조례가 같은 목록·등록·확인일 규칙을 쓴다.
//  · GET - 목록과 확인일 경고 대상 (ordinance.manage·ordinance_summary.sign 중 하나)
//  · POST op=register {name, region_code, kind, source_url, effective_from, promulgated_on, promulgation_no, verified_at, body_text, article_no?, article_title?, summary?}
//         편집자 수동 등록 (ordinance.manage - 편집 책임자·관리자). 원문은 원문 DB에 한 번만, 요약 숫자가 원문에 없으면 422
//  · POST op=summary {id, summary}  편집 요약 저장 (ordinance.manage) - 숫자 검사 422, 저장하면 이전 서명은 무효
//  · POST op=sign {id}              요약 감수 서명 (ordinance_summary.sign - 세무 감수위원만, 관리자도 403 + 거부 감사)
//  · POST op=verify {id}            확인일을 지금으로 갱신 (ordinance.manage)
//  · POST op=status {id, status}    공개·숨김·초안 (ordinance.manage) - 출처·시행일·확인일이 없으면 DB가 거부(422)
// 조례 내용을 룰셋·계산기에 반영하는 경로는 없다 (룰셋 자동 반영 0).
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const LIST_ACTIONS: Action[] = ["ordinance.manage", "ordinance_summary.sign"];

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const action = LIST_ACTIONS.find((a) => can(viewer, a)) ?? "ordinance.manage";
  const denied = await authorize(viewer, action, "ordinances:list");
  if (denied) return denied;
  return json(await loadOrdinancesBoard(serviceDb()));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!(ORDINANCE_OPS as readonly string[]).includes(op)) return invalid([`op: ${ORDINANCE_OPS.join("·")} 중 하나입니다`]);
  const denied = await authorize(viewer, op === "sign" ? "ordinance_summary.sign" : "ordinance.manage", `ordinances:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "register") {
    const p = parseRegister(body);
    if (!p.ok) return invalid(p.errors);
    const r = await registerOrdinance(db, p.value, actor);
    if (!r.ok) return r.status === 409 ? errorJson(409, r.errors[0] ?? "충돌") : invalid(r.errors);
    await writeAudit(db, { actor, action: "ordinance.register", reason: "조례 수동 등록", target: `ordinance_links:${r.linkId}`, before: null, after: { region_code: p.value.regionCode, kind: p.value.kind } });
    return json({ registered: { id: r.linkId } }, 201);
  }

  if (op === "summary") {
    const p = parseSummary(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.from("ordinance_links").update({ summary: p.value.summary }).eq("id", p.value.id).select("id").maybeSingle();
    if (error) {
      if (error.code === "23514") return invalid([error.message.includes("number_mismatch") ? "summary: 요약의 숫자가 원문에 없습니다" : error.message]);
      throw dbError(error, "조례 요약 저장");
    }
    if (!data) return errorJson(404, "없는 연결입니다");
    await writeAudit(db, { actor, action: "ordinance.summary", reason: "조례 편집 요약 저장", target: `ordinance_links:${p.value.id}`, before: null, after: { saved: true } });
    return json({ saved: true });
  }

  if (op === "sign") {
    const p = parseLinkId(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.from("ordinance_links").update({ summary_signed_by: actor, summary_signed_at: new Date().toISOString() }).eq("id", p.value.id).not("summary", "is", null).select("id").maybeSingle();
    if (error) throw dbError(error, "조례 요약 서명");
    if (!data) return errorJson(409, "서명할 요약이 없거나 없는 연결입니다");
    await writeAudit(db, { actor, action: "ordinance.summary.sign", reason: "조례 요약 감수 서명", target: `ordinance_links:${p.value.id}`, before: null, after: { signed: true } });
    revalidatePublicData();
    return json({ signed: true });
  }

  if (op === "verify") {
    const p = parseLinkId(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.from("ordinance_links").update({ verified_at: new Date().toISOString() }).eq("id", p.value.id).select("id").maybeSingle();
    if (error) throw dbError(error, "조례 확인일 갱신");
    if (!data) return errorJson(404, "없는 연결입니다");
    await writeAudit(db, { actor, action: "ordinance.verify", reason: "조례 확인일 갱신", target: `ordinance_links:${p.value.id}`, before: null, after: { verified: true } });
    revalidatePublicData();
    return json({ verified: true });
  }

  const p = parseStatus(body);
  if (!p.ok) return invalid(p.errors);
  const { data, error } = await db.from("ordinance_links").update({ status: p.value.status }).eq("id", p.value.id).select("id").maybeSingle();
  if (error) {
    if (error.code === "23514") return invalid(["status: 공개하려면 출처·시행일·확인일이 모두 있어야 합니다"]);
    throw dbError(error, "조례 상태 변경");
  }
  if (!data) return errorJson(404, "없는 연결입니다");
  await writeAudit(db, { actor, action: `ordinance.status.${p.value.status}`, reason: "조례 공개 상태 변경", target: `ordinance_links:${p.value.id}`, before: null, after: { status: p.value.status } });
  revalidatePublicData();
  return json({ status: p.value.status });
});
