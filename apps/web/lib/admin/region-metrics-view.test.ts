import { describe, expect, it } from "vitest";
import {
  COST_MAX_KRW,
  COST_MISSING,
  costRows,
  decodeRegionMetrics,
  formatKrw,
  formatPerArticle,
  formatRatio,
  isMonth,
  lastCompleteMonth,
  monthWindow,
  parseCostInput,
  regionRows,
  shiftMonth,
  type RegionMetricRow,
} from "./region-metrics-view";

const row = (o: Partial<RegionMetricRow> & { regionCode: string }): RegionMetricRow => ({
  published: 0,
  own: 0,
  ownWithEvidence: 0,
  viewSessions: 0,
  movedSessions: 0,
  visitors: 0,
  returned: 0,
  pending: 0,
  ...o,
});

describe("formatRatio — 분자와 분모를 함께", () => {
  it("분자 / 분모 (비율)", () => {
    expect(formatRatio({ numerator: 1, denominator: 3 })).toBe("1 / 3 (33.3%)");
    expect(formatRatio({ numerator: 2, denominator: 2 })).toBe("2 / 2 (100%)");
    expect(formatRatio({ numerator: 1200, denominator: 4000 })).toBe("1,200 / 4,000 (30%)");
  });
  it("분모 0이면 비율은 '—' (0%로 보이지 않음), 분자·분모 숫자는 그대로", () => {
    expect(formatRatio({ numerator: 0, denominator: 0 })).toBe("0 / 0 (—)");
  });
});

describe("decodeRegionMetrics", () => {
  it("DB 응답을 지역 줄로 바꾼다", () => {
    const rows = decodeRegionMetrics({
      regions: [{ region_code: "1100000000", published: 4, own: 3, own_with_evidence: 1, view_sessions: 5, moved_sessions: 2, visitors: 4, returned: 1, pending: 2 }],
    });
    expect(rows).toEqual([{ regionCode: "1100000000", published: 4, own: 3, ownWithEvidence: 1, viewSessions: 5, movedSessions: 2, visitors: 4, returned: 1, pending: 2 }]);
  });
  it("모양이 틀리면 오류, 숫자가 아닌 칸은 0", () => {
    expect(() => decodeRegionMetrics({})).toThrow();
    expect(decodeRegionMetrics({ regions: [{ region_code: "x", own: "7" }] })[0]?.own).toBe(0);
  });
});

describe("regionRows — 지표마다 분자·분모 짝", () => {
  it("자체 취재 = own/published, 근거 = 근거 확인/own, 재방문 = returned/visitors, 이동 = moved/view", () => {
    const names = new Map([["1100000000", "서울특별시"]]);
    const [r] = regionRows([row({ regionCode: "1100000000", published: 4, own: 3, ownWithEvidence: 1, viewSessions: 5, movedSessions: 2, visitors: 4, returned: 1, pending: 2 })], names);
    expect(r?.name).toBe("서울특별시");
    expect(r?.own).toEqual({ numerator: 3, denominator: 4 });
    expect(r?.evidence).toEqual({ numerator: 1, denominator: 3 });
    expect(r?.returned).toEqual({ numerator: 1, denominator: 4 });
    expect(r?.moved).toEqual({ numerator: 2, denominator: 5 });
    expect(r?.pending).toBe(2);
  });
  it("지역 코드 순서, 이름을 모르면 코드", () => {
    const rows = regionRows([row({ regionCode: "2600000000" }), row({ regionCode: "1100000000" })], new Map());
    expect(rows.map((r) => r.name)).toEqual(["1100000000", "2600000000"]);
  });
});

describe("편집비 — 빈 달은 '편집비 미입력'(추정값 0 아님)", () => {
  const names = new Map([["A", "가"], ["B", "나"]]);
  it("입력 행이 없으면 amountKrw null, 입력 행이 있으면 금액 그대로", () => {
    const rows = costRows([row({ regionCode: "A", own: 2 }), row({ regionCode: "B", own: 0 })], new Map([["B", 500]]), names);
    expect(rows.find((r) => r.regionCode === "A")?.amountKrw).toBeNull();
    expect(rows.find((r) => r.regionCode === "B")?.amountKrw).toBe(500);
    expect(formatPerArticle(rows.find((r) => r.regionCode === "A")!)).toBe(COST_MISSING);
  });
  it("편집비 0원을 입력한 달은 0원 — 미입력과 구분", () => {
    const [r] = costRows([row({ regionCode: "A", own: 2 })], new Map([["A", 0]]), names);
    expect(r?.amountKrw).toBe(0);
    expect(formatPerArticle(r!)).toBe("0원 ÷ 2건 = 0원");
  });
  it("취재 1건당 = 편집비 ÷ 자체 취재 (분자·분모 함께), 자체 취재 0건이면 나누지 않는다", () => {
    const rows = costRows([row({ regionCode: "A", own: 3 })], new Map([["A", 1000], ["B", 700]]), names);
    expect(formatPerArticle(rows[0]!)).toBe("1,000원 ÷ 3건 = 333원");
    expect(formatPerArticle(rows[1]!)).toBe("— (자체 취재 0건)");
  });
  it("편집비만 있고 기사 숫자가 없는 지역도 줄에 든다", () => {
    expect(costRows([], new Map([["B", 9]]), names).map((r) => r.regionCode)).toEqual(["B"]);
  });
});

describe("달 계산 (한국 달력)", () => {
  it("isMonth — 올바른 달만", () => {
    expect(isMonth("2026-09")).toBe(true);
    for (const bad of ["2026-13", "2026-00", "2026-9", "2026-09-01", "", undefined, 202609, "1999-12"]) expect(isMonth(bad)).toBe(false);
  });
  it("lastCompleteMonth — 한국 날짜 기준 지난 달 (달 첫날 0시 경계)", () => {
    expect(lastCompleteMonth(Date.parse("2026-10-24T03:00:00+09:00"))).toBe("2026-09");
    expect(lastCompleteMonth(Date.parse("2026-10-01T00:00:00+09:00"))).toBe("2026-09");
    expect(lastCompleteMonth(Date.parse("2026-09-30T23:59:59+09:00"))).toBe("2026-08");
    expect(lastCompleteMonth(Date.parse("2027-01-15T12:00:00+09:00"))).toBe("2026-12");
  });
  it("monthWindow — [달 1일 0시, 다음 달 1일 0시) 한국 시각, 12월은 다음 해 1월", () => {
    expect(monthWindow("2026-09")).toEqual({ from: Date.parse("2026-09-01T00:00:00+09:00"), to: Date.parse("2026-10-01T00:00:00+09:00") });
    expect(monthWindow("2026-12").to).toBe(Date.parse("2027-01-01T00:00:00+09:00"));
  });
  it("shiftMonth", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-05", 0)).toBe("2026-05");
  });
  it("formatKrw", () => expect(formatKrw(1200000)).toBe("1,200,000원"));
});

describe("parseCostInput — 편집비 입력 검사", () => {
  const ok = { regionCode: "1100000000", month: "2026-09", amountKrw: 1200000, reason: "분기 정산 반영" };
  it("올바른 입력", () => expect(parseCostInput(ok)).toEqual({ ok: true, value: ok }));
  it("금액 글자 숫자(쉼표·공백)도 정수로 받는다, 0원도 입력으로 인정", () => {
    expect(parseCostInput({ ...ok, amountKrw: "1,200,000" })).toMatchObject({ ok: true, value: { amountKrw: 1200000 } });
    expect(parseCostInput({ ...ok, amountKrw: 0 })).toMatchObject({ ok: true, value: { amountKrw: 0 } });
  });
  it.each([
    ["음수", { amountKrw: -1 }, "amountKrw"],
    ["소수", { amountKrw: 1.5 }, "amountKrw"],
    ["글자", { amountKrw: "12abc" }, "amountKrw"],
    ["빈 글자", { amountKrw: "" }, "amountKrw"],
    ["상한 초과", { amountKrw: COST_MAX_KRW + 1 }, "amountKrw"],
    ["지역 코드 9자리", { regionCode: "110000000" }, "regionCode"],
    ["달 13월", { month: "2026-13" }, "month"],
    ["달에 일 포함", { month: "2026-09-01" }, "month"],
    ["사유 없음", { reason: "  " }, "reason"],
    ["사유 201자", { reason: "가".repeat(201) }, "reason"],
  ])("거부 — %s", (_n, patch, field) => {
    const r = parseCostInput({ ...ok, ...patch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.startsWith(`${field}:`))).toBe(true);
  });
  it("상한 정확히는 허용 (경계값)", () => expect(parseCostInput({ ...ok, amountKrw: COST_MAX_KRW }).ok).toBe(true));
});
