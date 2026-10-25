import { describe, expect, test } from "vitest";
import { maskSmallCount, parseCampaignInput } from "./input";

const OK = { campaignKey: "acquisition", title: "취득세 먼저 계산", body: "부동산 세금 계산기로 확인해 보세요", primaryTarget: "calc", primaryTool: "acquisition", secondaryTarget: "expert_request", channel: "search", startsAt: "2026-11-01T00:00:00+09:00", endsAt: "2026-11-30T00:00:00+09:00" };
const errs = (patch: Record<string, unknown>) => {
  const r = parseCampaignInput({ ...OK, ...patch });
  return r.ok ? [] : r.errors;
};

describe("캠페인 입력 검사", () => {
  test("올바른 입력은 시각을 ISO로 바꿔 통과한다", () => {
    const r = parseCampaignInput(OK);
    expect(r.ok && r.value.startsAt).toBe("2026-10-31T15:00:00.000Z");
    expect(r.ok && r.value.secondaryTarget).toBe("expert_request");
  });
  test("보조 링크 2개(목록)는 거부된다", () => {
    expect(errs({ secondaryTarget: ["expert_request", "brief_weekly"] })).toEqual([expect.stringContaining("1개까지")]);
  });
  test("보조 링크가 주 버튼과 같으면 거부, 비어 있으면 보조 없음", () => {
    expect(errs({ secondaryTarget: "calc" })).toEqual([expect.stringContaining("같은 도착")]);
    const r = parseCampaignInput({ ...OK, secondaryTarget: "" });
    expect(r.ok && r.value.secondaryTarget).toBeNull();
  });
  test("도착은 4개 안의 값만 (외부 주소·관리 주소 거부)", () => {
    expect(errs({ primaryTarget: "https://evil.example" })[0]).toContain("primaryTarget");
    expect(errs({ primaryTarget: "/admin" })[0]).toContain("primaryTarget");
  });
  test("도구 지정은 도착이 계산기일 때만", () => {
    expect(errs({ primaryTarget: "brief_weekly", primaryTool: "acquisition", secondaryTarget: "" })).toEqual([expect.stringContaining("계산기일 때만")]);
  });
  test("제목 30자 통과 31자 거부, 본문 120자 통과 121자 거부 (경계)", () => {
    expect(errs({ title: "가".repeat(30) })).toEqual([]);
    expect(errs({ title: "가".repeat(31) })).toEqual([expect.stringContaining("title")]);
    expect(errs({ body: "가".repeat(120) })).toEqual([]);
    expect(errs({ body: "가".repeat(121) })).toEqual([expect.stringContaining("body")]);
  });
  test.each(["admin", "api", "go", "A", "-x", "a b"])("캠페인 키 '%s' 는 거부", (k) => {
    expect(errs({ campaignKey: k }).length).toBe(1);
  });
  test("끝이 시작과 같거나 앞서면 거부", () => {
    expect(errs({ endsAt: OK.startsAt })).toEqual([expect.stringContaining("끝은 시작보다")]);
  });
  test("모르는 채널은 거부", () => {
    expect(errs({ channel: "youtube" })).toEqual([expect.stringContaining("channel")]);
  });
});

describe("집계 가림", () => {
  test.each([[0, "5건 미만"], [4, "5건 미만"], [5, "5"], [123, "123"]])("%i건 -> %s", (n, shown) => {
    expect(maskSmallCount(n)).toBe(shown);
  });
});
