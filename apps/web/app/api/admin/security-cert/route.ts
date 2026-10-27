import { CERT_OPS, parseCertPlanDraft, parseCertPlanId, type CertOp } from "@/lib/security/cert-plan";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { revalidatePublicData } from "@/lib/server/public/cache";
import { loadCertPlanBoard } from "@/lib/server/security/cert-plan";

// 정보보호 인증 추진 계획 관리 (W13-j - PRD-05 SEC-02, docs/dev/W13-j_설계.md). 권한 security_cert.edit (관리자만).
//  · GET - 계획·감사·기관 판매 게이트 상태
//  · POST op=draft {cert_kind, other_kind_name?, scope, target_start_on, target_end_on, cost_estimate_krw, owner_name, entity_name?, risk_assessed_on?, note?}  (값은 PO 입력 - 인증 단정 표현은 422)
//  · POST op=approve {id} / op=withdraw {id}  (DB 함수가 명의·위험 평가일·일정·문구를 다시 검사, 거부 409 + 감사)
// 이 경로에 AI는 없다.
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "security_cert.edit", "security_cert:list");
  if (denied) return denied;
  return json(await loadCertPlanBoard(serviceDb()));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op) as CertOp;
  if (!(CERT_OPS as readonly string[]).includes(op)) return invalid([`op: ${CERT_OPS.join("·")} 중 하나입니다`]);
  const denied = await authorize(viewer, "security_cert.edit", `security_cert:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "draft") {
    const p = parseCertPlanDraft(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.from("security_cert_plans").insert({ ...p.value, drafted_by: actor }).select("id, cert_kind, status").single();
    if (error) {
      if (error.code === "23514" || error.code === "P0001") return invalid([error.message]);
      throw dbError(error, "security_cert_plans 추가");
    }
    await writeAudit(db, { actor, action: "security_cert_plan.draft", target: `security_cert_plans:${(data as { id: number }).id}`, before: null, after: { cert_kind: p.value.cert_kind }, reason: "정보보호 인증 추진 계획 초안(승인 전 공개 0)" });
    return json({ created: data }, 201);
  }

  const p = parseCertPlanId(body);
  if (!p.ok) return invalid(p.errors);
  const { data, error } = await db.rpc(op === "approve" ? "security_cert_plan_approve" : "security_cert_plan_withdraw", { p_id: p.value.id, p_actor: actor });
  if (error) throw dbError(error, `인증 추진 계획 ${op}`);
  const r = data as { ok: boolean; code: string; message: string };
  if (!r.ok) return errorJson(409, r.message, { code: r.code });
  revalidatePublicData();
  return json({ done: op });
});
