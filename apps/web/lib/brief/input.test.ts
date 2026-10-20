import { describe, expect, test } from "vitest";
import { BRIEF_MESSAGES, TOKEN_SHAPE, hashToken, isBriefCode, newToken, parseBriefInput } from "./input";

describe("parseBriefInput", () => {
  test("동의 체크 없이는 거부한다", () => {
    expect(parseBriefInput({ email: "a@example.com" })).toEqual({ ok: false, code: "consent" });
    expect(parseBriefInput({ email: "a@example.com", agree: "" })).toEqual({ ok: false, code: "consent" });
    expect(parseBriefInput({ email: "a@example.com", agree: "off" })).toEqual({ ok: false, code: "consent" });
  });
  test("체크(on·true)와 올바른 이메일은 받고 소문자·앞뒤 공백을 정리한다", () => {
    expect(parseBriefInput({ email: "  Reader+Tag@Example.COM ", agree: "on" })).toEqual({ ok: true, email: "reader+tag@example.com" });
    expect(parseBriefInput({ email: "a@b.kr", agree: true })).toEqual({ ok: true, email: "a@b.kr" });
  });
  test.each(["", "plain", "a@b", "a b@example.com", "a@@example.com", "한글@example.com", `${"a".repeat(250)}@x.com`])("형식이 틀린 이메일은 거부한다 (%s)", (email) => {
    expect(parseBriefInput({ email, agree: "on" })).toEqual({ ok: false, code: "email" });
  });
  test("이메일이 문자열이 아니면 거부한다", () => {
    expect(parseBriefInput({ email: ["a@example.com"], agree: "on" })).toEqual({ ok: false, code: "email" });
  });
  test("이메일 오류가 동의 오류보다 먼저다", () => {
    expect(parseBriefInput({ email: "x" })).toEqual({ ok: false, code: "email" });
  });
});

describe("토큰", () => {
  test("새 토큰은 모양을 지키고 매번 다르다", () => {
    const a = newToken();
    expect(a).toMatch(TOKEN_SHAPE);
    expect(a).toHaveLength(43);
    expect(newToken()).not.toBe(a);
  });
  test("해시는 SHA-256 16진수 64글자이고 같은 입력에 같다", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });
  test("모양이 틀린 토큰은 TOKEN_SHAPE에 걸린다", () => {
    for (const bad of ["", "short", "a b".padEnd(40, "x"), "x".repeat(65), "한글".repeat(20)]) expect(TOKEN_SHAPE.test(bad)).toBe(false);
  });
});

test("거부 문장 표: 신청 중복 안내 문장과 코드 판별", () => {
  expect(BRIEF_MESSAGES.already).toBe("이미 신청하셨습니다");
  expect(isBriefCode("consent")).toBe(true);
  expect(isBriefCode("toString")).toBe(false);
});
