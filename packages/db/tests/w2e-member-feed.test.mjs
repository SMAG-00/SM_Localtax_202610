// W2-e 3-A 내 관심 분야 새 글 — docs/dev/W2-e_설계.md 5.2 (HOME-07)
//  · 분야 · 하위 분야 · 시·도 → 아래 시·군·구 · 광고/핫뉴스 제외 · 14일 경계 · 6건 · 비공개 0 · 권한(service_role만) · analytics_events를 읽지 않음
// 모두 한 트랜잭션 안에서 넣고 되돌린다. 로컬 DB에서만 돈다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돈다");
  client = await connect();
});
after(async () => client?.end());

async function tx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}
async function attempt(sql, params = [], role = null) {
  await client.query("savepoint t");
  try {
    if (role) await client.query(`set local role ${role}`);
    const res = await client.query(sql, params);
    if (role) await client.query("reset role");
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, code: err.code, message: err.message };
  }
}
let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
async function insert(table, cols) {
  const k = Object.keys(cols);
  const sql = `insert into public.${table} (${k.join(", ")}) values (${k.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
  return (await client.query(sql, k.map((x) => cols[x]))).rows[0];
}
const para = (text) => JSON.stringify({ blocks: [{ type: "paragraph", text }], claims: [] });

async function fixture() {
  const reporter = await insert("people", { slug: uniq("p"), name: "피드 시험 기자", roles: ["reporter"], visibility: "public" });
  const article = (over) =>
    insert("articles", { slug: uniq("a"), title: "피드 시험 기사", section: "tax", content_type: "explainer", status: "published", author_id: reporter.id, body: para("본문"), ...over });
  const sido = (await client.query("select code from public.regions where level = 'sido' and (valid_to is null or valid_to >= current_date) order by code limit 1")).rows[0].code;
  const gu = await insert("regions", { code: `${sido.slice(0, 2)}9${String(++seq).padStart(2, "0")}00000`, parent_code: sido, level: "sigungu", slug: uniq("gu"), name: "피드시험구" });
  const cat = (await client.query("select slug, id from public.categories where section = 'tax' and visible order by id limit 1")).rows[0];
  return { article, sido, gu, cat };
}
const feed = async (interests, regions, extra = [], role = "service_role") => {
  const r = await attempt("select * from public.member_feed($1::text[], $2::text[]" + (extra.length ? ", $3, $4" : "") + ")", [interests, regions, ...extra], role);
  assert.ok(r.ok, r.message);
  return r.rows;
};
const daysAgo = (n, extraMinutes = 0) => new Date(Date.now() - n * 86400000 + extraMinutes * 60000);

test("분야 값(tax)에 맞는 공개 기사만 나오고 다른 분야·비공개(초안)·유료는 나오지 않는다", () =>
  tx(async () => {
    const f = await fixture();
    const mine = await f.article({ first_published_at: daysAgo(1) });
    const other = await f.article({ section: "finance", first_published_at: daysAgo(1) });
    const draft = await f.article({ status: "draft" });
    const paid = await f.article({ is_paid: true, first_published_at: daysAgo(1) });
    const ids = (await feed(["tax"], [])).map((r) => String(r.id));
    assert.ok(ids.includes(String(mine.id)));
    for (const x of [other, draft, paid]) assert.ok(!ids.includes(String(x.id)), `${x.slug} 제외`);
  }));

test("하위 분야 값(section:slug)은 그 하위 분야 기사만 고른다", () =>
  tx(async () => {
    const f = await fixture();
    const inCat = await f.article({ category_id: f.cat.id, first_published_at: daysAgo(1) });
    const noCat = await f.article({ first_published_at: daysAgo(1) });
    const ids = (await feed([`tax:${f.cat.slug}`], [])).map((r) => String(r.id));
    assert.ok(ids.includes(String(inCat.id)));
    assert.ok(!ids.includes(String(noCat.id)), "하위 분야 없는 기사는 제외");
  }));

test("관심 지역이 시·도면 아래 시·군·구 태그 기사도, 시·군·구면 그 코드 기사만 나온다", () =>
  tx(async () => {
    const f = await fixture();
    const inGu = await f.article({ region_codes: [f.gu.code], section: "local", first_published_at: daysAgo(1) });
    const inSido = await f.article({ region_codes: [f.sido], section: "local", first_published_at: daysAgo(1) });
    const none = await f.article({ section: "local", first_published_at: daysAgo(1) });
    const bySido = (await feed([], [f.sido])).map((r) => String(r.id));
    assert.ok(bySido.includes(String(inGu.id)) && bySido.includes(String(inSido.id)));
    assert.ok(!bySido.includes(String(none.id)));
    const byGu = (await feed([], [f.gu.code])).map((r) => String(r.id));
    assert.ok(byGu.includes(String(inGu.id)));
    assert.ok(!byGu.includes(String(inSido.id)), "시·군·구를 고르면 시·도 전체 태그 기사는 제외");
  }));

test("광고(sponsored)와 금주 핫뉴스(digest)는 분야가 맞아도 넣지 않는다", () =>
  tx(async () => {
    const f = await fixture();
    const normal = await f.article({ first_published_at: daysAgo(1) });
    const made = [];
    made.push(await f.article({ content_type: "sponsored", label: "ad", first_published_at: daysAgo(1) }));
    made.push(await f.article({ content_type: "digest", digest_id: 1, first_published_at: daysAgo(1) }));
    const ids = (await feed(["tax"], [])).map((r) => String(r.id));
    assert.ok(ids.includes(String(normal.id)));
    for (const x of made) assert.ok(!ids.includes(String(x.id)), `${x.content_type} 제외`);
  }));

test("14일 경계 — 13일 23시간 전 기사는 나오고 14일 1시간 전 기사는 빠진다", () =>
  tx(async () => {
    const f = await fixture();
    const inside = await f.article({ first_published_at: daysAgo(14, 60) });
    const outside = await f.article({ first_published_at: daysAgo(14, -60) });
    const ids = (await feed(["tax"], [])).map((r) => String(r.id));
    assert.ok(ids.includes(String(inside.id)), "14일 안");
    assert.ok(!ids.includes(String(outside.id)), "14일 밖");
  }));

test("기본 6건·최신순이고 p_limit을 주면 그 건수까지", () =>
  tx(async () => {
    const f = await fixture();
    for (let n = 1; n <= 8; n += 1) await f.article({ first_published_at: daysAgo(0, -n * 10) });
    const rows = await feed(["tax"], []);
    assert.equal(rows.length, 6);
    const times = rows.map((r) => new Date(r.first_published_at).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => b - a), "최신순");
    assert.equal((await feed(["tax"], [], [3, 2])).length, 2);
  }));

test("관심 값이 둘 다 비면 0건이고 잘못된 일수·건수는 22023으로 거부한다", () =>
  tx(async () => {
    assert.deepEqual(await feed([], []), []);
    for (const bad of [[0, 6], [366, 6], [14, 0], [14, 51]]) {
      const r = await attempt("select * from public.member_feed($1::text[], $2::text[], $3, $4)", [["tax"], [], ...bad], "service_role");
      assert.equal(r.ok, false);
      assert.equal(r.code, "22023");
    }
  }));

test("권한 — service_role만 실행하고 anon·authenticated는 거부된다", () =>
  tx(async () => {
    for (const role of ["anon", "authenticated"]) {
      const r = await attempt("select * from public.member_feed($1::text[], $2::text[])", [["tax"], []], role);
      assert.equal(r.ok, false, `${role} 거부`);
      assert.equal(r.code, "42501");
    }
  }));

test("함수 정의가 analytics_events를 읽지 않는다 (행동 추적 개인화 0)", async () => {
  const { rows } = await client.query("select pg_get_functiondef('public.member_feed(text[],text[],integer,integer)'::regprocedure) as def");
  assert.ok(!/analytics_events|article_rankings/i.test(rows[0].def));
});
