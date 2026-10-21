// W4 1단계 2.6 4 검증 — 부모 시·도 없는 시·군·구 → 중단 · W2-b 시·도 17 씨앗과 코드·이름이 다르면 중단 · 시·도와 이름이 같은 하위 행(12장 #5)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SEED, SEED_PLUS, FICTIONAL_SIDO, SIDO_SEED_MIGRATION_PATH, fix, textOf, problemsOf } from "./regions-fixtures.mjs";
import { parseSource } from "../regions/parse.mjs";
import { classifyRows } from "../regions/classify.mjs";
import { loadSidoSeed, readSidoSeed, validate, validateRows } from "../regions/validate.mjs";

const classified = (text) => classifyRows(parseSource(text).rows).rows;

test("W2-b 씨앗 마이그레이션에서 시·도 17을 읽는다 — 코드·이름·slug·별칭", () => {
  const seed = readSidoSeed(fs.readFileSync(SIDO_SEED_MIGRATION_PATH, "utf8"));
  assert.equal(seed.length, 17);
  assert.deepEqual(seed[0], { code: "1100000000", name: "서울특별시", slug: "seoul", aliases: ["서울"] });
  assert.deepEqual(seed.find((s) => s.code === "5100000000").aliases, ["강원", "강원도"]);
  assert.equal(new Set(seed.map((s) => s.slug)).size, 17);
  assert.deepEqual(SEED, seed);
  assert.throws(() => loadSidoSeed([SIDO_SEED_MIGRATION_PATH, SIDO_SEED_MIGRATION_PATH]), /두 번/);
  assert.deepEqual(FICTIONAL_SIDO, [{ code: "9900000000", name: "가상도", slug: "gasang-do", aliases: ["가상"] }]);
  assert.throws(() => loadSidoSeed([fix("v2.successors.csv")]), /하나도 읽지 못했습니다/);
});

test("v1 — 기준 시·도(씨앗 17 + 가짜 1)와 맞으면 넣을 지역: 시·도 18 · 시·군·구 6('존재'만) · 일반구 2(행 아님)", () => {
  const { desired, problems } = validateRows(classified(textOf("v1.utf8.txt")), { expectedSido: SEED_PLUS });
  assert.deepEqual(problems, []);
  assert.equal(desired.sido.length, 18);
  assert.deepEqual(desired.sigungu.map((s) => s.code), ["9911000000", "9913000000", "9915000000", "9917000000", "9919000000", "9920000000"]);
  assert.ok(!desired.sigungu.some((s) => s.code === "9922000000"), "폐지 행은 넣지 않는다");
  assert.deepEqual(desired.generalGu.map((g) => [g.code, g.cityCode, g.name]), [["9911100000", "9911000000", "시험구"], ["9911300000", "9911000000", "모의구"]]);
  assert.deepEqual(desired.sido.find((s) => s.code === "1100000000"), { code: "1100000000", name: "서울특별시", slug: "seoul", aliases: ["서울"] });
});

test("시·도 씨앗과 다르면 중단 — 이름 다름(줄 번호) · 씨앗 시·도 빠짐 · 씨앗에 없는 '존재' 시·도 · 씨앗 시·도가 폐지", () => {
  const v1 = textOf("v1.utf8.txt");
  const renamed = problemsOf(() => validate(classified(v1.replace("1100000000\t서울특별시", "1100000000\t서울시")), { expectedSido: SEED_PLUS }));
  assert.deepEqual(renamed.map((p) => [p.code, p.line]), [["SEED_MISMATCH", 2]]);
  assert.match(renamed[0].detail, /씨앗 '서울특별시' · 원본 '서울시'/);
  const missing = problemsOf(() => validate(classified(v1.replace("2600000000\t부산광역시\t존재\n", "")), { expectedSido: SEED_PLUS }));
  assert.deepEqual(missing.map((p) => p.code), ["SEED_MISMATCH"]);
  assert.match(missing[0].detail, /2600000000 부산광역시이 원본에 없습니다/);
  const extra = problemsOf(() => validate(classified(v1), { expectedSido: SEED }));
  assert.deepEqual(extra.map((p) => [p.code, p.line]), [["SEED_MISMATCH", 19]]);
  assert.match(extra[0].detail, /9900000000 가상도이 씨앗에 없습니다/);
  const retired = problemsOf(() => validate(classified(v1.replace("2700000000\t대구광역시\t존재", "2700000000\t대구광역시\t폐지")), { expectedSido: SEED_PLUS }));
  assert.ok(retired.some((p) => p.code === "SEED_MISMATCH" && /'존재' 시·도가 아닙니다/.test(p.detail)), JSON.stringify(retired));
  assert.throws(() => validateRows(classified(v1), { expectedSido: [] }), /기준 시·도/);
});

test("부모 시·도 없는(폐지된) '존재' 시·군·구 → 중단 + 줄 번호", () => {
  const p = problemsOf(() => validate(classified(textOf("orphan.txt")), { expectedSido: FICTIONAL_SIDO }));
  assert.ok(p.some((x) => x.code === "PARENT_MISSING" && x.line === 3 && /시·도 9900000000 폐지/.test(x.detail)), JSON.stringify(p));
  // 시·도 행 자체가 없는 경우
  const none = problemsOf(() => validate(classified("법정동코드\t법정동명\t폐지여부\n9911000000\t가상도 가상시\t존재\n"), { expectedSido: FICTIONAL_SIDO }));
  assert.ok(none.some((x) => x.code === "PARENT_MISSING" && /없음/.test(x.detail)), JSON.stringify(none));
});

test("'존재' 일반구의 상위 시가 폐지면 중단", () => {
  const text = textOf("v1.utf8.txt").replace("9911000000\t가상도 가상시\t존재", "9911000000\t가상도 가상시\t폐지");
  const p = problemsOf(() => validate(classified(text), { expectedSido: SEED_PLUS }));
  assert.deepEqual(p.map((x) => [x.code, x.line]), [["GENERAL_GU_CITY_RETIRED", 21], ["GENERAL_GU_CITY_RETIRED", 23]]);
});

test("시·도와 이름이 같은 하위 행 — 권고 기본값은 넣지 않고 참고에 남김, 설정 sigungu면 시·군·구 행", () => {
  const rows = classified(textOf("same-name-child.txt"));
  const sido = [{ code: "9900000000", name: "가상특별자치시", slug: "gasang", aliases: [] }];
  const def = validateRows(rows, { expectedSido: sido });
  assert.deepEqual(def.problems, []);
  assert.deepEqual(def.desired.sigungu, []);
  assert.equal(def.notes.length, 1);
  assert.match(def.notes[0], /9911000000 가상특별자치시 — 넣지 않고/);
  const asRow = validateRows(rows, { expectedSido: sido, sameNameChild: "sigungu" });
  assert.deepEqual(asRow.desired.sigungu.map((s) => [s.code, s.name]), [["9911000000", "가상특별자치시"]]);
  assert.throws(() => validateRows(rows, { expectedSido: sido, sameNameChild: "skip" }), /같은 이름 하위 행/);
});
