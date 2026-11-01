import { describe, expect, test } from "vitest";
import { addBusinessDays, composePreferredTime, parseContactLinks, parseRequestInput, sensitiveInput, sortProfiles } from "./logic";

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

describe("희망 날짜·시간대·연락 방법 고르기 (PO 2026-11-01)", () => {
  const ctx = { summaryMaxChars: 50, categories: ["cpa"], consentItemCount: 0 };
  const base = { category_code: "cpa", summary: "시험용 요약", name: "가상 요청인", phone: "010-0000-0000", summary_confirmed: "on" };
  test("세 칸을 고르면 한 줄로 묶어 preferred_time에 넣는다 — 요일 포함, 긴 숫자 검사에 걸리지 않는다", () => {
    const r = parseRequestInput({ ...base, preferred_date: "2026-11-05", preferred_slot: "afternoon", contact_method: "phone" }, ctx);
    expect(r).toMatchObject({ ok: true, value: { preferred_time: "11월 5일(목) 오후(12~18시) · 전화 연락 희망" } });
    expect(sensitiveInput("11월 5일(목) 오후(12~18시) · 전화 연락 희망")).toBe(false);
  });
  test("일부만 골라도 고른 것만 — 방법만·날짜만·아무것도 안 고르면 null", () => {
    expect(composePreferredTime({ contact_method: "sms" })).toBe("문자 연락 희망");
    expect(composePreferredTime({ preferred_date: "2026-12-31", preferred_slot: "any" })).toBe("12월 31일(목) 시간 무관");
    expect(parseRequestInput(base, ctx)).toMatchObject({ ok: true, value: { preferred_time: null } });
  });
  test("직접 적은 글자(preferred_time)가 있으면 그것을 쓴다 — 예전 양식·도우미 요청과 같다", () => {
    expect(parseRequestInput({ ...base, preferred_time: "평일 저녁", contact_method: "email" }, ctx)).toMatchObject({ ok: true, value: { preferred_time: "평일 저녁" } });
  });
  test.each([
    [{ preferred_date: "2026-02-30" }],
    [{ preferred_date: "11/05/2026" }],
    [{ preferred_slot: "night" }],
    [{ contact_method: "kakao" }],
  ])("틀린 고르기 값 %o 은 time 오류 (preferred_date 칸)", (bad) => {
    expect(parseRequestInput({ ...base, ...bad }, ctx)).toEqual({ ok: false, code: "time", field: "preferred_date" });
  });
});
