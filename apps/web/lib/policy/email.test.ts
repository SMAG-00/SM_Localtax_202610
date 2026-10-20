import { describe, expect, it } from "vitest";
import { findEmails, hasEmailShape, maskEmailForDisplay } from "./email";

// 설계 2.7 견본 표
describe("maskEmailForDisplay (설계 2.7 견본)", () => {
  const cases: Array<[string, string]> = [
    ["hong@example.com", "hong [at] example [dot] com"],
    ["HONG.GIL-dong+x@Mail.Example.co.kr", "HONG.GIL-dong+x [at] Mail [dot] Example [dot] co [dot] kr"],
    ["문의: a@b.kr 로 보내세요", "문의: a [at] b [dot] kr 로 보내세요"],
    ["hong＠example.com", "hong [at] example [dot] com"],
    ["hong&#64;example.com", "hong [at] example [dot] com"],
    ["hong&#x40;example&period;com", "hong [at] example [dot] com"],
    ["x@y", "x@y"],
  ];
  it.each(cases)("%s -> %s", (input, expected) => {
    expect(maskEmailForDisplay(input)).toBe(expected);
  });

  it("①②③·㈜·전각 괄호는 원문 그대로, 전각 이메일만 가린다", () => {
    expect(maskEmailForDisplay("①②③ ㈜선명 （본점）")).toBe("①②③ ㈜선명 （본점）");
    expect(maskEmailForDisplay("㈜선명 ａｂｃ＠ｅｘａｍｐｌｅ．ｃｏｍ ②")).toBe("㈜선명 abc [at] example [dot] com ②");
  });

  it("한 글에 이메일 둘이면 둘 다 가리고 사이 글은 그대로", () => {
    expect(maskEmailForDisplay("a@b.kr ① c@d.co")).toBe("a [at] b [dot] kr ① c [at] d [dot] co");
  });
});

describe("이메일 모양 판정", () => {
  it("엔티티·전각을 풀어 판정한다", () => {
    expect(hasEmailShape("hong&#64;example.com")).toBe(true);
    expect(hasEmailShape("hong＠example.com")).toBe(true);
    expect(hasEmailShape("x@y")).toBe(false);
    expect(findEmails("a@b.kr 와 c@d.co")).toEqual(["a@b.kr", "c@d.co"]);
  });
});
