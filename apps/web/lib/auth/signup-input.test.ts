// 가입 입력 검사·폼 열림 토큰 시험 (W2-e 설계 4.3 · 4.5) — 구체 입력과 기대 결과를 대조한다.
import { describe, expect, test } from "vitest";
import { CODE_MESSAGES, SIGNUP_FILL_TOKEN_HOURS, SIGNUP_MIN_FILL_SECONDS, checkFillToken, parseSignupInput, signFillToken, type SignupLimits } from "./signup-input";

const limits: SignupLimits = { password: { minChars: 10, maxBytes: 72 }, displayNameChars: 30, interestMax: 8, interestRegionLimit: 5 };
const good = { email: "Member.One@Example.test ", password: "한글비밀번호열글자넘게씁니다", agreeTerms: "on", agreePrivacy: true };

describe("parseSignupInput", () => {
  test("정상 입력 — 이메일은 앞뒤 공백을 떼고 소문자로, 선택 칸은 비어 있다", () => {
    const r = parseSignupInput(good, limits);
    expect(r).toEqual({ ok: true, value: { email: "member.one@example.test", password: good.password, displayName: null, interests: [], regionCodes: [] } });
  });
  test.each([["", "빈 값"], ["plain", "골뱅이 없음"], ["a@b", "도메인에 점 없음"], ["a b@example.test", "공백 포함"], [`${"a".repeat(250)}@example.test`, "254자 초과"]])(
    "이메일 %s (%s)은 email로 거부",
    (email) => {
      expect(parseSignupInput({ ...good, email }, limits)).toMatchObject({ ok: false, code: "email", field: "email" });
    },
  );
  test("비밀번호가 9글자면 too_short — 경계 10글자는 통과", () => {
    expect(parseSignupInput({ ...good, password: "abcdef1h9" }, limits)).toMatchObject({ ok: false, code: "password_too_short" });
    expect(parseSignupInput({ ...good, password: "q7!xv2#kLp" }, limits).ok).toBe(true);
  });
  test("비밀번호에 이메일을 그대로 넣으면 거부", () => {
    expect(parseSignupInput({ ...good, email: "kim.minsu@example.test", password: "kim.minsu@example.test" }, limits)).toMatchObject({ ok: false, code: "password_same_as_email" });
  });
  test("필수 동의가 하나라도 빠지면 terms — 'on'과 true만 동의로 본다", () => {
    expect(parseSignupInput({ ...good, agreePrivacy: undefined }, limits)).toMatchObject({ ok: false, code: "terms" });
    expect(parseSignupInput({ ...good, agreeTerms: "yes" }, limits)).toMatchObject({ ok: false, code: "terms" });
  });
  test("표시 이름 — 31글자·이메일 모양은 거부, 30글자는 통과", () => {
    expect(parseSignupInput({ ...good, displayName: "가".repeat(31) }, limits)).toMatchObject({ ok: false, code: "display_name" });
    expect(parseSignupInput({ ...good, displayName: "kim@example.test" }, limits)).toMatchObject({ ok: false, code: "display_name" });
    expect(parseSignupInput({ ...good, displayName: " " + "가".repeat(30) + " " }, limits)).toMatchObject({ ok: true, value: { displayName: "가".repeat(30) } });
  });
  test("관심 분야·지역 — 상한 초과·문자열 아닌 값은 interests, 중복은 하나로", () => {
    expect(parseSignupInput({ ...good, regionCodes: ["a", "b", "c", "d", "e", "f"] }, limits)).toMatchObject({ ok: false, code: "interests" });
    expect(parseSignupInput({ ...good, interests: [1] }, limits)).toMatchObject({ ok: false, code: "interests" });
    expect(parseSignupInput({ ...good, interests: ["tax", "tax", "local"] }, limits)).toMatchObject({ ok: true, value: { interests: ["tax", "local"] } });
  });
  test("가입 요청에 넣은 역할·메타데이터 칸은 결과에 없다", () => {
    const r = parseSignupInput({ ...good, role: "admin", roles: ["editor"], data: { role: "admin" } }, limits);
    expect(r.ok && Object.keys(r.value).sort()).toEqual(["displayName", "email", "interests", "password", "regionCodes"]);
  });
  test("모든 거부 코드에 문장이 있다", () => {
    const r = parseSignupInput({ ...good, email: "x" }, limits);
    expect(!r.ok && CODE_MESSAGES[r.code]).toBe("이메일 주소 형식을 확인해 주세요");
  });
});

describe("폼 열림 토큰", () => {
  const secret = "test-secret-1234";
  const opened = 1_800_000_000_000;
  const token = signFillToken(secret, opened);
  test("최소 작성 시간 직전은 too_fast, 딱 그 시간은 ok", () => {
    expect(checkFillToken(secret, token, opened + SIGNUP_MIN_FILL_SECONDS * 1000 - 1)).toBe("too_fast");
    expect(checkFillToken(secret, token, opened + SIGNUP_MIN_FILL_SECONDS * 1000)).toBe("ok");
  });
  test("유효 시간 끝은 ok, 1ms 지나면 expired", () => {
    const end = opened + SIGNUP_FILL_TOKEN_HOURS * 3600 * 1000;
    expect(checkFillToken(secret, token, end)).toBe("ok");
    expect(checkFillToken(secret, token, end + 1)).toBe("expired");
  });
  test("다른 열쇠·고친 시각·모양이 틀린 값·없는 값은 bad", () => {
    const now = opened + 10_000;
    expect(checkFillToken("other-secret", token, now)).toBe("bad");
    expect(checkFillToken(secret, token.replace(String(opened), String(opened - 5000)), now)).toBe("bad");
    expect(checkFillToken(secret, "abc", now)).toBe("bad");
    expect(checkFillToken(secret, undefined, now)).toBe("bad");
  });
  test("빈 열쇠로는 토큰을 만들지 못한다", () => {
    expect(() => signFillToken("", opened)).toThrow();
  });
});
