import { actorOf, writeAudit } from "@/lib/server/audit";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { adminClient } from "@/lib/server/supabase";

// 프리미엄 리포트 편집·발행 API (W11-f, BIZ-07). 원고는 편집국이 쓰고 세무 감수·편집 승인·법률(자본시장법) 검토 기록을 입력한다 - AI 작성 0.
//  · GET  목록 (report.publish: 편집 책임자·관리자). 본문 글자는 길이만
//  · POST op=report  메타 만들기·고치기 (제목·분기·기준일·출처 목록). 발행 상태는 여기서 못 바꾼다
//  · POST op=body    본문·미리보기 저장 (미리보기 길이는 설정 premium_report_policy 이하 - DB가 거부). 판매 권리 확인은 근거·확인일 필수
//  · POST op=publish 발행 - 기준일·출처 1건 이상·세무 감수 서명·편집 승인·법률 검토 기록이 모두 있어야(DB 제약), 거부는 422
// 본문 글자는 어떤 응답에도 되돌려 보내지 않는다. 금지 표현(투자 권유·수익률 순위·가입 링크) 검사는 편집 화면 쪽 사전과 같은 규칙으로 발행 전에 사람이 확인한다 [감수 필요: 법률].
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const fail = (error: { code?: string; message?: string }, context: string): Response => {
  if (error.code === "23514") return invalid([error.message ?? "저장 규칙에 맞지 않습니다"]);
  if (error.code === "23505") return errorJson(409, "이미 같은 값이 있습니다");
  throw dbError(error, context);
};
const OPS = ["report", "body", "publish"] as const;

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "report.publish", "report:board");
  if (denied) return denied;
  const db = adminClient();
  if (!db) return errorJson(503, "서버 설정이 끝나지 않았습니다");
  const [reports, bodies] = await Promise.all([
    db.from("premium_reports").select("id, slug, title, period_label, as_of, status, tax_reviewer, tax_reviewed_on, editor_approved_by, editor_approved_on, legal_review_ref, published_at").order("id", { ascending: false }).limit(200),
    db.from("paid_bodies").select("ref_key, preview, sale_allowed, rights_ref, sale_confirmed_on, updated_at").eq("kind", "premium_report").limit(200),
  ]);
  for (const r of [reports, bodies]) if (r.error) throw dbError(r.error, "리포트 보드 읽기");
  return json({ reports: reports.data, bodies: (bodies.data ?? []).map((b) => ({ ...b, previewLength: String((b as { preview: string }).preview).length, preview: undefined })) });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!(OPS as readonly string[]).includes(op)) return invalid([`op: ${OPS.join("·")} 중 하나입니다`]);
  const denied = await authorize(viewer, "report.publish", `report:${op}`);
  if (denied) return denied;
  const db = adminClient();
  if (!db) return errorJson(503, "서버 설정이 끝나지 않았습니다");
  const actor = actorOf(viewer);
  const audit = (a: string, target: string, before: unknown, after: unknown, reason: string) => writeAudit(db, { actor, action: a, target, before, after, reason });

  if (op === "report") {
    const row = {
      slug: str(body.slug), title: str(body.title), period_label: str(body.period_label), as_of: str(body.as_of),
      sources: Array.isArray(body.sources) ? body.sources : [], tax_reviewer: str(body.tax_reviewer), tax_reviewed_on: str(body.tax_reviewed_on),
      editor_approved_by: str(body.editor_approved_by), editor_approved_on: str(body.editor_approved_on), legal_review_ref: str(body.legal_review_ref), edited_by: actor,
    };
    if (!row.slug || !row.title || !row.period_label) return invalid(["slug·title·period_label(예 2026-Q4): 필수입니다"]);
    const { data: existing } = await db.from("premium_reports").select("id, status").eq("slug", row.slug).maybeSingle();
    if (existing && (existing as { status: string }).status === "published") return errorJson(409, "발행된 리포트의 메타는 고칠 수 없습니다");
    const q = existing ? db.from("premium_reports").update(row).eq("slug", row.slug) : db.from("premium_reports").insert(row);
    const { data, error } = await q.select("id, slug, status").single();
    if (error) return fail(error, "premium_reports 저장");
    await audit(existing ? "report.update" : "report.create", `premium_reports:${(data as { id: number }).id}`, existing ?? null, { slug: row.slug, period_label: row.period_label }, "리포트 메타 저장");
    return json({ report: data }, existing ? 200 : 201);
  }

  if (op === "body") {
    const row = {
      kind: "premium_report", ref_key: str(body.slug), title: str(body.title), preview: str(body.preview), body: typeof body.body === "string" ? body.body : null,
      sale_allowed: body.sale_allowed === true, rights_ref: str(body.rights_ref), sale_confirmed_on: str(body.sale_confirmed_on), edited_by: actor,
    };
    if (!row.ref_key || !row.title || !row.preview || !row.body) return invalid(["slug·title·preview·body: 필수입니다"]);
    const { data: existing } = await db.from("paid_bodies").select("id").eq("kind", "premium_report").eq("ref_key", row.ref_key).maybeSingle();
    const q = existing ? db.from("paid_bodies").update(row).eq("id", (existing as { id: number }).id) : db.from("paid_bodies").insert(row);
    const { data, error } = await q.select("id, ref_key, sale_allowed").single();
    if (error) return fail(error, "paid_bodies 저장");
    await audit(existing ? "report.body.update" : "report.body.create", `paid_bodies:${(data as { id: number }).id}`, null, { slug: row.ref_key, sale_allowed: row.sale_allowed }, "리포트 본문 저장 (본문 글자는 감사 기록에 넣지 않음)");
    return json({ body: data }, existing ? 200 : 201);
  }

  const slug = str(body.slug);
  if (!slug) return invalid(["slug: 필수입니다"]);
  const { data: before } = await db.from("premium_reports").select("id, status").eq("slug", slug).maybeSingle();
  if (!before) return errorJson(404, "그런 리포트가 없습니다");
  const { data, error } = await db.from("premium_reports").update({ status: "published", published_at: new Date().toISOString(), edited_by: actor }).eq("slug", slug).select("id, slug, status").single();
  if (error) {
    await audit("report.publish.denied", `premium_reports:${(before as { id: number }).id}`, before, null, "발행 조건 미달로 DB가 거부");
    return fail(error, "premium_reports 발행");
  }
  await audit("report.publish", `premium_reports:${(data as { id: number }).id}`, before, { status: "published" }, "리포트 발행");
  return json({ report: data });
});
