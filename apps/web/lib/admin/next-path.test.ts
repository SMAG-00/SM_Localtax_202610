// 로그인 뒤 돌아갈 주소(next) 시험 — 같은 사이트의 /admin 아래 상대 경로만 받는다 (열린 리디렉션 방지)
import { describe, expect, test } from "vitest";
import { ADMIN_HOME, safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  test.each([
    ["/admin", "/admin"],
    ["/admin/", "/admin/"],
    ["/admin/articles", "/admin/articles"],
    ["/admin/articles?status=draft&type=reported_news", "/admin/articles?status=draft&type=reported_news"],
    ["/admin/articles/12#check", "/admin/articles/12#check"],
    ["/admin/reviews?q=a b", "/admin/reviews?q=a%20b"],
  ])("받는다: %s", (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  test.each([
    ["다른 사이트 절대 주소", "https://evil.example"],
    ["다른 사이트 절대 주소 + /admin 경로", "https://evil.example/admin"],
    ["프로토콜 상대 주소", "//evil.example/admin"],
    ["역슬래시 우회", "/\\evil.example"],
    ["역슬래시 우회 2", "\\\\evil.example"],
    ["탭으로 // 만들기", "/\t/evil.example"],
    ["줄바꿈 끼우기", "/admin\n//evil.example"],
    ["javascript:", "javascript:alert(1)"],
    ["/admin으로 시작하는 다른 경로", "/administrator"],
    ["/admin 뒤 점", "/admin.evil"],
    ["공개 화면", "/news/abc"],
    ["상위 경로로 빠지기", "/admin/../news"],
    ["인코딩한 상위 경로", "/admin/%2e%2e/news"],
    ["로그인 화면(되돌이)", "/admin/login"],
    ["로그인 화면 + 쿼리", "/admin/login?next=/admin"],
    ["빈 값", ""],
    ["글자가 아님", 42],
    ["없음", undefined],
    ["목록(쿼리 두 번)", ["/admin", "/admin/x"]],
  ])("버리고 /admin: %s", (_name, raw) => {
    expect(safeNextPath(raw)).toBe(ADMIN_HOME);
  });

  test("2000자를 넘으면 버린다", () => {
    expect(safeNextPath(`/admin/${"a".repeat(2001)}`)).toBe(ADMIN_HOME);
  });
});
