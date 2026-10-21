// W4 1단계 2.6 3 분류 — 가짜 원본의 분류 수(시·도·시·군·구·일반구·하위 제외)가 기대값과 같다 · 0인 분류 → 중단 · 일반구의 상위 시 없음 → 중단
// 시험 자료 자체 점검 — 견본의 시·도 17은 W2-b 씨앗과 같고, 그 밖의 코드는 모두 접두 99(가짜)다
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { FIX, SEED, textOf, problemsOf } from "./regions-fixtures.mjs";
import { parseSource } from "../regions/parse.mjs";
import { classOf, classCountsJson, classify, classifyRows } from "../regions/classify.mjs";

const rowsOf = (name) => parseSource(textOf(name)).rows;

test("시험 자료 — 견본의 실제 코드는 W2-b 시·도 17 씨앗뿐(코드·이름 같음), 나머지는 모두 접두 99", () => {
  const seedCodes = new Map(SEED.map((s) => [s.code, s.name]));
  assert.equal(seedCodes.size, 17);
  for (const name of fs.readdirSync(FIX).filter((n) => n.endsWith(".txt") && !n.includes("cp949"))) {
    for (const line of textOf(name).split("\n").slice(1)) {
      const [code, full] = line.split("\t");
      if (!code || !/^\d+$/.test(code.trim())) continue;
      if (seedCodes.has(code)) assert.equal(full, seedCodes.get(code), `${name}: ${code}`);
      else assert.ok(code.startsWith("99"), `${name}: ${code}는 가짜 접두 99가 아니다`);
    }
  }
  const v1Seed = rowsOf("v1.utf8.txt").filter((r) => !r.code.startsWith("99"));
  assert.deepEqual(v1Seed.map((r) => [r.code, r.fullName]), SEED.map((s) => [s.code, s.name]));
});

test("v1 분류 수 = 기대값 (sido 18 · sigungu 7 · general_gu 2 · sub_district 5, 존재·폐지 나눠서)", () => {
  const { counts, rows } = classify(rowsOf("v1.utf8.txt"));
  assert.deepEqual(counts, {
    sido: { active: 18, retired: 0, total: 18 },
    sigungu: { active: 6, retired: 1, total: 7 },
    general_gu: { active: 2, retired: 0, total: 2 },
    sub_district: { active: 4, retired: 1, total: 5 },
  });
  assert.deepEqual(classCountsJson(counts), { sido: 18, sigungu: 7, general_gu: 2, sub_district: 5 });
  assert.equal(Object.values(classCountsJson(counts)).reduce((a, b) => a + b), rows.length, "분류 수 합 = 행 수");
  const by = Object.fromEntries(rows.map((r) => [r.code, r]));
  assert.deepEqual(Object.keys(by).filter((c) => by[c].rowClass === "general_gu"), ["9911100000", "9911300000"]);
  assert.deepEqual(
    Object.keys(by).filter((c) => c.startsWith("99") && by[c].rowClass === "sigungu"),
    ["9911000000", "9913000000", "9915000000", "9917000000", "9919000000", "9920000000", "9922000000"],
  );
  // 이름 — 상위 이름을 뗀 자기 이름
  assert.equal(by["9911000000"].name, "가상시");
  assert.equal(by["9911100000"].name, "시험구");
  assert.equal(by["9911100000"].cityName, "가상시");
  assert.equal(by["9911100000"].cityCode, "9911000000");
  assert.equal(by["9900000000"].name, "가상도");
  assert.equal(by["9913000000"].sidoCode, "9900000000");
});

test("분류 규칙(가설) — 코드 모양별", () => {
  const codes = new Set(["9900000000", "9911000000", "9911100000"]);
  assert.equal(classOf("9900000000", codes), "sido");
  assert.equal(classOf("9911000000", codes), "sigungu");
  assert.equal(classOf("9911100000", codes), "general_gu", "5번째 자리 ≠ 0 + 앞 4자리 + 0 시 있음");
  assert.equal(classOf("9911300000", codes), "general_gu", "상위 시가 원본에 있으면 일반구");
  assert.equal(classOf("9913100000", codes), null, "상위 시(9913000000) 없음");
  assert.equal(classOf("9911101000", codes), "sub_district");
  assert.equal(classOf("9911000001", codes), "sub_district");
  assert.equal(classOf("9900010000", codes), "sub_district", "3~5자리 000이면 시·군·구 후보가 아니다");
});

test("일반구 모양인데 상위 시가 없으면 중단 + 줄 번호", () => {
  const p = problemsOf(() => classify(rowsOf("general-gu-no-city.txt")));
  assert.ok(p.some((x) => x.code === "GENERAL_GU_NO_CITY" && x.line === 3 && /9911000000/.test(x.detail)), JSON.stringify(p));
});

test("분류 수가 0인 분류가 있으면 중단 — 어느 분류가 0인지 적는다", () => {
  const p = problemsOf(() => classify(rowsOf("orphan.txt")));
  assert.deepEqual(p.map((x) => [x.code, x.detail]), [["CLASS_EMPTY", "general_gu 0행"]]);
  // 분류만(중단 없이) 돌리면 수를 그대로 낸다 — 작은 견본의 검증 시험용 흐름
  const { counts } = classifyRows(rowsOf("orphan.txt"));
  assert.equal(counts.general_gu.total, 0);
  assert.equal(counts.sigungu.active, 1);
});
