import { describe, expect, test } from "vitest";
import { crawlerPolicyErrors, indexnowEnabled, indexnowErrors, indexingSwitchProblems, newsSitemapHoursErrors, parseCrawlerPolicy, parseNewsSitemapHours, seoLintParamsErrors } from "./settings";
import { isNonIndexablePath } from "./paths";

const policy = (over: Record<string, unknown> = {}) => ({ search: ["TestSearchBot"], ai_training: { decided: true, agents: [{ name: "TestAiBot", allow: false }] }, ...over });

describe("크롤러 정책 검사 (OPT-08)", () => {
  test("올바른 정책은 오류 0이고 그대로 읽힌다", () => {
    expect(crawlerPolicyErrors(policy())).toEqual([]);
    expect(parseCrawlerPolicy(policy())).toEqual(policy());
  });
  test("모르는 칸·잘못된 이름·중복 이름·allow 형식을 거부한다", () => {
    expect(crawlerPolicyErrors(policy({ extra: 1 })).join()).toContain("모르는 칸 extra");
    expect(crawlerPolicyErrors(policy({ search: ["bad name"] })).join()).toContain("search");
    expect(crawlerPolicyErrors(policy({ search: ["A", "a"] })).join()).toContain("같은 이름");
    expect(crawlerPolicyErrors(policy({ ai_training: { decided: true, agents: [{ name: "X", allow: "no" }] } })).join()).toContain("ai_training.agents");
    expect(parseCrawlerPolicy("x")).toBeNull();
  });
  test("색인 켜기 점검 — AI 학습 정책 미결정·검색 크롤러 없음·값 없음이면 사유를 돌려주고, 갖추면 빈 목록", () => {
    expect(indexingSwitchProblems(policy({ ai_training: { decided: false, agents: [] } })).join()).toContain("AI 학습 크롤러");
    expect(indexingSwitchProblems(policy({ search: [] })).join()).toContain("일반 검색 크롤러");
    expect(indexingSwitchProblems(undefined)).toHaveLength(1);
    expect(indexingSwitchProblems(policy())).toEqual([]);
  });
});

describe("뉴스 사이트맵 기간·IndexNow·점검 기준 설정", () => {
  test("기간은 1~168 정수만, 틀리거나 없으면 48", () => {
    for (const ok of [1, 48, 168]) expect(newsSitemapHoursErrors(ok)).toEqual([]);
    for (const bad of [0, 169, 1.5, "48", null]) expect(newsSitemapHoursErrors(bad)).toHaveLength(1);
    expect(parseNewsSitemapHours(72)).toBe(72);
    expect(parseNewsSitemapHours(0)).toBe(48);
  });
  test("IndexNow는 { enabled: boolean }만, 모르는 값은 꺼짐", () => {
    expect(indexnowEnabled({ enabled: true })).toBe(true);
    for (const v of [{ enabled: false }, { enabled: "true" }, { enabled: true, key: 1 }, null, undefined]) expect(indexnowEnabled(v)).toBe(false);
    expect(indexnowErrors({ enabled: 1 })).toHaveLength(1);
  });
  test("점검 기준 덮어쓰기는 규칙 파일에 있는 이름·형식만 허용한다", () => {
    expect(seoLintParamsErrors({})).toEqual([]);
    expect(seoLintParamsErrors({ "seo.keyword-density": { maxPercent: 10 } })).toEqual([]);
    expect(seoLintParamsErrors({ "seo.keyword-density": { maxPercent: "10" } })).toHaveLength(1);
    expect(seoLintParamsErrors({ "no.such": {} })).toHaveLength(1);
    expect(seoLintParamsErrors([])).toHaveLength(1);
  });
});

describe("색인 제외 경로", () => {
  test("관리·API·계정·검색 결과·도우미 경로는 제외, 공개 기사·허브는 대상", () => {
    for (const p of ["/admin", "/admin/x", "/api/events", "/my/withdraw", "/search", "/experts/request", "/login"]) expect(isNonIndexablePath(p), p).toBe(true);
    for (const p of ["/", "/tax", "/news/a", "/experts", "/experts/profile/a", "/searching"]) expect(isNonIndexablePath(p), p).toBe(false);
  });
});
