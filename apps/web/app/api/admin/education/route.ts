import { CLOSE_REASONS, QUOTE_STATUSES } from "@/lib/education/rules";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { adminClient } from "@/lib/server/supabase";

// 교육 강좌·세미나·위탁교육 견적 관리 (W10-g - EDU-01·BIZ-06, docs/dev/W10-g_설계.md). 모든 쓰기는 감사 로그. 결제·수강 등록·수료증 조작 0 (연결 방식).
//  · GET - 보드 (product.manage: 스토어 담당·관리자). 강좌·회차·세미나·정책(개인정보 없음)·견적 목록(기관명·연락처 없는 요약만)
//  · POST op=course | session | session_delete | seminar            (product.manage). 게시(published)는 출처·확인일, 세미나는 연사 이해관계 공개가 있어야 - DB가 거부
//  · POST op=policy                                                    (settings.edit - 관리자만). 견적 요청 정책(보관 기간·동의 문구) - 승인은 법률 검토 기록이 있어야 - DB가 거부
//  · POST op=quote_status                                              (settings.edit - 관리자만). 접수 -> 회신함 -> 종결(사유 필수), 되돌리기 거부 - DB가 거부
// 견적 요청의 이름·연락처·내용은 이 보드에 싣지 않는다 - 상세는 /api/admin/education/quotes/[id] (열람 감사 1행).
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const fail = (error: { code?: string; message?: string }, context: string): Response => {
  if (error.code === "23514") return invalid([error.message ?? "저장 규칙에 맞지 않습니다"]);
  if (error.code === "23505") return errorJson(409, "이미 같은 값이 있습니다");
  if (error.code === "23503") return invalid(["참조하는 값이 없습니다 (강좌·바깥 연결 번호를 확인하세요)"]);
  throw dbError(error, context);
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const strList = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]).map((x) => x.trim()).filter((x) => x !== "") : null);
const OPS = ["course", "session", "session_delete", "seminar", "policy", "quote_status"] as const;

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "product.manage", "education:board");
  if (denied) return denied;
  const db = adminClient();
  if (!db) return errorJson(503, "서버 설정이 끝나지 않았습니다");
  const [courses, sessions, seminars, quotes, policy, flags, links] = await Promise.all([
    db.from("courses").select("id, slug, title, status, apply_link_id, verified_on, verified_ref, updated_at").order("id"),
    db.from("course_sessions").select("id, course_id, starts_on, ends_on, mode, status, verified_on").order("course_id").order("starts_on"),
    db.from("seminars").select("id, slug, title, topic, starts_at, ends_at, status, sponsored, apply_link_id, verified_on").order("starts_at", { ascending: false }).limit(200),
    db.from("training_quotes").select("id, receipt_no, org_type, headcount, course_id, status, close_reason, purge_at, purged_at, created_at").order("id", { ascending: false }).limit(200),
    db.from("settings").select("value").eq("key", "training_quote_policy").maybeSingle(),
    db.from("settings").select("value").eq("key", "feature_flags").maybeSingle(),
    db.from("official_links").select("id, key, label, status, active").eq("kind", "edu_site").order("id"),
  ]);
  for (const r of [courses, sessions, seminars, quotes, policy, flags, links]) if (r.error) throw dbError(r.error, "education 보드 읽기");
  const f = ((flags.data as { value?: Record<string, unknown> } | null)?.value ?? {}) as Record<string, unknown>;
  return json({
    flags: { edu: f.edu === true, education_billing: f.education_billing === true, seminars: f.seminars === true },
    policy: (policy.data as { value?: unknown } | null)?.value ?? null,
    courses: courses.data,
    sessions: sessions.data,
    seminars: seminars.data,
    quotes: quotes.data,
    eduLinks: links.data,
  });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!(OPS as readonly string[]).includes(op)) return invalid([`op: ${OPS.join("·")} 중 하나입니다`]);
  const action = op === "policy" || op === "quote_status" ? "settings.edit" : "product.manage";
  const denied = await authorize(viewer, action, `education:${op}`);
  if (denied) return denied;
  const db = adminClient();
  if (!db) return errorJson(503, "서버 설정이 끝나지 않았습니다");
  const actor = actorOf(viewer);
  const audit = (a: string, target: string, before: unknown, after: unknown, reason: string) => writeAudit(db, { actor, action: a, target, before, after, reason });

  if (op === "course") {
    const row = {
      slug: str(body.slug),
      title: str(body.title),
      summary: typeof body.summary === "string" ? body.summary : "",
      audience: typeof body.audience === "string" ? body.audience : "",
      provider_name: str(body.provider_name),
      apply_link_id: int(body.apply_link_id),
      status: str(body.status) ?? "draft",
      verified_on: str(body.verified_on),
      verified_ref: str(body.verified_ref),
      edited_by: actor,
    };
    if (!row.slug || !row.title || !row.provider_name) return invalid(["slug·title·provider_name: 필수입니다"]);
    const id = int(body.id);
    if (id === null) {
      const { data, error } = await db.from("courses").insert(row).select("id, slug, status").single();
      if (error) return fail(error, "courses 추가");
      await audit("education.course.create", `courses:${(data as { id: number }).id}`, null, { slug: row.slug }, "교육 강좌 등록");
      return json({ course: data }, 201);
    }
    const { data: before } = await db.from("courses").select("*").eq("id", id).maybeSingle();
    if (!before) return errorJson(404, "그런 강좌가 없습니다");
    const { data, error } = await db.from("courses").update(row).eq("id", id).select("id, slug, status").single();
    if (error) return fail(error, "courses 수정");
    await audit("education.course.update", `courses:${id}`, before, data, "교육 강좌 고치기");
    return json({ course: data });
  }

  if (op === "session") {
    const row = {
      course_id: int(body.course_id),
      starts_on: str(body.starts_on),
      ends_on: str(body.ends_on),
      mode: str(body.mode),
      location_name: str(body.location_name),
      status: str(body.status) ?? "scheduled",
      verified_on: str(body.verified_on),
      verified_ref: str(body.verified_ref),
    };
    if (row.course_id === null || !row.starts_on || !row.mode || !row.verified_on || !row.verified_ref) return invalid(["course_id·starts_on·mode·verified_on·verified_ref: 필수입니다 (출처·확인일 없는 일정은 저장하지 않습니다)"]);
    const id = int(body.id);
    if (id === null) {
      const { data, error } = await db.from("course_sessions").insert(row).select("id, course_id, starts_on").single();
      if (error) return fail(error, "course_sessions 추가");
      await audit("education.session.create", `course_sessions:${(data as { id: number }).id}`, null, { course_id: row.course_id, starts_on: row.starts_on }, "교육 강좌 회차 등록");
      return json({ session: data }, 201);
    }
    const { data: before } = await db.from("course_sessions").select("*").eq("id", id).maybeSingle();
    if (!before) return errorJson(404, "그런 회차가 없습니다");
    const { data, error } = await db.from("course_sessions").update(row).eq("id", id).select("id, course_id, starts_on").single();
    if (error) return fail(error, "course_sessions 수정");
    await audit("education.session.update", `course_sessions:${id}`, before, data, "교육 강좌 회차 고치기");
    return json({ session: data });
  }

  if (op === "session_delete") {
    const id = int(body.id);
    if (id === null) return invalid(["id: 필수입니다"]);
    const { data: before } = await db.from("course_sessions").select("*").eq("id", id).maybeSingle();
    if (!before) return errorJson(404, "그런 회차가 없습니다");
    const { error } = await db.from("course_sessions").delete().eq("id", id);
    if (error) return fail(error, "course_sessions 삭제");
    await audit("education.session.delete", `course_sessions:${id}`, before, null, "교육 강좌 회차 지우기");
    return json({ ok: true });
  }

  if (op === "seminar") {
    const row = {
      slug: str(body.slug),
      title: str(body.title),
      summary: typeof body.summary === "string" ? body.summary : "",
      topic: str(body.topic),
      starts_at: str(body.starts_at),
      ends_at: str(body.ends_at),
      mode: str(body.mode),
      venue_name: str(body.venue_name),
      organizer_name: str(body.organizer_name),
      sponsored: body.sponsored === true,
      sponsor_name: str(body.sponsor_name),
      speaker_disclosure: typeof body.speaker_disclosure === "string" ? body.speaker_disclosure : "",
      apply_link_id: int(body.apply_link_id),
      status: str(body.status) ?? "draft",
      verified_on: str(body.verified_on),
      verified_ref: str(body.verified_ref),
      edited_by: actor,
    };
    if (!row.slug || !row.title || !row.topic || !row.starts_at || !row.ends_at || !row.mode || !row.organizer_name) {
      return invalid(["slug·title·topic·starts_at·ends_at·mode·organizer_name: 필수입니다"]);
    }
    const id = int(body.id);
    if (id === null) {
      const { data, error } = await db.from("seminars").insert(row).select("id, slug, status").single();
      if (error) return fail(error, "seminars 추가");
      await audit("education.seminar.create", `seminars:${(data as { id: number }).id}`, null, { slug: row.slug }, "세미나 등록");
      return json({ seminar: data }, 201);
    }
    const { data: before } = await db.from("seminars").select("*").eq("id", id).maybeSingle();
    if (!before) return errorJson(404, "그런 세미나가 없습니다");
    const { data, error } = await db.from("seminars").update(row).eq("id", id).select("id, slug, status").single();
    if (error) return fail(error, "seminars 수정");
    await audit("education.seminar.update", `seminars:${id}`, before, data, "세미나 고치기");
    return json({ seminar: data });
  }

  if (op === "policy") {
    const intro = strList(body.intro);
    const items = strList(body.consent_items);
    if (intro === null || items === null) return invalid(["intro·consent_items: 글자 배열입니다"]);
    const value = {
      retention_days: int(body.retention_days),
      target_business_days: int(body.target_business_days),
      message_max_chars: int(body.message_max_chars),
      consent_version: typeof body.consent_version === "string" ? body.consent_version.trim() : "",
      intro,
      consent_items: items,
      approved: body.approved === true,
      reviewed_by: str(body.reviewed_by),
      reviewed_on: str(body.reviewed_on),
      legal_review_ref: typeof body.legal_review_ref === "string" ? body.legal_review_ref.trim() : "",
    };
    const { data: before } = await db.from("settings").select("value").eq("key", "training_quote_policy").maybeSingle();
    const { error } = await db.from("settings").update({ value, updated_by: actor }).eq("key", "training_quote_policy");
    if (error) return fail(error, "training_quote_policy 수정");
    await audit("education.policy.update", "settings:training_quote_policy", (before as { value?: unknown } | null)?.value ?? null, value, "견적 요청 정책 고치기");
    return json({ policy: value });
  }

  // op === "quote_status"
  const id = int(body.id);
  const status = str(body.status);
  const reason = str(body.close_reason);
  if (id === null || !status || !(QUOTE_STATUSES as readonly string[]).includes(status) || status === "received") return invalid(["id·status: contacted 또는 closed를 고르세요"]);
  if (status === "closed" && (!reason || !(CLOSE_REASONS as readonly string[]).includes(reason))) return invalid([`close_reason: ${CLOSE_REASONS.join("·")} 중 하나가 필요합니다`]);
  const { data: before } = await db.from("training_quotes").select("id, receipt_no, status, close_reason").eq("id", id).maybeSingle();
  if (!before) return errorJson(404, "그런 견적 요청이 없습니다");
  const patch = status === "closed" ? { status, close_reason: reason, updated_by: actor } : { status, updated_by: actor };
  const { data, error } = await db.from("training_quotes").update(patch).eq("id", id).is("purged_at", null).select("id, status, close_reason").maybeSingle();
  if (error) return fail(error, "training_quotes 상태");
  if (!data) return errorJson(409, "파기된 요청은 상태를 바꿀 수 없습니다");
  await audit("education.quote.status", `training_quotes:${id}`, before, data, "위탁교육 견적 요청 상태 변경");
  return json({ quote: data });
});
