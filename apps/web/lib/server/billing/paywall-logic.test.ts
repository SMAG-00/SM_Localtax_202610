import { describe, expect, it } from "vitest";
import { PAYWALL_SELECTOR, paragraphsOf } from "./paywall-logic";

describe("페이월 순수 로직", () => {
  it("본문은 빈 줄 기준으로 문단을 나누고 앞뒤 공백·빈 문단을 버린다", () => {
    expect(paragraphsOf("첫 문단\n\n\n  둘째 문단  \n\n\n")).toEqual(["첫 문단", "둘째 문단"]);
    expect(paragraphsOf("한 줄\n이어지는 줄")).toEqual(["한 줄\n이어지는 줄"]);
    expect(paragraphsOf("   ")).toEqual([]);
  });

  it("유료 구간 선택자는 화면의 본문 표식과 같은 값이다", () => {
    expect(PAYWALL_SELECTOR).toBe("[data-part='paywall-body']");
  });
});
