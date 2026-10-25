import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/server/http";
import { hashInviteToken, inviteExpiry, newInviteToken, newReceiptNo, orgErrorOf, TOKEN_SHAPE, type InquiryInput } from "./logic";

// 기관 구독·좌석·세금계산서 요청·견적 요청 서버 기능 (W11-f, BIZ-07·PAY-04).
//  · 권한 판정은 DB 권한 함수 하나에 있고(리포트 본문 읽기는 reports.ts), 이 모듈은 좌석 수·등급·기관 번호를 요청 값으로 정하지 않는다.
//  · 기관 결제 경로는 없다 - 계약서·세금계산서 기록뿐이다 (결제 모듈 billing/을 부르지 않는다).
//  · 응답에는 회원 번호·메일·초대 토큰 원문을 담지 않는다(토큰 원문은 초대를 만든 그 응답에서만 한 번).
type Db = SupabaseClient;

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; code: string; message: string };

function fail(error: { code?: string; message?: string }, context: string): Result<never> {
  const known = orgErrorOf(error.message);
  if (known) return { ok: false, status: known.status, code: known.code, message: known.message };
  throw dbError(error, context);
}

/** 기능 키가 켜져 있는지 - 꺼져 있으면 화면·API는 404 */
export async function featureOn(db: Db, key: "institution_subscription" | "premium_reports" | "institution_inquiry"): Promise<boolean> {
  const { data, error } = await db.from("settings").select("value").eq("key", "feature_flags").maybeSingle();
  if (error) throw dbError(error, "feature_flags 읽기");
  return ((data as { value?: Record<string, unknown> } | null)?.value ?? {})[key] === true;
}

export async function isOrgAdmin(db: Db, userId: string, orgId: string): Promise<boolean> {
  const { data, error } = await db.rpc("org_is_admin", { p_user: userId, p_org: orgId });
  if (error) throw dbError(error, "org_is_admin");
  return data === true;
}

/** 초대 만들기 - actor가 null이면 운영자 호출(화면 권한은 호출한 API가 확인). 토큰 원문은 이 반환값에서만 나간다 */
export async function inviteSeat(db: Db, actor: string | null, orgId: string, expiresInDays: unknown, now = new Date()): Promise<Result<{ seatId: string; token: string; expiresAt: string }>> {
  const expires = inviteExpiry(now, expiresInDays);
  if (!expires) return { ok: false, status: 422, code: "invalid", message: "expiresInDays: 1~30 사이 정수" };
  const { token, hash } = newInviteToken();
  const { data, error } = await db.rpc("org_seat_invite", { p_actor: actor, p_org: orgId, p_token_hash: hash, p_expires_at: expires.toISOString(), p_at: now.toISOString() });
  if (error) return fail(error, "org_seat_invite");
  return { ok: true, value: { seatId: String(data), token, expiresAt: expires.toISOString() } };
}

export async function acceptSeat(db: Db, userId: string, token: string, now = new Date()): Promise<Result<{ seatId: string }>> {
  if (!TOKEN_SHAPE.test(token)) return { ok: false, status: 404, code: "org:invite_invalid", message: "사용할 수 없는 초대 링크입니다" };
  const { data, error } = await db.rpc("org_seat_accept", { p_user: userId, p_token_hash: hashInviteToken(token), p_at: now.toISOString() });
  if (error) return fail(error, "org_seat_accept");
  return { ok: true, value: { seatId: String(data) } };
}

export async function revokeSeat(db: Db, actor: string | null, seatId: string, now = new Date()): Promise<Result<true>> {
  const { error } = await db.rpc("org_seat_revoke", { p_actor: actor, p_seat: seatId, p_reason: actor ? "admin_revoke" : "operator_revoke", p_at: now.toISOString() });
  if (error) return fail(error, "org_seat_revoke");
  return { ok: true, value: true };
}

export interface SeatRow {
  id: string;
  status: "invited" | "active" | "revoked";
  invitedAt: string;
  inviteExpiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}
export interface TaxInvoiceRow {
  id: string;
  kind: "tax_invoice" | "receipt";
  supplyAmount: number;
  status: "requested" | "issued" | "cancelled";
  requestedAt: string;
  issuedOn: string | null;
}
export interface OrgBoard {
  org: { id: string; name: string; orgType: string; hasBusinessInfo: boolean };
  securityApproved: boolean;
  contract: { id: string; status: string; seats: number; startsOn: string; endsOn: string; amount: number | null; includesDigital: boolean; includesReports: boolean } | null;
  seats: SeatRow[];
  usedSeats: number;
  taxInvoices: TaxInvoiceRow[];
}

/** 기관 관리자 화면 데이터 - 관리자가 아니면 null(화면은 404). 회원 번호·메일은 담지 않는다 */
export async function orgBoard(db: Db, userId: string, orgId: string): Promise<OrgBoard | null> {
  if (!(await isOrgAdmin(db, userId, orgId))) return null;
  const [org, contract, sec] = await Promise.all([
    db.from("orgs").select("id, name, org_type, business_no, tax_invoice_email").eq("id", orgId).maybeSingle(),
    db.from("org_contracts").select("id, status, seats, starts_on, ends_on, amount, includes_digital, includes_reports").eq("org_id", orgId).in("status", ["active", "ended"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.rpc("org_security_approved", { p_org: orgId }),
  ]);
  for (const r of [org, contract, sec]) if (r.error) throw dbError(r.error, "org 보드 읽기");
  const o = org.data as { id: string; name: string; org_type: string; business_no: string | null; tax_invoice_email: string | null } | null;
  if (!o) return null;
  const c = contract.data as { id: string; status: string; seats: number; starts_on: string; ends_on: string; amount: number | null; includes_digital: boolean; includes_reports: boolean } | null;
  let seats: SeatRow[] = [];
  let taxInvoices: TaxInvoiceRow[] = [];
  if (c) {
    const [s, t] = await Promise.all([
      db.from("org_seats").select("id, status, invited_at, invite_expires_at, accepted_at, revoked_at").eq("contract_id", c.id).order("invited_at"),
      db.from("tax_invoice_requests").select("id, kind, supply_amount, status, requested_at, issued_on").eq("org_id", orgId).order("requested_at", { ascending: false }).limit(50),
    ]);
    if (s.error) throw dbError(s.error, "org_seats 읽기");
    if (t.error) throw dbError(t.error, "tax_invoice_requests 읽기");
    seats = ((s.data ?? []) as Array<Record<string, string | null>>).map((r) => ({
      id: String(r.id), status: r.status as SeatRow["status"], invitedAt: String(r.invited_at), inviteExpiresAt: String(r.invite_expires_at), acceptedAt: r.accepted_at, revokedAt: r.revoked_at,
    }));
    taxInvoices = ((t.data ?? []) as Array<Record<string, string | number | null>>).map((r) => ({
      id: String(r.id), kind: r.kind as TaxInvoiceRow["kind"], supplyAmount: Number(r.supply_amount), status: r.status as TaxInvoiceRow["status"], requestedAt: String(r.requested_at), issuedOn: (r.issued_on as string | null) ?? null,
    }));
  }
  return {
    org: { id: o.id, name: o.name, orgType: o.org_type, hasBusinessInfo: o.business_no !== null && o.tax_invoice_email !== null },
    securityApproved: sec.data === true,
    contract: c ? { id: c.id, status: c.status, seats: c.seats, startsOn: c.starts_on, endsOn: c.ends_on, amount: c.amount, includesDigital: c.includes_digital, includesReports: c.includes_reports } : null,
    seats,
    usedSeats: seats.filter((x) => x.status !== "revoked").length,
    taxInvoices,
  };
}

/** 세금계산서·영수증 요청 - 공급가액은 계약 금액 데이터에서 서버가 정한다(요청 값 무시) */
export async function requestTaxInvoice(db: Db, actor: string, orgId: string, kind: unknown): Promise<Result<{ id: string }>> {
  if (kind !== "tax_invoice" && kind !== "receipt") return { ok: false, status: 422, code: "invalid", message: "kind: tax_invoice 또는 receipt" };
  const { data: c, error: ce } = await db.from("org_contracts").select("id, amount").eq("org_id", orgId).in("status", ["active", "ended"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (ce) throw dbError(ce, "계약 읽기");
  const contract = c as { id: string; amount: number | null } | null;
  if (!contract) return { ok: false, status: 404, code: "tax_invoice:no_contract", message: "요청할 수 있는 계약이 없습니다" };
  if (contract.amount === null) return { ok: false, status: 422, code: "tax_invoice:amount_missing", message: "계약 금액이 아직 입력되지 않았습니다" };
  const { data, error } = await db.rpc("tax_invoice_request_create", { p_actor: actor, p_org: orgId, p_contract: contract.id, p_kind: kind, p_supply_amount: contract.amount });
  if (error) return fail(error, "tax_invoice_request_create");
  return { ok: true, value: { id: String(data) } };
}

/** 견적 요청 접수 - 동의·이메일 검사는 logic.validateInquiry가 먼저 하고, DB 함수가 한 번 더 막는다 */
export async function submitInquiry(db: Db, input: InquiryInput, now = new Date()): Promise<Result<{ receiptNo: string }>> {
  const receiptNo = newReceiptNo();
  // 동의한 문서 버전 - 처리방침 게시본 번호(brief 사전 알림 신청과 같은 방식). 게시본이 없으면 빈 목록
  const versions = await db.from("policy_versions").select("id").eq("doc_key", "privacy").eq("status", "published");
  if (versions.error) throw dbError(versions.error, "policy_versions 읽기");
  const versionRef = ((versions.data ?? []) as Array<{ id: number }>).map((v) => v.id);
  const { error } = await db.rpc("institution_inquiry_submit", {
    p_receipt: receiptNo, p_org_type: input.orgType, p_org_name: input.orgName, p_contact_name: input.contactName, p_contact_email: input.contactEmail,
    p_contact_phone: input.contactPhone, p_seats: input.seatsWanted, p_message: input.message, p_consent_contact: input.consentContact,
    p_consent_marketing: input.consentMarketing, p_version_ref: versionRef, p_at: now.toISOString(),
  });
  if (error) return fail(error, "institution_inquiry_submit");
  return { ok: true, value: { receiptNo } };
}

/** 작업 institution-inquiry-purge - 파기한 수만 돌려준다 */
export async function purgeInquiries(db: Db, now: Date): Promise<{ purged: number }> {
  const { data, error } = await db.rpc("institution_inquiries_purge", { p_now: now.toISOString() });
  if (error) throw dbError(error, "institution_inquiries_purge");
  return { purged: Number(data ?? 0) };
}

/** 작업 org-contract-close - 종료 시각이 지난 계약 수 */
export async function closeExpiredContracts(db: Db, now: Date): Promise<{ closed: number }> {
  const { data, error } = await db.rpc("org_contracts_close_expired", { p_now: now.toISOString() });
  if (error) throw dbError(error, "org_contracts_close_expired");
  return { closed: Number(data ?? 0) };
}
