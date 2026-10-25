import { describe, expect, it } from "vitest";
import { assistantHiddenOn } from "./assistant-paths";

describe("AI 도우미 런처 숨김 경로", () => {
  it("구독 결제·내 구독 화면과 그 아래 경로에서는 숨긴다", () => {
    expect(assistantHiddenOn("/store/subscription")).toBe(true);
    expect(assistantHiddenOn("/store/subscription/complete")).toBe(true);
    expect(assistantHiddenOn("/my/billing")).toBe(true);
  });

  it("접두어만 같은 다른 경로나 일반 화면에서는 숨기지 않는다", () => {
    expect(assistantHiddenOn("/store")).toBe(false);
    expect(assistantHiddenOn("/store/subscriptions-guide")).toBe(false);
    expect(assistantHiddenOn("/news/zz-article")).toBe(false);
    expect(assistantHiddenOn(null)).toBe(false);
  });
});
