// W4 2단계 — 전국 행정구역 적재 (docs/dev/W4_설계.md 1장 2단계 · 2.6 · 11.2a, 마이그레이션 20261024000062_w4_regions_data_20260729)
// 원본 = 공공데이터포털 「국토교통부_전국 법정동」 20260729 CSV (저장소에는 파생 파일과 원본 SHA-256만 — PO 결정 #2)
// 로컬 DB(마이그레이션 적용 뒤)와 파생 파일 packages/db/data/regions/regions.derived.20260729.json을 대조한다.
//  ① 적재 기록 1행(해시·행 수·분류 수)  ② 시·도 — 씨앗 17 그대로 + 통합 신설 1, 광주·전남은 폐지+후속  ③ 시·군·구 수·이름·부모 = 파생 파일
//  ④ 부모 없는 시·군·구 0 · (부모, slug) 중복 0 · 예약 이름 0 · slug 모양  ⑤ 시범 지역(서울·부산)과 옛 씨앗 행 그대로
//  ⑥ 일반구는 행이 아니라 상위 시의 별칭  ⑦ 폐지 시·도의 옛 주소 301
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";
import { RESERVED_SLUGS } from "../../../scripts/regions/config.mjs";
import { readSidoSeed } from "../../../scripts/regions/validate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const derived = JSON.parse(fs.readFileSync(path.join(HERE, "..", "data", "regions", "regions.derived.20260729.json"), "utf8"));
const seed = readSidoSeed(fs.readFileSync(path.join(HERE, "..", "supabase", "migrations", "20261018000009_regions.sql"), "utf8"));
const SHA = "e5657d4b53a16f72e42e9c0d91e84ff2d647e70dc56b9408da6fd057d0da45c3";
const NEW_SIDO = "1200000000"; // 전남광주통합특별시 (원본에서 신설 확인)
const RETIRED_SIDO = ["2900000000", "4600000000"]; // 광주광역시·전라남도 — 원본에 행 없음
const SAME_NAME_CHILD = "3611000000"; // 세종특별자치시 세종시 — 시·도와 같은 이름이라 넣지 않음 (12장 #5)

let client;
let regions; // code → row
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
  regions = new Map((await client.query("select code, parent_code, level, name, slug, aliases, valid_to::text as valid_to, successor_code from public.regions")).rows.map((r) => [r.code, r]));
});
after(async () => client?.end());

const byClass = (c) => derived.rows.filter((r) => r.row_class === c);
const sidoRows = () => [...regions.values()].filter((r) => r.level === "sido");
const sigunguRows = () => [...regions.values()].filter((r) => r.level === "sigungu");

test("파생 파일 — 원본 SHA-256·형식 기록, 분류 수 합 = 행 수, 시·도 16 · 시·군·구 230 · 일반구 39", () => {
  assert.equal(derived.source.sha256, SHA);
  assert.equal(derived.source.file_date, "2026-07-29");
  assert.equal(derived.source.format, "molit-csv");
  assert.deepEqual(derived.class_counts, { sido: 16, sigungu: 230, general_gu: 39, sub_district: 20276 });
  assert.equal(Object.values(derived.class_counts).reduce((a, b) => a + b, 0), derived.source.rows_total);
  assert.equal(derived.rows.length, 16 + 230 + 39, "파생 파일에는 하위(읍·면·동·리)를 두지 않는다");
  assert.ok(derived.rows.every((r) => r.status === "존재"));
});

test("적재 기록 — region_import_runs에 이 원본의 applied 1행: 해시·행 수·분류 수·적용자·시각", async () => {
  const { rows } = await client.query("select file_name, file_date::text as file_date, rows_total, class_counts, status, applied_by, applied_at from public.region_import_runs where sha256 = $1", [SHA]);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.status, "applied");
  assert.equal(r.file_name, derived.source.file_name);
  assert.equal(r.file_date, "2026-07-29");
  assert.equal(r.rows_total, derived.source.rows_total);
  assert.deepEqual(r.class_counts, derived.class_counts);
  assert.ok(r.applied_by && r.applied_at);
});

test("시·도 — 씨앗 17이 코드·이름·slug 그대로 남고, 통합 신설 1개가 더해져 18행 (존재 16 · 폐지 2)", () => {
  assert.equal(seed.length, 17);
  for (const s of seed) {
    const r = regions.get(s.code);
    assert.ok(r, `${s.code} ${s.name}`);
    assert.equal(r.level, "sido");
    assert.equal(r.name, s.name);
    assert.equal(r.slug, s.slug);
    assert.equal(r.parent_code, null);
  }
  assert.equal(sidoRows().length, 18);
  const active = sidoRows().filter((r) => r.valid_to === null);
  assert.equal(active.length, 16);
  assert.deepEqual(active.map((r) => r.code).sort(), byClass("sido").map((r) => r.code).sort(), "존재 시·도 = 파생 파일의 시·도");
  const nu = regions.get(NEW_SIDO);
  assert.equal(nu.name, "전남광주통합특별시");
  assert.equal(nu.slug, "jeonnam-gwangju");
});

test("광주광역시·전라남도 — 원본에 행이 없어 폐지(valid_to 2026-06-30), 후속은 전남광주통합특별시 · slug·이름은 그대로", () => {
  for (const code of RETIRED_SIDO) {
    const r = regions.get(code);
    assert.equal(r.valid_to, "2026-06-30", code);
    assert.equal(r.successor_code, NEW_SIDO, code);
  }
  assert.equal(regions.get("2900000000").slug, "gwangju");
  assert.equal(regions.get("4600000000").slug, "jeonnam");
  const aliases = regions.get(NEW_SIDO).aliases;
  assert.ok(aliases.includes("광주광역시") && aliases.includes("전라남도"), `옛 이름이 후속 별칭에: ${aliases}`);
});

test("옛 주소 301 — /local/gwangju · /local/jeonnam → 전남광주통합특별시", async () => {
  const { rows } = await client.query("select old_path, region_code, reason from public.region_slug_redirects where old_path in ('/local/gwangju', '/local/jeonnam') order by old_path");
  assert.deepEqual(rows, [
    { old_path: "/local/gwangju", region_code: NEW_SIDO, reason: "retired" },
    { old_path: "/local/jeonnam", region_code: NEW_SIDO, reason: "retired" },
  ]);
});

test("시·군·구 — 수 = 파생 파일(시·도와 같은 이름의 세종시 1개만 뺌), 코드·이름·부모가 파생 파일과 같다", () => {
  const want = byClass("sigungu").filter((r) => r.code !== SAME_NAME_CHILD);
  assert.equal(want.length, 229);
  assert.equal(sigunguRows().length, want.length);
  for (const w of want) {
    const r = regions.get(w.code);
    assert.ok(r, `${w.code} ${w.full_name}`);
    assert.equal(r.name, w.name, w.code);
    assert.equal(r.parent_code, `${w.code.slice(0, 2)}00000000`, w.code);
    assert.equal(r.valid_to, null, w.code);
  }
  assert.equal(regions.has(SAME_NAME_CHILD), false, "세종시는 시·도 세종특별자치시로 찾는다 (12장 #5 권고)");
  // 제주시·서귀포시는 시·군·구 단계
  assert.deepEqual(["5011000000", "5013000000"].map((c) => regions.get(c)?.name), ["제주시", "서귀포시"]);
});

test("무결성 — 부모 없는 시·군·구 0 · 부모는 존재 시·도 · (부모, slug) 중복 0 · 예약 이름 0 · slug 모양(로마자 + -si/-gun/-gu)", async () => {
  for (const r of sigunguRows()) {
    const p = regions.get(r.parent_code);
    assert.ok(p && p.level === "sido" && p.valid_to === null, `${r.code} ${r.name}의 부모 ${r.parent_code}`);
    assert.match(r.slug, /^[a-z0-9]+(-[a-z0-9]+)*-(si|gun|gu)$/, `${r.code} ${r.name} ${r.slug}`);
    assert.equal(RESERVED_SLUGS.includes(r.slug), false, r.slug);
  }
  const dup = await client.query("select parent_code, slug, count(*)::int n from public.regions group by 1, 2 having count(*) > 1");
  assert.deepEqual(dup.rows, []);
  const cycle = await client.query("select code from public.regions where parent_code = code or (parent_code is not null and parent_code in (select code from public.regions c where c.parent_code is not null and c.parent_code = public.regions.code))");
  assert.deepEqual(cycle.rows, []);
  const bySlug = (sido, code) => assert.equal(regions.get(code).slug, sido);
  bySlug("jongno-gu", "1111000000");
  bySlug("seongdong-gu", "1120000000");
  bySlug("gangnam-gu", "1168000000");
  bySlug("suwon-si", "4111000000");
});

test("시범 지역(서울·부산)과 옛 씨앗 시·도 행은 그대로 — 이름·slug·별칭·유효 기간, 서울 25구·부산 16개 시·군·구", () => {
  for (const code of ["1100000000", "2600000000"]) {
    const s = seed.find((x) => x.code === code);
    const r = regions.get(code);
    assert.equal(r.name, s.name);
    assert.equal(r.slug, s.slug);
    assert.deepEqual([...r.aliases].sort(), [...s.aliases].sort(), `${s.name} 별칭이 씨앗과 같다`);
    assert.equal(r.valid_to, null);
  }
  assert.equal(sigunguRows().filter((r) => r.parent_code === "1100000000").length, 25);
  assert.equal(sigunguRows().filter((r) => r.parent_code === "2600000000").length, 16);
  // 광주·전남을 뺀 나머지 씨앗 시·도는 폐지 아님
  for (const s of seed.filter((x) => !RETIRED_SIDO.includes(x.code))) assert.equal(regions.get(s.code).valid_to, null, s.name);
});

test("일반구 39개 — 행으로 넣지 않고 상위 시 별칭('○○시 ○○구'·'○○구')으로: 수원시 장안구 · 성남시 분당구 · 창원시 마산합포구", () => {
  const gu = byClass("general_gu");
  assert.equal(gu.length, 39);
  for (const g of gu) {
    assert.equal(regions.has(g.code), false, `${g.code}는 regions 행이 아니다`);
    const cityCode = `${g.code.slice(0, 4)}000000`;
    const city = regions.get(cityCode);
    assert.ok(city, `${g.full_name}의 상위 시 ${cityCode}`);
    assert.ok(city.name.endsWith("시") && g.name.endsWith("구"), g.full_name);
    assert.ok(city.aliases.includes(`${city.name} ${g.name}`), `${city.name} 별칭에 '${city.name} ${g.name}'`);
  }
  const alias = (code) => regions.get(code).aliases;
  assert.ok(alias("4111000000").includes("수원시 장안구") && alias("4111000000").includes("장안구"));
  assert.ok(alias("4113000000").includes("성남시 분당구"));
  assert.ok(alias("4812000000").includes("창원시 마산합포구"));
  // 이름이 겹치는 일반구 별칭(예: 여러 시의 '남구')은 구 이름 단독 별칭으로 넣지 않는다
  const southGu = [...regions.values()].filter((r) => r.level === "sigungu" && r.aliases.includes("남구")).map((r) => r.name);
  assert.deepEqual(southGu, [], "'남구'는 전국에서 겹쳐 별칭 0");
});
