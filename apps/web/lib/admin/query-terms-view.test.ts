// 검색어 집계 화면 보기 값 (SRCH-03 — W2-d 설계 8.3) — 기간 단추·기간 글자·동의어 더하기 주소·숨긴 검색어 안내
import { describe, expect, test } from "vitest";
import { QUERY_TERMS_PATH, hiddenNote, moreNote, synonymAddHref, synonymLineHref, termsPeriodLinks, termsPeriodText } from "./query-terms-view";
import { SYNONYM_LIMITS } from "./synonym-rules";

describe("기간", () => {
  test("단추 최근 7·30·90일 — 고른 단추만 지금, 직접 고른 기간이면 지금 0", () => {
    const links = termsPeriodLinks({ from: "2026-09-20", to: "2026-10-19", days: 30, preset: 30 });
    expect(links.map((l) => [l.label, l.href, l.current])).toEqual([
      ["최근 7일", `${QUERY_TERMS_PATH}?days=7`, false],
      ["최근 30일", `${QUERY_TERMS_PATH}?days=30`, true],
      ["최근 90일", `${QUERY_TERMS_PATH}?days=90`, false],
    ]);
    expect(termsPeriodLinks({ from: "2026-10-01", to: "2026-10-07", days: 7, preset: null }).some((l) => l.current)).toBe(false);
  });
  test("기간 글자", () => {
    expect(termsPeriodText({ from: "2026-10-13", to: "2026-10-19", days: 7, preset: 7 })).toBe("2026-10-13 ~ 2026-10-19 (7일)");
    expect(termsPeriodText({ from: "2026-10-19", to: "2026-10-19", days: 1, preset: null })).toBe("2026-10-19 (하루)");
  });
});

describe("동의어 사전으로", () => {
  test("더하기 — 낱말 칸을 정규형으로 채우는 주소(띄어쓰기·한글은 주소 글자로), 낱말 한도까지 자른다", () => {
    expect(synonymAddHref("자동차 매도")).toBe("/admin/dictionaries?tab=synonyms&term=%EC%9E%90%EB%8F%99%EC%B0%A8%20%EB%A7%A4%EB%8F%84#synonym-add");
    const long = "가".repeat(SYNONYM_LIMITS.termChars + 7);
    const term = new URL(synonymAddHref(long), "https://x.test").searchParams.get("term");
    expect(Array.from(term!).length).toBe(SYNONYM_LIMITS.termChars);
  });
  test("있는 줄로", () => expect(synonymLineHref(42)).toBe("/admin/dictionaries?tab=synonyms#synonym-42"));
});

describe("안내", () => {
  test("최소 횟수 아래 검색어가 있으면 그 수와 기준, 없으면 0", () => {
    expect(hiddenNote({ terms: 1240, shown: 40, minCount: 2 })).toMatch(/^2회보다 적게 찾은 검색어 1,200개는 목록에 보이지 않습니다/);
    expect(hiddenNote({ terms: 5, shown: 5, minCount: 2 })).toBeNull();
    expect(hiddenNote({ terms: 0, shown: 0, minCount: 1 })).toBeNull();
  });
  test("목록 상한 — 보일 수 있는 수가 목록보다 많을 때만", () => {
    expect(moreNote({ shown: 150, rows: Array.from({ length: 100 }) })).toBe("많이 찾은 앞 100개만 보입니다 (보일 수 있는 검색어 150개).");
    expect(moreNote({ shown: 100, rows: Array.from({ length: 100 }) })).toBeNull();
  });
});
