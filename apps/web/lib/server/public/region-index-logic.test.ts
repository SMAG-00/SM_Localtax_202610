// 지역 색인 판정·시범 지역·최소선 리포트 (W4 11단계 — docs/dev/W4_설계.md 1장 11단계 · 2.2 · 12장 #6·#27·#81~, PRD-01B REG-09 · REG1-12 · 9.2)
//  · 씨앗 = 설계 2.2 = 마이그레이션 …46 씨앗 · 한도 = 마이그레이션 상수 · 보도자료 재게시 경고 번호 = 8단계 판정 번호 = 뷰 글자
//  · 설정 검사(DB 트리거와 같은 규칙 — 운영 설정 화면 검사도 같은 함수) · 검색 노출 제외 사유 순서 · robots(SITE_INDEXING) · 제목·메타 설명(템플릿 0)
//  · 리포트 — 시범 지역 미지정 · 한 시·도뿐 → '시·도 분포 미달' · 미달 지역 · 유효하지 않은 코드 · 충족
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { RULES } from "@ltr/editorial";
import { SETTING_SPECS } from "@/lib/admin/settings-rules";
import type { RegionRouteRow } from "@/lib/site/region-route";
import {
  DESCRIPTION_MAX_CHARS,
  PILOT_MIN_SIDO,
  REGION_INDEX_KEYS,
  REGION_INDEX_LIMITS,
  REGION_INDEX_THRESHOLD_SEED,
  REPOST_WARNING_ID,
  parsePilotRegions,
  pilotRegionsErrors,
  pilotRegionsRegionErrors,
  pilotReport,
  regionDescription,
  regionIndexThresholdErrors,
  regionNoindexReason,
  regionRobots,
  regionTitle,
  sidoIsPilot,
  type RegionIndexRow,
} from "./region-index-logic";

const ROOT = path.resolve(__dirname, "../../../../..");
const DESIGN = fs.readFileSync(path.join(ROOT, "docs", "dev", "W4_설계.md"), "utf8");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages", "db", "supabase", "migrations", "20261023000046_w4_region_index.sql"), "utf8");

const designSeed = (key: string): unknown => {
  const line = DESIGN.split("\n").find((l) => l.startsWith(`| \`${key}\` |`));
  expect(line, `설계 2.2 '${key}' 줄`).toBeTruthy();
  return JSON.parse(line!.split("|")[2]!.match(/`([[{][^`]+)`/)![1]!);
};
const migrationSeed = (key: string): unknown => JSON.parse(MIGRATION.match(new RegExp(`\\('${key}',\\s*'([^']+)'::jsonb`))![1]!);
const constant = (name: string) => Number(MIGRATION.match(new RegExp(`${name} constant integer := (\\d+);`))![1]);

describe("씨앗·한도 — 설계 2.2 = 마이그레이션 …46 = 코드 상수", () => {
  test("region_index_threshold = 9.2 최소선(자체 취재 1 · 공식 자료 1)", () => {
    expect(designSeed("region_index_threshold")).toEqual(REGION_INDEX_THRESHOLD_SEED);
    expect(migrationSeed("region_index_threshold")).toEqual(REGION_INDEX_THRESHOLD_SEED);
    expect(Object.keys(REGION_INDEX_THRESHOLD_SEED)).toEqual([...REGION_INDEX_KEYS]);
  });
  test("pilot_regions = PO 승인 서울특별시·부산광역시 (12장 #6)", () => {
    expect(designSeed("pilot_regions")).toEqual(["1100000000", "2600000000"]);
    expect(migrationSeed("pilot_regions")).toEqual(["1100000000", "2600000000"]);
    expect(DESIGN).toMatch(/\| 6 \| 시범 취재 지역[^\n]*PO 승인 \(2026-10-22\)\*\* — 서울특별시·부산광역시/);
  });
  test("한도 1~1000 · 시범 지역 20곳 = 트리거 상수, 시·도 분포 최소 2곳 = 9.2", () => {
    expect([constant("c_min"), constant("c_max"), constant("c_pilots")]).toEqual([REGION_INDEX_LIMITS.min, REGION_INDEX_LIMITS.max, REGION_INDEX_LIMITS.pilots]);
    expect(PILOT_MIN_SIDO).toBe(2);
  });
  test("보도자료 재게시 경고 번호 = 8단계 판정 번호 = 뷰 글자", () => {
    expect(RULES.some((f) => f.id === REPOST_WARNING_ID)).toBe(true);
    expect(MIGRATION).toContain(`? '${REPOST_WARNING_ID}'`);
  });
});

describe("설정 검사 — DB 트리거와 같은 규칙", () => {
  const BAD_THRESHOLD: [string, unknown, RegExp][] = [
    ["목록", [1, 1], /객체/],
    ["칸 하나 빠짐", { reported_news: 1 }, /official_sources: 1~1000 정수/],
    ["모르는 칸", { ...REGION_INDEX_THRESHOLD_SEED, digest: 1 }, /digest: 모르는 칸/],
    ["0 — 빈 지역 색인", { reported_news: 0, official_sources: 1 }, /reported_news: 1~1000 정수여야 합니다 — 0이면 빈 지역/],
    ["소수", { reported_news: 1.5, official_sources: 1 }, /reported_news: 1~1000 정수/],
    ["글자 숫자", { reported_news: "1", official_sources: 1 }, /reported_news/],
    ["1001", { reported_news: 1, official_sources: 1001 }, /official_sources: 1~1000/],
  ];
  for (const [name, value, error] of BAD_THRESHOLD) test(`임계값 거부 — ${name}`, () => expect(regionIndexThresholdErrors(value).join("\n")).toMatch(error));

  test("임계값 받는 값 — 씨앗 · 1000 · 운영 설정 화면 검사가 같은 함수", () => {
    expect(regionIndexThresholdErrors(REGION_INDEX_THRESHOLD_SEED)).toEqual([]);
    expect(regionIndexThresholdErrors({ reported_news: 1000, official_sources: 3 })).toEqual([]);
    expect(SETTING_SPECS.region_index_threshold!.check(REGION_INDEX_THRESHOLD_SEED, REGION_INDEX_THRESHOLD_SEED)).toEqual([]);
    for (const [, value] of BAD_THRESHOLD) expect(SETTING_SPECS.region_index_threshold!.check(value, REGION_INDEX_THRESHOLD_SEED)).toEqual(regionIndexThresholdErrors(value));
  });

  const BAD_PILOTS: [string, unknown, RegExp][] = [
    ["객체", { a: "1100000000" }, /0~20개 목록/],
    ["21개", Array.from({ length: 21 }, (_, i) => `99${String(i).padStart(2, "0")}000000`), /0~20개 목록/],
    ["9자리", ["110000000"], /\[0\]: 10자리 숫자/],
    ["숫자 값", [1100000000], /\[0\]: 10자리 숫자/],
    ["두 번", ["1100000000", "1100000000"], /\[1\]: 1100000000가 두 번/],
  ];
  for (const [name, value, error] of BAD_PILOTS) test(`시범 지역 거부 — ${name}`, () => expect(pilotRegionsErrors(value).join("\n")).toMatch(error));

  test("시범 지역 받는 값 — 빈 목록 · 씨앗 · 20개 · 운영 설정 화면 검사가 같은 함수", () => {
    expect(pilotRegionsErrors([])).toEqual([]);
    expect(pilotRegionsErrors(["1100000000", "2600000000"])).toEqual([]);
    expect(pilotRegionsErrors(Array.from({ length: 20 }, (_, i) => `99${String(i).padStart(2, "0")}000000`))).toEqual([]);
    for (const [, value] of BAD_PILOTS) expect(SETTING_SPECS.pilot_regions!.check(value, [])).toEqual(pilotRegionsErrors(value));
  });

  const reg = (code: string, over: Partial<RegionRouteRow> = {}): RegionRouteRow => ({ code, parent_code: null, level: "sido", name: `시험용 ${code}`, slug: `s${code}`, valid_from: null, valid_to: null, ...over });
  test("새로 넣는 코드는 오늘 유효한 행정구역 — 없는 코드·폐지·시작 전 거부, 이미 있던 코드는 폐지돼도 남는다", () => {
    const regions = [reg("9900000000"), reg("9901100000", { level: "sigungu", parent_code: "9900000000", valid_to: "2026-10-21" }), reg("9902000000", { valid_from: "2026-10-23" }), reg("9903000000", { valid_to: "2026-10-22" })];
    expect(pilotRegionsRegionErrors(["9900000000", "9903000000"], [], regions, "2026-10-22")).toEqual([]); // 폐지일 당일까지 유효
    expect(pilotRegionsRegionErrors(["9900000000", "9901100000", "9902000000", "9800000000"], [], regions, "2026-10-22")).toEqual([
      "[1]: 9901100000는 오늘 유효한 행정구역(regions)이 아닙니다",
      "[2]: 9902000000는 오늘 유효한 행정구역(regions)이 아닙니다",
      "[3]: 9800000000는 오늘 유효한 행정구역(regions)이 아닙니다",
    ]);
    expect(pilotRegionsRegionErrors(["9900000000", "9901100000"], ["9901100000"], regions, "2026-10-22")).toEqual([]);
  });

  test("공개 읽기 — 모양이 틀리면 빈 목록(칩 0)", () => {
    expect(parsePilotRegions(["1100000000"])).toEqual(["1100000000"]);
    for (const v of [null, undefined, "1100000000", ["1100000000", "1100000000"], [11]]) expect(parsePilotRegions(v)).toEqual([]);
  });
});

describe("지역 허브 검색 노출 — 사유 하나 · robots · 제목 · 메타 설명", () => {
  test("사유 순서 — 빈 지역 → 고른 분야 0건 → 최소선 미달, 모두 아니면 null", () => {
    expect(regionNoindexReason({ empty: true, indexable: false, topicEmpty: true })).toBe("empty");
    expect(regionNoindexReason({ empty: false, indexable: false, topicEmpty: true })).toBe("topic_empty");
    expect(regionNoindexReason({ empty: false, indexable: true, topicEmpty: true })).toBe("topic_empty");
    expect(regionNoindexReason({ empty: false, indexable: false, topicEmpty: false })).toBe("below_minimum");
    expect(regionNoindexReason({ empty: false, indexable: true, topicEmpty: false })).toBeNull();
  });

  test("robots — 사유가 있으면 noindex(SITE_INDEXING과 상관없이), 없고 SITE_INDEXING=on이면 index, 꺼짐이면 루트 그대로", () => {
    for (const reason of ["empty", "below_minimum", "topic_empty"] as const) {
      expect(regionRobots(reason, true)).toEqual({ index: false, follow: false });
      expect(regionRobots(reason, false)).toEqual({ index: false, follow: false });
    }
    expect(regionRobots(null, true)).toEqual({ index: true, follow: true });
    expect(regionRobots(null, false)).toBeUndefined();
  });

  test("제목 — 지역 전체 이름 · 분야를 고르면 분야 글자를 더해 허브와 다르다", () => {
    expect(regionTitle("시험용 가상도 시험용 가득구", "지자체뉴스", null)).toBe("시험용 가상도 시험용 가득구 · 지자체뉴스");
    expect(regionTitle("시험용 가상도 시험용 가득구", "지자체뉴스", "지방세")).toBe("시험용 가상도 시험용 가득구 지방세 · 지자체뉴스");
  });

  test("메타 설명 — 기사 제목 2건만(빈 제목 빼고), 0건 null, 160자 넘으면 줄임표 · 지역 이름을 끼워 넣는 문장 0", () => {
    expect(regionDescription(["첫 보도", "  ", "둘째 보도", "셋째 보도"])).toBe("첫 보도 · 둘째 보도");
    expect(regionDescription([])).toBeNull();
    expect(regionDescription(["   "])).toBeNull();
    const long = regionDescription(["가".repeat(100), "나".repeat(100)])!;
    expect(long.length).toBe(DESCRIPTION_MAX_CHARS);
    expect(long.endsWith("…")).toBe(true);
    // 같은 재료면 어느 지역이든 같은 설명 — 지역마다 다른 설명은 지역마다 다른 기사(그 지역 코드 하나만 단 기사)에서만 나온다
    expect(regionDescription(["같은 제목"])).toBe("같은 제목");
  });
});

describe("/local 시·도 카드 '시범 지역'", () => {
  test("그 시·도 또는 그 아래 시·군·구가 시범 지역이면 표시, 다른 시·도 아래 시·군·구는 0", () => {
    expect(sidoIsPilot("1100000000", ["1100000000"])).toBe(true);
    expect(sidoIsPilot("9900000000", ["9901100000"])).toBe(true);
    expect(sidoIsPilot("9900000000", ["9801100000", "2600000000"])).toBe(false);
    expect(sidoIsPilot("9900000000", [])).toBe(false);
  });
});

describe("최소선 판정 리포트 (9.2)", () => {
  const row = (code: string, over: Partial<RegionIndexRow> = {}): RegionIndexRow => {
    const sido = /^[0-9]{2}0{8}$/.test(code);
    return {
      code,
      level: sido ? "sido" : "sigungu",
      parent_code: sido ? null : `${code.slice(0, 2)}00000000`,
      name: `시험용 ${code}`,
      path: `/local/s${code}`,
      current: true,
      pilot: false,
      own_reported: 0,
      official_sources: 0,
      min_reported: "1",
      min_official: "1",
      reported_ok: false,
      official_ok: false,
      indexable: false,
      last_published_at: null,
      ...over,
    };
  };
  const met = { own_reported: 2, official_sources: 1, reported_ok: true, official_ok: true, indexable: true };
  const ROWS = [row("9900000000", met), row("9901100000", { own_reported: 1, reported_ok: true }), row("9902100000", met), row("9800000000", met), row("9700000000", { current: false })];

  test("시범 지역이 비면 '시범 지역 미지정' — 문제 목록 0, 전국 색인 대상 수는 그대로", () => {
    const r = pilotReport([], ROWS, REGION_INDEX_THRESHOLD_SEED);
    expect(r).toMatchObject({ status: "unset", label: "시범 지역 미지정", problems: [], regions: [], sidoCount: 0, indexedCount: 3 });
  });

  test("한 시·도 안의 시범 지역만 → '시·도 분포 미달' (두 지역 모두 충족이어도)", () => {
    const r = pilotReport(["9900000000", "9902100000"], ROWS, REGION_INDEX_THRESHOLD_SEED);
    expect(r.status).toBe("short");
    expect(r.label).toBe("최소선 미달");
    expect(r.problems).toEqual(["시·도 분포 미달 — 서로 다른 시·도 1곳 (최소 2곳)"]);
    expect(r.sidoCount).toBe(1);
  });

  test("서로 다른 시·도 2곳 + 모두 충족 → '최소선 충족', 지역마다 수·최소선·판정 = 뷰 값", () => {
    const r = pilotReport(["9900000000", "9800000000"], ROWS, REGION_INDEX_THRESHOLD_SEED);
    expect(r).toMatchObject({ status: "met", label: "최소선 충족", problems: [], sidoCount: 2, threshold: { reported: 1, official: 1 } });
    expect(r.regions[0]).toEqual({
      code: "9900000000",
      name: "시험용 9900000000",
      sidoName: "시험용 9900000000",
      path: "/local/s9900000000",
      current: true,
      reported: { count: 2, min: 1, ok: true },
      official: { count: 1, min: 1, ok: true },
      indexable: true,
    });
  });

  test("미달 지역 · 유효하지 않은 코드(폐지·없음) · 임계값 없음은 문제마다 한 줄 — 시·도 분포는 유효한 지역으로만 센다", () => {
    const r = pilotReport(["9901100000", "9700000000", "9600000000", "9800000000"], ROWS, null);
    expect(r.status).toBe("short");
    expect(r.problems).toEqual(["유효하지 않은 시범 지역 2곳", "최소선 미달 지역 1곳", "임계값 설정 없음"]);
    expect(r.sidoCount).toBe(2);
    const gu = r.regions[0]!;
    expect(gu).toMatchObject({ code: "9901100000", sidoName: "시험용 9900000000", reported: { count: 1, min: 1, ok: true }, official: { count: 0, min: 1, ok: false }, indexable: false });
    expect(r.regions[2]).toMatchObject({ code: "9600000000", name: "(행정구역에 없는 코드)", current: false, path: null });
  });
});
