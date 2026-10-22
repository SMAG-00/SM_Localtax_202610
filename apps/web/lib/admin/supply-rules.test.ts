// 분양 정보 관리 규칙 (W4 17단계 — docs/dev/W4_설계.md 1장 17단계 · 2.1 · 3장 · 12장 #11·#140~, PRD-01B PR-04 · PR-05)
// 분양 정보·지역·공고 기관은 모두 시험용 가짜다. DB 제약·트리거(마이그레이션 …51)와 같은 규칙인지는 DB 시험 w4-supply.test.mjs가 같은 견본으로 본다.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { LICENSE_TYPES } from "@ltr/editorial";
import {
  SUPPLY_FIELDS,
  SUPPLY_LIMITS,
  SUPPLY_OPS,
  SUPPLY_PRICE_AMOUNT_RE,
  SUPPLY_PUBLISH_TARGETS,
  SUPPLY_STATUSES,
  parseSupplyInput,
  parseSupplyPublish,
  supplyPublishErrors,
  supplyRegionErrors,
  supplyTextHasPrice,
} from "./supply-rules";
import { errorsByField } from "./project-rules";

const ROOT = path.resolve(__dirname, "../../../..");
const DESIGN = fs.readFileSync(path.join(ROOT, "docs", "dev", "W4_설계.md"), "utf8");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages", "db", "supabase", "migrations", "20261023000051_w4_supply_notices.sql"), "utf8");
const row = (prefix: string) => {
  const line = DESIGN.split("\n").find((l) => l.startsWith(prefix));
  if (!line) throw new Error(`설계 문서에 '${prefix}' 줄이 없다`);
  return line;
};
const codes = (line: string) => [...line.split("|")[2]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

/** 금액·가격 표현 견본 — DB 시험(w4-supply.test.mjs PRICE_TEXT_SAMPLES)과 같은 견본 */
const PRICE_TEXT_SAMPLES: [string, boolean][] = [
  ["총 820세대 중 일반공급 410세대", false],
  ["시험용 하늘마을 1단지", false],
  ["3억 5,000만원", true],
  ["5,000만 원부터", true],
  ["12,000원", true],
  ["원문 3건 확인", false],
  ["원본 2부", false],
  ["분양가 공개 예정", true],
  ["시세보다 낮게", true],
  ["프리미엄 단지", true],
  ["웃돈 기대", true],
  ["수익 보장", true],
  ["가격 안내", true],
  ["전용 84㎡ 120세대", false],
  ["청약 경쟁률 12%", false],
];

const TODAY = "2026-10-23";
const VALID = { valid_from: null, valid_to: null };
const ctx = { today: TODAY, region: VALID, projectExists: true };
const FULL = {
  name: "시험용 하늘마을 분양",
  region_code: "9901100000",
  supply_scale: "총 820세대 중 일반공급 410세대",
  apply_start: "2026-11-02",
  apply_end: "2026-11-04",
  notice_date: "2026-10-26",
  notice_issuer: "시험용 하늘구청",
  official_notice_url: "https://gov.example.test/supply/1",
  license_type: "kogl_1",
};

describe("값 목록 = 설계 2.1 = 마이그레이션 …51", () => {
  test("supply_notice.status = draft·public·hidden (설계 줄·DB check와 같다)", () => {
    expect([...SUPPLY_STATUSES]).toEqual(codes(row("| supply_notice.status |")));
    expect(MIGRATION).toContain("status text not null default 'draft' check (status in ('draft', 'public', 'hidden'))");
    expect([...SUPPLY_PUBLISH_TARGETS]).toEqual(["public", "hidden"]);
    expect([...SUPPLY_OPS]).toEqual(["create", "update", "publish"]);
  });
  test("공공누리 유형 = DB check 6값 · 글자 한도 = DB check 숫자", () => {
    expect(MIGRATION).toContain(`license_type text not null check (license_type in (${LICENSE_TYPES.map((t) => `'${t}'`).join(", ")}))`);
    expect(MIGRATION).toContain(`length(btrim(name)) between 1 and ${SUPPLY_LIMITS.name}`);
    expect(MIGRATION).toContain(`length(btrim(supply_scale)) between 1 and ${SUPPLY_LIMITS.supplyScale}`);
    expect(MIGRATION).toContain(`length(btrim(notice_issuer)) between 1 and ${SUPPLY_LIMITS.issuer}`);
    expect(MIGRATION).toContain(`length(official_notice_url) <= ${SUPPLY_LIMITS.url}`);
  });
  test("받는 칸 = 표 칸(작성자·상태·확인일·시각 빼고)이고 가격 사전 낱말이 든 칸 0", () => {
    const table = /create table public\.supply_notices \(([\s\S]*?)\n\);/.exec(MIGRATION)![1]!;
    const columns = [...table.matchAll(/^ {2}([a-z_]+) /gm)].map((m) => m[1]!).filter((c) => c !== "constraint");
    expect(columns).toEqual(["id", ...SUPPLY_FIELDS.slice(0, 4), "apply_start", "apply_end", "notice_date", "notice_issuer", "official_notice_url", "verified_at", "license_type", "status", "created_by", "updated_by", "created_at", "updated_at"]);
    expect(columns.filter((c) => /price|cost|contribution|yield|return|profit|premium|market|appraisal|saleamount|bunyang/.test(c.replaceAll("_", "")))).toEqual([]);
  });
});

describe("금액·가격 표현 (DB supply_text_has_price와 같은 식)", () => {
  test("견본 15 — 숫자 + 원·가격 낱말은 잡고, 세대 수·원문·원본·비율은 잡지 않는다", () => {
    expect(PRICE_TEXT_SAMPLES.map(([t]) => [t, supplyTextHasPrice(t)])).toEqual(PRICE_TEXT_SAMPLES);
    expect(supplyTextHasPrice(null)).toBe(false);
  });
  test("식이 마이그레이션과 같은 모양이다", () => {
    expect(MIGRATION).toContain("~ '[0-9][0-9,.]*([[:space:]]*(조|억|천|백|만))*[[:space:]]*원(?!문|본)'");
    expect(MIGRATION).toContain("~ '(분양가|분담금|시세|프리미엄|웃돈|수익|가격)'");
    expect(SUPPLY_PRICE_AMOUNT_RE.source).toBe("[0-9][0-9,.]*(\\s*(조|억|천|백|만))*\\s*원(?!문|본)");
  });
});

describe("만들기·고치기 입력", () => {
  test("빠짐없는 입력 → 칸 값 그대로(앞뒤 공백 정리)·연결 프로젝트 없음 = null", () => {
    const r = parseSupplyInput({ op: "create", ...FULL, name: "  시험용 하늘마을 분양 " }, ctx);
    expect(r).toEqual({ ok: true, value: { ...FULL, project_id: null } });
  });
  test("필수 칸 각각 — 사업명·지역·청약 시작·마감·모집공고일·공고 기관·공식 공고 주소·공공누리 유형 빈 값마다 그 칸 하나", () => {
    for (const k of ["name", "region_code", "apply_start", "apply_end", "notice_date", "notice_issuer", "official_notice_url", "license_type"] as const) {
      const r = parseSupplyInput({ ...FULL, [k]: "" }, ctx);
      expect(r.ok, k).toBe(false);
      if (!r.ok) expect(Object.keys(errorsByField(r.errors)), k).toEqual([k]);
    }
    const noScale = parseSupplyInput({ ...FULL, supply_scale: "" }, ctx);
    expect(noScale.ok && noScale.value.supply_scale).toBe(null);
  });
  test("모양 — 주소 http(s)·날짜·10자리 코드·공공누리 6값·마감 < 시작·한도 넘김", () => {
    const fields = (over: Record<string, unknown>) => {
      const r = parseSupplyInput({ ...FULL, ...over }, ctx);
      return r.ok ? [] : Object.keys(errorsByField(r.errors));
    };
    expect(fields({ official_notice_url: "ftp://gov.example.test/x" })).toEqual(["official_notice_url"]);
    expect(fields({ official_notice_url: `https://gov.example.test/${"a".repeat(480)}` })).toEqual(["official_notice_url"]);
    expect(fields({ apply_start: "2026-13-01" })).toEqual(["apply_start"]);
    expect(fields({ notice_date: "2026/10/26" })).toEqual(["notice_date"]);
    expect(fields({ region_code: "99011" })).toEqual(["region_code"]);
    expect(fields({ license_type: "kogl_5" })).toEqual(["license_type"]);
    expect(fields({ apply_end: "2026-11-01" })).toEqual(["apply_end"]);
    expect(fields({ apply_end: "2026-11-02" })).toEqual([]);
    expect(fields({ name: "가".repeat(121) })).toEqual(["name"]);
    expect(fields({ name: "가".repeat(120) })).toEqual([]);
    expect(fields({ notice_issuer: "가".repeat(81) })).toEqual(["notice_issuer"]);
  });
  test("가격 칸 이름(분양가·supply_price·expected_return)은 받지 않고 그 칸마다 422 문장 · 모르는 칸도 422", () => {
    const r = parseSupplyInput({ ...FULL, supply_price: 1, "분양가": "x", expected_return: 3, memo: "x" }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(errorsByField(r.errors))).toEqual(["supply_price", "분양가", "expected_return", "memo"]);
      expect(r.errors.slice(0, 3).every((e) => e.includes("분양 정보에 저장하지 않습니다") && e.includes("PR-05"))).toBe(true);
      expect(r.errors[3]).toBe("memo: 받지 않는 칸입니다");
    }
  });
  test("사업명·공급 규모·공고 기관 글자에 금액·가격 표현 → 그 칸 422 (공식 공고 링크로만 — 12장 #11)", () => {
    for (const [k, v] of [
      ["name", "시험용 하늘마을 분양가 3억"],
      ["supply_scale", "84㎡ 5억 2,000만원"],
      ["notice_issuer", "시세 안내 센터"],
    ] as const) {
      const r = parseSupplyInput({ ...FULL, [k]: v }, ctx);
      expect(r.ok, k).toBe(false);
      if (!r.ok) expect(errorsByField(r.errors)[k]?.[0]).toContain("가격을 싣지 않고 공식 공고 링크로만");
    }
  });
  test("지역 — 오늘 유효한 행정구역만 (폐지 어제 거부·폐지 오늘 받음·시작 내일 거부·없는 코드)", () => {
    expect(supplyRegionErrors("9901100000", { valid_from: null, valid_to: "2026-10-22" }, TODAY)).toEqual(["region_code: 오늘 유효한 행정구역이 아닙니다 (폐지·아직 시작 전)"]);
    expect(supplyRegionErrors("9901100000", { valid_from: null, valid_to: TODAY }, TODAY)).toEqual([]);
    expect(supplyRegionErrors("9901100000", { valid_from: "2026-10-24", valid_to: null }, TODAY)).toHaveLength(1);
    expect(supplyRegionErrors("9901100000", null, TODAY)).toEqual(["region_code: 없는 행정구역 코드입니다"]);
    const r = parseSupplyInput(FULL, { ...ctx, region: null });
    expect(r.ok ? [] : r.errors).toEqual(["region_code: 없는 행정구역 코드입니다"]);
  });
  test("연결 프로젝트 — 번호 모양·없는 프로젝트 422, 비우면 잇지 않음", () => {
    const bad = parseSupplyInput({ ...FULL, project_id: "abc" }, ctx);
    expect(bad.ok ? [] : Object.keys(errorsByField(bad.errors))).toEqual(["project_id"]);
    const missing = parseSupplyInput({ ...FULL, project_id: 77 }, { ...ctx, projectExists: false });
    expect(missing.ok ? [] : missing.errors).toEqual(["project_id: 그런 프로젝트가 없습니다"]);
    const ok = parseSupplyInput({ ...FULL, project_id: "77" }, ctx);
    expect(ok.ok && ok.value.project_id).toBe(77);
  });
  test("고치기 — 기존 값 위에 보낸 칸만 바꾼다", () => {
    const base = { ...FULL, project_id: null, license_type: "kogl_1" as const };
    const r = parseSupplyInput({ op: "update", id: 3, apply_end: "2026-11-05" }, ctx, base);
    expect(r).toEqual({ ok: true, value: { ...base, apply_end: "2026-11-05" } });
  });
});

describe("공개 조건", () => {
  test("공개는 확인일·공급 규모 — 칸마다 문장 (DB 제약 supply_notices_public_record와 같다)", () => {
    expect(supplyPublishErrors({ supply_scale: "총 10세대", verified_at: "2026-10-23T00:00:00Z" })).toEqual([]);
    expect(Object.keys(errorsByField(supplyPublishErrors({ supply_scale: null, verified_at: null })))).toEqual(["supply_scale", "verified"]);
    expect(MIGRATION).toContain("constraint supply_notices_public_record check (status <> 'public' or (verified_at is not null and supply_scale is not null))");
  });
  test("공개 전환 입력 — 번호·대상(public·hidden)·확인 표시", () => {
    expect(parseSupplyPublish({ id: 4, status: "public", verified: true })).toEqual({ ok: true, value: { id: 4, status: "public", verified: true } });
    expect(parseSupplyPublish({ id: "4", status: "hidden" })).toEqual({ ok: true, value: { id: 4, status: "hidden", verified: false } });
    const bad = parseSupplyPublish({ status: "draft", verified: "yes" });
    expect(bad.ok ? [] : Object.keys(errorsByField(bad.errors))).toEqual(["id", "status", "verified"]);
  });
});
