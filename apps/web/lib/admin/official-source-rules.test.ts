// 공식 자료·공공누리 운영 규칙 (W4 5단계 — docs/dev/W4_설계.md 2.1 · 2.2 · 12장 #13, PRD-01B REG1-07 · PR-07)
//  · 값 목록 = 설계 2.1 글자 = 마이그레이션 …41 check·씨앗 = @ltr/editorial 상수
//  · 운영 설정 검사(official_source_types · kogl_usage) — 차단 4종·제4유형·미표시는 설정으로도 못 넣는다(DB 트리거와 같은 규칙)
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { BLOCKED_OFFICIAL_SOURCE_TYPES, KOGL_USAGE_DEFAULT, LICENSE_TYPES, LICENSE_TYPE_LABELS, OFFICIAL_SOURCE_TYPES } from "@ltr/editorial";
import { SETTING_SPECS } from "./settings-rules";
import {
  SOURCE_TYPE_LABELS,
  koglUsageErrors,
  licenseBadge,
  officialSourceTypesErrors,
  parseKoglUsage,
  parseOfficialSourceTypes,
  sourceTypeLabel,
} from "./official-source-rules";

const ROOT = path.resolve(__dirname, "../../../..");
const DESIGN = fs.readFileSync(path.join(ROOT, "docs", "dev", "W4_설계.md"), "utf8");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages", "db", "supabase", "migrations", "20261022000041_w4_official_sources.sql"), "utf8");

const row = (prefix: string) => {
  const line = DESIGN.split("\n").find((l) => l.startsWith(prefix));
  if (!line) throw new Error(`설계 문서에 '${prefix}' 줄이 없다`);
  return line;
};
const codes = (line: string) => [...line.split("|")[2]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

describe("값 목록 = 설계 2.1 · 2.2 = 마이그레이션 …41 = 코드 상수", () => {
  test("공공누리 6값", () => {
    expect([...LICENSE_TYPES]).toEqual(codes(row("| article_source.license_type · media.license_type (공공누리) |")));
    expect(MIGRATION).toContain(`check (license_type in (${LICENSE_TYPES.map((t) => `'${t}'`).join(", ")}))`);
  });
  test("자료 종류 허용 6종(씨앗)·차단 4종", () => {
    expect([...OFFICIAL_SOURCE_TYPES]).toEqual(codes(row("| official_source_type (허용 — 설정")));
    expect([...BLOCKED_OFFICIAL_SOURCE_TYPES]).toEqual(codes(row("| official_source_type (차단 — 설정에도 못 넣는다) |")));
    expect(MIGRATION).toContain(`'${JSON.stringify(OFFICIAL_SOURCE_TYPES).replace(/,/g, ", ")}'::jsonb`);
    expect(MIGRATION).toContain(`in (${BLOCKED_OFFICIAL_SOURCE_TYPES.map((t) => `'${t}'`).join(", ")})`);
  });
  test("kogl_usage 씨앗 = 12장 #13 권고 기본값 = KOGL_USAGE_DEFAULT", () => {
    const seed = JSON.parse(row("| `kogl_usage` |").split("|")[2]!.match(/`(\{[^`]+\})`/)![1]!);
    expect(seed).toEqual(KOGL_USAGE_DEFAULT);
    expect(MIGRATION).toContain(`'{"photoTypes": ["kogl_1", "not_applicable"], "fullTextTypes": []}'::jsonb`);
  });
  test("배지 글자 — 유형마다 하나, 모두 '공공누리'로 시작하고 서로 다르다. 모르는 값·빈 값은 배지 0", () => {
    const labels = LICENSE_TYPES.map((t) => licenseBadge(t));
    expect(new Set(labels).size).toBe(6);
    for (const l of labels) expect(l).toMatch(/^공공누리 /);
    expect(licenseBadge("kogl_1")).toBe(LICENSE_TYPE_LABELS.kogl_1);
    expect(licenseBadge("kogl_5")).toBeNull();
    expect(licenseBadge(null)).toBeNull();
    expect(licenseBadge("")).toBeNull();
  });
  test("자료 종류 글자 — 씨앗 6종은 한국어, 편집국이 더한 종류는 키 그대로", () => {
    expect(Object.keys(SOURCE_TYPE_LABELS)).toEqual([...OFFICIAL_SOURCE_TYPES]);
    expect(sourceTypeLabel("notice")).toBe("고시");
    expect(sourceTypeLabel("public_property")).toBe("public_property");
  });
});

describe("운영 설정 검사 — official_source_types (REG1-07)", () => {
  test("씨앗·편집국이 더한 종류는 통과", () => {
    expect(officialSourceTypesErrors([...OFFICIAL_SOURCE_TYPES])).toEqual([]);
    expect(officialSourceTypesErrors(["notice", "public_property"])).toEqual([]);
  });
  test("차단 4종은 하나씩 모두 거부 — 자리 번호와 REG1-07 코드 고정", () => {
    for (const t of BLOCKED_OFFICIAL_SOURCE_TYPES) {
      const e = officialSourceTypesErrors(["notice", t]);
      expect(e).toHaveLength(1);
      expect(e[0]).toMatch(/^\[1\]: /);
      expect(e[0]).toMatch(/REG1-07 코드 고정/);
    }
  });
  test("빈 목록·목록 아님·51개·형식 밖 글자·중복 거부", () => {
    expect(officialSourceTypesErrors([])).toHaveLength(1);
    expect(officialSourceTypesErrors({ notice: true })).toHaveLength(1);
    expect(officialSourceTypesErrors(Array.from({ length: 51 }, (_, i) => `type_${i}`))).toHaveLength(1);
    expect(officialSourceTypesErrors(["Notice", "a", "x".repeat(41), 3])).toEqual([
      "[0]: 영문 소문자·숫자·_ 2~40자입니다",
      "[1]: 영문 소문자·숫자·_ 2~40자입니다",
      "[2]: 영문 소문자·숫자·_ 2~40자입니다",
      "[3]: 영문 소문자·숫자·_ 2~40자입니다",
    ]);
    expect(officialSourceTypesErrors(["notice", "notice"])).toEqual(["[1]: notice가 앞에 이미 있습니다"]);
  });
  test("읽기 — 모양이 틀리면 null(부르는 쪽이 씨앗으로 닫힌다)", () => {
    expect(parseOfficialSourceTypes(["notice"])).toEqual(["notice"]);
    expect(parseOfficialSourceTypes(["tourism"])).toBeNull();
    expect(parseOfficialSourceTypes(undefined)).toBeNull();
  });
});

describe("운영 설정 검사 — kogl_usage (PR-07 · 12장 #13)", () => {
  test("씨앗 통과, 법률 검토 뒤 제2·3유형 열기 통과", () => {
    expect(koglUsageErrors(KOGL_USAGE_DEFAULT)).toEqual([]);
    expect(koglUsageErrors({ photoTypes: ["kogl_1", "kogl_2", "kogl_3", "not_applicable"], fullTextTypes: ["kogl_1"] })).toEqual([]);
  });
  test("제4유형·미표시는 사진·전재 어느 쪽에도 못 넣는다 (코드 고정)", () => {
    for (const t of ["kogl_4", "unmarked"]) {
      expect(koglUsageErrors({ photoTypes: [t], fullTextTypes: [] })).toEqual([expect.stringMatching(new RegExp(`^photoTypes\\[0\\]: .*\\(${t}\\).*PR-07 코드 고정`))]);
      expect(koglUsageErrors({ photoTypes: [], fullTextTypes: [t] })).toEqual([expect.stringMatching(/^fullTextTypes\[0\]: .*PR-07 코드 고정/)]);
    }
  });
  test("전재에 '해당 없음'은 넣지 않는다(자체 자료는 늘 됨), 모르는 칸·빠진 칸·중복 거부", () => {
    expect(koglUsageErrors({ photoTypes: [], fullTextTypes: ["not_applicable"] })).toEqual(["fullTextTypes[0]: kogl_1·kogl_2·kogl_3 중 하나여야 합니다"]);
    expect(koglUsageErrors({ photoTypes: [], fullTextTypes: [], extra: [] })).toEqual(["extra: 모르는 칸입니다 — photoTypes·fullTextTypes만 씁니다"]);
    expect(koglUsageErrors({ photoTypes: [] })).toEqual(["fullTextTypes: 유형 목록이어야 합니다"]);
    expect(koglUsageErrors({ photoTypes: ["kogl_1", "kogl_1"], fullTextTypes: [] })).toEqual(["photoTypes[1]: kogl_1가 앞에 이미 있습니다"]);
    expect(koglUsageErrors(["kogl_1"])).toHaveLength(1);
  });
  test("읽기 — 모양이 틀리면 null(부르는 쪽이 KOGL_USAGE_DEFAULT로 닫힌다)", () => {
    expect(parseKoglUsage({ photoTypes: ["kogl_1"], fullTextTypes: [] })).toEqual({ photoTypes: ["kogl_1"], fullTextTypes: [] });
    expect(parseKoglUsage({ photoTypes: ["unmarked"], fullTextTypes: [] })).toBeNull();
    expect(parseKoglUsage(undefined)).toBeNull();
  });
});

describe("운영 설정 화면 — 두 키가 같은 검사를 쓴다", () => {
  test("SETTING_SPECS.official_source_types · kogl_usage", () => {
    expect(SETTING_SPECS.official_source_types!.check(["notice", "restaurant"], null)).toEqual(officialSourceTypesErrors(["notice", "restaurant"]));
    expect(SETTING_SPECS.official_source_types!.check(["notice", "restaurant"], null)).toHaveLength(1);
    expect(SETTING_SPECS.kogl_usage!.check({ photoTypes: ["kogl_4"], fullTextTypes: [] }, null)).toHaveLength(1);
    expect(SETTING_SPECS.kogl_usage!.check(KOGL_USAGE_DEFAULT, null)).toEqual([]);
  });
});
