// 화면 경로 막기 규칙 시험 (proxy.ts) — 로그인 쿠키가 없으면 로그인 화면으로, 로그인 화면은 그대로.
// 이 판정은 낙관적 확인(쿠키 존재)일 뿐이다 — 실제 확인은 서버 컴포넌트·라우트 처리기의 DAL이 한다 (PRD-00 6장 두 곳에서 막기).
import { describe, expect, test } from "vitest";
import { adminProxyDecision, hasAuthCookie, isLoginPath } from "./proxy-rules";

describe("Supabase 로그인 쿠키 알아보기", () => {
  test.each([
    [["sb-127-auth-token"], true],
    [["sb-fvnhqbtdviknitetjuxr-auth-token.0", "sb-fvnhqbtdviknitetjuxr-auth-token.1"], true],
    [["theme", "sb-127-auth-token"], true],
    [[], false],
    [["sb-127-auth-token-code-verifier"], false],
    [["session", "auth-token"], false],
    [["xsb-127-auth-token"], false],
  ])("%j → %s", (names, expected) => {
    expect(hasAuthCookie(names)).toBe(expected);
  });
});

describe("로그인 화면 경로", () => {
  test.each([
    ["/admin/login", true],
    ["/admin/login/", true],
    ["/admin/loginx", false],
    ["/admin", false],
    ["/admin/articles", false],
  ])("%s → %s", (path, expected) => {
    expect(isLoginPath(path)).toBe(expected);
  });
});

describe("판정", () => {
  test("쿠키 없이 /admin → 로그인 화면, 돌아갈 주소는 경로+쿼리", () => {
    expect(adminProxyDecision({ pathname: "/admin", search: "", cookieNames: [] })).toEqual({ kind: "login", location: "/admin/login?next=%2Fadmin" });
    expect(adminProxyDecision({ pathname: "/admin/articles/12", search: "?tab=check", cookieNames: ["theme"] })).toEqual({
      kind: "login",
      location: "/admin/login?next=%2Fadmin%2Farticles%2F12%3Ftab%3Dcheck",
    });
  });

  test("쿠키가 있으면 통과(실제 확인은 서버가 한다)", () => {
    expect(adminProxyDecision({ pathname: "/admin/reviews", search: "", cookieNames: ["sb-127-auth-token"] })).toEqual({ kind: "pass" });
  });

  test("로그인 화면은 쿠키가 없어도 통과 — 되돌이 없음", () => {
    expect(adminProxyDecision({ pathname: "/admin/login", search: "?next=%2Fadmin", cookieNames: [] })).toEqual({ kind: "login-page" });
  });
});
