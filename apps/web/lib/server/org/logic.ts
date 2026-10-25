import { createHash, randomBytes } from "node:crypto";

// 기관 구독·좌석·견적 요청의 순수 규칙 (W11-f, BIZ-07·PAY-04). DB·네트워크를 부르지 않는다.
//  · 초대 링크 토큰은 서버가 만들고 SHA-256 해시만 DB에 둔다 (메일 주소 저장 0).
//  · 좌석 수·등급·기관 번호는 서버가 DB에서 정한다 - 요청 본문의 값은 판정에 쓰지 않는다.

export const ORG_TYPES = ["local_government", "tax_firm", "financial"] as const;
export type OrgType = (typeof ORG_TYPES)[number];
export const ORG_TYPE_LABELS: Readonly<Record<OrgType, string>> = {
  local_government: "지자체",
  tax_firm: "세무법인",
  financial: "금융기관",
};

export const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const TOKEN_SHAPE = /^[0-9a-f]{64}$/;
const EMAIL_SHAPE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 초대 링크 토큰 - 원문은 링크로만 전달되고 DB에는 해시만 남는다 */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: hashInviteToken(token) };
}

/** 견적 요청 접수번호 - 영문 대문자·숫자 10자 */
export function newReceiptNo(): string {
  return `IQ${randomBytes(4).toString("hex").toUpperCase()}`;
}

/** 초대 만료 시각 - 일수는 요청이 정하고(1~30), 시각은 서버 시계로 계산한다 */
export function inviteExpiry(now: Date, days: unknown): Date | null {
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 30) return null;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

interface ErrorInfo {
  status: number;
  message: string;
}
const ERRORS: Readonly<Record<string, ErrorInfo>> = {
  "org:not_admin": { status: 403, message: "이 기관의 관리자만 할 수 있습니다" },
  "org:no_active_contract": { status: 409, message: "진행 중인 계약이 없습니다" },
  "org:security_not_approved": { status: 409, message: "보안·개인정보 확인표가 승인되지 않아 좌석을 열 수 없습니다" },
  "org:seat_limit": { status: 409, message: "계약 좌석을 모두 사용했습니다" },
  "org:invite_invalid": { status: 404, message: "사용할 수 없는 초대 링크입니다" },
  "org:invite_expired": { status: 410, message: "초대 링크가 만료됐습니다" },
  "org:already_seated": { status: 409, message: "이미 이 기관의 좌석을 쓰고 있습니다" },
  "org:login_required": { status: 401, message: "로그인이 필요합니다" },
  "org:seat_not_found": { status: 404, message: "그런 좌석이 없습니다" },
  "org:contract_not_found": { status: 404, message: "그런 계약이 없습니다" },
  "org:contract_not_draft": { status: 409, message: "작성 중인 계약만 개통할 수 있습니다" },
  "org:contract_ref_missing": { status: 422, message: "계약서 위치(contract_ref)가 비어 있어 개통할 수 없습니다" },
  "org:contract_expired": { status: 409, message: "종료일이 지난 계약입니다" },
  "org:already_active": { status: 409, message: "이 기관에는 이미 진행 중인 계약이 있습니다" },
  "org:contract_not_active": { status: 409, message: "진행 중이거나 끝난 계약만 종료일을 바꿀 수 있습니다" },
  "org:end_before_start": { status: 422, message: "종료일이 시작일보다 앞입니다" },
  "org:seats_below_usage": { status: 422, message: "사용 중인 좌석보다 적게 줄일 수 없습니다" },
  "tax_invoice:not_admin": { status: 403, message: "이 기관의 관리자만 할 수 있습니다" },
  "tax_invoice:business_info_missing": { status: 422, message: "사업자등록번호와 세금계산서 수신 이메일이 있어야 요청할 수 있습니다" },
  "tax_invoice:no_contract": { status: 404, message: "요청할 수 있는 계약이 없습니다" },
  "tax_invoice:not_requested": { status: 409, message: "발행 대기 중인 요청이 아닙니다" },
  "inquiry:consent_required": { status: 422, message: "연락 동의가 필요합니다" },
  "inquiry:policy_missing": { status: 503, message: "견적 요청을 받을 수 없는 상태입니다" },
};

/** DB 함수가 낸 'org:코드' 문장 → HTTP 상태와 안내 문장. 모르는 문장이면 null (서버 오류로 처리) */
export function orgErrorOf(message: string | undefined): { code: string; status: number; message: string } | null {
  const m = /^(org|tax_invoice|inquiry):[a-z_]+/.exec(message ?? "");
  if (!m) return null;
  const info = ERRORS[m[0]];
  return info ? { code: m[0], ...info } : null;
}

export interface InquiryInput {
  orgType: OrgType;
  orgName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  seatsWanted: number;
  message: string | null;
  consentContact: true;
  consentMarketing: boolean;
}

/** 견적 요청 검증 - 연락 동의(필수)가 없거나 이메일 형식이 틀리면 접수하지 않는다. 소식 수신 동의는 따로이고 거부해도 접수된다 */
export function validateInquiry(body: Record<string, unknown>): { ok: true; value: InquiryInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() !== "" && v.trim().length <= max ? v.trim() : null);
  const orgType = ORG_TYPES.find((t) => t === body.orgType);
  if (!orgType) errors.push("orgType: 지자체·세무법인·금융기관 중 하나를 고르세요");
  const orgName = text(body.orgName, 100);
  if (!orgName) errors.push("orgName: 기관 이름이 필요합니다 (100자 이하)");
  const contactName = text(body.contactName, 60);
  if (!contactName) errors.push("contactName: 담당자 이름이 필요합니다 (60자 이하)");
  const email = typeof body.contactEmail === "string" ? body.contactEmail.trim().toLowerCase() : "";
  if (!(email.length <= 320 && EMAIL_SHAPE.test(email))) errors.push("contactEmail: 이메일 형식이 맞지 않습니다");
  const phone = typeof body.contactPhone === "string" && body.contactPhone.trim() !== "" ? body.contactPhone.trim() : null;
  if (phone !== null && !/^[0-9+-]{7,20}$/.test(phone)) errors.push("contactPhone: 숫자와 하이픈만 7~20자");
  const seats = body.seatsWanted;
  if (typeof seats !== "number" || !Number.isInteger(seats) || seats < 1 || seats > 10000) errors.push("seatsWanted: 1~10000 사이 정수");
  const message = typeof body.message === "string" && body.message.trim() !== "" ? body.message.trim() : null;
  if (message !== null && message.length > 2000) errors.push("message: 2000자 이하");
  if (body.consentContact !== true) errors.push("consentContact: 연락 동의가 필요합니다");
  if (errors.length > 0 || !orgType || !orgName || !contactName || typeof seats !== "number") return { ok: false, errors };
  return {
    ok: true,
    value: { orgType, orgName, contactName, contactEmail: email, contactPhone: phone, seatsWanted: seats, message, consentContact: true, consentMarketing: body.consentMarketing === true },
  };
}

/** 본문을 빈 줄 기준 문단으로 - 글자 그대로 문단으로만 그린다(HTML로 해석하지 않음) */
export function paragraphsOf(body: string): string[] {
  return body.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p !== "");
}
