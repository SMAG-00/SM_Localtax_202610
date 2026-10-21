import { describe, expect, it } from "vitest";
import { daysSince, isoWeekKey, isStale, parseLinkUpdate, parseManualCheck, resultOf } from "./rules";

const NOW = new Date("2026-10-21T03:00:00Z"); // KST 2026-10-21 12:00

describe("점검이 낡았는가 — 7일 전은 경고 0, 8일 전은 경고 1 (KST 날짜)", () => {
  const link = (checked_at: string | null) => ({ url: "http://127.0.0.1:1/x", checked_at });
  it("7일 전 점검은 낡지 않았다", () => {
    expect(isStale(link("2026-10-14T05:00:00Z"), NOW)).toBe(false);
  });
  it("8일 전 점검은 낡았다", () => {
    expect(isStale(link("2026-10-13T05:00:00Z"), NOW)).toBe(true);
  });
  it("UTC로는 7일이지만 KST 날짜로는 8일인 경계 — 10-13 15:30Z는 KST 10-14", () => {
    expect(daysSince("2026-10-13T15:30:00Z", NOW)).toBe(7);
    expect(isStale(link("2026-10-13T15:30:00Z"), NOW)).toBe(false);
    expect(isStale(link("2026-10-13T14:30:00Z"), NOW)).toBe(true); // KST 10-13
  });
  it("주소가 있는데 점검한 적 없으면 낡음, 주소가 없으면 대상 아님", () => {
    expect(isStale(link(null), NOW)).toBe(true);
    expect(isStale({ url: null, checked_at: null }, NOW)).toBe(false);
  });
});

describe("실행 키 — KST 기준 ISO 주", () => {
  it("2026-10-21(수) = 2026-W43", () => expect(isoWeekKey(NOW)).toBe("2026-W43"));
  it("같은 주 월요일 새벽(KST)과 일요일 밤은 같은 키, 다음 월요일은 다음 키", () => {
    expect(isoWeekKey(new Date("2026-10-18T14:59:00Z"))).toBe("2026-W42"); // 일 23:59 KST
    expect(isoWeekKey(new Date("2026-10-18T15:00:00Z"))).toBe("2026-W43"); // 월 00:00 KST
  });
  it("연말 경계 — 2026-12-31(목)은 2026-W53, 2027-01-01(금)도 2026-W53", () => {
    expect(isoWeekKey(new Date("2026-12-31T03:00:00Z"))).toBe("2026-W53");
    expect(isoWeekKey(new Date("2027-01-01T03:00:00Z"))).toBe("2026-W53");
  });
});

describe("응답 상태 → 결과", () => {
  it.each([
    [200, "ok"],
    [204, "ok"],
    [301, "broken"],
    [404, "broken"],
    [500, "broken"],
    [null, "broken"],
  ] as const)("%s → %s", (status, expected) => expect(resultOf(status)).toBe(expected));
});

describe("편집 입력 검사", () => {
  it("주소를 비우면 null(카드 숨김), http(s)가 아니면 거부", () => {
    expect(parseLinkUpdate({ id: 3, url: "" })).toEqual({ ok: true, value: { id: 3, url: null } });
    expect(parseLinkUpdate({ id: 3, url: "ftp://a.test/x" }).ok).toBe(false);
    expect(parseLinkUpdate({ id: 3, url: "javascript:alert(1)" }).ok).toBe(false);
    expect(parseLinkUpdate({ id: 3, url: "https://a.test/x?y=1" })).toEqual({ ok: true, value: { id: 3, url: "https://a.test/x?y=1" } });
  });
  it("바꿀 칸이 없거나 번호가 틀리면 거부", () => {
    expect(parseLinkUpdate({ id: 3 }).ok).toBe(false);
    expect(parseLinkUpdate({ id: 0, label: "a" }).ok).toBe(false);
    expect(parseLinkUpdate({ id: 3, label: "x".repeat(81) }).ok).toBe(false);
  });
  it("수동 점검은 ok|broken만", () => {
    expect(parseManualCheck({ id: 2, result: "ok" })).toEqual({ ok: true, value: { id: 2, result: "ok" } });
    expect(parseManualCheck({ id: 2, result: "unchecked" }).ok).toBe(false);
  });
});
