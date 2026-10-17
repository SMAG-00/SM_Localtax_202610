// 회원·편집국 계정 관리 규칙 시험 (ADM-02 조회·정지) — 정지 판정 경계, 정지 입력, 검색어, 정지할 수 없는 계정
import { describe, expect, test } from "vitest";
import { isSuspended, memberSearchQuery, parseSuspensionInput, suspendBlocked } from "./member-rules";

const NOW = Date.parse("2026-10-18T03:00:00Z");

describe("정지 판정 (Supabase Auth banned_until)", () => {
  test.each([
    ["정지 기록 없음", null, false],
    ["빈 값", "", false],
    ["1초 뒤까지 정지", "2026-10-18T03:00:01Z", true],
    ["지금 끝남", "2026-10-18T03:00:00Z", false],
    ["어제 끝난 정지", "2026-10-17T03:00:00Z", false],
    ["100년 정지", "2126-09-23T15:59:07.12680053Z", true],
    ["읽을 수 없는 값은 정지로 본다 (닫힌 쪽)", "언젠가", true],
  ] as const)("%s → %s", (_n, bannedUntil, expected) => {
    expect(isSuspended(bannedUntil, NOW)).toBe(expected);
  });
});

describe("정지·해제 입력", () => {
  test("정지 여부와 사유(필수)", () => {
    expect(parseSuspensionInput({ suspend: true, reason: " 퇴사 " })).toEqual({ ok: true, value: { suspend: true, reason: "퇴사" } });
    expect(parseSuspensionInput({ suspend: false, reason: "복직" })).toEqual({ ok: true, value: { suspend: false, reason: "복직" } });
  });
  test("사유가 없거나 정지 여부가 boolean이 아니면 거부", () => {
    expect(parseSuspensionInput({ suspend: true })).toEqual({ ok: false, errors: ["suspension.reason: 사유를 적어야 합니다 (감사 기록)"] });
    expect(parseSuspensionInput({ suspend: "yes", reason: "x" })).toEqual({ ok: false, errors: ["suspension.suspend: true/false여야 합니다"] });
    expect(parseSuspensionInput({ suspend: true, reason: "x", until: "2027" })).toEqual({ ok: false, errors: ["suspension.until: 모르는 칸입니다"] });
  });
});

describe("정지할 수 없는 계정", () => {
  test("자기 계정", () => {
    expect(suspendBlocked({ targetId: "u1", viewerId: "u1", targetIsAdmin: true })).toMatch(/자기 계정/);
  });
  test("관리자 계정(ADMIN_EMAILS) — 먼저 관리자 목록에서 빼야 한다", () => {
    expect(suspendBlocked({ targetId: "u2", viewerId: "u1", targetIsAdmin: true })).toMatch(/ADMIN_EMAILS/);
  });
  test("그 밖의 계정은 정지할 수 있다", () => {
    expect(suspendBlocked({ targetId: "u2", viewerId: "u1", targetIsAdmin: false })).toBeNull();
  });
});

describe("검색어 (이메일 일부)", () => {
  test.each([
    ["  Editor@Example ", "editor@example"],
    ["ab", "ab"],
    ["a", null],
    ["", null],
    ["a".repeat(101), null],
    ["a,b", null],
    ["a b", null],
  ] as const)("'%s' → %s", (q, expected) => {
    expect(memberSearchQuery(q)).toBe(expected);
  });
});
