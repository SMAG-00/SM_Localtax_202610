import { describe, expect, test } from "vitest";
import { cutoffBefore, isExpired, parseRetention } from "./retention";

const SEED = {
  version: "2026-10-20.1",
  unconfirmed_signup_days: 7,
  unconfirmed_consent_days: 7,
  revoked_consent_days: 30,
  inquiry_contact_days: 365,
  inquiry_attachment_days: 365,
  throttle_hours: 24,
};

describe("parseRetention — 보존 기한 설정", () => {
  test("씨앗 값을 이름별로 읽는다", () => {
    expect(parseRetention(SEED)).toEqual({
      unconfirmedSignupDays: 7,
      unconfirmedConsentDays: 7,
      revokedConsentDays: 30,
      inquiryContactDays: 365,
      inquiryAttachmentDays: 365,
      throttleHours: 24,
    });
  });
  test.each([
    ["일수 0", { ...SEED, revoked_consent_days: 0 }],
    ["일수 소수", { ...SEED, inquiry_contact_days: 1.5 }],
    ["일수 상한 초과", { ...SEED, inquiry_attachment_days: 3651 }],
    ["문자열 일수", { ...SEED, unconfirmed_signup_days: "7" }],
    ["시간 0", { ...SEED, throttle_hours: 0 }],
    ["칸 빠짐", { version: "x" }],
    ["배열", []],
    ["null", null],
  ])("모양이 틀리면 null이다 (%s)", (_n, value) => {
    expect(parseRetention(value)).toBeNull();
  });
  test("경계값 1일과 3650일, 1시간과 720시간은 받는다", () => {
    expect(parseRetention({ ...SEED, revoked_consent_days: 1, inquiry_contact_days: 3650, throttle_hours: 720 })).not.toBeNull();
  });
});

describe("isExpired — 경계 하루 전은 남고 당일은 지운다", () => {
  const now = new Date("2026-10-21T03:30:00.000Z");
  test("cutoffBefore는 정확히 일수만큼 거슬러 올라간다", () => {
    expect(cutoffBefore(now, 7).toISOString()).toBe("2026-10-14T03:30:00.000Z");
  });
  test("7일 되기 1밀리초 전은 남는다", () => {
    expect(isExpired(new Date("2026-10-14T03:30:00.001Z"), now, 7)).toBe(false);
  });
  test("정확히 7일 된 것은 지운다", () => {
    expect(isExpired(new Date("2026-10-14T03:30:00.000Z"), now, 7)).toBe(true);
  });
  test("365일 연락처: 하루 전(364일)은 남고 365일은 지운다", () => {
    const day = 86_400_000;
    expect(isExpired(new Date(now.getTime() - 364 * day), now, 365)).toBe(false);
    expect(isExpired(new Date(now.getTime() - 365 * day), now, 365)).toBe(true);
  });
});
