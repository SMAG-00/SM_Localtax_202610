import { describe, expect, it } from "vitest";
import { buildSeriesChart, formatValue, isLocalTaxItem, NATIONAL_STEMS, parseVia, pointsProblem, seriesHref, statsRenderable, type SeriesView } from "./series";

// 모든 값은 `시험용` 지어낸 값이다 (실제 통계 값 아님).
const base: SeriesView = {
  id: 1,
  series_key: "test_series_a",
  title: "시험용 시계열",
  tax_item: "시험세목",
  region_code: null,
  unit: "시험단위",
  points: [
    { period: "2021", value: 10 },
    { period: "2022", value: 14 },
    { period: "2023", value: 12 },
  ],
  source_name: "시험용 출처",
  source_url: "https://example.test/stats",
  base_year: 2023,
  checked_at: "2026-10-01",
  status: "approved",
};

describe("statsRenderable - 출처·기준연도·확인일이 없으면 렌더하지 않는다", () => {
  it("모든 칸이 있으면 true", () => {
    expect(statsRenderable(base)).toBe(true);
  });
  it.each([
    ["출처 이름 없음", { source_name: "" }],
    ["출처 이름 공백", { source_name: "   " }],
    ["출처 주소 없음", { source_url: "" }],
    ["출처 주소가 http", { source_url: "http://example.test" }],
    ["출처 주소에 인증키 변수", { source_url: "https://example.test/a?serviceKey=abc" }],
    ["기준연도 없음", { base_year: undefined }],
    ["기준연도 범위 밖", { base_year: 1800 }],
    ["확인일 없음", { checked_at: undefined }],
    ["확인일 모양 틀림", { checked_at: "어제" }],
    ["점 없음", { points: [] }],
    ["키 형식 틀림", { series_key: "Bad Key" }],
  ])("%s -> false", (_name, patch) => {
    expect(statsRenderable({ ...base, ...patch } as Partial<SeriesView>)).toBe(false);
  });
  it("null·undefined는 false", () => {
    expect(statsRenderable(null)).toBe(false);
    expect(statsRenderable(undefined)).toBe(false);
  });
});

describe("pointsProblem - DB 함수 stats_points_problem과 같은 규칙", () => {
  it("올바른 점 목록은 문제 없음", () => {
    expect(pointsProblem(base.points)).toBeNull();
    expect(pointsProblem([{ period: "2023-01", value: 1.5 }])).toBeNull();
  });
  it("목록 아님·빈 목록·201개 거부", () => {
    expect(pointsProblem("x")).not.toBeNull();
    expect(pointsProblem([])).not.toBeNull();
    expect(pointsProblem(Array.from({ length: 201 }, (_, i) => ({ period: String(1800 + i).padStart(4, "0"), value: i })))).not.toBeNull();
  });
  it("기간 모양·값 형식·중복·내림차순·여분 칸 거부", () => {
    expect(pointsProblem([{ period: "23", value: 1 }])).toMatch(/period/);
    expect(pointsProblem([{ period: "2023", value: "1" }])).toMatch(/value/);
    expect(pointsProblem([{ period: "2023", value: 1 }, { period: "2023", value: 2 }])).toMatch(/오름차순/);
    expect(pointsProblem([{ period: "2024", value: 1 }, { period: "2023", value: 2 }])).toMatch(/오름차순/);
    expect(pointsProblem([{ period: "2023", value: 1, note: "x" }])).toMatch(/두 칸/);
    expect(pointsProblem([{ period: "2023", value: Number.NaN }])).toMatch(/value/);
  });
});

describe("buildSeriesChart - 차트와 표는 같은 목록", () => {
  it("점 수 = 표 행 수, 번호·기간·값이 같다", () => {
    const c = buildSeriesChart(base.points);
    expect(c.dots).toHaveLength(base.points.length);
    expect(c.rows).toHaveLength(base.points.length);
    c.dots.forEach((d, i) => {
      expect(c.rows[i]).toEqual({ no: d.no, period: d.period, value: d.value });
      expect(d.period).toBe(base.points[i].period);
      expect(d.value).toBe(base.points[i].value);
    });
    expect(c.min).toBe(10);
    expect(c.max).toBe(14);
  });
  it("가장 큰 값이 가장 위, 가장 작은 값이 가장 아래 (y는 작을수록 위)", () => {
    const c = buildSeriesChart(base.points);
    const top = c.dots.reduce((a, b) => (b.y < a.y ? b : a));
    expect(top.value).toBe(14);
    const bottom = c.dots.reduce((a, b) => (b.y > a.y ? b : a));
    expect(bottom.value).toBe(10);
  });
  it("점이 1개여도 값이 같아도 깨지지 않는다 (가운데 배치)", () => {
    const c = buildSeriesChart([{ period: "2023", value: 7 }]);
    expect(c.dots).toHaveLength(1);
    expect(Number.isFinite(c.dots[0].x) && Number.isFinite(c.dots[0].y)).toBe(true);
    expect(c.line).toBe(`${c.dots[0].x},${c.dots[0].y}`);
  });
  it("선(line) 좌표 개수는 점 수와 같다", () => {
    expect(buildSeriesChart(base.points).line.split(" ")).toHaveLength(3);
  });
});

describe("isLocalTaxItem - 국세 항목 이름 거르기", () => {
  it("지방세·빈 값은 통과", () => {
    expect(isLocalTaxItem(null)).toBe(true);
    expect(isLocalTaxItem("시험세목")).toBe(true);
    expect(isLocalTaxItem("지방소득세")).toBe(true);
  });
  it("조각 목록으로 만든 국세 이름은 거부, 길이 밖도 거부", () => {
    for (const stem of NATIONAL_STEMS) expect(isLocalTaxItem(`${stem.join("")}항목`)).toBe(false);
    expect(isLocalTaxItem("")).toBe(false);
    expect(isLocalTaxItem("가".repeat(31))).toBe(false);
  });
  it("DB 제약(179)의 조각과 같다", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(new URL("../../../../packages/db/supabase/migrations/20261026000179_w12h_stats_series.sql", import.meta.url), "utf8");
    const joined = NATIONAL_STEMS.map((p) => p.join("")).join("|");
    const line = sql.split(/\r?\n/).find((l) => l.includes("tax_item !~")) ?? "";
    const tail = line.slice(line.indexOf("tax_item !~"));
    const pieces = [...tail.matchAll(/'([^']*)'/g)].map((x) => x[1]);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join("")).toBe(`(${joined})`);
  });
});

describe("주소·표시 도우미", () => {
  it("seriesHref는 키를 인코딩하고 기준연도는 선택", () => {
    expect(seriesHref("test_series_a")).toBe("/data/test_series_a");
    expect(seriesHref("test_series_a", 2022)).toBe("/data/test_series_a?base=2022");
  });
  it("parseVia는 허용 값만, 아니면 data_page", () => {
    expect(parseVia("article")).toBe("article");
    expect(parseVia("evil")).toBe("data_page");
    expect(parseVia(null)).toBe("data_page");
  });
  it("formatValue는 천 단위 구분", () => {
    expect(formatValue(1234567)).toBe("1,234,567");
  });
});
