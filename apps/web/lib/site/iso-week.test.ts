import { describe, expect, it } from "vitest";
import { addDays, consecutiveWeekCount, isoWeekKey, isoWeekRange, isoWeekStart, previousWeekKey } from "./iso-week";

describe("ISO 주 (LG-01)", () => {
  it("2027-01-01(금)은 2026-53 주, 2027-01-04(월)는 2027-01 주에 속한다", () => {
    expect(isoWeekKey("2027-01-01")).toBe("2026-53");
    expect(isoWeekKey("2027-01-03")).toBe("2026-53");
    expect(isoWeekKey("2027-01-04")).toBe("2027-01");
  });
  it("주는 월요일에 시작해 일요일에 끝난다", () => {
    expect(isoWeekKey("2026-10-18")).toBe("2026-42");
    expect(isoWeekKey("2026-10-19")).toBe("2026-43");
    expect(isoWeekRange("2026-43")).toEqual({ start: "2026-10-19", end: "2026-10-25" });
  });
  it("존재하지 않는 주(2027-53)·형식 밖 값은 null", () => {
    expect(isoWeekStart("2027-53")).toBeNull();
    expect(isoWeekStart("2026-53")).toBe("2026-12-28");
    expect(isoWeekStart("2027-00")).toBeNull();
    expect(isoWeekStart("2027-1")).toBeNull();
    expect(isoWeekStart("abcd-ef")).toBeNull();
    expect(isoWeekRange("2027-53")).toBeNull();
  });
  it("범위의 모든 날짜는 같은 주차로 돌아온다", () => {
    const range = isoWeekRange("2026-53")!;
    for (let i = 0; i < 7; i += 1) expect(isoWeekKey(addDays(range.start, i))).toBe("2026-53");
    expect(isoWeekKey(addDays(range.end, 1))).toBe("2027-01");
  });
  it("없는 날짜는 예외", () => {
    expect(() => isoWeekKey("2026-02-30")).toThrow(RangeError);
  });
});

describe("연속 발행 주 수 (9.1 - 4주 연속)", () => {
  it("해가 바뀌어도 이어진다 - 2026-52, 2026-53, 2027-01은 3주 연속", () => {
    expect(previousWeekKey("2027-01")).toBe("2026-53");
    expect(previousWeekKey("2026-53")).toBe("2026-52");
    expect(consecutiveWeekCount(["2026-52", "2026-53", "2027-01"])).toBe(3);
  });
  it("중간이 비면 가장 최근에서 끊긴 곳까지만 센다", () => {
    expect(consecutiveWeekCount(["2026-40", "2026-42", "2026-43", "2026-44"])).toBe(3);
    expect(consecutiveWeekCount([])).toBe(0);
    expect(consecutiveWeekCount(["2027-53", "2026-43"])).toBe(1);
  });
});
