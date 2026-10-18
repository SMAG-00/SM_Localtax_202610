// 기사 생산 대시보드 기간 (NAV-14 — docs/dev/W2-c_설계.md 2.8·8.5) — 기대값은 손으로 센 한국 달력 날짜다.
//  · closed_months: 지난달까지 완결된 달 / including_current: 이번 달 오늘까지
//  · 한국 시각 달 경계(UTC 15시) · 해 넘김 · 시작일 하루 전 제외·시작일 0시 포함·끝 0시 제외 (NAV-14 수용 기준)
import { describe, expect, test } from "vitest";
import { designList, designSeeds } from "@/lib/analytics/test-design";
import { NAV14_WINDOWS, WINDOW_BASES, checkWindowsSetting, inWindow, monthWindow, readWindowsSetting, windowsFor } from "./windows";

const kst = (local: string) => Date.parse(`${local}+09:00`);
const NOW = kst("2026-10-18T12:00:00");

describe("monthWindow — 완결된 달 (closed_months)", () => {
  test.each([
    [3, "2026-07-01", "2026-09-30"],
    [6, "2026-04-01", "2026-09-30"],
    [12, "2025-10-01", "2026-09-30"],
  ])("%i개월 → %s ~ %s (이번 달 10월 제외)", (months, from, to) => {
    const w = monthWindow(months, "closed_months", NOW);
    expect([w.from, w.to, w.monthsCounted]).toEqual([from, to, months]);
    expect(w.start).toBe(kst(`${from}T00:00:00`));
    expect(w.end).toBe(kst("2026-10-01T00:00:00"));
  });

  test("시작일 하루 전(23:59:59.999)은 제외, 시작일 0시는 포함, 끝(이번 달 1일 0시)은 제외 — NAV-14 수용 기준", () => {
    const w = monthWindow(3, "closed_months", NOW);
    expect(inWindow(kst("2026-06-30T12:00:00"), w)).toBe(false);
    expect(inWindow(kst("2026-06-30T23:59:59.999"), w)).toBe(false);
    expect(inWindow(kst("2026-07-01T00:00:00"), w)).toBe(true);
    expect(inWindow(kst("2026-09-30T23:59:59.999"), w)).toBe(true);
    expect(inWindow(kst("2026-10-01T00:00:00"), w)).toBe(false);
  });

  test("한국 시각 달 경계 — UTC 10월 31일 15시(한국 11월 1일 0시)부터 이번 달은 11월", () => {
    const lastOctober = monthWindow(3, "closed_months", Date.parse("2026-10-31T14:59:59.999Z"));
    expect([lastOctober.from, lastOctober.to]).toEqual(["2026-07-01", "2026-09-30"]);
    const firstNovember = monthWindow(3, "closed_months", Date.parse("2026-10-31T15:00:00Z"));
    expect([firstNovember.from, firstNovember.to]).toEqual(["2026-08-01", "2026-10-31"]);
  });

  test("해 넘김 — 2027년 1월에 3개월은 2026-10-01 ~ 2026-12-31, 12개월은 2026-01-01 ~ 2026-12-31", () => {
    const jan = kst("2027-01-05T09:00:00");
    expect([monthWindow(3, "closed_months", jan).from, monthWindow(3, "closed_months", jan).to]).toEqual(["2026-10-01", "2026-12-31"]);
    expect([monthWindow(12, "closed_months", jan).from, monthWindow(12, "closed_months", jan).to]).toEqual(["2026-01-01", "2026-12-31"]);
  });

  test("2월 끝날 — 윤년 2028년 3월에 1개월은 2028-02-01 ~ 2028-02-29", () => {
    const w = monthWindow(1, "closed_months", kst("2028-03-10T00:00:00"));
    expect([w.from, w.to]).toEqual(["2028-02-01", "2028-02-29"]);
  });
});

describe("monthWindow — 이번 달 포함 (including_current)", () => {
  test.each([
    [3, "2026-08-01"],
    [6, "2026-05-01"],
    [12, "2025-11-01"],
  ])("%i개월 → %s ~ 오늘 2026-10-18, 끝은 내일 0시", (months, from) => {
    const w = monthWindow(months, "including_current", NOW);
    expect([w.from, w.to, w.monthsCounted]).toEqual([from, "2026-10-18", months]);
    expect(w.end).toBe(kst("2026-10-19T00:00:00"));
    expect(inWindow(kst("2026-10-18T23:59:59"), w)).toBe(true);
    expect(inWindow(kst(`${from}T00:00:00`) - 1, w)).toBe(false);
  });
});

describe("내부 집계 기간 설정 (news_readiness_windows — 설계 2.8)", () => {
  const seed = designSeeds("2.8").get("news_readiness_windows") as Record<string, unknown>;

  test("설계 2.8의 잡는 법 값 = 코드 값, 씨앗은 검사를 지난다", () => {
    expect([...WINDOW_BASES]).toEqual(designList("2.8", "review_period.basis"));
    expect(checkWindowsSetting(seed)).toEqual([]);
    expect(readWindowsSetting(seed, true)).toEqual({ setting: seed, problem: null });
  });

  test.each([
    [{ months: [] }, "months: 1~24 정수 1~4개를 작은 것부터 적습니다"],
    [{ months: [3, 3] }, "months: 1~24 정수 1~4개를 작은 것부터 적습니다"],
    [{ months: [6, 3] }, "months: 1~24 정수 1~4개를 작은 것부터 적습니다"],
    [{ months: [0, 3] }, "months: 1~24 정수 1~4개를 작은 것부터 적습니다"],
    [{ months: [3, 25] }, "months: 1~24 정수 1~4개를 작은 것부터 적습니다"],
    [{ months: [3.5] }, "months: 1~24 정수 1~4개를 작은 것부터 적습니다"],
    [{ months: [1, 2, 3, 4, 5] }, "months: 1~24 정수 1~4개를 작은 것부터 적습니다"],
    [{ basis: "rolling" }, "basis: closed_months·including_current 중 하나여야 합니다"],
    [{ target: 30 }, "target: 모르는 칸입니다 — 기준 숫자는 규정 버전에만 적습니다"],
  ])("틀린 값 %j → 거부", (change, message) => {
    expect(checkWindowsSetting({ ...seed, version: "v-next", ...change })).toEqual([message]);
  });

  test("값을 바꾸고 버전을 그대로 두면 거부 — 같은 값이면 된다", () => {
    expect(checkWindowsSetting({ ...seed, months: [3, 12] }, seed)).toEqual([`version: 값을 바꾸면 버전도 바꿔야 합니다 (지금 ${String(seed.version)})`]);
    expect(checkWindowsSetting({ ...seed }, seed)).toEqual([]);
    expect(checkWindowsSetting({ ...seed, version: "2026-11-01.1", months: [3, 12] }, seed)).toEqual([]);
  });

  test("설정이 없거나 틀리면 NAV-14 정의(3·6·12개월·완결된 달)로 보고 그 문제를 알린다", () => {
    expect(readWindowsSetting(undefined, false)).toEqual({ setting: NAV14_WINDOWS, problem: "내부 집계 기간 설정(news_readiness_windows)이 없습니다 — NAV-14 정의(3·6·12개월, 완결된 달)로 셉니다" });
    const broken = readWindowsSetting({ version: "x", months: "3,6", basis: "closed_months" }, true);
    expect(broken.setting).toEqual(NAV14_WINDOWS);
    expect(broken.problem).toMatch(/^내부 집계 기간 설정이 틀렸습니다\(months: /);
    expect(NAV14_WINDOWS).toMatchObject({ months: [3, 6, 12], basis: "closed_months" });
  });

  test("windowsFor — 설정의 달마다 한 기간, 순서 그대로", () => {
    const ws = windowsFor({ version: "v", months: [3, 12], basis: "closed_months" }, NOW);
    expect(ws.map((w) => [w.months, w.from, w.to])).toEqual([
      [3, "2026-07-01", "2026-09-30"],
      [12, "2025-10-01", "2026-09-30"],
    ]);
  });
});
