import { ACCURACY_OPS, parseCaseAdd, parseCaseNote, parseTargetId } from "@/lib/accuracy/input";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { loadAccuracyBoard } from "@/lib/server/accuracy/board";
import { runAccuracy } from "@/lib/server/accuracy/run";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { revalidatePublicData } from "@/lib/server/public/cache";

// 정확도 대조 관리 (W10-a a6 - PRD-02 CALC-14·FAM-07, docs/dev/W10-a_설계.md 11.2). 공개 게이트 상태는 DB 뷰 calc_gate_status에서만 읽고, 여기에 열기·닫기 입력은 없다.
//  · GET - 게이트 줄·사례 목록(입력 제외)·최근 실행 (accuracy.manage - 세무 감수위원·관리자)
//  · POST op=case_add {...}      사례 추가 (accuracy.manage). 개인정보 흔적은 422 (앱 검사 + DB 트리거)
//  · POST op=case_confirm {id}   사례 확인 (ruleset.sign - 세무 감수위원만). 확인된 non-synthetic 사례만 게이트에 센다
//  · POST op=case_retire {id}    사례 철회 (accuracy.manage) - 지우지 않고 retired_at
//  · POST op=case_note {id, mismatch_cause?, mismatch_note?}  불일치 원인 기록 (accuracy.manage)
//  · POST op=run                 대조 실행 지금 (accuracy.manage) - 배치 accuracy-run과 같은 함수
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "accuracy.manage", "accuracy:list");
  if (denied) return denied;
  return json(await loadAccuracyBoard(serviceDb()));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!(ACCURACY_OPS as readonly string[]).includes(op)) return invalid([`op: ${ACCURACY_OPS.join("·")} 중 하나입니다`]);
  const denied = await authorize(viewer, op === "case_confirm" ? "ruleset.sign" : "accuracy.manage", `accuracy:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "case_add") {
    const p = parseCaseAdd(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.from("accuracy_cases").insert({ ...p.value, entered_by: actor }).select("id, case_key").single();
    if (error) {
      if (error.code === "23514") return invalid([error.message]);
      if (error.code === "23505") return errorJson(409, "같은 관리 번호(case_key)가 이미 있습니다");
      throw dbError(error, "accuracy_cases 추가");
    }
    // 감사에는 입력·금액을 싣지 않는다 - 관리 번호와 분류만
    await writeAudit(db, { actor, action: "accuracy.case.add", target: `accuracy_cases:${(data as { id: number }).id}`, before: null, after: { tax_kind: p.value.tax_kind, cause: p.value.cause, sample_kind: p.value.sample_kind, synthetic: p.value.synthetic }, reason: "대조 사례 추가(확인 전)" });
    return json({ created: data }, 201);
  }

  if (op === "run") {
    const detail = await runAccuracy(db, new Date(), actor);
    await writeAudit(db, { actor, action: "accuracy.run", target: "accuracy_runs", before: null, after: detail, reason: "정확도 대조 실행(수동)" });
    revalidatePublicData();
    return json({ run: detail });
  }

  if (op === "case_note") {
    const p = parseCaseNote(body);
    if (!p.ok) return invalid(p.errors);
    const { error } = await db.from("accuracy_cases").update({ mismatch_cause: p.value.cause, mismatch_note: p.value.note }).eq("id", p.value.id);
    if (error) {
      if (error.code === "23514") return invalid([error.message]);
      throw dbError(error, "accuracy_cases 메모");
    }
    return json({ updated: true });
  }

  const id = parseTargetId(body);
  if (!id.ok) return invalid(id.errors);
  if (op === "case_confirm") {
    const { data, error } = await db.rpc("confirm_accuracy_case", { p_case_id: id.value, p_actor: actor });
    if (error) throw dbError(error, "사례 확인");
    const r = data as { ok: boolean; code: string; message: string };
    return r.ok ? json({ confirmed: true }) : errorJson(409, r.message, { code: r.code });
  }
  // case_retire
  const { data, error } = await db.from("accuracy_cases").update({ retired_at: new Date().toISOString() }).eq("id", id.value).is("retired_at", null).select("id");
  if (error) throw dbError(error, "사례 철회");
  if (!data || data.length === 0) return errorJson(404, "철회할 사례가 없거나 이미 철회되었습니다");
  await writeAudit(db, { actor, action: "accuracy.case.retire", target: `accuracy_cases:${id.value}`, before: null, after: { retired: true }, reason: "대조 사례 철회" });
  revalidatePublicData();
  return json({ retired: true });
});
