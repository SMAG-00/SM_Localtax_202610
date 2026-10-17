// 편집국 세션 쿠키 설정 시험 — httpOnly·SameSite=Lax는 늘, Secure는 https 요청일 때만 (앞단 프록시 머리글 먼저)
import { describe, expect, test } from "vitest";
import { authCookieOptions, isHttps } from "./cookie-options";

const headers = (init: Record<string, string> = {}) => new Headers(init);

describe("authCookieOptions", () => {
  test("브라우저 스크립트가 못 읽고(httpOnly) 다른 사이트 요청에 붙지 않는다(Lax), 경로는 사이트 전체", () => {
    expect(authCookieOptions(true)).toEqual({ httpOnly: true, sameSite: "lax", secure: true, path: "/" });
    expect(authCookieOptions(false)).toEqual({ httpOnly: true, sameSite: "lax", secure: false, path: "/" });
  });
});

describe("isHttps", () => {
  test.each([
    [{ "x-forwarded-proto": "https" }, "http://127.0.0.1:3001/api/auth/login", true],
    [{ "x-forwarded-proto": "http" }, "https://e2e.example.test/api/auth/login", false],
    [{ "x-forwarded-proto": "https, http" }, undefined, true],
    [{ "x-forwarded-proto": " HTTPS " }, undefined, true],
    [{}, "https://e2e.example.test/admin", true],
    [{}, "http://127.0.0.1:3001/admin", false],
    [{}, "주소 아님", false],
    [{}, undefined, false],
  ] as const)("%j + %s → %s", (h, url, expected) => {
    expect(isHttps(headers(h), url)).toBe(expected);
  });
});
