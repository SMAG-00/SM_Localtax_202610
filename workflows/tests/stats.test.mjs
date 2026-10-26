// W12-h 통계 수집기 단위 시험 (DATA-01) - 실제 외부 호출 0, 지어낸 견본(시험용)만 쓴다
//  · 관문 - 기능 키·인증키·주소 칸·원천 이용 조건 중 하나라도 틀리면 요청 0 (실제 원천 등록표는 칸이 비어 있어 요청 0)
//  · 점 만들기 - 시점 모양·수치가 맞는 행만, 오름차순·중복 제거, match 조건
//  · 키 비노출 - 요청 주소에만 키, 저장 주소·오류 글에는 키 0
//  · 실패 - 목록 실패는 저장 0, 한 시계열의 오류는 나머지를 멈추지 않음
//  · AI 호출 0 - 수집 모듈 소스에 AI 모듈·SDK import 없음
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { collectStats, runStatsSource, buildPoints, baseYearOf, statsGate, requestUrls, STATS_SPECS } from "../src/stats/index.ts";
import { findCredentials } from "../src/pipelines/credentials.ts";

const KEY = "fixture-stats-key-0001";
const NOW = new Date("2026-10-26T20:00:00Z"); // 한국 날짜 2026-10-27

const spec = (over = {}) => ({
  sourceKey: "fixture_stats", sourceName: "시험용 출처", sourceUrl: "https://example.test/about", baseUrl: "https://example.test/stats/list",
  keyName: "DATA_API_KEY", keyParam: "serviceKey", params: { format: "json" }, listRoot: "Items",
  series: [
    { seriesKey: "test_series_a", title: "시험용 시계열 A", taxItem: "시험세목", regionCode: null, unit: "시험단위", periodField: "yr", valueField: "amt", match: { field: "kind", value: "A" } },
    { seriesKey: "test_series_b", title: "시험용 시계열 B", taxItem: null, regionCode: "11", unit: "시험단위", periodField: "yr", valueField: "amt", match: { field: "kind", value: "B" } },
  ],
  ...over,
});
const rows = [
  { kind: "A", yr: "2022", amt: "10" },
  { kind: "A", yr: "2021", amt: "8" },
  { kind: "A", yr: "2021", amt: "999" },
  { kind: "A", yr: "bad", amt: "5" },
  { kind: "A", yr: "2023", amt: "x" },
  { kind: "B", yr: "2023", amt: "1,200" },
];
const body = JSON.stringify({ Items: { item: rows } });

const fakeFetch = (text, status = 200) => {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    return { status, text };
  };
  fn.calls = calls;
  return fn;
};
const fakeStore = (over = {}) => {
  const puts = [];
  return { puts, async put(input) { puts.push(input); return { ok: true, created: true }; }, ...over };
};

test("관문 - 네 조건 중 하나라도 틀리면 요청 0", async () => {
  const cases = [
    [{ flagOn: false, key: KEY, sourceRunnable: true }, "flag_off"],
    [{ flagOn: true, key: undefined, sourceRunnable: true }, "no_key"],
    [{ flagOn: true, key: KEY, sourceRunnable: false }, "source_not_runnable"],
  ];
  for (const [over, reason] of cases) {
    const f = fakeFetch(body);
    const r = await runStatsSource({ spec: spec(), fetch: f, store: fakeStore(), now: NOW, ...over });
    assert.deepEqual(r, { skipped: reason });
    assert.equal(f.calls.length, 0);
  }
  const f = fakeFetch(body);
  const r = await runStatsSource({ spec: spec({ baseUrl: null }), fetch: f, store: fakeStore(), now: NOW, flagOn: true, key: KEY, sourceRunnable: true });
  assert.deepEqual(r, { skipped: "no_endpoint" });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(statsGate({ flagOn: true, hasKey: true, endpointSet: true, sourceRunnable: true }), { run: true });
});

test("실제 원천 등록표는 칸이 비어 있어 요청 0", async () => {
  const f = fakeFetch(body);
  for (const s of Object.values(STATS_SPECS)) {
    const r = await runStatsSource({ spec: s, fetch: f, store: fakeStore(), now: NOW, flagOn: true, key: KEY, sourceRunnable: true });
    assert.deepEqual(r, { skipped: "no_endpoint" });
  }
  assert.equal(f.calls.length, 0);
});

test("점 만들기 - 모양이 틀린 행 제외, 오름차순, 먼저 나온 값 유지, 쉼표 수치", () => {
  const s = spec().series[0];
  assert.deepEqual(buildPoints(rows, s), [{ period: "2021", value: 8 }, { period: "2022", value: 10 }]);
  assert.deepEqual(buildPoints(rows, spec().series[1]), [{ period: "2023", value: 1200 }]);
  assert.equal(buildPoints([], s), null);
  assert.equal(buildPoints([{ kind: "A", yr: "2020", amt: "" }], s), null);
  assert.equal(baseYearOf([{ period: "2021" }, { period: "2022-03" }]), 2022);
});

test("수집 - 시계열마다 초안 입력 1건, 확인일은 한국 날짜, 기준연도는 가장 늦은 시점", async () => {
  const store = fakeStore();
  const r = await collectStats({ spec: spec(), fetch: fakeFetch(body), store, now: NOW, key: KEY });
  assert.equal(r.created, 2);
  assert.equal(r.failed, 0);
  assert.equal(store.puts.length, 2);
  const a = store.puts[0];
  assert.equal(a.sourceKey, "fixture_stats");
  assert.equal(a.series.checked_at, "2026-10-27");
  assert.equal(a.series.base_year, 2022);
  assert.equal(a.series.source_name, "시험용 출처");
  assert.equal(a.snapshot.external_id, "test_series_a");
  assert.equal(a.snapshot.payload, body);
  assert.match(a.snapshot.content_hash, /^[0-9a-f]{64}$/);
});

test("키 비노출 - 요청 주소에만 키, 저장 주소에는 키 변수 0", async () => {
  const f = fakeFetch(body);
  const store = fakeStore();
  await collectStats({ spec: spec(), fetch: f, store, now: NOW, key: KEY });
  assert.match(f.calls[0], /serviceKey=fixture-stats-key-0001/);
  const { safe } = requestUrls(spec(), KEY);
  assert.doesNotMatch(safe, /serviceKey/);
  for (const p of store.puts) {
    assert.doesNotMatch(p.snapshot.url, /serviceKey|fixture-stats-key/);
    assert.deepEqual(findCredentials?.(p.snapshot.url) ?? [], []);
  }
});

test("실패 - 목록 상태 오류는 저장 0과 오류 글 키 마스킹, 한 시계열 오류는 나머지를 멈추지 않음", async () => {
  const store = fakeStore();
  const bad = await collectStats({ spec: spec(), fetch: fakeFetch("x", 500), store, now: NOW, key: KEY });
  assert.equal(bad.failed, 1);
  assert.equal(store.puts.length, 0);
  assert.ok(bad.errors.every((e) => !e.includes(KEY)));
  const broken = await collectStats({ spec: spec(), fetch: async () => { throw new Error(`연결 실패 serviceKey=${KEY}`); }, store, now: NOW, key: KEY });
  assert.equal(broken.failed, 1);
  assert.ok(broken.errors.every((e) => !e.includes(KEY)));

  let n = 0;
  const flaky = { async put() { n += 1; if (n === 1) throw new Error("시험용 저장 오류"); return { ok: true, created: true }; } };
  const r = await collectStats({ spec: spec(), fetch: fakeFetch(body), store: flaky, now: NOW, key: KEY });
  assert.equal(r.failed, 1);
  assert.equal(r.created, 1);
});

test("DB가 거부한 시계열은 rejected로 세고 이미 있는 판은 known", async () => {
  const seq = [{ ok: false, code: "source_not_runnable" }, { ok: true, created: false }];
  const store = { async put() { return seq.shift(); } };
  const r = await collectStats({ spec: spec(), fetch: fakeFetch(body), store, now: NOW, key: KEY });
  assert.equal(r.rejected, 1);
  assert.equal(r.known, 1);
  assert.equal(r.created, 0);
});

test("AI 호출 0 - 수집 모듈 소스에 AI 모듈·SDK import가 없다", () => {
  const dir = new URL("../src/stats/", import.meta.url);
  for (const f of readdirSync(dir)) {
    const text = readFileSync(new URL(f, dir), "utf8");
    assert.doesNotMatch(text, /from\s+["'][^"']*(anthropic|openai|ops-model|\/ops\/|@anthropic-ai)[^"']*["']/i, f);
  }
});
