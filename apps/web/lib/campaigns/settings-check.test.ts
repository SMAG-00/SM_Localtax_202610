import { describe, expect, test } from "vitest";
import { shortcutCopyErrors, utmRegistryErrors } from "./settings-check";

describe("바로가기 설명 설정 검사", () => {
  test("30자는 통과, 31자·줄바꿈·모르는 키·배열은 거부", () => {
    expect(shortcutCopyErrors({ calc: "가".repeat(30) })).toEqual([]);
    expect(shortcutCopyErrors({ calc: "가".repeat(31) })).toHaveLength(1);
    expect(shortcutCopyErrors({ calc: "a\nb" })).toHaveLength(1);
    expect(shortcutCopyErrors({ law_brief: "x" })).toEqual([expect.stringContaining("아는 키")]);
    expect(shortcutCopyErrors(["calc"])).toEqual(["객체여야 합니다"]);
  });
  test("빈 객체는 통과 (비워 두면 이름만 보임)", () => {
    expect(shortcutCopyErrors({})).toEqual([]);
  });
});

describe("캠페인 태그 등록 값 설정 검사", () => {
  test("모양이 맞으면 통과", () => {
    expect(utmRegistryErrors({ source: ["naver", "kakao"], medium: ["cpc"], content: [] })).toEqual([]);
  });
  test("20개는 통과, 21개는 거부", () => {
    expect(utmRegistryErrors({ source: Array.from({ length: 20 }, (_, i) => `s${i}`) })).toEqual([]);
    expect(utmRegistryErrors({ source: Array.from({ length: 21 }, (_, i) => `s${i}`) })).toHaveLength(1);
  });
  test.each([["Naver"], ["other"], ["a b"], [""], ["가나"], ["a".repeat(21)]])("값 '%s' 는 거부", (v) => {
    expect(utmRegistryErrors({ source: [v] })).toHaveLength(1);
  });
  test("utm_term 같은 칸은 거부 (자유 글자·검색어 방지)", () => {
    expect(utmRegistryErrors({ term: ["x"] })).toEqual([expect.stringContaining("아는 키")]);
  });
});
