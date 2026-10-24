import { RECORD_OPS, parseAlertAck, parsePenaltyAdd, parseRecalc, parseRulesSave } from "@/lib/admin/readiness-records";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { loadRecordsBoard, recalculateMonth } from "@/lib/server/readiness/monthly";

// 제휴 준비 기록 (W7 - NAV-16·17·18·19·20, docs/dev/W7_설계.md 1장 5단계). 편집 책임자·관리자(readiness.read / readiness.records).
//  · GET - 월 마감 행·임의 3개월 조합의 가장 낮은 조합·경고 알림·부정평가 누적과 기록·다음 접수 목표 + 규정 버전별 판단 값
//  · POST op=rules_save {requirement_id, similarity_rule?, penalty_rule?, contributor_rule?} - 규정 버전의 판단 값(확정 전만, 비우면 null)
//  · POST op=penalty_add {item,points,occurred_on,evidence_ref?,supersedes_id?} - 부정평가 위험 기록(추가만, 정정은 새 기록이 이전 기록을 대체)
//  · POST op=monthly_recalc {month,reason} - 사유와 함께 새 version 행 / alert_ack {id} - 경고 알림 확인
// 모든 쓰기는 감사 로그. 마감 행은 바꾸지 않는다(DB 트리거).
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const fail = (error: { code?: string; message?: string }, context: string): Response => {
  if (error.code === "23514") return invalid([error.message ?? "저장 규칙에 맞지 않습니다"]);
  if (error.code === "23503") return invalid(["참조하는 값이 없습니다 (규정 버전·기록 번호를 확인하세요)"]);
  throw dbError(error, context);
};

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "readiness.read", "readiness:records");
  if (denied) return denied;
  return json(await loadRecordsBoard(serviceDb(), new Date()));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!(RECORD_OPS as readonly string[]).includes(op)) return invalid([`op: ${RECORD_OPS.join("·")} 중 하나입니다`]);
  const denied = await authorize(viewer, "readiness.records", `readiness:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);
  const audit = (action: string, target: string, before: unknown, after: unknown, reason: string) => writeAudit(db, { actor, action, target, before, after, reason });

  if (op === "rules_save") {
    const p = parseRulesSave(body);
    if (!p.ok) return invalid(p.errors);
    const { data: cur, error: ce } = await db.from("news_partner_requirement_rules").select("requirement_id, similarity_rule, penalty_rule, contributor_rule").eq("requirement_id", p.value.requirementId).maybeSingle();
    if (ce) throw dbError(ce, "news_partner_requirement_rules 조회");
    const row = { requirement_id: p.value.requirementId, similarity_rule: p.value.similarity_rule, penalty_rule: p.value.penalty_rule, contributor_rule: p.value.contributor_rule, updated_by: actor };
    const { data, error } = await db.from("news_partner_requirement_rules").upsert(row, { onConflict: "requirement_id" }).select("requirement_id, similarity_rule, penalty_rule, contributor_rule").single();
    if (error) return fail(error, "news_partner_requirement_rules 저장");
    await audit("readiness.rules.save", `news_partner_requirement_rules:${p.value.requirementId}`, cur, data, "규정 판단 값 저장");
    return json({ rules: data }, cur ? 200 : 201);
  }

  if (op === "penalty_add") {
    const p = parsePenaltyAdd(body);
    if (!p.ok) return invalid(p.errors);
    const row = {
      kind: "penalty_risk",
      item: p.value.item,
      status: p.value.evidenceRef ? "confirmed" : "unconfirmed",
      evidence_ref: p.value.evidenceRef,
      points: p.value.points,
      occurred_at: `${p.value.occurredOn}T12:00:00+09:00`,
      checked_by: actor,
      supersedes_id: p.value.supersedesId,
    };
    const { data, error } = await db.from("news_partner_checks").insert(row).select("id, item, points, occurred_at").single();
    if (error) return fail(error, "news_partner_checks 저장");
    await audit("readiness.penalty.add", `news_partner_checks:${data.id}`, null, data, "부정평가 위험 기록");
    return json({ record: data }, 201);
  }

  if (op === "monthly_recalc") {
    const p = parseRecalc(body);
    if (!p.ok) return invalid(p.errors);
    const result = await recalculateMonth(db, p.value.month, p.value.reason, new Date());
    if (result.created === 0) return errorJson(409, "마감된 적 없는 달입니다 - 월 마감 배치가 먼저 행을 만듭니다");
    await audit("readiness.monthly.recalc", `partner_readiness_monthly:${p.value.month}`, null, result, p.value.reason);
    return json(result, 201);
  }

  const p = parseAlertAck(body);
  if (!p.ok) return invalid(p.errors);
  const { data, error } = await db
    .from("partner_readiness_alerts")
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: actor })
    .eq("id", p.value.id)
    .is("acknowledged_at", null)
    .select("id")
    .maybeSingle();
  if (error) return fail(error, "partner_readiness_alerts 확인");
  if (!data) return errorJson(409, "없는 알림이거나 이미 확인한 알림입니다");
  await audit("readiness.alert.ack", `partner_readiness_alerts:${p.value.id}`, { acknowledged: false }, { acknowledged: true }, "경고 알림 확인");
  return json({ id: p.value.id });
});
