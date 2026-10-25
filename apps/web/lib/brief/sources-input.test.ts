import { describe, expect, it } from "vitest";
import { isRealDate, isRealMonthDay, parseActiveInput, parseCalendarInput, parseOngoingInput } from "./sources-input";

describe("브리핑 원천 표 입력 검사", () => {
  it("날짜 검사 - 존재하지 않는 날짜와 모양이 다른 값을 거부한다", () => {
    expect(isRealDate("2026-02-28")).toBe(true);
    expect(isRealDate("2026-02-30")).toBe(false);
    expect(isRealDate("2026-2-3")).toBe(false);
    expect(isRealMonthDay("02-29")).toBe(true);
    expect(isRealMonthDay("02-30")).toBe(false);
    expect(isRealMonthDay("13-01")).toBe(false);
  });

  it("달력 - 매년 반복은 시작 월-일이 필수이고 끝은 선택", () => {
    const ok = parseCalendarInput({ text: "시험용 반복 안내", mode: "yearly", startMd: "07-16", endMd: "07-31" });
    expect(ok).toEqual({ ok: true, value: { id: null, text: "시험용 반복 안내", is_always: false, is_yearly: true, start_md: "07-16", end_md: "07-31", start_on: null, end_on: null } });
    const noStart = parseCalendarInput({ text: "시험용", mode: "yearly" });
    expect(noStart.ok).toBe(false);
    const badEnd = parseCalendarInput({ text: "시험용", mode: "yearly", startMd: "07-16", endMd: "02-30" });
    expect(badEnd.ok).toBe(false);
  });

  it("달력 - 한 번만은 끝일이 시작일보다 빠르면 거부, 상시는 날짜 없이 통과", () => {
    expect(parseCalendarInput({ text: "시험용", mode: "once", startOn: "2026-11-10", endOn: "2026-11-09" }).ok).toBe(false);
    const once = parseCalendarInput({ text: "시험용", mode: "once", startOn: "2026-11-10", endOn: "2026-11-10" });
    expect(once.ok && once.value.end_on).toBe("2026-11-10");
    const always = parseCalendarInput({ text: "시험용 상시", mode: "always", id: 3 });
    expect(always.ok && [always.value.is_always, always.value.id, always.value.start_on]).toEqual([true, 3, null]);
  });

  it("달력 - 빈 글, 300자 초과, 알 수 없는 방식, 잘못된 번호를 거부한다", () => {
    expect(parseCalendarInput({ text: "  ", mode: "always" }).ok).toBe(false);
    expect(parseCalendarInput({ text: "가".repeat(301), mode: "always" }).ok).toBe(false);
    expect(parseCalendarInput({ text: "시험용", mode: "weekly" }).ok).toBe(false);
    expect(parseCalendarInput({ text: "시험용", mode: "always", id: -1 }).ok).toBe(false);
  });

  it("진행 중 개정안 - 필수 칸, 기준일, 주소 모양, 요점 줄 수를 검사한다", () => {
    const ok = parseOngoingInput({ name: "시험용 개정안", stage: "정부안", asOf: "2026-10-01", sourceUrl: "https://example.test/a", points: "첫째\n\n둘째" });
    expect(ok.ok && ok.value.points).toEqual(["첫째", "둘째"]);
    expect(ok.ok && ok.value.source).toBeNull();
    expect(parseOngoingInput({ name: "시험용", stage: "정부안", asOf: "2026-13-01" }).ok).toBe(false);
    expect(parseOngoingInput({ name: "시험용", stage: "정부안", asOf: "2026-10-01", sourceUrl: "javascript:alert(1)" }).ok).toBe(false);
    expect(parseOngoingInput({ name: "시험용", stage: "정부안", asOf: "2026-10-01", points: Array.from({ length: 11 }, () => "줄") }).ok).toBe(false);
    expect(parseOngoingInput({ name: "", stage: "정부안", asOf: "2026-10-01" }).ok).toBe(false);
  });

  it("켜기·끄기 - 불리언이 아니면 거부, 수집 대상 이름 모양을 검사한다", () => {
    expect(parseActiveInput({ id: 4, active: false }, "id")).toEqual({ ok: true, value: { id: 4, active: false } });
    expect(parseActiveInput({ id: 4, active: "yes" }, "id").ok).toBe(false);
    expect(parseActiveInput({ key: "brief_laws", active: true }, "key")).toEqual({ ok: true, value: { key: "brief_laws", active: true } });
    expect(parseActiveInput({ key: "Bad Key", active: true }, "key").ok).toBe(false);
  });
});
