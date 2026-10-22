// 원문 변경·시점 만료 검수 큐 규칙 (W4 6단계 — docs/dev/W4_설계.md 1장 6단계 · 2.1 · 2.2 · 2.3 · 12장 #23, PRD-01B REG1-13)
//  · 값 목록 = 설계 2.1 글자 = 마이그레이션 …42 check · 만료 기준 씨앗 = 2.2(365)
//  · 만료 경계 — 한국 날짜 기준 365일째 false · 366일째 true (00:30 KST = 전날 15:30 UTC 확인도 한국 날짜로), 윤년, 실행 키 = 한국 날짜
//  · 입력 검사 — 다시 받기(출처 번호·붙여 넣은 원문) · 해결(항목 번호·메모·reverify) · 설정 값(1~3650 정수)
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { SETTING_SPECS } from "@/lib/admin/settings-rules";
import {
  EXPIRY_DAYS_DEFAULT,
  NOTE_MAX,
  SOURCE_REVIEW_REASONS,
  SOURCE_REVIEW_STATUSES,
  SOURCE_REVIEW_TARGETS,
  elapsedKstDays,
  expiresOn,
  expiryDaysErrors,
  expiryDaysOf,
  isExpired,
  isSnapshotHash,
  parseRefetch,
  parseResolve,
  parseSourceRef,
  runKeyOf,
} from "./rules";

const ROOT = path.resolve(__dirname, "../../../..");
const DESIGN = fs.readFileSync(path.join(ROOT, "docs", "dev", "W4_설계.md"), "utf8");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages", "db", "supabase", "migrations", "20261022000042_w4_source_review.sql"), "utf8");
const row = (prefix: string) => {
  const line = DESIGN.split("\n").find((l) => l.startsWith(prefix));
  if (!line) throw new Error(`설계 문서에 '${prefix}' 줄이 없다`);
  return line;
};
const codes = (line: string) => [...line.split("|")[2]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
const sqlCheck = (column: string) => {
  const m = new RegExp(`${column} text not null (?:default '[a-z_]+' )?check \\(${column} in \\(([^)]+)\\)\\)`).exec(MIGRATION);
  if (!m) throw new Error(`마이그레이션에 ${column} check가 없다`);
  return [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
};

describe("값 목록 = 설계 2.1 · 2.2 = 마이그레이션 …42 = 코드 상수", () => {
  test("대상 3종·사유 2종·상태 2종", () => {
    expect(codes(row("| source_review.target |"))).toEqual([...SOURCE_REVIEW_TARGETS]);
    expect(codes(row("| source_review.reason |"))).toEqual([...SOURCE_REVIEW_REASONS]);
    expect(codes(row("| source_review.status |"))).toEqual([...SOURCE_REVIEW_STATUSES]);
    expect(sqlCheck("target_type")).toEqual([...SOURCE_REVIEW_TARGETS]);
    expect(sqlCheck("reason")).toEqual([...SOURCE_REVIEW_REASONS]);
    expect(sqlCheck("status")).toEqual([...SOURCE_REVIEW_STATUSES]);
  });
  test("만료 기준 씨앗 365 = 2.2 = 마이그레이션 씨앗, 한도 2.3 '기준 당일 0건, 하루 넘김 1건'", () => {
    expect(codes(row("| `official_source_expiry_days` |"))).toEqual([String(EXPIRY_DAYS_DEFAULT)]);
    expect(EXPIRY_DAYS_DEFAULT).toBe(365);
    expect(MIGRATION).toContain("('official_source_expiry_days', '365'::jsonb");
    expect(row("| 시점 만료·오래된 통계 |")).toContain("기준 당일 0건, 하루 넘김 1건");
  });
});

describe("만료 경계 (한국 날짜)", () => {
  test("365일째 0 · 366일째 1 · 364일째 0", () => {
    const today = "2027-10-22";
    expect(elapsedKstDays("2026-10-22T10:00:00+09:00", today)).toBe(365);
    expect(isExpired("2026-10-22T10:00:00+09:00", today, 365)).toBe(false);
    expect(isExpired("2026-10-21T10:00:00+09:00", today, 365)).toBe(true);
    expect(isExpired("2026-10-23T10:00:00+09:00", today, 365)).toBe(false);
  });
  test("00:30 KST(전날 15:30 UTC) 확인은 한국 날짜로 — UTC 날짜로 재면 하루 더 지난 것으로 잘못 잡힌다", () => {
    const verified = "2026-10-21T15:30:00Z"; // = 2026-10-22 00:30 KST
    expect(elapsedKstDays(verified, "2027-10-22")).toBe(365);
    expect(isExpired(verified, "2027-10-22", 365)).toBe(false);
    expect(isExpired(verified, "2027-10-23", 365)).toBe(true);
    // 23:59 KST = 같은 날 14:59 UTC
    expect(elapsedKstDays("2026-10-22T14:59:00Z", "2027-10-22")).toBe(365);
  });
  test("윤년 — 2027-10-24 확인 → 2028-10-23이 365일째(0), 2028-10-24가 첫 만료일", () => {
    expect(elapsedKstDays("2027-10-24T09:00:00+09:00", "2028-10-23")).toBe(365);
    expect(expiresOn("2027-10-24T09:00:00+09:00", 365)).toBe("2028-10-24");
    expect(expiresOn("2026-10-21T15:30:00Z", 365)).toBe("2027-10-23");
    expect(expiresOn("2026-10-22T09:00:00+09:00", 30)).toBe("2026-11-22");
  });
  test("읽을 수 없는 확인일·날짜 → 만료 아님(null·'')", () => {
    expect(elapsedKstDays(null, "2027-10-22")).toBeNull();
    expect(elapsedKstDays("어제", "2027-10-22")).toBeNull();
    expect(elapsedKstDays("2026-10-22T10:00:00+09:00", "2027/10/22")).toBeNull();
    expect(isExpired(undefined, "2027-10-22", 365)).toBe(false);
    expect(expiresOn("", 365)).toBe("");
  });
  test("실행 키 = 한국 날짜 — 15:00 UTC부터 다음 날", () => {
    expect(runKeyOf(new Date("2026-10-22T14:59:59Z"))).toBe("2026-10-22");
    expect(runKeyOf(new Date("2026-10-22T15:00:00Z"))).toBe("2026-10-23");
  });
});

describe("설정 값 official_source_expiry_days", () => {
  test("1~3650 정수만", () => {
    for (const ok of [1, 30, 365, 3650]) expect(expiryDaysErrors(ok)).toEqual([]);
    for (const bad of [0, 3651, 365.5, "365", null, [365], -1]) expect(expiryDaysErrors(bad)).toHaveLength(1);
  });
  test("틀린 저장값은 씨앗 365로 (DB 배치 함수와 같은 대체)", () => {
    expect(expiryDaysOf(30)).toBe(30);
    expect(expiryDaysOf("30")).toBe(365);
    expect(expiryDaysOf(undefined)).toBe(365);
  });
  test("운영 설정 화면·API가 같은 검사를 쓴다", () => {
    const spec = SETTING_SPECS.official_source_expiry_days;
    expect(spec).toBeDefined();
    expect(spec!.check(30, 365)).toEqual([]);
    expect(spec!.check(0, 365)).toHaveLength(1);
  });
});

describe("입력 검사", () => {
  test("출처 번호 — 숫자·'src:N'·숫자 글자, 0·음수·모양 밖 거부", () => {
    expect(parseSourceRef(12)).toBe(12);
    expect(parseSourceRef("src:34")).toBe(34);
    expect(parseSourceRef(" 56 ")).toBe(56);
    for (const bad of [0, -1, 1.5, "src:", "src:x", "abc", null, undefined]) expect(parseSourceRef(bad)).toBeNull();
  });
  test("다시 받기 — 출처 번호 필수 · 붙여 넣은 원문은 선택, 빈 글자 거부", () => {
    expect(parseRefetch({ sourceId: "src:7" })).toEqual({ ok: true, value: { sourceId: 7, text: null } });
    expect(parseRefetch({ sourceId: 7, text: "시험용 원문" })).toEqual({ ok: true, value: { sourceId: 7, text: "시험용 원문" } });
    const r = parseRefetch({ text: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.split(":")[0])).toEqual(["sourceId", "text"]);
    expect(parseRefetch("x").ok).toBe(false);
  });
  test("해결 — 항목 번호 필수 · 메모 500자 이하(앞뒤 공백 제거) · reverify 참·거짓", () => {
    expect(parseResolve({ id: 3 })).toEqual({ ok: true, value: { id: 3, note: null, reverify: false } });
    expect(parseResolve({ id: "3", note: "  원문 확인  ", reverify: true })).toEqual({ ok: true, value: { id: 3, note: "원문 확인", reverify: true } });
    const long = parseResolve({ id: 3, note: "가".repeat(NOTE_MAX + 1) });
    expect(long.ok).toBe(false);
    const bad = parseResolve({ reverify: "yes" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => e.split(":")[0])).toEqual(["id", "reverify"]);
  });
  test("원문 해시 모양 — sha256:<64자리 소문자 16진>", () => {
    expect(isSnapshotHash(`sha256:${"a".repeat(64)}`)).toBe(true);
    for (const bad of ["a".repeat(64), `sha256:${"A".repeat(64)}`, `sha256:${"a".repeat(63)}`, `md5:${"a".repeat(64)}`]) expect(isSnapshotHash(bad)).toBe(false);
  });
});
