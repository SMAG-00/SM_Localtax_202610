// W10-h 분야 데이터 수집기 단위 시험 (PR-06 · LG-15 · DF-06) - 실제 외부 호출 0, 지어낸 견본(시험용)만 쓴다
//  · 관문 - 기능 키·인증키·주소 칸·원천 이용 조건 중 하나라도 틀리면 요청 0 (실제 원천 등록표는 칸이 비어 있어 요청 0)
//  · 칸 옮기기 - 옮김 표에 없는 원천 필드(가격·분담금·수익률 같은 이름 포함)는 후보에 실리지 않음
//  · 키 비노출 - 요청 주소에만 키, 저장 주소·오류 기록에는 키 0
//  · 멱등·변경 - 같은 응답 재수집은 후보 0 추가, 값이 바뀌면 새 후보와 바뀐 칸 표시
//  · 실패 - 목록 실패는 저장 0 + 실패 기록 1건, 한 항목의 오류는 나머지를 멈추지 않음
//  · 단계 후보 - 연결된 프로젝트가 없으면 후보 0, 행사 이미지 - 권리 확인이 없으면 이미지 칸 0
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectField, fieldGate, mapRow, requestUrls, runFieldSource, stableStringify, valueHash, FIELD_SPECS } from "../src/field-data/index.ts";
import { findCredentials } from "../src/pipelines/credentials.ts";

const KEY = "fixture-data-key-0001";
const NOW = new Date("2026-10-25T00:00:00Z");

const supplySpec = (over = {}) => ({
  sourceKey: "fixture_field", target: "supply_notice", baseUrl: "https://example.test/fixture/list", keyName: "DATA_API_KEY", keyParam: "serviceKey",
  params: { format: "json" }, listRoot: "Items", idField: "id",
  fieldMap: { nm: "name", region: "region_code", scale: "supply_scale", start: "apply_start", end: "apply_end", ndate: "notice_date", issuer: "notice_issuer", url: "official_notice_url" },
  koglField: "kogl", koglMap: { 1: "kogl_1", 4: "kogl_4" },
  ...over,
});
const row = (over = {}) => ({
  id: "A-1", nm: "시험용 사업", region: "11110", scale: "100세대", start: "2026-11-01", end: "2026-11-03", ndate: "2026-10-20", issuer: "시험용 기관", url: "https://example.test/notice/1", kogl: "1",
  price: "시험용 가격", 분담금: "시험용", profit_rate: 0.1, ...over,
});
const body = (...rows) => JSON.stringify({ Items: { item: rows } });

function fakeFetch(text, status = 200) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (typeof text === "function") return text(url);
    return { status, text };
  };
  fn.calls = calls;
  return fn;
}

function fakeStore(over = {}) {
  const items = new Map(); // `${src}|${id}` -> { valueHash, fields, keys:Set }
  const keys = new Set();
  const failures = [];
  const commits = [];
  const store = {
    items, keys, failures, commits,
    async latest(src, id) { return items.get(`${src}|${id}`) ?? null; },
    async projectSlugFor() { return null; },
    async commitCandidate({ spec, snapshot, candidate, title }) {
      const key = `${spec.sourceKey}:${candidate.sourceItemId}:${candidate.valueHash}:${candidate.koglType}`;
      if (keys.has(key)) return { created: false };
      keys.add(key);
      items.set(`${spec.sourceKey}|${candidate.sourceItemId}`, { valueHash: candidate.valueHash, fields: candidate.fields });
      commits.push({ candidate, snapshot, title });
      return { created: true };
    },
    async recordSourceFailure(f) { failures.push(f); },
    ...over,
  };
  return store;
}

test("관문 - 기능 키·인증키·주소 칸·이용 조건 중 하나라도 틀리면 요청 0, 모두 맞으면 요청 1", async () => {
  const open = { flagOn: true, hasKey: true, endpointSet: true, sourceRunnable: true };
  assert.deepEqual(fieldGate(open), { run: true });
  assert.deepEqual(fieldGate({ ...open, flagOn: false }), { run: false, reason: "flag_off" });
  assert.deepEqual(fieldGate({ ...open, hasKey: false }), { run: false, reason: "no_key" });
  assert.deepEqual(fieldGate({ ...open, endpointSet: false }), { run: false, reason: "no_endpoint" });
  assert.deepEqual(fieldGate({ ...open, sourceRunnable: false }), { run: false, reason: "source_not_runnable" });

  for (const [name, patch, reason] of [["키 꺼짐", { flagOn: false }, "flag_off"], ["인증키 없음", { key: undefined }, "no_key"], ["원천 미확인", { sourceRunnable: false }, "source_not_runnable"]]) {
    const fetch = fakeFetch(body(row()));
    const r = await runFieldSource({ spec: supplySpec(), fetch, store: fakeStore(), now: NOW, key: KEY, flagOn: true, sourceRunnable: true, ...patch });
    assert.deepEqual(r, { skipped: reason }, name);
    assert.equal(fetch.calls.length, 0, `${name} - 요청 0`);
  }
  const fetch = fakeFetch(body(row()));
  const r = await runFieldSource({ spec: supplySpec(), fetch, store: fakeStore(), now: NOW, key: KEY, flagOn: true, sourceRunnable: true });
  assert.equal(r.candidates, 1);
  assert.equal(fetch.calls.length, 1);
});

test("실제 원천 등록표 7개는 주소 칸이 비어 있어 모든 관문을 열어도 요청 0 - 관광 계열 원천 0", async () => {
  const specs = Object.values(FIELD_SPECS);
  assert.equal(specs.length, 7);
  for (const spec of specs) {
    const fetch = fakeFetch("{}");
    const r = await runFieldSource({ spec, fetch, store: fakeStore(), now: NOW, key: KEY, flagOn: true, sourceRunnable: true });
    assert.deepEqual(r, { skipped: "no_endpoint" }, spec.sourceKey);
    assert.equal(fetch.calls.length, 0);
    assert.doesNotMatch(`${spec.sourceKey} ${spec.baseUrl ?? ""}`, /tour|관광|음식|맛집/i);
  }
  assert.equal(FIELD_SPECS.dart_disclosure.keyName, "DATA_API_DART_KEY");
});

test("칸 옮기기 - 옮김 표에 없는 원천 필드는 후보에 없다 (가격·분담금·수익률 이름 포함)", () => {
  const m = mapRow(row(), supplySpec());
  assert.equal(m.sourceItemId, "A-1");
  assert.deepEqual(Object.keys(m.fields).sort(), ["apply_end", "apply_start", "name", "notice_date", "notice_issuer", "official_notice_url", "region_code", "supply_scale"]);
  assert.equal(m.fields.supply_scale, "100세대");
  assert.equal(m.koglType, "kogl_1");
  assert.equal(JSON.stringify(m.fields).includes("가격"), false);
  assert.equal(mapRow(row({ id: "" }), supplySpec()), null, "번호 없는 항목은 버린다");
  assert.equal(mapRow(row({ kogl: "9" }), supplySpec()).koglType, null, "모르는 유형 값은 null (승인 불가)");
});

test("인증키 - 요청 주소에만 있고 저장 주소는 키 변수가 없다, 오류 기록에도 키 0", async () => {
  const { request, safe } = requestUrls(supplySpec(), KEY);
  assert.match(request, /serviceKey=fixture-data-key-0001/);
  assert.equal(safe.includes(KEY), false);
  assert.deepEqual(findCredentials(safe), []);

  const store = fakeStore();
  await collectField({ spec: supplySpec(), fetch: fakeFetch(body(row())), store, now: NOW, key: KEY });
  assert.equal(store.commits[0].snapshot.url.includes(KEY), false);
  assert.equal(store.commits[0].snapshot.url, "https://example.test/fixture/list?format=json");

  const failing = fakeStore();
  const throwing = async (url) => { throw new Error(`연결 실패 ${url}`); };
  await collectField({ spec: supplySpec(), fetch: throwing, store: failing, now: NOW, key: KEY });
  assert.equal(failing.failures.length, 1);
  assert.equal(failing.failures[0].message.includes(KEY), false);
  assert.match(failing.failures[0].message, /serviceKey=\*\*\*/);
});

test("같은 응답을 다시 수집해도 후보 1건 (원천 ID 멱등)", async () => {
  const store = fakeStore();
  const text = body(row(), row({ id: "A-2", nm: "시험용 사업 둘" }));
  const first = await collectField({ spec: supplySpec(), fetch: fakeFetch(text), store, now: NOW, key: KEY });
  assert.deepEqual([first.listed, first.candidates, first.known], [2, 2, 0]);
  const second = await collectField({ spec: supplySpec(), fetch: fakeFetch(text), store, now: NOW, key: KEY });
  assert.deepEqual([second.listed, second.candidates, second.known], [2, 0, 2]);
  assert.equal(store.commits.length, 2);
});

test("원천 값이 바뀌면 새 후보와 바뀐 칸 표시, 처음 후보는 바뀐 칸 없음", async () => {
  const store = fakeStore();
  await collectField({ spec: supplySpec(), fetch: fakeFetch(body(row())), store, now: NOW, key: KEY });
  assert.deepEqual(store.commits[0].candidate.changedFields, []);
  const r = await collectField({ spec: supplySpec(), fetch: fakeFetch(body(row({ scale: "120세대", end: "2026-11-05" }))), store, now: NOW, key: KEY });
  assert.equal(r.candidates, 1);
  assert.deepEqual(store.commits[1].candidate.changedFields, ["apply_end", "supply_scale"]);
  assert.match(store.commits[1].title, /값 변경/);
  assert.notEqual(store.commits[0].candidate.valueHash, store.commits[1].candidate.valueHash);
});

test("목록 실패(5xx·깨진 응답)는 저장 0 + 실패 기록 1건, 한 항목 오류는 나머지를 멈추지 않는다", async () => {
  for (const text of [fakeFetch("서버 오류", 503), fakeFetch("{깨진")]) {
    const store = fakeStore();
    const r = await collectField({ spec: supplySpec(), fetch: text, store, now: NOW, key: KEY });
    assert.equal(r.failed, 1);
    assert.equal(store.commits.length, 0);
    assert.equal(store.failures.length, 1);
    assert.equal(store.failures[0].day, "2026-10-25");
  }
  const store = fakeStore({ async latest(src, id) { if (id === "BAD") throw new Error("저장소 오류"); return null; } });
  const r = await collectField({ spec: supplySpec(), fetch: fakeFetch(body(row({ id: "BAD" }), row({ id: "OK" }))), store, now: NOW, key: KEY });
  assert.deepEqual([r.failed, r.candidates], [1, 1]);
  assert.equal(store.commits[0].candidate.sourceItemId, "OK");
});

test("공공누리 유형을 못 읽은 후보는 유형 null 로 만들어진다 (승인은 DB 가 막는다)", async () => {
  const store = fakeStore();
  await collectField({ spec: supplySpec(), fetch: fakeFetch(body(row({ kogl: undefined }))), store, now: NOW, key: KEY });
  assert.equal(store.commits[0].candidate.koglType, null);
});

test("단계 후보 - 연결된 프로젝트가 없으면 후보 0(unmatched), 연결되면 프로젝트 slug 가 칸에 들어간다", async () => {
  const spec = supplySpec({ target: "project_stage", fieldMap: { stage: "stage", no: "notice_no", d: "notice_date", iss: "issuer", u: "source_url" } });
  const text = body({ id: "P-1", stage: "시험용단계", no: "시험용 제1호", d: "2026-10-01", iss: "시험용 기관", u: "https://example.test/g/1", 분양가: "시험용" });
  const none = fakeStore();
  const r0 = await collectField({ spec, fetch: fakeFetch(text), store: none, now: NOW, key: KEY });
  assert.deepEqual([r0.unmatched, r0.candidates], [1, 0]);
  const linked = fakeStore({ async projectSlugFor(src, id) { return id === "P-1" ? "fixture-project" : null; } });
  const r1 = await collectField({ spec, fetch: fakeFetch(text), store: linked, now: NOW, key: KEY });
  assert.equal(r1.candidates, 1);
  assert.equal(linked.commits[0].candidate.fields.project_slug, "fixture-project");
  assert.equal("분양가" in linked.commits[0].candidate.fields, false);
});

test("행사 이미지 - 권리 확인이 없으면 이미지 주소를 후보에도 싣지 않고, 확인된 원천만 싣는다", () => {
  const spec = { ...supplySpec({ target: "local_event", fieldMap: { t: "title", img: "image_url" } }) };
  const r = { id: "E-1", t: "시험용 행사", img: "https://example.test/img.png" };
  const unconfirmed = mapRow(r, spec);
  assert.equal("image_url" in unconfirmed.fields, false);
  assert.equal(unconfirmed.fields.image_rights, "unconfirmed");
  const confirmed = mapRow(r, { ...spec, imageRightsConfirmed: true });
  assert.equal(confirmed.fields.image_url, "https://example.test/img.png");
  assert.equal(confirmed.fields.image_rights, "confirmed");
});

test("값 해시 - 키 순서와 상관없이 같고 값이 바뀌면 다르다", async () => {
  assert.equal(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] }), stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
  assert.match(await valueHash({ a: 1 }), /^[0-9a-f]{64}$/);
  assert.equal(await valueHash({ a: 1, b: 2 }), await valueHash({ b: 2, a: 1 }));
  assert.notEqual(await valueHash({ a: 1 }), await valueHash({ a: 2 }));
});
