import { describe, expect, it } from "vitest";
import { RESET_WINDOW_MINUTES, checkResetCookie, parseEmailField, signResetCookie, unconfirmedCutoff, unconfirmedSignupDays, withdrawBlocked } from "./recovery";

const SECRET = "unit-test-secret";
const USER = "123e4567-e89b-12d3-a456-426614174000";
const OTHER = "223e4567-e89b-12d3-a456-426614174000";
const NOW = Date.UTC(2026, 9, 20, 3, 0, 0);

describe("재설정 확인 쿠키", () => {
  const value = signResetCookie(SECRET, USER, NOW);
  it("같은 계정·유효 시간 안이면 통과", () => expect(checkResetCookie(SECRET, value, USER, NOW + 60_000)).toBe(true));
  it("유효 시간 경계 — 만료 1ms 전 통과, 만료 시각 정각 거부", () => {
    const exp = NOW + RESET_WINDOW_MINUTES * 60_000;
    expect(checkResetCookie(SECRET, value, USER, exp - 1)).toBe(true);
    expect(checkResetCookie(SECRET, value, USER, exp)).toBe(false);
  });
  it("다른 계정의 세션이면 거부", () => expect(checkResetCookie(SECRET, value, OTHER, NOW)).toBe(false));
  it("다른 열쇠로는 거부", () => expect(checkResetCookie("other-secret", value, USER, NOW)).toBe(false));
  it("만료 시각을 늘려 위조하면 거부", () => {
    const [id, exp, mac] = value.split(".");
    expect(checkResetCookie(SECRET, `${id}.${Number(exp) + 3_600_000}.${mac}`, USER, NOW)).toBe(false);
  });
  it.each([undefined, null, "", "abc", 5, `${USER}.1.x`])("모양이 틀린 값 %s은 거부", (v) => expect(checkResetCookie(SECRET, v, USER, NOW)).toBe(false));
});

describe("이메일 칸", () => {
  it("공백·대문자를 정리한다", () => expect(parseEmailField("  Foo@Example.TEST ")).toBe("foo@example.test"));
  it.each(["", "no-at", "a@b", "a b@c.d", 3, null])("형식 오류 %s는 null", (v) => expect(parseEmailField(v)).toBeNull());
  it("254자를 넘으면 null", () => expect(parseEmailField(`${"a".repeat(250)}@b.cd`)).toBeNull());
});

describe("미확인 가입 정리 기준", () => {
  it("7일 전 시각을 만든다", () => expect(unconfirmedCutoff(new Date(NOW), 7).toISOString()).toBe("2026-10-13T03:00:00.000Z"));
  it("설정에서 일수를 읽는다", () => expect(unconfirmedSignupDays({ version: "v", unconfirmed_signup_days: 7 })).toBe(7));
  it.each([0, 366, 1.5, "7", null])("범위·모양이 틀린 일수 %s는 null", (d) => expect(unconfirmedSignupDays({ unconfirmed_signup_days: d })).toBeNull());
  it.each([null, [], "x"])("객체가 아닌 설정 %s는 null", (v) => expect(unconfirmedSignupDays(v)).toBeNull());
});

describe("탈퇴 제한", () => {
  it("역할 없는 일반 회원은 허용", () => expect(withdrawBlocked({ isAdmin: false, roles: [] })).toBe(false));
  it("편집국 역할이 있으면 막는다", () => expect(withdrawBlocked({ isAdmin: false, roles: ["reporter"] })).toBe(true));
  it("관리자는 막는다", () => expect(withdrawBlocked({ isAdmin: true, roles: [] })).toBe(true));
});
