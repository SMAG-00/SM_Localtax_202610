import {
  EXPERT_OPS,
  parseCategory,
  parseNotice,
  parsePolicy,
  parseProfile,
  parsePublish,
  parseRequestStatus,
  parseWithdraw,
  parseId,
} from "@/lib/admin/expert-rules";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { loadExpertBoard } from "@/lib/server/experts/board";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// SM 전문가 관리 (W7c - PRD-01C EXPL-01·02·05·07·08·13·17~21, docs/dev/W7c_설계.md 1장 3단계).
// 프로필 등록·공개·내림·철회, 분류, 고지문·연락 정책, 요청 상태는 관리자(PO)만 한다 (PO 결정 2026-10-24 - 외부 등재 신청 없음, 담당·알림은 관리자 계정).
// 전문가 담당(expert_ops)은 화면에 들어올 수 있지만 쓰기는 모두 403 + 거부 감사. 칸 모양은 lib/admin/expert-rules.ts, 쓰면 안 되는 표현·분류·공개 조건·상태 순서는 DB 트리거가 정본이다
// (check_violation은 422로 문장 그대로). 모든 쓰기는 감사 로그와 공개 캐시 만료.
//  · GET - 보드(분류·프로필·고지문·정책·요청 목록 - 요청 목록은 관리자에게만, 이름·연락처·요약 없음)
//  · POST op=category {code,name,sort_order,active} 분류 만들기·고치기
//  · POST op=profile {id?,...} 프로필 등록·고치기(초안) / publish {id,consent_version,consent_on,consent_doc_ref} 공개 / unpublish {id} 내리기 / withdraw {id,reason}
//  · POST op=notice {...} 고지문 / policy {...} 연락 요청 정책
//  · POST op=request_status {id,status,scope_noted,performing_entity,close_reason} 요청 첫 연락·종결
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const fail = (error: { code?: string; message?: string }, context: string): Response => {
  if (error.code === "23514") return invalid([error.message ?? "저장 규칙에 맞지 않습니다"]);
  if (error.code === "23505") return errorJson(409, "이미 같은 값이 있습니다");
  if (error.code === "23503") return invalid(["참조하는 값이 없습니다 (분류·이미지 번호를 확인하세요)"]);
  throw dbError(error, context);
};

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "expert.manage", "experts:list");
  if (denied) return denied;
  return json(await loadExpertBoard(serviceDb(), { withRequests: viewer.isAdmin }));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!(EXPERT_OPS as readonly string[]).includes(op)) return invalid([`op: ${EXPERT_OPS.join("·")} 중 하나입니다`]);
  // 쓰기는 관리자만 - settings.edit(관리자 전용)로 판정하고 거부는 감사 로그에 남긴다
  const denied = await authorize(viewer, "settings.edit", `experts:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);
  const audit = (action: string, target: string, before: unknown, after: unknown, reason: string) => writeAudit(db, { actor, action, target, before, after, reason });

  if (op === "category") {
    const p = parseCategory(body);
    if (!p.ok) return invalid(p.errors);
    const { data: cur, error: ce } = await db.from("expert_categories").select("code, name, sort_order, active").eq("code", p.value.code).maybeSingle();
    if (ce) throw dbError(ce, "expert_categories 조회");
    const { data, error } = cur
      ? await db.from("expert_categories").update({ name: p.value.name, sort_order: p.value.sort_order, active: p.value.active }).eq("code", p.value.code).select("code, name, sort_order, active").single()
      : await db.from("expert_categories").insert(p.value).select("code, name, sort_order, active").single();
    if (error) return fail(error, "expert_categories 저장");
    await audit(cur ? "expert.category.update" : "expert.category.create", `expert_categories:${p.value.code}`, cur, data, "전문가 분류 저장");
    return json({ category: data }, cur ? 200 : 201);
  }

  if (op === "profile") {
    const p = parseProfile(body);
    if (!p.ok) return invalid(p.errors);
    if (p.value.id === null) {
      const { data, error } = await db.from("expert_profiles").insert({ ...p.value.row, edited_by: actor }).select("id, slug, status").single();
      if (error) return fail(error, "expert_profiles 추가");
      await audit("expert.profile.create", `expert_profiles:${(data as { id: number }).id}`, null, { slug: p.value.row.slug, categories: p.value.row.category_codes }, "전문가 프로필 등록(초안)");
      return json({ profile: data }, 201);
    }
    const { data: before, error: be } = await db.from("expert_profiles").select("*").eq("id", p.value.id).maybeSingle();
    if (be) throw dbError(be, "expert_profiles 조회");
    if (!before) return errorJson(404, "그런 프로필이 없습니다");
    const { data, error } = await db.from("expert_profiles").update({ ...p.value.row, edited_by: actor }).eq("id", p.value.id).select("id, slug, status").single();
    if (error) return fail(error, "expert_profiles 수정");
    await audit("expert.profile.update", `expert_profiles:${p.value.id}`, before, data, "전문가 프로필 고치기");
    return json({ profile: data });
  }

  if (op === "publish") {
    const p = parsePublish(body);
    if (!p.ok) return invalid(p.errors);
    const { data: before } = await db.from("expert_profiles").select("id, status").eq("id", p.value.id).maybeSingle();
    if (!before) return errorJson(404, "그런 프로필이 없습니다");
    const { data, error } = await db
      .from("expert_profiles")
      .update({ status: "published", consent_version: p.value.consent_version, consent_on: p.value.consent_on, consent_doc_ref: p.value.consent_doc_ref, published_by: actor, edited_by: actor })
      .eq("id", p.value.id)
      .select("id, slug, status")
      .single();
    if (error) return fail(error, "expert_profiles 공개");
    await audit("expert.profile.publish", `expert_profiles:${p.value.id}`, before, { status: "published", consent_version: p.value.consent_version }, "전문가 프로필 공개 - 본인 동의서 기록 확인");
    return json({ profile: data });
  }

  if (op === "unpublish") {
    const id = parseId(body);
    if (!id.ok) return invalid(id.errors);
    const { data, error } = await db.from("expert_profiles").update({ status: "draft", edited_by: actor }).eq("id", id.value).eq("status", "published").select("id, slug, status").maybeSingle();
    if (error) return fail(error, "expert_profiles 내리기");
    if (!data) return errorJson(409, "공개 중인 프로필이 아닙니다");
    await audit("expert.profile.unpublish", `expert_profiles:${id.value}`, { status: "published" }, { status: "draft" }, "전문가 프로필 내리기");
    return json({ profile: data });
  }

  if (op === "withdraw") {
    const p = parseWithdraw(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db
      .from("expert_profiles")
      .update({ status: "withdrawn", withdrawn_at: new Date().toISOString(), withdrawn_reason: p.value.reason, edited_by: actor })
      .eq("id", p.value.id)
      .neq("status", "withdrawn")
      .select("id, slug, status")
      .maybeSingle();
    if (error) return fail(error, "expert_profiles 철회");
    if (!data) return errorJson(409, "없는 프로필이거나 이미 철회되었습니다");
    await audit("expert.profile.withdraw", `expert_profiles:${p.value.id}`, null, { status: "withdrawn" }, p.value.reason);
    return json({ profile: data });
  }

  if (op === "notice" || op === "policy") {
    const p = op === "notice" ? parseNotice(body) : parsePolicy(body);
    if (!p.ok) return invalid(p.errors);
    const key = op === "notice" ? "expert_notice" : "expert_request_policy";
    const { data: before } = await db.from("settings").select("value").eq("key", key).maybeSingle();
    const { error } = await db.from("settings").update({ value: p.value, updated_by: actor }).eq("key", key);
    if (error) return fail(error, `settings ${key} 저장`);
    await audit(`expert.${op}.save`, `settings:${key}`, (before as { value?: unknown } | null)?.value ?? null, p.value, op === "notice" ? "전문가 소개 고지문 저장" : "연락 요청 정책 저장");
    return json({ saved: key });
  }

  // request_status
  const p = parseRequestStatus(body);
  if (!p.ok) return invalid(p.errors);
  const patch = p.value.status === "contacted"
    ? { status: "contacted", scope_noted: true, performing_entity: p.value.performing_entity, updated_by: actor }
    : { status: "closed", close_reason: p.value.close_reason, updated_by: actor };
  const { data, error } = await db.from("expert_requests").update(patch).eq("id", p.value.id).is("purged_at", null).select("id, receipt_no, status").maybeSingle();
  if (error) return fail(error, "expert_requests 상태");
  if (!data) return errorJson(404, "없는 요청이거나 이미 파기되었습니다");
  await audit("expert.request.status", `expert_requests:${p.value.id}`, null, { status: p.value.status, close_reason: p.value.close_reason }, "전문가 연락 요청 상태 바꾸기");
  return json({ request: data });
}, { revalidatesPublic: true });
