// W10-c 수집 파이프라인 단위 시험 (PIPE-01~04 · PIPE-06 · PIPE-07 · PIPE-08 · AIOPS-06) — 실제 외부 호출 0, 지어낸 견본(시험용)만 쓴다
//  · 개정 판정 표(2026-07-30 SM 오탐 회귀: 해시만 바뀜 → 개정 아님)
//  · 법령 감시 — 첫 확인은 기준 개정판(검수 항목 0), 공포번호 변경은 개정판 + 검수 항목 1건(재감지도 1건), 해시만 바뀜은 기록만, 변화 없음은 쓰기 0
//  · 실패 — 5xx는 백오프 3회(1초·2초) 뒤 api_error, 4xx는 재시도 없이 즉시, 본문 못 받으면 저장 0, 실패한 실행은 공개 자료 불변
//  · 인증키 — 저장 주소·오류 글·기록에 키 0, 공개 HTML 검사기 동작
//  · 관문 — 플래그·기관코드·원천 이용 조건 중 하나라도 틀리면 요청 0
//  · 문서 수집기 — 목록 계약(부처 필터·번호 없는 항목 버림), 새 문서만 저장, 날짜 변경은 검수 항목, 별칭 대응, 실패 격리
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createLawApi, LawApiError } from "../src/pipelines/law/law-api.ts";
import { classifyChange, checkOneLaw, runLawCheck } from "../src/pipelines/law/law-watch.ts";
import { parseLawArticles } from "../src/pipelines/law/articles.ts";
import { collectDocs, parseDocList, decisionKindOf, DOC_SPECS } from "../src/pipelines/docs/collector.ts";
import { findCredentials, redactCredentials, isPublicUrl, publicLawUrl } from "../src/pipelines/credentials.ts";
import { pipelineGate } from "../src/pipelines/gate.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const OC = "test-oc-secret-0001";

/** 주소로 응답을 고르는 가짜 fetch — 호출 기록과 받은 주소를 남긴다 */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const route = routes(url);
    const r = typeof route === "function" ? route() : route;
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}
const ok = (obj) => ({ status: 200, body: typeof obj === "string" ? obj : JSON.stringify(obj) });
function makeApi(routes, extra = {}) {
  const sleeps = [];
  const f = fakeFetch(routes);
  const api = createLawApi({ oc: OC, fetch: f, sleep: async (ms) => void sleeps.push(ms), ...extra });
  return { api, f, sleeps };
}
const lawRoutes = (search, body) => (url) => (url.includes("lawSearch.do") ? ok(search) : url.includes("lawService.do") ? ok(body) : { status: 404, body: "" });

/** 메모리 저장소 — DB와 같은 멱등 규칙(같은 개정판·사건·검수 키는 1건)을 흉내 낸다 */
function memoryLawStore(initial = []) {
  const s = { laws: initial, versions: new Map(), articles: [], events: new Map(), reviewItems: new Map(), snapshots: [], states: new Map(), failures: [], writes: 0 };
  return {
    s,
    async listWatched() { return s.laws.map((l) => ({ ...l, prev: s.states.get(l.lawId) ?? l.prev ?? null })); },
    async recordUnchanged(law, _at, snap, hash) { s.writes += 1; const p = s.states.get(law.lawId); s.states.set(law.lawId, { ...p, failCount: 0, bodyHash: hash ?? p?.bodyHash ?? null }); },
    async recordBodyOnly(law, _at, snap, body) {
      s.writes += 1; s.snapshots.push(body);
      s.events.set(`${law.lawId}|body_only|${body.contentHash}`, { kind: "body_only" });
      const p = s.states.get(law.lawId); s.states.set(law.lawId, { ...p, bodyHash: body.contentHash, failCount: 0 });
    },
    async recordVersion(law, _at, snap, input) {
      s.writes += 1; s.snapshots.push(input.snapshot);
      const vkey = `${law.lawId}|${input.promulgationNo}|${input.effectiveOn}`;
      if (!s.versions.has(vkey)) { s.versions.set(vkey, input); for (const a of input.articles) s.articles.push({ vkey, ...a }); }
      s.events.set(`${law.lawId}|${input.kind}|${input.promulgationNo}|${input.effectiveOn}`, { kind: input.kind });
      let created = false;
      if (input.kind === "revision") {
        const rkey = `law_change|law:${law.lawId}:${input.promulgationNo}:${input.effectiveOn}`;
        if (!s.reviewItems.has(rkey)) { s.reviewItems.set(rkey, { payload: input }); created = true; }
      }
      s.states.set(law.lawId, { promulgationNo: input.promulgationNo, effectiveOn: input.effectiveOn, bodyHash: input.bodyHash, failCount: 0 });
      return { reviewItemCreated: created };
    },
    async recordFailure(law, _at, message, notFound) {
      s.failures.push({ lawId: law.lawId, message, notFound });
      const p = s.states.get(law.lawId) ?? law.prev;
      if (p) s.states.set(law.lawId, { ...p, failCount: p.failCount + 1 });
    },
  };
}
const LAW = { lawId: 1, name: "시험용법", lawKey: null, prev: null };
const publicCounts = (st) => [st.s.versions.size, st.s.articles.length, st.s.events.size, st.s.reviewItems.size, st.s.snapshots.length];

test("개정 판정 표 — 공포번호·시행일자 변경만 개정, 본문 해시만 바뀌면 개정이 아니다 (2026-07-30 오탐 회귀)", () => {
  const cases = [
    [{ dateChanged: false, promulgationChanged: true, bodyChanged: true }, { changed: true, bodyOnly: false }],
    [{ dateChanged: true, promulgationChanged: false, bodyChanged: false }, { changed: true, bodyOnly: false }],
    [{ dateChanged: false, promulgationChanged: false, bodyChanged: true }, { changed: false, bodyOnly: true }],
    [{ dateChanged: false, promulgationChanged: false, bodyChanged: false }, { changed: false, bodyOnly: false }],
    [{ dateChanged: true, promulgationChanged: true, bodyChanged: true }, { changed: true, bodyOnly: false }],
  ];
  for (const [input, expected] of cases) assert.deepEqual(classifyChange(input), expected, JSON.stringify(input));
});

test("첫 확인 — 기준 개정판과 조문을 저장하고 검수 항목은 만들지 않는다, 같은 날 다시 돌려도 쓰기 0", async () => {
  const { api } = makeApi(lawRoutes(fixture("law-search.json"), fixture("law-body.json")));
  const st = memoryLawStore([LAW]);
  const first = await runLawCheck({ api, store: st, now: new Date("2026-10-26T00:00:00Z"), secrets: [OC] });
  assert.equal(first.summary.firstSeen, 1);
  assert.equal(st.s.versions.size, 1);
  assert.equal(st.s.reviewItems.size, 0);
  assert.deepEqual(st.s.articles.map((a) => [a.articleNo, a.branchNo]), [[1, 0], [2, 2]], "장 제목 줄(전문)은 조문이 아니다");
  assert.equal(st.s.articles[1].body, "제2조의2(시험용 정의) 시험용 문장 나.\n시험용 항 하나");
  const writes = st.s.writes;
  const again = await runLawCheck({ api, store: st, now: new Date("2026-10-27T00:00:00Z") });
  assert.equal(again.summary.unchanged, 1);
  assert.equal(st.s.versions.size, 1);
  assert.ok(st.s.writes === writes + 1, "변화 없음은 감시 상태 갱신만");
  assert.equal(st.s.snapshots.length, 1, "변화 없음은 스냅샷을 늘리지 않는다");
});

test("공포번호가 바뀌면 새 개정판 + 검수 항목 1건, 재감지해도 검수 항목은 1건", async () => {
  const search = fixture("law-search.json");
  const body = fixture("law-body.json");
  const st = memoryLawStore([LAW]);
  await runLawCheck({ api: makeApi(lawRoutes(search, body)).api, store: st, now: new Date() });
  const changed = structuredClone(search);
  changed.LawSearch.law[2].공포번호 = "시험-11";
  changed.LawSearch.law[2].시행일자 = "20260301";
  const newBody = structuredClone(body);
  newBody.법령.조문.조문단위[0].조문내용 = "제1조(시험용 목적) 시험용 문장 다.";
  const api2 = makeApi(lawRoutes(changed, newBody)).api;
  const r = await runLawCheck({ api: api2, store: st, now: new Date() });
  assert.equal(r.summary.changed, 1);
  assert.equal(r.outcomes[0].reviewItemCreated, true);
  assert.equal(st.s.versions.size, 2);
  assert.equal(st.s.reviewItems.size, 1);
  assert.match([...st.s.reviewItems.keys()][0], /시험-11/);
  // 상태 저장이 실패한 날 같은 개정이 다시 감지돼도 검수 항목은 1건 (멱등)
  st.s.states.set(1, { promulgationNo: "시험-10", effectiveOn: "2026-02-01", bodyHash: "x", failCount: 0 });
  const retry = await runLawCheck({ api: api2, store: st, now: new Date() });
  assert.equal(retry.outcomes[0].reviewItemCreated, false);
  assert.equal(st.s.reviewItems.size, 1);
  assert.equal(st.s.versions.size, 2);
});

test("해시만 바뀌면(공포번호·시행일자 그대로) 개정이 아니다 — 개정판·검수 항목 0, 기록만", async () => {
  const search = fixture("law-search.json");
  const body = fixture("law-body.json");
  const st = memoryLawStore([LAW]);
  await runLawCheck({ api: makeApi(lawRoutes(search, body)).api, store: st, now: new Date() });
  const touched = structuredClone(body);
  touched.법령.조문.조문단위[0].조문내용 += " ";
  touched.법령.조문.조문단위[0].조문제목 = "시험용 목적(정비)";
  const r = await runLawCheck({ api: makeApi(lawRoutes(search, touched)).api, store: st, now: new Date() });
  assert.equal(r.summary.bodyOnly, 1);
  assert.equal(r.summary.changed, 0);
  assert.equal(st.s.versions.size, 1);
  assert.equal(st.s.reviewItems.size, 0);
  assert.equal([...st.s.events.keys()].filter((k) => k.includes("|body_only|")).length, 1);
});

test("법령 API 5xx — 백오프 1초·2초 뒤 3번 시도하고 api_error, 공개 자료는 그대로", async () => {
  const search = fixture("law-search.json");
  const body = fixture("law-body.json");
  const st = memoryLawStore([LAW]);
  await runLawCheck({ api: makeApi(lawRoutes(search, body)).api, store: st, now: new Date() });
  const before = publicCounts(st);
  const { api, f, sleeps } = makeApi(() => ({ status: 503, body: "" }));
  const r = await runLawCheck({ api, store: st, now: new Date(), secrets: [OC] });
  assert.equal(r.summary.apiErrors, 1);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(sleeps, [1000, 2000]);
  assert.deepEqual(publicCounts(st), before);
  assert.equal(st.s.failures.length, 1);
  assert.equal(st.s.states.get(1).failCount, 1);
});

test("4xx(기관코드 거부)는 재시도하지 않고 바로 실패 — 오류 글에 기관코드가 없다", async () => {
  const { api, f, sleeps } = makeApi(() => ({ status: 403, body: "" }));
  const st = memoryLawStore([LAW]);
  const r = await runLawCheck({ api, store: st, now: new Date(), secrets: [OC] });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(sleeps, []);
  assert.equal(r.outcomes[0].kind, "api_error");
  assert.ok(!JSON.stringify(st.s.failures).includes(OC));
  assert.ok(!r.outcomes[0].message.includes(OC));
});

test("네트워크 오류 글에 키가 들어 있어도 기록 전에 가린다", async () => {
  const leaky = () => new Error(`fetch failed https://www.law.go.kr/DRF/lawSearch.do?OC=${OC}&target=law`);
  const { api } = makeApi(() => leaky);
  const out = await checkOneLaw(LAW, api, memoryLawStore([LAW]), new Date(), [OC]);
  assert.equal(out.kind, "api_error");
  assert.ok(!out.message.includes(OC), out.message);
  assert.match(out.message, /OC=\*\*\*/);
});

test("검색에 정확히 일치하는 현행 법령이 없으면 not_found로 기록하고 저장 0", async () => {
  const { api } = makeApi(lawRoutes({ LawSearch: { law: fixture("law-search.json").LawSearch.law.slice(0, 2) } }, fixture("law-body.json")));
  const st = memoryLawStore([LAW]);
  const r = await runLawCheck({ api, store: st, now: new Date() });
  assert.equal(r.summary.notFound, 1);
  assert.deepEqual(publicCounts(st), [0, 0, 0, 0, 0]);
  assert.equal(st.s.failures[0].notFound, true);
});

test("본문을 못 받으면 새 개정판을 저장하지 않는다 (스냅샷 없이 저장 0)", async () => {
  const { api } = makeApi((url) => (url.includes("lawSearch.do") ? ok(fixture("law-search.json")) : { status: 500, body: "" }));
  const st = memoryLawStore([LAW]);
  const r = await runLawCheck({ api, store: st, now: new Date() });
  assert.equal(r.outcomes[0].kind, "api_error");
  assert.deepEqual(publicCounts(st), [0, 0, 0, 0, 0]);
});

test("저장하는 주소에는 인증키가 없고, 요청 주소에만 있다", async () => {
  const { api, f } = makeApi(lawRoutes(fixture("law-search.json"), fixture("law-body.json")));
  const st = memoryLawStore([LAW]);
  await runLawCheck({ api, store: st, now: new Date() });
  assert.ok(f.calls.every((u) => u.includes(`OC=${OC}`)), "요청 주소에는 키가 있다");
  for (const snap of st.s.snapshots) {
    assert.ok(!snap.url.includes(OC) && findCredentials(snap.url).length === 0, snap.url);
    assert.ok(isPublicUrl(snap.url));
  }
  for (const v of st.s.versions.values()) assert.equal(isPublicUrl(v.snapshotPublicUrl), true);
});

test("기관코드가 없으면 클라이언트를 만들 수 없다", () => {
  assert.throws(() => createLawApi({ oc: "" }), LawApiError);
});

test("인증키 검사기 — 공개 HTML에서 OC=·serviceKey=·알려진 비밀 값을 찾고, 키 없는 주소는 통과", () => {
  assert.deepEqual(findCredentials('<a href="https://www.law.go.kr/DRF/lawService.do?OC=abc123&ID=1">'), ["OC=abc123"]);
  assert.equal(findCredentials('<a href="/x?serviceKey=zzz999">').length, 1);
  assert.equal(findCredentials(`<p>${OC}</p>`, [OC]).length, 1);
  assert.deepEqual(findCredentials('<a href="https://www.law.go.kr/법령/%EC%8B%9C%ED%97%98">시험용 법</a> <a href="/a?type=JSON&ID=3">'), []);
  assert.equal(redactCredentials("x?oc=ABC&y=1"), "x?oc=***&y=1");
  assert.equal(isPublicUrl(publicLawUrl("시험용법")), true);
  assert.equal(isPublicUrl("http://www.law.go.kr/x"), false);
});

test("조문 해석 — 응답 모양이 다르면 ok=false(조용히 비우지 않는다), 잘못된 번호·빈 본문·중복은 버린다", () => {
  assert.deepEqual(parseLawArticles("not json"), { ok: false, articles: [] });
  assert.deepEqual(parseLawArticles('{"다른":1}'), { ok: false, articles: [] });
  const r = parseLawArticles(JSON.stringify({ 법령: { 조문: { 조문단위: [
    { 조문번호: "3", 조문내용: "시험용 가" }, { 조문번호: "3", 조문내용: "시험용 중복" }, { 조문번호: "x", 조문내용: "번호 이상" }, { 조문번호: "4", 조문내용: "  " },
  ] } } }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.articles.map((a) => a.body), ["시험용 가"]);
  assert.equal(parseLawArticles(JSON.stringify({ 법령: { 조문: { 조문단위: { 조문번호: "1", 조문내용: "단일 객체" } } } })).articles.length, 1);
});

test("관문 — 기능 키 꺼짐·기관코드 없음·원천 미허용 중 하나라도 있으면 실행하지 않고 이유를 돌려준다", () => {
  assert.deepEqual(pipelineGate({ flagOn: false, oc: OC, sourceRunnable: true }), { run: false, reason: "flag_off" });
  assert.deepEqual(pipelineGate({ flagOn: true, oc: undefined, sourceRunnable: true }), { run: false, reason: "no_oc" });
  assert.deepEqual(pipelineGate({ flagOn: true, oc: "", sourceRunnable: true }), { run: false, reason: "no_oc" });
  assert.deepEqual(pipelineGate({ flagOn: true, oc: OC, sourceRunnable: false }), { run: false, reason: "source_not_runnable" });
  assert.deepEqual(pipelineGate({ flagOn: true, oc: OC, sourceRunnable: true }), { run: true });
});

// ─── 문서 수집기 ───
function memoryDocStore(known = {}) {
  const s = { docs: new Map(), aliases: [], reviewItems: new Map(), failures: [], known };
  return {
    s,
    async findKnown(src, id) { return s.known[`${src}|${id}`] ?? (s.docs.has(`${src}|${id}`) ? { legalDocId: 1, decidedOn: s.docs.get(`${src}|${id}`).decidedOn } : null); },
    async commitNewDoc({ spec, item, snapshot }) { const k = `${spec.sourceKey}|${item.docId}`; if (s.docs.has(k)) return { created: false }; s.docs.set(k, { ...item, snapshot }); s.reviewItems.set(`legal_doc|${k}`, 1); return { created: true }; },
    async linkAlias(a) { s.aliases.push(a); },
    async commitDateChange({ spec, item }) { const k = `legal_doc|${spec.sourceKey}|${item.docId}|${item.decidedOn}`; if (s.reviewItems.has(k)) return { created: false }; s.reviewItems.set(k, 1); return { created: true }; },
    async recordSourceFailure(f) { s.failures.push(f); },
  };
}
const docRoutes = (list, detail = { 본문: "시험용 상세" }) => (url) => (url.includes("lawSearch.do") ? ok(list) : ok(detail));

test("행정규칙 목록 — 소관부처 필터와 번호 없는 항목 버리기, 날짜는 ISO로", () => {
  const { items, dropped } = parseDocList(fixture("admrul-list.json"), DOC_SPECS.admrul);
  assert.deepEqual(items.map((i) => [i.docId, i.decidedOn, i.docNo]), [["A-1", "2026-03-01", "시험-예규-1"]]);
  assert.equal(dropped, 2);
  assert.deepEqual(parseDocList({ 이상한: "모양" }, DOC_SPECS.admrul).items, []);
});

test("결정 구분 글자 → 분류 코드", () => {
  assert.equal(decisionKindOf("기각"), "rejected");
  assert.equal(decisionKindOf("일부인용"), "accepted");
  assert.equal(decisionKindOf("각하"), "dismissed");
  assert.equal(decisionKindOf("재조사"), "remanded");
  assert.equal(decisionKindOf("그밖에"), "other");
  assert.equal(decisionKindOf(null), null);
});

test("문서 수집 — 새 문서만 저장하고 상세 원문은 키 없는 주소로 스냅샷, 두 번째 실행은 저장 0", async () => {
  const { api, f } = makeApi(docRoutes(fixture("admrul-list.json")));
  const st = memoryDocStore();
  const first = await collectDocs({ spec: DOC_SPECS.admrul, api, store: st, now: new Date("2026-10-26T00:00:00Z"), secrets: [OC] });
  assert.deepEqual([first.listed, first.dropped, first.newDocs, first.known, first.failed], [1, 2, 1, 0, 0]);
  const doc = st.s.docs.get("admrul|A-1");
  assert.equal(doc.snapshot.sourceKey, "admrul");
  assert.equal(doc.snapshot.externalId, "A-1");
  assert.ok(!doc.snapshot.url.includes(OC) && doc.snapshot.contentHash.length === 64);
  assert.equal(f.calls.filter((u) => u.includes("target=admrul") && u.includes("lawService.do")).length, 1);
  const second = await collectDocs({ spec: DOC_SPECS.admrul, api, store: st, now: new Date(), secrets: [OC] });
  assert.deepEqual([second.newDocs, second.known], [0, 1]);
  assert.equal(st.s.docs.size, 1);
});

test("결정례 — 의결일자가 바뀐 기존 문서는 새 문서가 아니라 날짜 변경 검수 항목 1건, 일련번호 기준 원천(해석)은 날짜가 달라도 신규가 아니다", async () => {
  const list = fixture("tribunal-list.json");
  const st = memoryDocStore();
  await collectDocs({ spec: DOC_SPECS.tribunal_decision, api: makeApi(docRoutes(list)).api, store: st, now: new Date() });
  const moved = structuredClone(list);
  moved.TtSpecialDecc.ttSpecialDecc[0].의결일자 = "20260415";
  const r = await collectDocs({ spec: DOC_SPECS.tribunal_decision, api: makeApi(docRoutes(moved)).api, store: st, now: new Date() });
  assert.deepEqual([r.newDocs, r.dateChanged], [0, 1]);
  const r2 = await collectDocs({ spec: DOC_SPECS.tribunal_decision, api: makeApi(docRoutes(moved)).api, store: st, now: new Date() });
  assert.equal(r2.dateChanged, 0, "같은 날짜 변경은 한 번만");
  const serial = { ...DOC_SPECS.tribunal_decision, newRule: "serial" };
  const r3 = await collectDocs({ spec: serial, api: makeApi(docRoutes(moved)).api, store: st, now: new Date() });
  assert.deepEqual([r3.newDocs, r3.dateChanged, r3.known], [0, 0, 1]);
});

test("두 원천이 같은 문서를 주면 별칭으로만 잇는다 (문서 행 새로 만들지 않음)", async () => {
  const spec = { ...DOC_SPECS.mois_interpretation, sameAsSource: "tribunal_decision", fields: { ...DOC_SPECS.mois_interpretation.fields, sameAs: "연계번호" } };
  const list = { MoisCgmExpc: { item: [{ 법령해석일련번호: "M-1", 안건명: "시험용 안건", 해석일자: "20260501", 연계번호: "T-1" }] } };
  const st = memoryDocStore({ "tribunal_decision|T-1": { legalDocId: 77, decidedOn: "2026-04-01" } });
  const r = await collectDocs({ spec, api: makeApi(docRoutes(list)).api, store: st, now: new Date() });
  assert.deepEqual([r.aliased, r.newDocs], [1, 0]);
  assert.deepEqual([st.s.aliases[0].legalDocId, st.s.aliases[0].sourceKey, st.s.aliases[0].docId], [77, "mois_interpretation", "M-1"]);
  assert.equal(st.s.docs.size, 0);
});

test("목록 조회 실패는 아무것도 저장하지 않고 실패 기록 1건, 문서 하나의 상세 실패는 나머지를 멈추지 않는다", async () => {
  const dead = memoryDocStore();
  const r = await collectDocs({ spec: DOC_SPECS.admrul, api: makeApi(() => ({ status: 502, body: "" })).api, store: dead, now: new Date("2026-10-26T01:00:00Z"), secrets: [OC] });
  assert.deepEqual([r.failed, r.newDocs], [1, 0]);
  assert.deepEqual(dead.s.failures.map((x) => [x.sourceKey, x.day]), [["admrul", "2026-10-26"]]);
  assert.ok(!dead.s.failures[0].message.includes(OC));

  const list = { AdmRulSearch: { admrul: [
    { 행정규칙일련번호: "A-1", 행정규칙명: "시험용 하나", 발령일자: "20260301", 소관부처명: "행정안전부" },
    { 행정규칙일련번호: "A-2", 행정규칙명: "시험용 둘", 발령일자: "20260302", 소관부처명: "행정안전부" },
  ] } };
  const partial = memoryDocStore();
  const { api } = makeApi((url) => (url.includes("lawSearch.do") ? ok(list) : url.includes("ID=A-1") ? { status: 500, body: "" } : ok({ 본문: "시험용" })));
  const p = await collectDocs({ spec: DOC_SPECS.admrul, api, store: partial, now: new Date() });
  assert.deepEqual([p.newDocs, p.failed], [1, 1]);
  assert.deepEqual([...partial.s.docs.keys()], ["admrul|A-2"]);
});
