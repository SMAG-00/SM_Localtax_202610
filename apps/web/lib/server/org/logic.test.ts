import { describe, expect, it } from "vitest";
import { hashInviteToken, inviteExpiry, newInviteToken, newReceiptNo, orgErrorOf, paragraphsOf, TOKEN_SHAPE, validateInquiry } from "./logic";

const valid = { orgType: "tax_firm", orgName: "시험 세무법인", contactName: "홍시험", contactEmail: "Buyer@Example.com", seatsWanted: 3, consentContact: true };

describe("초대 토큰", () => {
  it("토큰은 64자 16진수이고 해시는 SHA-256 16진수이며 원문과 같지 않다", () => {
    const { token, hash } = newInviteToken();
    expect(token).toMatch(TOKEN_SHAPE);
    expect(hash).toMatch(TOKEN_SHAPE);
    expect(hash).not.toBe(token);
    expect(hashInviteToken(token)).toBe(hash);
  });
  it("두 번 만들면 서로 다르다", () => {
    expect(newInviteToken().token).not.toBe(newInviteToken().token);
  });
  it("알려진 입력의 해시가 SHA-256 표준값과 같다", () => {
    expect(hashInviteToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("초대 만료", () => {
  const now = new Date("2026-11-01T00:00:00Z");
  it("1일과 30일은 되고 0일·31일·소수·문자열은 거부", () => {
    expect(inviteExpiry(now, 1)?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(inviteExpiry(now, 30)?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    for (const bad of [0, 31, 1.5, "7", null, undefined, -1]) expect(inviteExpiry(now, bad)).toBeNull();
  });
});

describe("DB 오류 문장 해석", () => {
  it("좌석 초과는 409, 관리자 아님은 403, 만료는 410", () => {
    expect(orgErrorOf("org:seat_limit")?.status).toBe(409);
    expect(orgErrorOf("org:not_admin")?.status).toBe(403);
    expect(orgErrorOf("org:invite_expired")?.status).toBe(410);
    expect(orgErrorOf("tax_invoice:business_info_missing")?.status).toBe(422);
  });
  it("모르는 문장이나 다른 오류는 null", () => {
    expect(orgErrorOf("duplicate key value violates unique constraint")).toBeNull();
    expect(orgErrorOf("org:something_new")).toBeNull();
    expect(orgErrorOf(undefined)).toBeNull();
  });
});

describe("견적 요청 검증", () => {
  it("올바른 입력은 이메일을 소문자로 바꾸고 수신 동의는 기본 해제", () => {
    const r = validateInquiry(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.contactEmail).toBe("buyer@example.com");
      expect(r.value.consentMarketing).toBe(false);
    }
  });
  it("수신 동의를 거부(false)해도 접수되고, 켜면 true", () => {
    expect(validateInquiry({ ...valid, consentMarketing: false }).ok).toBe(true);
    const r = validateInquiry({ ...valid, consentMarketing: true });
    expect(r.ok && r.value.consentMarketing).toBe(true);
  });
  it("연락 동의 없음(false·누락·문자열 'true')은 거부", () => {
    for (const c of [false, undefined, "true", 1]) {
      const r = validateInquiry({ ...valid, consentContact: c });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join(" ")).toContain("consentContact");
    }
  });
  it("이메일 형식 오류·좌석 0·좌석 10001·없는 기관 유형은 거부하고 경계 1과 10000은 허용", () => {
    expect(validateInquiry({ ...valid, contactEmail: "not-an-email" }).ok).toBe(false);
    expect(validateInquiry({ ...valid, seatsWanted: 0 }).ok).toBe(false);
    expect(validateInquiry({ ...valid, seatsWanted: 10001 }).ok).toBe(false);
    expect(validateInquiry({ ...valid, orgType: "company" }).ok).toBe(false);
    expect(validateInquiry({ ...valid, seatsWanted: 1 }).ok).toBe(true);
    expect(validateInquiry({ ...valid, seatsWanted: 10000 }).ok).toBe(true);
  });
  it("메시지 2000자는 허용, 2001자는 거부", () => {
    expect(validateInquiry({ ...valid, message: "가".repeat(2000) }).ok).toBe(true);
    expect(validateInquiry({ ...valid, message: "가".repeat(2001) }).ok).toBe(false);
  });
});

describe("접수번호·문단", () => {
  it("접수번호는 DB 모양(영문 대문자·숫자 8~16자)과 같다", () => {
    expect(newReceiptNo()).toMatch(/^[A-Z0-9]{8,16}$/);
  });
  it("문단은 빈 줄 기준으로 나누고 HTML 글자도 글자 그대로 둔다", () => {
    expect(paragraphsOf("첫째\n\n\n둘째 <b>x</b>\n\n")).toEqual(["첫째", "둘째 <b>x</b>"]);
  });
});
