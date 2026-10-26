import { IGT_OPS, parseCaseAdd, parseCreate, parseId, parseSign } from "@/lib/igt/admin";
import { loadIgtBoard } from "@/lib/igt/board";
import { runNationalAccuracy } from "@/lib/igt/run";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { revalidatePublicData } from "@/lib/server/public/cache";

// 상속·증여세 룰셋 감수 관리 (FAM-12, docs/dev/W11-g_설계.md). 경로는 하나: 초안 -> 세무 감수위원 서명 -> 관리자 승인. 열고 닫는 입력은 없고 공개 게이트는 DB 뷰에서만 읽는다.
//  · GET - 버전·서명 기록·게이트 줄·대조 사례 (ruleset.read - 세무 감수위원·관리자). 본문·사례 입력은 싣지 않는다
//  · POST op=create {version, source_ref, basis_note, body}  초안 만들기 (ruleset.approve - 관리자). 활성·서명 상태로는 못 만든다
//  · POST op=sign {id, sheet_ref}   감수 서명 (ruleset.sign - 세무 감수위원만, 관리자도 403 + 거부 감사)
//  · POST op=approve {id}           활성화 승인 (ruleset.approve - 관리자만). 서명 없음은 409 + rules_audit 거부 1행
//  · POST op=case_add {...}         증여·상속 대조 사례 추가 (accuracy.manage). 개인정보 흔적은 422 (앱 검사 + DB 트리거)
//  · POST op=case_confirm {id}      사례 확인 (ruleset.sign - 세무 감수위원만)
//  · POST op=case_retire {id}       사례 철회 (accuracy.manage)
//  · POST op=run                    상속·증여 대조 실행 지금 (accuracy.manage) - 배치 accuracy-run 의 국세 몫과 같은 함수
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const PERMISSION: Record<string, string> = {
  create: "ruleset.approve",
  sign: "ruleset.sign",
  approve: "ruleset.approve",
  case_add: "accuracy.manage",
  case_confirm: "ruleset.sign",
  case_retire: "accuracy.manage",
  run: "accuracy.manage",
};

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "ruleset.read", "national-calc:list");
  if (denied) return denied;
  return json(await loadIgtBoard(serviceDb()));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!(IGT_OPS as readonly string[]).includes(op)) return invalid([`op: ${IGT_OPS.join("·")} 중 하나입니다`]);
  const denied = await authorize(viewer, PERMISSION[op] as Parameters<typeof authorize>[1], `national-calc:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "create") {
    const p = parseCreate(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.from("igt_rulesets").insert({ version: p.value.version, body: p.value.body, source_ref: p.value.source_ref, basis_note: p.value.basis_note, created_by: actor }).select("id, version, status").single();
    if (error) {
      if (error.code === "23514" || error.code === "P0001") return invalid([error.message]);
      if (error.code === "23505") return errorJson(409, "같은 버전이 이미 있습니다 - 차수를 올려 새 버전으로 만드세요 (덮어쓰기 금지)");
      throw dbError(error, "igt_rulesets 추가");
    }
    await writeAudit(db, { actor, action: "national-calc.draft.create", target: `igt_rulesets:${(data as { id: number }).id}`, before: null, after: { version: p.value.version }, reason: "초안 만들기(서명 전, 공개 계산에 쓰이지 않음)" });
    return json({ created: data }, 201);
  }

  if (op === "sign") {
    const p = parseSign(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.rpc("sign_igt_ruleset", { p_id: p.value.id, p_signer: actor, p_sheet_ref: p.value.sheetRef });
    if (error) throw dbError(error, "감수 서명");
    const r = data as { ok: boolean; code: string; message: string };
    return r.ok ? json({ signed: true }) : errorJson(409, r.message, { code: r.code });
  }

  if (op === "approve") {
    const id = parseId(body);
    if (!id.ok) return invalid(id.errors);
    const { data, error } = await db.rpc("approve_igt_ruleset", { p_id: id.value, p_approver: actor });
    if (error) throw dbError(error, "활성화 승인");
    const r = data as { ok: boolean; code: string; message: string };
    if (!r.ok) return errorJson(409, r.message, { code: r.code });
    revalidatePublicData();
    return json({ activated: true });
  }

  if (op === "case_add") {
    const p = parseCaseAdd(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.from("accuracy_cases").insert({ ...p.value, cause: null, entered_by: actor }).select("id, case_key").single();
    if (error) {
      if (error.code === "23514") return invalid([error.message]);
      if (error.code === "23505") return errorJson(409, "같은 관리 번호(case_key)가 이미 있습니다");
      throw dbError(error, "accuracy_cases 추가");
    }
    // 감사에는 입력·금액을 싣지 않는다 - 관리 번호와 분류만
    await writeAudit(db, { actor, action: "national-calc.case.add", target: `accuracy_cases:${(data as { id: number }).id}`, before: null, after: { tax_kind: p.value.tax_kind, sample_kind: p.value.sample_kind }, reason: "대조 사례 추가" });
    return json({ created: data }, 201);
  }

  if (op === "run") {
    const detail = await runNationalAccuracy(db, actor);
    await writeAudit(db, { actor, action: "national-calc.run", target: "accuracy_runs", before: null, after: detail, reason: "상속·증여 대조 실행(수동)" });
    revalidatePublicData();
    return json({ run: detail });
  }

  const id = parseId(body);
  if (!id.ok) return invalid(id.errors);
  if (op === "case_confirm") {
    const { data, error } = await db.rpc("confirm_accuracy_case", { p_case_id: id.value, p_actor: actor });
    if (error) throw dbError(error, "사례 확인");
    const r = data as { ok: boolean; code: string; message: string };
    return r.ok ? json({ confirmed: true }) : errorJson(409, r.message, { code: r.code });
  }
  // case_retire - 증여·상속 사례만
  const { data, error } = await db.from("accuracy_cases").update({ retired_at: new Date().toISOString() }).eq("id", id.value).in("tax_kind", ["gift", "inheritance"]).is("retired_at", null).select("id");
  if (error) throw dbError(error, "사례 철회");
  if (!data || data.length === 0) return errorJson(404, "철회할 사례가 없거나 이미 철회되었습니다");
  await writeAudit(db, { actor, action: "national-calc.case.retire", target: `accuracy_cases:${id.value}`, before: null, after: { retired: true }, reason: "대조 사례 철회" });
  revalidatePublicData();
  return json({ retired: true });
});
