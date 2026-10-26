// W12-g DB - 키워드 맵 집계 (마이그레이션 176, PRD-04 CASE-06)
//  · 정책 모양 검사(max_nodes 1~50, min_docs 1 이상, 모르는 칸 거부), 정책이 비거나 기능 키가 꺼지면 모든 뷰 0행
//  · 승인된 연결만 센다 (제안 상태·폐기 태그 0), 노드 건수 = 그 노드 태그로 거른 목록 건수, 두 태그 AND, 연결선 건수 = 함께 붙은 결정례 수
//  · 세목마다 따로 센다, 상한(max_nodes)·최소 건수(min_docs) 적용, anon이 뷰를 읽고 표는 못 읽는다
// 모든 시험은 거래 안에서 돌고 되돌린다. 태그·결정례는 모두 시험용 가짜다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { open, helpers } from "./_w10d_helpers.mjs";

let client;
let h;
before(async () => {
  client = await open();
  h = helpers(client);
});
after(async () => client?.end());

const ACTOR = "admin:test@example.test";
const key = () => `tag_${h.uniq("k").replace(/[^a-z0-9]/gi, "_").toLowerCase()}`.slice(0, 39);
const setKeywordMapFlag = (on) => client.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify({ keyword_map: on })]);
async function setPolicy(value) {
  await client.query("update public.settings set value = $1::jsonb where key = 'keyword_map_policy'", [JSON.stringify(value)]);
}
async function openMap(policy = { max_nodes: 30 }) {
  await h.flags({ case_db: true });
  await setKeywordMapFlag(true);
  await setPolicy(policy);
}
async function approvedTag(label = "시험용 태그") {
  const k = key();
  const p = await h.one("insert into public.issue_tags (tag_key, label, hub, proposed_by) values ($1, $2, 'trust', 'test') returning id, tag_key", [k, label]);
  assert.equal((await h.one("select public.issue_tag_approve($1, $2) r", [p.id, ACTOR])).r.ok, true);
  return p;
}
/** 결정례에 태그를 붙이고 연결을 승인한다 (approve=false면 제안 상태로 둔다) */
async function tagDoc(doc, tag, approve = true) {
  const l = await h.one("insert into public.case_issue_tags (case_id, issue_tag_id, applied_by) values ($1, $2, 'test') returning id", [doc, tag.id]);
  if (approve) assert.equal((await h.one("select public.case_issue_tag_approve($1, $2) r", [l.id, ACTOR])).r.ok, true);
  return l;
}
const nodes = (tax) => h.anon("select tag_key, label, n, rank from public.public_keyword_map_nodes where tax_kind = $1 order by rank", [tax]);
const docsOf = async (tax, tags) => (await h.anon("select case_id from public.public_keyword_map_docs where tax_kind = $1 and tag_keys @> $2::text[]", [tax, tags])).rows;

test("정책 모양 — 상한 1~50 정수, 최소 건수 1 이상, 모르는 칸 거부, 빈 값은 허용", () =>
  h.tx(async () => {
    const bad = async (v) => (await h.attempt("update public.settings set value = $1::jsonb where key = 'keyword_map_policy'", [JSON.stringify(v)])).ok;
    assert.equal(await bad({ max_nodes: 0 }), false);
    assert.equal(await bad({ max_nodes: 51 }), false);
    assert.equal(await bad({ max_nodes: 2.5 }), false);
    assert.equal(await bad({ max_nodes: "30" }), false);
    assert.equal(await bad({ min_docs: 1 }), false, "max_nodes 없음");
    assert.equal(await bad({ max_nodes: 30, min_docs: 0 }), false);
    assert.equal(await bad({ max_nodes: 30, extra: 1 }), false);
    assert.equal(await bad({ max_nodes: 30, min_docs: 2 }), true);
    assert.equal(await bad({}), true);
  }));

test("닫힘 — 정책이 비어 있거나 기능 키가 꺼지면 모든 뷰 0행 (승인 태그가 있어도)", () =>
  h.tx(async () => {
    await openMap();
    const doc = await h.doc({ tax_kinds: ["취득세"] });
    await tagDoc(doc, await approvedTag());
    const all = async () => [
      (await h.anon("select * from public.public_keyword_map_policy")).rows.length,
      (await h.anon("select * from public.public_keyword_map_docs")).rows.length,
      (await h.anon("select * from public.public_keyword_map_nodes")).rows.length,
      (await h.anon("select * from public.public_keyword_map_edges")).rows.length,
    ];
    assert.deepEqual((await all()).map((n) => n > 0), [true, true, true, false]);
    await setPolicy({});
    assert.deepEqual(await all(), [0, 0, 0, 0], "정책 비면 닫힘");
    await setPolicy({ max_nodes: 30 });
    await setKeywordMapFlag(false);
    assert.deepEqual(await all(), [0, 0, 0, 0], "기능 키 꺼짐");
  }));

test("승인 전 태그 0 — 제안 상태 연결·폐기된 태그는 노드와 목록에 없다", () =>
  h.tx(async () => {
    await openMap();
    const doc = await h.doc({ tax_kinds: ["취득세"] });
    const tag = await approvedTag();
    await tagDoc(doc, tag, false);
    assert.equal((await nodes("취득세")).rows.filter((r) => r.tag_key === tag.tag_key).length, 0, "연결 승인 전 0");
    assert.equal((await docsOf("취득세", [tag.tag_key])).length, 0);
    const link = await h.one("select id from public.case_issue_tags where case_id = $1", [doc]);
    await h.one("select public.case_issue_tag_approve($1, $2) r", [link.id, ACTOR]);
    assert.equal((await nodes("취득세")).rows.find((r) => r.tag_key === tag.tag_key)?.n, 1);
    await h.one("select public.issue_tag_retire($1, $2) r", [tag.id, ACTOR]);
    assert.equal((await nodes("취득세")).rows.filter((r) => r.tag_key === tag.tag_key).length, 0, "폐기하면 빠진다");
    assert.equal((await docsOf("취득세", [tag.tag_key])).length, 0);
  }));

test("집계 일치 — 노드 결정례 수 = 그 태그로 거른 목록 건수, 두 태그 AND, 연결선 건수 = 함께 붙은 결정례 수", () =>
  h.tx(async () => {
    await openMap();
    const a = await approvedTag("시험용 A");
    const b = await approvedTag("시험용 B");
    const c = await approvedTag("시험용 C");
    const d1 = await h.doc({ tax_kinds: ["취득세"] });
    const d2 = await h.doc({ tax_kinds: ["취득세"] });
    const d3 = await h.doc({ tax_kinds: ["취득세"] });
    await tagDoc(d1, a);
    await tagDoc(d1, b);
    await tagDoc(d2, a);
    await tagDoc(d2, b);
    await tagDoc(d3, a);
    await tagDoc(d3, c);
    const n = (await nodes("취득세")).rows;
    const byKey = Object.fromEntries(n.map((r) => [r.tag_key, r]));
    assert.equal(byKey[a.tag_key].n, 3);
    assert.equal(byKey[b.tag_key].n, 2);
    assert.equal(byKey[c.tag_key].n, 1);
    for (const t of [a, b, c]) assert.equal((await docsOf("취득세", [t.tag_key])).length, byKey[t.tag_key].n, "노드 수 = 목록 건수");
    assert.deepEqual((await docsOf("취득세", [a.tag_key, b.tag_key])).map((r) => r.case_id).sort(), [d1, d2].sort(), "두 태그 AND");
    assert.equal((await docsOf("취득세", [b.tag_key, c.tag_key])).length, 0);
    const [lo, hi] = [a.tag_key, b.tag_key].sort();
    const e = await h.anon("select n from public.public_keyword_map_edges where tax_kind = '취득세' and tag_a = $1 and tag_b = $2", [lo, hi]);
    assert.equal(e.rows[0].n, 2, "A-B 함께 붙은 결정례 2건");
    assert.equal(n[0].tag_key, a.tag_key, "건수 많은 순");
  }));

test("세목별로 따로 센다 — 여러 세목 결정례는 세목마다 1건씩", () =>
  h.tx(async () => {
    await openMap();
    const a = await approvedTag();
    const d1 = await h.doc({ tax_kinds: ["취득세", "재산세"] });
    const d2 = await h.doc({ tax_kinds: ["재산세"] });
    await tagDoc(d1, a);
    await tagDoc(d2, a);
    assert.equal((await nodes("취득세")).rows.find((r) => r.tag_key === a.tag_key).n, 1);
    assert.equal((await nodes("재산세")).rows.find((r) => r.tag_key === a.tag_key).n, 2);
  }));

test("상한·최소 건수 — max_nodes 밖 노드와 min_docs 미만 노드는 빠지고, 연결선도 노드에 든 것만", () =>
  h.tx(async () => {
    await openMap({ max_nodes: 2, min_docs: 1 });
    const a = await approvedTag();
    const b = await approvedTag();
    const c = await approvedTag();
    const d1 = await h.doc({ tax_kinds: ["취득세"] });
    const d2 = await h.doc({ tax_kinds: ["취득세"] });
    for (const t of [a, b, c]) await tagDoc(d1, t);
    for (const t of [a, b]) await tagDoc(d2, t);
    const shown = (await nodes("취득세")).rows.map((r) => r.tag_key).sort();
    assert.deepEqual(shown, [a.tag_key, b.tag_key].sort(), "건수 2인 둘만 (상한 2)");
    const edges = (await h.anon("select tag_a, tag_b from public.public_keyword_map_edges where tax_kind = '취득세'")).rows;
    assert.equal(edges.length, 1, "노드에 없는 C가 낀 연결선은 빠진다");
    await setPolicy({ max_nodes: 10, min_docs: 2 });
    assert.deepEqual((await nodes("취득세")).rows.map((r) => r.tag_key).sort(), [a.tag_key, b.tag_key].sort(), "min_docs 2 미만 C 제외");
  }));

test("권한 — anon은 뷰는 읽고 표(case_issue_tags)는 못 읽는다", () =>
  h.tx(async () => {
    await openMap();
    assert.equal((await h.anon("select * from public.public_keyword_map_nodes")).ok, true);
    assert.equal((await h.anon("select * from public.case_issue_tags")).ok, false);
  }));
