import { describe, expect, test } from "vitest";
import {
  METRIC_KEYS,
  addMonthsToDate,
  choose,
  columnShareExceeded,
  isMonth,
  lastClosedMonth,
  lowestCombos,
  monthWindowOf,
  monthlyMetrics,
  penaltyReached,
  penaltyTotal,
  readMergeExternal,
  readPenaltyRule,
  readSimilarityRule,
  recentClosedMonths,
  reporterCount,
  threeMonthCombos,
  valueOf,
  zeroMetrics,
  type MonthMetrics,
} from "./monthly";
import type { FactArticle, Facts } from "./production";

const SEPT = monthWindowOf("2026-09");
const inSept = Date.parse("2026-09-15T03:00:00Z");

let seq = 0;
function article(over: Partial<FactArticle> = {}): FactArticle {
  seq += 1;
  return {
    id: seq,
    slug: `a${seq}`,
    title: "시험",
    section: "tax",
    contentType: "reported_news",
    reportingMethod: "quantitative",
    origin: "native",
    status: "published",
    label: "none",
    authorId: 1,
    publishedAt: inSept,
    assignmentKind: null,
    editorialStatus: "approved",
    taxReviewStatus: "not_required",
    evidenceTotal: 1,
    evidenceVerified: 1,
    evidenceRightsUnconfirmed: 0,
    mediaUnconfirmed: 0,
    viewsHuman: 0,
    engagedViews: 0,
    shares: 0,
    lastSimilarity: "pass",
    ...over,
  };
}
const facts = (articles: FactArticle[], people: Facts["people"] = new Map()): Facts => ({ articles, corrections: [], similarityChecks: [], people, openAssignments: new Map() });
type Person = { name: string; roles: string[]; employment: string | null };
const staff = (name: string): Person => ({ name, roles: ["reporter"], employment: "staff" });
const external = (name: string): Person => ({ name, roles: ["writer"], employment: "external" });

describe("기간·달 도우미", () => {
  test("달 'YYYY-MM'은 그 달 1일~말일(한국 날짜) 한 달 기간이다", () => {
    expect(SEPT.from).toBe("2026-09-01");
    expect(SEPT.to).toBe("2026-09-30");
    expect(SEPT.end - SEPT.start).toBe(30 * 86_400_000);
    expect(monthWindowOf("2026-12").to).toBe("2026-12-31");
    expect(isMonth("2026-09") && !isMonth("2026-13") && !isMonth("2026-9")).toBe(true);
  });
  test("직전 완결 달 — 한국 날짜 기준, 1월이면 전년 12월", () => {
    expect(lastClosedMonth(Date.parse("2026-10-25T00:00:00Z"))).toBe("2026-09");
    expect(lastClosedMonth(Date.parse("2026-01-01T00:00:00+09:00"))).toBe("2025-12");
    expect(lastClosedMonth(Date.parse("2025-12-31T15:00:00Z"))).toBe("2025-12"); // 한국 시각 1월 1일 00시
  });
  test("최근 12개월은 오래된 달이 앞이고 연도를 넘어간다", () => {
    const months = recentClosedMonths(Date.parse("2026-10-25T00:00:00Z"), 12);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-10");
    expect(months.at(-1)).toBe("2026-09");
  });
});

describe("기자 수 — 외부 기고자 합산 (NAV-19)", () => {
  const people = new Map<number, Person>([
    [1, staff("내부1")],
    [2, staff("내부2")],
    [11, external("외부1")],
    [12, external("외부2")],
    [13, external("외부3")],
  ]);
  const authors = [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 11, 11, 12, 12, 13, 13];
  test("외부 기고자 3명(각 2건) + 내부 기자 2명(각 5건) — 합산 규칙이 있으면 3명, 없으면 5명", () => {
    expect(reporterCount(authors, people, true)).toBe(3);
    expect(reporterCount(authors, people, false)).toBe(5);
  });
  test("외부 기고자가 없으면 합산 규칙과 상관없이 내부 기자 수", () => {
    expect(reporterCount([1, 2], people, true)).toBe(2);
  });
  test("월 지표의 기자 1인당 분모가 이 규칙을 따른다 (분모 3)", () => {
    const arts = authors.map((authorId) => article({ authorId }));
    const m = monthlyMetrics(facts(arts, people), SEPT, { mergeExternal: true });
    expect(m.per_reporter).toMatchObject({ numerator: 16, denominator: 3 });
    expect(monthlyMetrics(facts(arts, people), SEPT, { mergeExternal: false }).per_reporter!.denominator).toBe(5);
  });
});

describe("월 지표 (NAV-17)", () => {
  test("digest·정보 목록·opinion·sponsored를 1건씩 더해도 자체 생산 분자는 그대로, 분모(월 발행)만 늘어난다", () => {
    const base = [article(), article(), article({ authorId: 2 })];
    const before = monthlyMetrics(facts(base), SEPT, { mergeExternal: true });
    const more = [...base, article({ contentType: "digest" }), article({ contentType: "explainer" }), article({ contentType: "opinion" }), article({ contentType: "sponsored", label: "ad" })];
    const after = monthlyMetrics(facts(more), SEPT, { mergeExternal: true });
    expect(after.own_ratio!.numerator).toBe(before.own_ratio!.numerator);
    expect(before.own_ratio).toMatchObject({ numerator: 3, denominator: 3 });
    expect(after.own_ratio).toMatchObject({ numerator: 3, denominator: 7 });
    expect(after.column_share).toMatchObject({ numerator: 1, denominator: 7 });
    expect(after.evidence_rate).toMatchObject({ numerator: 3, denominator: 3 });
  });
  test("달 밖 발행·보류·이관 기사는 세지 않는다 (경계: 달 첫날 0시 포함, 다음 달 0시 제외)", () => {
    const arts = [
      article({ publishedAt: SEPT.start }),
      article({ publishedAt: SEPT.end }),
      article({ publishedAt: SEPT.start - 1 }),
      article({ status: "held" }),
      article({ origin: "legacy" }),
    ];
    expect(monthlyMetrics(facts(arts), SEPT, { mergeExternal: true }).monthly_output!.numerator).toBe(1);
  });
  test("모든 지표에 분자·분모(건수 지표는 null)·정의·제외 조건이 있다", () => {
    const m = monthlyMetrics(facts([article()]), SEPT, { mergeExternal: true });
    for (const key of METRIC_KEYS) {
      expect(m[key], key).toBeDefined();
      expect(m[key]!.definition.length).toBeGreaterThan(0);
      expect(m[key]!.exclusions.length).toBeGreaterThan(0);
    }
    expect(valueOf(m.own_ratio!)).toBe(1);
    expect(valueOf(m.monthly_output!)).toBe(1);
  });
  test("0인 지표 — 기사가 없는 달은 월 송출량 0 경고, 비율은 분모가 0이면 판단하지 않는다", () => {
    const empty = monthlyMetrics(facts([]), SEPT, { mergeExternal: true });
    expect(zeroMetrics(empty)).toEqual(["monthly_output", "feature_output"]);
    const noOwn = monthlyMetrics(facts([article({ contentType: "explainer" })]), SEPT, { mergeExternal: true });
    expect(zeroMetrics(noOwn)).toContain("own_ratio");
    expect(zeroMetrics(noOwn)).toContain("feature_output");
    expect(zeroMetrics(noOwn)).not.toContain("monthly_output");
  });
  test("칼럼 비중 경고 — 기준과 같은 값은 경고 아님, 넘으면 경고, 기준이 없으면 경고 없음", () => {
    const m = monthlyMetrics(facts([article(), article({ contentType: "opinion" })]), SEPT, { mergeExternal: true });
    expect(columnShareExceeded(m, 0.5)).toBe(false);
    expect(columnShareExceeded(m, 0.49)).toBe(true);
    expect(columnShareExceeded(m, null)).toBe(false);
  });
});

describe("임의 3개월 조합 (NAV-17)", () => {
  const month = (i: number) => `2025-${String(((i + 9) % 12) + 1).padStart(2, "0")}`; // 형식만 맞는 달 이름
  const rows = (n: number): { month: string; metrics: MonthMetrics }[] =>
    Array.from({ length: n }, (_, i) => ({
      month: `${2025 + Math.floor((i + 9) / 12)}-${String(((i + 9) % 12) + 1).padStart(2, "0")}`,
      metrics: { own_ratio: { numerator: i + 1, denominator: 10, definition: "d", exclusions: "e" }, monthly_output: { numerator: 10, denominator: null, definition: "d", exclusions: "e" } },
    }));
  void month;

  test("12개월이면 조합 220개, 5개월이면 10개, 3개월이면 1개, 3개월 미만이면 기간 부족", () => {
    const count = (n: number) => {
      const r = threeMonthCombos(rows(n));
      return r.kind === "ok" ? r.combos.length : r.months;
    };
    expect(count(12)).toBe(220);
    expect(count(5)).toBe(10);
    expect(count(3)).toBe(1);
    expect(threeMonthCombos(rows(2))).toEqual({ kind: "insufficient", months: 2 });
    expect(threeMonthCombos([])).toEqual({ kind: "insufficient", months: 0 });
  });
  test("연속 3개월만 보는 정의로 바꾸면 12개월에서 10개 (규정 원문이 정할 때)", () => {
    const r = threeMonthCombos(rows(12), { onlyConsecutive: true });
    expect(r.kind === "ok" && r.combos.length).toBe(10);
  });
  test("조합 값은 분자·분모를 각각 더한 뒤 나눈다 — 가장 낮은 조합은 지표마다 따로", () => {
    const r = threeMonthCombos(rows(5));
    if (r.kind !== "ok") throw new Error("조합 있음");
    const low = lowestCombos(r.combos);
    const own = low.find((l) => l.key === "own_ratio")!;
    expect(own.months).toEqual(rows(5).slice(0, 3).map((x) => x.month));
    expect(own.value).toBeCloseTo((1 + 2 + 3) / 30);
    expect(low.find((l) => l.key === "monthly_output")!.value).toBe(30);
  });
  test("조합 수 계산 도우미", () => {
    expect(choose([1, 2, 3, 4], 3)).toEqual([[1, 2, 3], [1, 2, 4], [1, 3, 4], [2, 3, 4]]);
    expect(choose([1, 2], 3)).toEqual([]);
  });
});

describe("부정평가 누적 (NAV-20)", () => {
  const rec = (occurredOn: string, points = 1) => ({ occurredOn, points });
  test("창은 일어난 날부터 N개월 뒤 전날까지 — 마지막 날 포함, 그다음 날 제외", () => {
    const records = [rec("2026-01-15", 2)];
    expect(penaltyTotal(records, "2026-04-14", 3)).toBe(2);
    expect(penaltyTotal(records, "2026-04-15", 3)).toBe(0);
    expect(penaltyTotal(records, "2026-01-15", 3)).toBe(2);
    expect(penaltyTotal(records, "2026-01-14", 3)).toBe(0);
  });
  test("달 끝 날짜 — 1월 31일 + 1개월은 2월 말일로 접는다", () => {
    expect(addMonthsToDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDate("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsToDate("2026-11-15", 3)).toBe("2027-02-15");
  });
  test("여러 기록은 창 안의 것만 더한다", () => {
    const records = [rec("2025-01-01", 4), rec("2025-06-10", 3), rec("2025-12-31", 5)];
    expect(penaltyTotal(records, "2025-12-31", 12)).toBe(12);
    expect(penaltyTotal(records, "2026-01-01", 12)).toBe(8);
    expect(penaltyTotal(records, "2026-06-10", 12)).toBe(5);
  });
  test("경고 기준 비교 — 이상(gte)은 같은 값도, 초과(gt)는 같은 값은 아님", () => {
    expect(penaltyReached(3, { warn_points: 3, comparator: "gte" })).toBe(true);
    expect(penaltyReached(3, { warn_points: 3, comparator: "gt" })).toBe(false);
    expect(penaltyReached(3.5, { warn_points: 3, comparator: "gt" })).toBe(true);
  });
});

describe("규정 판단 값 읽기", () => {
  test("부정평가 규칙은 모양이 맞을 때만, 외부 기고자 합산은 true일 때만 켜진다", () => {
    expect(readPenaltyRule({ window_months: 12, warn_points: 5, comparator: "gte" })).toEqual({ window_months: 12, warn_points: 5, comparator: "gte" });
    for (const bad of [null, {}, { window_months: 0, warn_points: 5, comparator: "gte" }, { window_months: 12, warn_points: 0, comparator: "gte" }, { window_months: 12, warn_points: 5, comparator: "eq" }]) {
      expect(readPenaltyRule(bad)).toBeNull();
    }
    expect(readMergeExternal({ merge_external: true })).toBe(true);
    expect(readMergeExternal({ merge_external: "true" })).toBe(false);
    expect(readMergeExternal(null)).toBe(false);
  });
  test("유사도 규정 기준은 규정 버전 글자와 함께 엔진 입력 모양으로, 틀리면 null(내부 기준)", () => {
    const rule = { sentence_similarity: 0.9, sentence_comparator: "gte", article_ratio: 0.6, article_comparator: "gt" };
    expect(readSimilarityRule(rule, "시험 규정 v1")).toEqual({ version: "시험 규정 v1", sentenceSimilarity: 0.9, sentenceComparator: "gte", articleRatio: 0.6, articleComparator: "gt" });
    expect(readSimilarityRule({ ...rule, article_ratio: 1.2 }, "v")).toBeNull();
    expect(readSimilarityRule(null, "v")).toBeNull();
  });
});
