// 측정 지표 대시보드 화면 값 시험 — 비율 글자(분모 0은 '—'), 깔때기 줄, 정의 글자(분모·분자·제외 조건·소유 ID), 다른 문서 지표는 '수집 전'(숫자 0), 기간 링크
import { describe, expect, test } from "vitest";
import { resolvePeriod } from "@/lib/analytics/metrics";
import { DEFINITIONS, OTHER_METRICS, SECTION_ROWS, formatCount, formatRate, funnelRows, periodLinks, periodText } from "./metrics-view";

describe("비율 글자", () => {
  test("소수 한 자리 백분율 — 나누어떨어지면 소수 없음, 분모 0은 '—'(0%가 아니다)", () => {
    expect(formatRate({ numerator: 1, denominator: 3 })).toBe("33.3%");
    expect(formatRate({ numerator: 2, denominator: 3 })).toBe("66.7%");
    expect(formatRate({ numerator: 1, denominator: 2 })).toBe("50%");
    expect(formatRate({ numerator: 0, denominator: 5 })).toBe("0%");
    expect(formatRate({ numerator: 3, denominator: 3 })).toBe("100%");
    expect(formatRate({ numerator: 0, denominator: 0 })).toBe("—");
    expect(formatCount(12345)).toBe("12,345");
  });
});

describe("깔때기 줄", () => {
  test("앞 칸 대비·첫 방문 대비 — 첫 칸은 비율 없음", () => {
    const rows = funnelRows({ firstVisits: 4, entered: 2, engagedAction: 1, solved: 2 });
    expect(rows.map((r) => [r.step, r.count])).toEqual([
      [1, 4],
      [2, 2],
      [3, 1],
    ]);
    expect(rows[0]).toMatchObject({ fromPrevious: null, fromFirst: null });
    expect(rows[2]!.fromPrevious).toEqual({ numerator: 1, denominator: 2 });
    expect(rows[2]!.fromFirst).toEqual({ numerator: 1, denominator: 4 });
  });
});

describe("정의 글자 (GROW-01 '지표마다 정의·분모·분자·소유 요구사항 ID')", () => {
  test("지표마다 분모·분자·제외 조건·소유 ID가 비어 있지 않고, 봇·편집국 제외를 적는다", () => {
    for (const [key, d] of Object.entries(DEFINITIONS)) {
      for (const field of ["title", "owner", "denominator", "numerator", "exclusions"] as const) expect(d[field].trim().length, `${key}.${field}`).toBeGreaterThan(0);
      expect(d.owner).toMatch(/GROW-01/);
      expect(d.exclusions).toMatch(/봇·편집국·관리자/);
    }
    expect(DEFINITIONS.validVisits.numerator).toMatch(/30초/);
    expect(DEFINITIONS.revisits.numerator).toMatch(/30일째 날짜까지.*31일째는 넣지 않음/);
    expect(DEFINITIONS.revisits.exclusions).toMatch(/방문자 ID가 없는 세션/);
  });
  test("분야 줄은 4대 분야 순서와 이름", () => {
    expect(SECTION_ROWS.map((r) => r.label)).toEqual(["지방세", "부동산", "부동산개발금융", "지자체뉴스"]);
  });
});

describe("다른 문서가 정하는 지표 — 수집 전 (추정값 0)", () => {
  test("GROW-01이 같은 대시보드에 모으라고 한 지표 전부와 소유 ID — 상태 글자만, 숫자 0", () => {
    expect(OTHER_METRICS.map((m) => [m.name, m.owner, m.status])).toEqual([
      ["지방세 연결률", "01B CORE-03", "수집 전"],
      ["AI 도우미 해결률 · 사람 연결률 · 대화당 비용", "01C CHAT-13", "수집 전"],
      ["전문가 연결", "01C EXPL-09", "수집 전"],
      ["구독·도서·교육·상담 전환과 유입 경로", "01C BIZ-09", "수집 전"],
      ["상품별 공헌이익", "01C BIZ-09", "2단계부터"],
      ["AI 검색 노출", "OPT-09", "수집 전"],
      ["제휴 준비도", "NAV-17", "수집 전"],
    ]);
    for (const m of OTHER_METRICS) expect(Object.keys(m).sort(), m.id).toEqual(["definition", "id", "name", "note", "owner", "status"]); // 숫자 칸 0
  });
});

describe("기간 링크", () => {
  const now = Date.parse("2026-10-18T03:00:00Z");
  test("최근 7·30·90일 — 지금 기간 표시, 전환일이 없으면 기준선 링크 0", () => {
    const { period } = resolvePeriod({ period: "7" }, now, null);
    expect(periodLinks(period, null)).toEqual([
      { key: "7", label: "최근 7일", href: "/admin/metrics?period=7", current: true },
      { key: "30", label: "최근 30일", href: "/admin/metrics?period=30", current: false },
      { key: "90", label: "최근 90일", href: "/admin/metrics?period=90", current: false },
    ]);
    expect(periodText(period)).toBe("2026-10-12 ~ 2026-10-18 (7일, 한국 날짜)");
  });
  test("전환일이 있으면 '전환 후 첫 4주 (기준선)' — 직접 고른 기간은 어느 링크도 지금 기간이 아니다", () => {
    const base = resolvePeriod({ period: "baseline" }, now, "2026-10-01").period;
    expect(periodLinks(base, "2026-10-01").at(-1)).toEqual({ key: "baseline", label: "전환 후 첫 4주 (기준선)", href: "/admin/metrics?period=baseline", current: true });
    const custom = resolvePeriod({ period: "custom", from: "2026-09-01", to: "2026-09-30" }, now, "2026-10-01").period;
    expect(periodLinks(custom, "2026-10-01").some((l) => l.current)).toBe(false);
  });
});
