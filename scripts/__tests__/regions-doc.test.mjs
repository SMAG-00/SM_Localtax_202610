// W4 1단계 — 설계 문서(docs/dev/W4_설계.md) 표와 적재 도구가 같은 약속을 쓰는지 본다
//  2.6 '멈추는 조건' 칸의 모든 조건(1~7 차례)이 도구의 멈춤 목록에 같은 글자·같은 차례로 있다 (8 적용 뒤 검사는 2단계 DB 시험)
//  2.1 region_import.row_class · region_import.change · region_import_run.status · region_slug_redirect.reason = 도구 값
//  2.7 예 칸 — slug·짧은 별칭 견본을 도구가 그대로 만든다
import { test } from "node:test";
import assert from "node:assert/strict";
import { designSection, tableRows, ticks, SEED } from "./regions-fixtures.mjs";
import { CHANGES, REDIRECT_REASONS, ROW_CLASSES, RUN_STATUSES } from "../regions/config.mjs";
import { STEP_NAMES, STOPS } from "../regions/stop.mjs";
import { autoSlug, shortAliasCandidate } from "../regions/slug.mjs";

/** 2.6 표 → [{ step, name, stops: [글자] }] */
function pipelineTable() {
  return tableRows(designSection("2.6")).map(([step, , stops]) => {
    const m = step.match(/^(\d+)\s+(.+)$/);
    assert.ok(m, `2.6 차례 칸 '${step}'`);
    const list = stops === "—" ? [] : stops.split(" · ").map((s) => s.replace(/\s*\([^)]*\)\s*$/, "").trim());
    return { step: Number(m[1]), name: m[2].trim(), stops: list };
  });
}

test("2.6 표를 읽었다 — 8차례, 1~7 차례 이름이 도구의 차례 이름과 같다", () => {
  const rows = pipelineTable();
  assert.deepEqual(rows.map((r) => r.step), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const r of rows.filter((x) => x.step <= 7)) assert.equal(STEP_NAMES[r.step], r.name, `차례 ${r.step}`);
  assert.deepEqual(rows.find((r) => r.step === 2).stops, ["모르는 열 머리", "코드가 10자리 숫자 아님", "이름 빈 값", "폐지여부가 2값 밖", "같은 코드 두 번"]);
});

test("2.6 '멈추는 조건'(1~7 차례)마다 도구에 같은 글자·같은 차례의 조건이 있다", () => {
  const rows = pipelineTable().filter((r) => r.step <= 7);
  const listed = rows.flatMap((r) => r.stops.map((s) => ({ step: r.step, text: s })));
  assert.equal(listed.length, 14, JSON.stringify(listed));
  for (const { step, text } of listed) {
    const hits = Object.entries(STOPS).filter(([, s]) => s.doc === text && s.step === step);
    assert.ok(hits.length >= 1, `2.6 ${step}차례 '${text}'에 맞는 멈춤 조건이 없다`);
  }
  // 거꾸로 — 도구의 doc 글자는 모두 설계 표에 있다 (글자를 지어내지 않는다)
  for (const [code, s] of Object.entries(STOPS).filter(([, x]) => x.doc)) {
    assert.ok(listed.some((l) => l.step === s.step && l.text === s.doc), `${code}의 doc '${s.doc}'가 설계 2.6 ${s.step}차례에 없다`);
  }
  // '후속이 또 폐지'는 멈추지 않고 최종 지역으로 바꿔 쓴다(괄호 안 설명)
  assert.equal(STOPS.SUCCESSOR_CHAIN.action, "rewrite");
  assert.ok(Object.values(STOPS).filter((s) => s.action === "stop").length >= 14);
});

test("2.1 적재 값 목록 = 도구 값", () => {
  const rows = tableRows(designSection("2.1"));
  const values = (name) => {
    const row = rows.find(([n]) => n.split(/[\s(`)]+/).includes(name));
    assert.ok(row, `2.1에 ${name}이 없다`);
    return ticks(row[1]);
  };
  assert.deepEqual(values("region_import.row_class"), [...ROW_CLASSES]);
  assert.deepEqual(values("region_import.change"), [...CHANGES]);
  assert.deepEqual(values("region_import_run.status"), [...RUN_STATUSES]);
  assert.deepEqual(values("region_slug_redirect.reason"), [...REDIRECT_REASONS]);
  assert.deepEqual(values("region.level"), ["sido", "sigungu"], "W2-b 단계 2종 그대로");
});

test("2.7 예 칸 — 시·도 slug는 씨앗 값, 시·군·구 slug·짧은 별칭 견본을 도구가 그대로 만든다", () => {
  const rows = tableRows(designSection("2.7"));
  const row = (prefix) => {
    const r = rows.find(([k]) => k.startsWith(prefix));
    assert.ok(r, `2.7에 '${prefix}' 줄이 없다`);
    return r;
  };
  const sidoSlugs = ticks(row("시·도 slug")[2]);
  assert.deepEqual(sidoSlugs, ["seoul", "gyeonggi"]);
  for (const s of sidoSlugs) assert.ok(SEED.some((x) => x.slug === s), `씨앗에 ${s}`);
  const pairs = (cell) => cell.split(" · ").map((seg) => ({ from: ticks(seg)[0], to: ticks(seg)[1] ?? null }));
  const slugPairs = pairs(row("시·군·구 slug")[2]);
  assert.deepEqual(slugPairs, [{ from: "시험구", to: "siheom-gu" }]);
  for (const p of slugPairs) assert.equal(autoSlug(p.from), p.to);
  const aliasPairs = pairs(row("짧은 별칭")[2]);
  assert.deepEqual(aliasPairs, [{ from: "시험시", to: "시험" }, { from: "중구", to: null }]);
  for (const p of aliasPairs) assert.equal(shortAliasCandidate(p.from), p.to, p.from);
});
