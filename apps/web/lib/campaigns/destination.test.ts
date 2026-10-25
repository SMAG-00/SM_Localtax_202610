import { describe, expect, test } from "vitest";
import { campaignDestinationHref } from "./destination";
import { toolLinkFor, type ToolContext } from "@/lib/calc/tool-link";

const open = [
  { key: "calc", href: "/calc" },
  { key: "expert_request", href: "/experts/request" },
  { key: "brief_weekly", href: "/brief/2026-10-26" },
];

describe("캠페인 도착 주소", () => {
  test("닫힌 도착은 null", () => {
    expect(campaignDestinationHref("realestate_weekly", null, open)).toBeNull();
    expect(campaignDestinationHref("calc", null, [])).toBeNull();
  });
  test("계산기 도구 지정 + 자체 계산기가 열려 있으면 그 화면", () => {
    expect(campaignDestinationHref("calc", "acquisition", open, { acquisition: "/calc/acquisition" })).toBe("/calc/acquisition");
  });
  test("게이트가 닫혔거나(null) 목록에 없으면 허브 /calc", () => {
    expect(campaignDestinationHref("calc", "acquisition", open, { acquisition: null })).toBe("/calc");
    expect(campaignDestinationHref("calc", "holding", open, { acquisition: "/calc/acquisition" })).toBe("/calc");
    expect(campaignDestinationHref("calc", "refund", open)).toBe("/calc");
  });
  test("도구 지정이 없으면 허브, 다른 도착은 도구 지정과 상관없이 자기 주소", () => {
    expect(campaignDestinationHref("calc", null, open, { acquisition: "/calc/acquisition" })).toBe("/calc");
    expect(campaignDestinationHref("brief_weekly", "acquisition", open)).toBe("/brief/2026-10-26");
  });
  test("toolLinkFor 결과와 이어 쓰기: 게이트 닫힘(sm_calculator 꺼짐)이면 self가 아니라 허브로 간다", () => {
    const ctx = { features: { calc: true, self_calculator: true, calc_acquisition: true, sm_calculator: false }, gateRows: [], engineHash: "x", refundTableActive: false } as unknown as ToolContext;
    const l = toolLinkFor("acquisition", null, ctx);
    const selfHref = l.kind === "self" ? l.href : null;
    expect(selfHref).toBeNull(); // 게이트 행이 없어 자체 계산기는 닫힘
    expect(campaignDestinationHref("calc", "acquisition", open, { acquisition: selfHref })).toBe("/calc");
  });
});
