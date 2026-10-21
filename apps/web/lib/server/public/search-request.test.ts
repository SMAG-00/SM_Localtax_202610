// GET /api/search 요청 검사·응답 모양·속도 제한 (SRCH-02 · PRD-01A 6.4 — docs/dev/W2-d_설계.md 2.4·8장)
//  · 검색 화면 주소는 모르는 값을 닫힌 쪽으로 읽지만(parseSearchParams), API는 틀린 값을 400으로 알린다 — 어느 입력에도 500 0
//  · 검색어: 앞뒤 공백을 떼고 1~100자(코드 포인트) · 같은 칸 두 번·모르는 칸 400 · 탭·분야·기사 유형·지역·기간·쪽 값 검사
//  · IP별 1분 상한(설계 2.4)까지 받고 그다음은 거부(429 — 다시 보낼 때까지 초)
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { TokenBuckets } from "@/lib/analytics/rate-limit";
import type { SearchKind, SearchResult } from "./search-logic";
import { SEARCH_API, parseSearchRequest, searchResponseBody, takeSearchToken } from "./search-request";

const MD = fs.readFileSync(path.resolve(__dirname, "../../../../../docs/dev/W2-d_설계.md"), "utf8");
function row24(name: string): string[] {
  const sec = MD.split(/^## /m).find((s) => s.startsWith("2. 값 목록"));
  const line = sec?.split(/^### /m).find((s) => s.startsWith("2.4"))?.split("\n").find((l) => l.startsWith(`| ${name} `));
  if (!line) throw new Error(`설계 2.4 '${name}' 줄이 없다`);
  return [...line.split("|")[2]!.matchAll(/`([^`]*)`/g)].map((m) => m[1]!);
}

const req = (qs: string) => parseSearchRequest(new URLSearchParams(qs));
const errors = (qs: string) => {
  const r = req(qs);
  return r.ok ? [] : r.errors;
};

describe("설계 2.4와 같은 값", () => {
  test("쿼리 칸 이름·IP별 1분 상한", () => {
    expect([...SEARCH_API.params]).toEqual(row24("api.params"));
    expect(SEARCH_API.ipPerMinute).toBe(Number(row24("api.ip_per_minute")[0]));
  });
});

describe("검색어 (길이·공백)", () => {
  test("앞뒤 공백을 떼고 그대로 — 1자·100자(코드 포인트)는 받는다", () => {
    expect(req("q=%20%20%EC%B7%A8%EB%93%9D%EC%84%B8%20")).toEqual({
      ok: true,
      options: { q: "취득세", tab: "all", section: null, contentType: null, region: null, from: null, to: null, page: 1 },
    });
    expect(req(`q=${encodeURIComponent("가")}`).ok).toBe(true);
    expect(req(`q=${encodeURIComponent("가".repeat(100))}`).ok).toBe(true);
    expect(req(`q=${encodeURIComponent("𠀀".repeat(100))}`).ok).toBe(true);
  });

  test("없거나 공백뿐이거나 101자면 400 사유", () => {
    expect(errors("")).toEqual(["q: 검색어가 필요합니다"]);
    expect(errors("q=%20%20%20")).toEqual(["q: 검색어가 필요합니다"]);
    expect(errors(`q=${encodeURIComponent("가".repeat(101))}`)).toEqual(["q: 검색어는 100자까지입니다 (지금 101자)"]);
  });

  test("남는 글자 없는 검색어(?!·)는 틀린 입력이 아니다 — 결과 0으로 받는다", () => {
    expect(req(`q=${encodeURIComponent("?!·")}`)).toMatchObject({ ok: true, options: { q: "?!·" } });
  });
});

describe("칸 검사", () => {
  test("모든 칸이 맞으면 그대로 — 검색 화면 주소와 같은 이름", () => {
    expect(req("q=x&tab=article&section=tax&type=reported_news&region=1100000000&from=2026-10-01&to=2026-10-19&page=51")).toEqual({
      ok: true,
      options: { q: "x", tab: "article", section: "tax", contentType: "reported_news", region: "1100000000", from: "2026-10-01", to: "2026-10-19", page: 51 },
    });
    expect(req("q=x&from=2026-10-19&to=2026-10-19").ok).toBe(true);
  });

  test.each([
    ["q=x&foo=1", "foo: 모르는 칸입니다 — q·tab·section·type·region·from·to·page"],
    ["q=x&q=y", "q: 같은 칸을 두 번 보냈습니다"],
    ["q=x&tab=place", "tab: all·article·tracker·region·event·glossary·expert 중 하나입니다"],
    ["q=x&section=seoul", "section: tax·realestate·finance·local 중 하나입니다"],
    ["q=x&type=digest", "type: reported_news·explainer·guide·opinion·sponsored 중 하나입니다"],
    ["q=x&region=11000", "region: 법정동코드 10자리입니다"],
    ["q=x&from=2026-02-30", "from: 날짜(YYYY-MM-DD)입니다"],
    ["q=x&to=20261019", "to: 날짜(YYYY-MM-DD)입니다"],
    ["q=x&from=2026-10-20&to=2026-10-19", "to: 기간의 끝이 시작보다 앞입니다"],
    ["q=x&tab=article&page=0", "page: 1~51 정수입니다"],
    ["q=x&tab=article&page=52", "page: 1~51 정수입니다"],
    ["q=x&tab=article&page=1.5", "page: 1~51 정수입니다"],
    ["q=x&page=2", "page: 전체 탭은 종류별 묶음이라 쪽이 없습니다 — 종류 탭(tab)을 고르세요"],
    ["q=x&tab=all&page=2", "page: 전체 탭은 종류별 묶음이라 쪽이 없습니다 — 종류 탭(tab)을 고르세요"],
    ["q=x&tab=x&page=2", "tab: all·article·tracker·region·event·glossary·expert 중 하나입니다"],
    ["q=x&section=", "section: tax·realestate·finance·local 중 하나입니다"],
  ])("%s → 400", (qs, message) => {
    expect(errors(qs)).toEqual([message]);
  });

  test("틀린 칸이 여럿이면 모두 알린다", () => {
    expect(errors("tab=x&page=x")).toEqual(["q: 검색어가 필요합니다", "tab: all·article·tracker·region·event·glossary·expert 중 하나입니다", "page: 1~51 정수입니다"]);
  });
});

describe("응답 모양", () => {
  const counts = (over: Partial<Record<SearchKind, number>>) => ({ region: 0, situation: 0, tracker: 0, glossary: 0, category: 0, article: 0, person: 0, interpretation: 0, ...over });
  const result: SearchResult = { query: "성동구", terms: ["성동구"], total: 0, counts: counts({ region: 1, article: 3 }), items: [], page: 1, pageSize: 20, hasMore: false };

  test("고른 탭의 전체 수는 탭 숫자(종류 합)에서 — 지역 분류 여부·종류별 수·쪽", () => {
    const o = { q: "성동구", tab: "article" as const, section: null, contentType: null, region: null, from: null, to: null, page: 1 };
    expect(searchResponseBody(result, o)).toEqual({
      query: "성동구",
      terms: ["성동구"],
      tab: "article",
      page: 1,
      pageSize: 20,
      total: 3,
      hasMore: false,
      counts: counts({ region: 1, article: 3 }),
      regionClassified: true,
      items: [],
    });
    expect(searchResponseBody(result, { ...o, tab: "all" }).total).toBe(4);
  });
});

describe("속도 제한 (IP별 1분 상한 — 서버 메모리)", () => {
  test("상한까지 받고 다음은 거부(다시 보낼 때까지 초), 1분이 지나면 다시 받는다 · IP마다 따로", () => {
    const limiter = new TokenBuckets();
    const t0 = 1_000_000;
    for (let i = 0; i < SEARCH_API.ipPerMinute; i++) expect(takeSearchToken(limiter, "ip:a", t0)).toEqual({ ok: true });
    const refused = takeSearchToken(limiter, "ip:a", t0);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(takeSearchToken(limiter, "ip:b", t0)).toEqual({ ok: true });
    expect(takeSearchToken(limiter, "ip:a", t0 + 60_000)).toEqual({ ok: true });
  });
});
