import { actorOf, writeAudit } from "@/lib/server/audit";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { UUID_SHAPE } from "@/lib/server/org/logic";
import { inviteSeat, revokeSeat } from "@/lib/server/org/service";
import { orgErrorOf } from "@/lib/server/org/logic";
import { adminClient } from "@/lib/server/supabase";

// 기관·계약·좌석·확인표 운영 API (W11-f, BIZ-07·PAY-04). 모든 쓰기는 감사 로그. 계약서·확인표 문서 위치는 PO·법률이 입력하는 빈 칸이다.
//  · GET  보드 (org.manage: 스토어·구독 담당·관리자) - 기관·계약·확인표 최신 상태·좌석 수·세금계산서 요청·견적 요청(연락처는 담당 확인용)
//  · POST op=org / admin_add / admin_revoke / contract / contract_activate / contract_end / seat_invite / seat_revoke / tax_issued / inquiry_status (org.manage)
//  · POST op=security 확인표 기록 - 'approved'로 남기는 것은 org_security.approve(관리자만, 거부 시도도 감사), 그 외 상태는 org.manage
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const uuid = (v: unknown): string | null => (typeof v === "string" && UUID_SHAPE.test(v) ? v : null);
const OPS = ["org", "admin_add", "admin_revoke", "contract", "contract_activate", "contract_end", "security", "seat_invite", "seat_revoke", "tax_issued", "inquiry_status"] as const;
const fail = (error: { code?: string; message?: string }, context: string): Response => {
  const known = orgErrorOf(error.message);
  if (known) return errorJson(known.status, known.message, { code: known.code });
  if (error.code === "23514") return invalid([error.message ?? "저장 규칙에 맞지 않습니다"]);
  if (error.code === "23505") return errorJson(409, "이미 같은 값이 있습니다");
  if (error.code === "23503") return invalid(["참조하는 값이 없습니다"]);
  throw dbError(error, context);
};

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "org.manage", "org:board");
  if (denied) return denied;
  const db = adminClient();
  if (!db) return errorJson(503, "서버 설정이 끝나지 않았습니다");
  const [orgs, contracts, reviews, seats, taxes, inquiries] = await Promise.all([
    db.from("orgs").select("id, name, org_type, business_no, status").order("created_at", { ascending: false }).limit(200),
    db.from("org_contracts").select("id, org_id, seats, starts_on, ends_on, status, amount, includes_digital, includes_reports").order("created_at", { ascending: false }).limit(200),
    db.from("org_security_reviews").select("id, org_id, status, reviewed_on, created_at").order("id", { ascending: false }).limit(400),
    db.from("org_seats").select("id, org_id, contract_id, status").limit(2000),
    db.from("tax_invoice_requests").select("id, org_id, kind, supply_amount, status, requested_at, issued_ref, issued_on").order("requested_at", { ascending: false }).limit(200),
    db.from("institution_inquiries").select("id, receipt_no, org_type, org_name, contact_name, seats_wanted, status, retention_until, purged_at, created_at").order("created_at", { ascending: false }).limit(200),
  ]);
  for (const r of [orgs, contracts, reviews, seats, taxes, inquiries]) if (r.error) throw dbError(r.error, "org 보드 읽기");
  return json({ orgs: orgs.data, contracts: contracts.data, securityReviews: reviews.data, seats: seats.data, taxInvoices: taxes.data, inquiries: inquiries.data });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!(OPS as readonly string[]).includes(op)) return invalid([`op: ${OPS.join("·")} 중 하나입니다`]);
  const action = op === "security" && body.status === "approved" ? "org_security.approve" : "org.manage";
  const denied = await authorize(viewer, action, `org:${op}`);
  if (denied) return denied;
  const db = adminClient();
  if (!db) return errorJson(503, "서버 설정이 끝나지 않았습니다");
  const actor = actorOf(viewer);
  const audit = (a: string, target: string, before: unknown, after: unknown, reason: string) => writeAudit(db, { actor, action: a, target, before, after, reason });

  if (op === "org") {
    const row = { name: str(body.name), org_type: str(body.org_type), business_no: str(body.business_no), business_address: str(body.business_address), tax_invoice_email: str(body.tax_invoice_email)?.toLowerCase() ?? null };
    if (!row.name || !row.org_type) return invalid(["name·org_type: 필수입니다"]);
    const id = uuid(body.id);
    if (!id) {
      const { data, error } = await db.from("orgs").insert({ ...row, created_by: actor }).select("id").single();
      if (error) return fail(error, "orgs 추가");
      await audit("org.create", `orgs:${(data as { id: string }).id}`, null, { name: row.name, org_type: row.org_type }, "기관 등록");
      return json({ org: data }, 201);
    }
    const { data: before } = await db.from("orgs").select("*").eq("id", id).maybeSingle();
    if (!before) return errorJson(404, "그런 기관이 없습니다");
    const { data, error } = await db.from("orgs").update(row).eq("id", id).select("id").single();
    if (error) return fail(error, "orgs 수정");
    await audit("org.update", `orgs:${id}`, before, row, "기관 정보 고치기");
    return json({ org: data });
  }

  if (op === "admin_add" || op === "admin_revoke") {
    const orgId = uuid(body.org_id);
    const userId = uuid(body.user_id);
    if (!orgId || !userId) return invalid(["org_id·user_id: 필수입니다 (UUID)"]);
    if (op === "admin_add") {
      const { error } = await db.from("org_admins").insert({ org_id: orgId, user_id: userId, added_by: actor });
      if (error) return fail(error, "org_admins 추가");
    } else {
      const { error } = await db.from("org_admins").update({ revoked_at: new Date().toISOString() }).eq("org_id", orgId).eq("user_id", userId).is("revoked_at", null);
      if (error) return fail(error, "org_admins 철회");
    }
    await audit(`org.${op}`, `orgs:${orgId}`, null, { user_id: userId }, op === "admin_add" ? "기관 관리자 지정" : "기관 관리자 해제");
    return json({ ok: true });
  }

  if (op === "contract") {
    const orgId = uuid(body.org_id);
    const row = {
      org_id: orgId, product_id: int(body.product_id), contract_ref: str(body.contract_ref), seats: int(body.seats), starts_on: str(body.starts_on), ends_on: str(body.ends_on),
      includes_digital: body.includes_digital !== false, includes_reports: body.includes_reports !== false, amount: int(body.amount), edited_by: actor,
    };
    if (!orgId || row.seats === null || !row.starts_on || !row.ends_on) return invalid(["org_id·seats·starts_on·ends_on: 필수입니다"]);
    const id = uuid(body.id);
    if (!id) {
      const { data, error } = await db.from("org_contracts").insert(row).select("id, status").single();
      if (error) return fail(error, "org_contracts 추가");
      await audit("org.contract.create", `org_contracts:${(data as { id: string }).id}`, null, { org_id: orgId, seats: row.seats }, "계약 등록 (작성 중)");
      return json({ contract: data }, 201);
    }
    const { data: before } = await db.from("org_contracts").select("*").eq("id", id).eq("status", "draft").maybeSingle();
    if (!before) return errorJson(404, "작성 중인 계약만 고칠 수 있습니다");
    const { data, error } = await db.from("org_contracts").update(row).eq("id", id).select("id, status").single();
    if (error) return fail(error, "org_contracts 수정");
    await audit("org.contract.update", `org_contracts:${id}`, before, row, "계약 고치기");
    return json({ contract: data });
  }

  if (op === "contract_activate" || op === "contract_end") {
    const id = uuid(body.id);
    if (!id) return invalid(["id: 필수입니다 (UUID)"]);
    const { error } =
      op === "contract_activate"
        ? await db.rpc("org_contract_activate", { p_contract: id, p_by: actor })
        : await db.rpc("org_contract_set_end", { p_contract: id, p_ends_on: str(body.ends_on), p_by: actor });
    if (error) return fail(error, op);
    await audit(`org.${op}`, `org_contracts:${id}`, null, op === "contract_end" ? { ends_on: body.ends_on } : { status: "active" }, op === "contract_activate" ? "계약 개통" : "계약 종료일 변경");
    return json({ ok: true });
  }

  if (op === "security") {
    const orgId = uuid(body.org_id);
    const status = str(body.status);
    if (!orgId || !status) return invalid(["org_id·status: 필수입니다"]);
    const row = { org_id: orgId, status, checklist_ref: str(body.checklist_ref), reviewer: str(body.reviewer), reviewed_on: str(body.reviewed_on), note: str(body.note), created_by: actor };
    const { data, error } = await db.from("org_security_reviews").insert(row).select("id, status").single();
    if (error) return fail(error, "org_security_reviews 추가");
    await audit("org.security.record", `org_security_reviews:${(data as { id: number }).id}`, null, { org_id: orgId, status }, "보안·개인정보 확인표 기록");
    return json({ review: data }, 201);
  }

  if (op === "seat_invite") {
    const orgId = uuid(body.org_id);
    if (!orgId) return invalid(["org_id: 필수입니다"]);
    const r = await inviteSeat(db, null, orgId, body.expiresInDays);
    if (!r.ok) return errorJson(r.status, r.message, { code: r.code });
    await audit("org.seat.invite", `org_seats:${r.value.seatId}`, null, { org_id: orgId }, "운영자 좌석 초대 (토큰은 기록하지 않음)");
    return json({ seatId: r.value.seatId, token: r.value.token, acceptPath: `/org/accept?token=${r.value.token}` }, 201);
  }

  if (op === "seat_revoke") {
    const seatId = uuid(body.seat_id);
    if (!seatId) return invalid(["seat_id: 필수입니다"]);
    const r = await revokeSeat(db, null, seatId);
    if (!r.ok) return errorJson(r.status, r.message, { code: r.code });
    await audit("org.seat.revoke", `org_seats:${seatId}`, null, { revoked: true }, "운영자 좌석 회수");
    return json({ ok: true });
  }

  if (op === "tax_issued") {
    const id = uuid(body.id);
    const ref = str(body.issued_ref);
    const on = str(body.issued_on);
    if (!id || !ref || !on) return invalid(["id·issued_ref·issued_on: 필수입니다 (수기 발행 번호·날짜)"]);
    const { error } = await db.rpc("tax_invoice_mark_issued", { p_id: id, p_issued_ref: ref, p_issued_on: on, p_by: actor });
    if (error) return fail(error, "tax_invoice_mark_issued");
    await audit("org.tax_invoice.issued", `tax_invoice_requests:${id}`, null, { issued_on: on }, "세금계산서 수기 발행 기록");
    return json({ ok: true });
  }

  const id = uuid(body.id);
  const status = str(body.status);
  if (!id || !status) return invalid(["id·status: 필수입니다"]);
  const { data, error } = await db.from("institution_inquiries").update({ status, updated_by: actor }).eq("id", id).is("purged_at", null).select("id, status").maybeSingle();
  if (error) return fail(error, "institution_inquiries 상태");
  if (!data) return errorJson(404, "그런 견적 요청이 없습니다 (이미 파기됐을 수 있음)");
  await audit("org.inquiry.status", `institution_inquiries:${id}`, null, { status }, "견적 요청 처리 상태 변경");
  return json({ inquiry: data });
});
