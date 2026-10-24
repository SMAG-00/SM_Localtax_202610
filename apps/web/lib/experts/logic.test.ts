import { describe, expect, test } from "vitest";
import { addBusinessDays, parseContactLinks, parseRequestInput, sensitiveInput, sortProfiles } from "./logic";

describe("민감 입력 (EXPL-20)", () => {
  test.each(["900101-1234567", "900101 1234567", "9001011234567", "900101.1234567", "９００１０１－１２３４５６７", "900101 - 1 2 3 4 5 6 7", "계좌 110-123-456789", "1101234567890", "110_123_456789", "110/123/456789"])("긴 숫자 우회 %s는 막는다", (v) => {
    expect(sensitiveInput(`문의 ${v}`)).toBe(true);
  });
  test("날짜·건수·8자리 이하 숫자는 통과한다", () => {
    expect(sensitiveInput("2026.10.24 오후 3시, 서류 5건")).toBe(false);
    expect(sensitiveInput("12345678")).toBe(false);
    expect(sensitiveInput(null)).toBe(false);
    expect(sensitiveInput("")).toBe(false);
  });
  test("경계 - 숫자 9개부터 막는다", () => {
    expect(sensitiveInput("123456789")).toBe(true);
    expect(sensitiveInput("12345678 9")).toBe(true);
    expect(sensitiveInput("12345678 가 9")).toBe(false);
  });
});

describe("영업일 (EXPL-18)", () => {
  const kst = (s: string) => new Date(`${s}+09:00`);
  test("금요일 17:00 접수 + 1영업일 = 월요일 17:00", () => {
    expect(addBusinessDays(kst("2026-10-23T17:00:00"), 1).toISOString()).toBe(kst("2026-10-26T17:00:00").toISOString());
  });
  test("토요일 접수 + 1영업일 = 월요일 같은 시각, 월요일 + 1 = 화요일", () => {
    expect(addBusinessDays(kst("2026-10-24T10:00:00"), 1).toISOString()).toBe(kst("2026-10-26T10:00:00").toISOString());
    expect(addBusinessDays(kst("2026-10-26T09:30:00"), 1).toISOString()).toBe(kst("2026-10-27T09:30:00").toISOString());
  });
  test("5영업일은 다음 주 같은 요일", () => {
    expect(addBusinessDays(kst("2026-10-26T09:00:00"), 5).toISOString()).toBe(kst("2026-11-02T09:00:00").toISOString());
  });
});

describe("정렬 (EXPL-04)", () => {
  const order = new Map([["tax-accountant", 10], ["cpa", 20], ["lawyer", 30]]);
  test("분류 순서(첫 분류) -> 이름 가나다, 두 번 돌려도 같은 순서", () => {
    const rows = [
      { name: "다 가상", category_codes: ["lawyer"] },
      { name: "나 가상", category_codes: ["cpa", "tax-accountant"] },
      { name: "가 가상", category_codes: ["cpa"] },
      { name: "라 가상", category_codes: ["tax-accountant"] },
    ];
    const once = sortProfiles(rows, order).map((r) => r.name);
    expect(once).toEqual(["나 가상", "라 가상", "가 가상", "다 가상"]);
    expect(sortProfiles([...rows].reverse(), order).map((r) => r.name)).toEqual(once);
  });
});

describe("연락 링크", () => {
  test("http(s) 주소만 남긴다", () => {
    expect(parseContactLinks([{ label: "홈", url: "https://a.example.test/" }, { label: "x", url: "javascript:alert(1)" }, { label: 1, url: "https://b" }, "s"])).toEqual([{ label: "홈", url: "https://a.example.test/" }]);
    expect(parseContactLinks(null)).toEqual([]);
  });
});

describe("요청 입력 검사 (EXPL-15)", () => {
  const ctx = { summaryMaxChars: 50, categories: ["tax-accountant", "cpa"], consentItemCount: 2 };
  const ok = { category_code: "cpa", summary: "시험용 요약", name: "가상 요청인", email: "a@example.test", summary_confirmed: "on", consent_0: "on", consent_1: "on" };
  test("정상 입력", () => {
    const r = parseRequestInput(ok, ctx);
    expect(r).toMatchObject({ ok: true, value: { category_code: "cpa", source: "experts", email: "a@example.test", phone: null, deadline_urgent: false } });
  });
  test.each([
    [{ category_code: "lawyer" }, "category", "category_code"],
    [{ summary: "" }, "summary", "summary"],
    [{ summary: "가".repeat(51) }, "summary_long", "summary"],
    [{ summary: "계좌 110-123-456789" }, "sensitive", "summary"],
    [{ name: "" }, "name", "name"],
    [{ email: "", phone: "" }, "contact", "email"],
    [{ email: "no" }, "email", "email"],
    [{ email: "", phone: "12-3" }, "phone", "phone"],
    [{ summary_confirmed: "" }, "confirm", "summary_confirmed"],
    [{ consent_1: "" }, "consent", "consent_1"],
    [{ preferred_time: "900101-1234567" }, "sensitive", "summary"],
  ])("거부 %j -> %s", (patch, code, field) => {
    expect(parseRequestInput({ ...ok, ...patch }, ctx)).toEqual({ ok: false, code, field });
  });
  test("진입 출처는 세 값만, 모르는 값은 experts", () => {
    expect(parseRequestInput({ ...ok, source: "assistant" }, ctx)).toMatchObject({ value: { source: "assistant" } });
    expect(parseRequestInput({ ...ok, source: "other" }, ctx)).toMatchObject({ value: { source: "experts" } });
  });
});
