// 진입 경로 분류 시험 (PRD-00 13장 진입 경로 · OPT-09 AI 답변 엔진 리퍼러 — 설정 씨앗 목록으로)
import { describe, expect, test } from "vitest";
import { classifyReferrer, hostMatches, type ReferrerLists } from "./entry";
import { designSeeds } from "./test-design";

const LISTS = designSeeds().get("analytics_referrers") as ReferrerLists;
const SITE = ["localtaxresearch.com", "127.0.0.1:3001"];
const c = (host: string | null) => classifyReferrer(host, SITE, LISTS);

describe("리퍼러 → 진입 경로 (설계 2.5 씨앗 목록)", () => {
  test.each([
    ["chatgpt.com", "ai_answer_engine"],
    ["www.perplexity.ai", "ai_answer_engine"],
    ["gemini.google.com", "ai_answer_engine"],
    ["claude.ai", "ai_answer_engine"],
    ["search.naver.com", "naver"],
    ["m.search.naver.com", "naver"],
    ["news.naver.com", "naver"],
    ["www.google.com", "search"],
    ["www.google.co.kr", "search"],
    ["www.bing.com", "search"],
    ["search.daum.net", "search"],
    ["cafe.daum.net", "referral"],
    ["blog.example.org", "referral"],
  ])("%s → %s", (host, entry) => {
    expect(c(host)).toBe(entry);
  });

  test("AI 답변 엔진을 검색보다 먼저 본다 — google.com 아래라도 gemini는 AI", () => {
    expect(LISTS.search).toContain("google.com");
    expect(c("gemini.google.com")).toBe("ai_answer_engine");
  });

  test("이름 일부만 같은 호스트는 아니다 — notgoogle.com · naver.com.evil.example", () => {
    expect(c("notgoogle.com")).toBe("referral");
    expect(c("naver.com.evil.example")).toBe("referral");
    expect(hostMatches("a.naver.com", "naver.com")).toBe(true);
    expect(hostMatches("xnaver.com", "naver.com")).toBe(false);
  });

  test("이 사이트(www. 포함·포트)·리퍼러 없음 → null (사이트 안 이동 — 세션 진입 경로 그대로)", () => {
    expect(c(null)).toBeNull();
    expect(c("localtaxresearch.com")).toBeNull();
    expect(c("www.localtaxresearch.com")).toBeNull();
    expect(c("127.0.0.1")).toBeNull();
  });

  test("목록을 바꾸면 분류도 바뀐다 (코드 상수 0)", () => {
    expect(classifyReferrer("blog.example.org", SITE, { ...LISTS, search: [...LISTS.search, "example.org"] })).toBe("search");
  });
});
