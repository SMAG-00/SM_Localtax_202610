// 시도 횟수 키 시험 — HMAC-SHA256(열쇠, 범위:값) 앞 32글자. 정답은 다른 도구(python hmac)로 따로 구해 적었다.
import { describe, expect, test } from "vitest";
import { THROTTLE_KEY_CHARS, loginKeys, normalizeEmailKey, throttleKey } from "./throttle-key";

describe("throttleKey", () => {
  test("정답값과 같다 — 같은 열쇠·범위·값이면 python hmac의 앞 32글자와 일치", () => {
    expect(throttleKey("test-secret", "login_pair", "a@example.test|203.0.113.7")).toBe("507d195742b2fb0ba25cdb083cdf300c");
    expect(throttleKey("test-secret", "login_account", "a@example.test")).toBe("caf3cfd90e80ac395a26a25b1ec9ab0b");
    expect(throttleKey("test-secret", "login_ip", "203.0.113.7")).toBe("f83205aeee676c3312bcc501d4473216");
  });

  test("DB check 모양(소문자 16진수 32글자)이고 이메일·IP 원문이 들어 있지 않다", () => {
    const k = throttleKey("s3cret", "login_account", "admin@example.com");
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(k).toHaveLength(THROTTLE_KEY_CHARS);
    expect(k).not.toContain("admin");
  });

  test("범위가 다르면 같은 값도 다른 키, 열쇠가 다르면 다른 키, 값이 한 글자 달라도 다른 키", () => {
    const base = throttleKey("s", "login_account", "a@example.test");
    expect(throttleKey("s", "reset_email", "a@example.test")).not.toBe(base);
    expect(throttleKey("t", "login_account", "a@example.test")).not.toBe(base);
    expect(throttleKey("s", "login_account", "b@example.test")).not.toBe(base);
    expect(throttleKey("s", "login_account", "a@example.test")).toBe(base);
  });

  test("열쇠가 비어 있으면 만들지 않는다", () => {
    expect(() => throttleKey("", "login_ip", "1.1.1.1")).toThrow();
  });
});

describe("이메일 정리와 로그인 세 겹", () => {
  test("대소문자·앞뒤 공백·전각 글자를 맞춘다 — 같은 계정이 모양만 바꿔 한도를 피하지 못한다", () => {
    expect(normalizeEmailKey("  Admin@Example.COM ")).toBe("admin@example.com");
    expect(normalizeEmailKey("ａｄｍｉｎ＠example.com")).toBe("admin@example.com");
  });

  test("loginKeys — 이메일 표기가 달라도 세 키가 같고, IP가 다르면 짝·IP 키만 다르다(계정 키는 같다)", () => {
    const a = loginKeys("s", "Admin@Example.com", "203.0.113.7");
    const b = loginKeys("s", " admin@example.com ", "203.0.113.7");
    expect(b).toEqual(a);
    const c = loginKeys("s", "admin@example.com", "203.0.113.8");
    expect(c.account).toBe(a.account);
    expect(c.pair).not.toBe(a.pair);
    expect(c.ip).not.toBe(a.ip);
    const d = loginKeys("s", "other@example.com", "203.0.113.7");
    expect(d.ip).toBe(a.ip);
    expect(d.account).not.toBe(a.account);
    expect(d.pair).not.toBe(a.pair);
  });
});
