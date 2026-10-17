// 홈 배치 home_curations (PRD-01A HOME-03) — docs/dev/W2-b_설계.md 3장
// ① 종류와 대상이 맞아야 한다 ② 노출 기간 ends_on ≥ starts_on ③ 같은 날 보이는 스토리 카드 6장까지 — 7장째 거부,
//    기간이 겹치지 않으면(끝난 뒤 시작) 7번째 행도 저장 ④ 트래커 하이라이트는 같은 날 3장까지 ⑤ 같은 대상의 기간 겹침 거부
// ⑥ 광고·금주 핫뉴스는 스토리 카드 거부 ⑦ 기간을 늘려 겹치게 만드는 수정도 같은 규칙 ⑧ 대상을 지우면 배치도 지워진다
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

async function tx(fn) {
  await client.query("begin");
  try {
    // 다른 시험·E2E가 남긴 배치와 섞이지 않게 이 트랜잭션 안에서만 비운다 (되돌린다)
    await client.query("delete from public.home_curations");
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

async function attempt(sql, params = []) {
  await client.query("savepoint t");
  try {
    const res = await client.query(sql, params);
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, message: err.message, code: err.code };
  }
}

let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
function insertSql(table, cols) {
  const keys = Object.keys(cols);
  return { sql: `insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, params: keys.map((k) => cols[k]) };
}
const insert = async (table, cols) => {
  const { sql, params } = insertSql(table, cols);
  return (await client.query(sql, params)).rows[0];
};
const tryInsert = (table, cols) => {
  const { sql, params } = insertSql(table, cols);
  return attempt(sql, params);
};

const article = (over = {}) => insert("articles", { slug: uniq("a"), title: "해설 기사", section: "tax", content_type: "explainer", ...over });
const amendment = () => insert("amendments", { slug: uniq("am"), title: "시험 개정안", status: "public" });
const story = async (starts_on, ends_on = null, over = {}) =>
  tryInsert("home_curations", { kind: "story", article_id: (await article()).id, starts_on, ends_on, created_by: "user:편집자", ...over });
const tracker = async (starts_on, ends_on = null) =>
  tryInsert("home_curations", { kind: "tracker", amendment_id: (await amendment()).id, starts_on, ends_on, created_by: "user:편집자" });

test("종류와 대상 — tracker는 개정안만, story는 기사만, 둘 다·둘 다 없음 거부", () =>
  tx(async () => {
    const a = await article();
    const m = await amendment();
    const C = { starts_on: "2026-11-01", created_by: "user:편집자" };
    assert.ok((await tryInsert("home_curations", { kind: "tracker", amendment_id: m.id, ...C })).ok);
    assert.ok((await tryInsert("home_curations", { kind: "story", article_id: a.id, ...C })).ok);
    for (const bad of [
      { kind: "tracker", article_id: a.id },
      { kind: "story", amendment_id: m.id },
      { kind: "story", article_id: a.id, amendment_id: m.id },
      { kind: "tracker" },
    ]) {
      const r = await tryInsert("home_curations", { ...bad, ...C, starts_on: "2027-03-01" });
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.equal(r.code, "23514", r.message);
    }
    assert.equal((await tryInsert("home_curations", { kind: "story", article_id: a.id, starts_on: "2027-05-01" })).ok, false, "만든 사람(created_by) 필수");
  }));

test("노출 기간 — 끝이 시작보다 앞이면 거부, 같은 날·끝 없음은 저장", () =>
  tx(async () => {
    const bad = await story("2026-11-02", "2026-11-01");
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "23514");
    assert.ok((await story("2026-11-01", "2026-11-01")).ok, "하루만");
    assert.ok((await story("2026-11-01", null)).ok, "끝 없음");
  }));

test("스토리 카드 — 같은 날 6장까지, 7장째는 거부 (HOME-03 '7장째는 지정할 수 없다')", () =>
  tx(async () => {
    for (let i = 0; i < 6; i++) {
      const r = await story("2026-11-01", "2026-11-30");
      assert.ok(r.ok, `${i + 1}장째: ${r.message}`);
    }
    const seventh = await story("2026-11-15", "2026-12-15");
    assert.equal(seventh.ok, false);
    assert.equal(seventh.code, "23514");
    assert.match(seventh.message, /6장까지/);
    const { rows } = await client.query("select count(*)::int n from public.home_curations where kind = 'story'");
    assert.equal(rows[0].n, 6);
  }));

test("스토리 카드 — 끝난 카드와 겹치지 않는 기간이면 7번째 행도 저장 (끝난 카드는 세지 않는다), 하루라도 겹치면 거부", () =>
  tx(async () => {
    for (let i = 0; i < 6; i++) assert.ok((await story("2026-11-01", "2026-11-30")).ok);
    assert.ok((await story("2026-12-01", "2026-12-31")).ok, "11월 카드가 끝난 다음 날 시작");
    const overlapOneDay = await story("2026-11-30", "2026-12-05");
    assert.equal(overlapOneDay.ok, false, "11-30 하루 겹침 — 그날 7장(11월 6장 + 이 카드)");
    // 끝 없는 카드 6장이 있으면 앞으로 어느 날에도 더할 수 없다
  }));

test("스토리 카드 — 기간이 나뉘어 겹쳐도 같은 날 기준으로 센다 (시작일마다 최대값)", () =>
  tx(async () => {
    // 11/1~11/10 3장, 11/5~11/20 3장 → 11/5~11/10에 6장
    for (let i = 0; i < 3; i++) assert.ok((await story("2026-11-01", "2026-11-10")).ok);
    for (let i = 0; i < 3; i++) assert.ok((await story("2026-11-05", "2026-11-20")).ok);
    assert.ok((await story("2026-11-11", "2026-11-30")).ok, "11/11부터는 4장 → 5장");
    const peak = await story("2026-10-25", "2026-11-06");
    assert.equal(peak.ok, false, "새 카드 시작일(10/25)에는 0장이지만 11/5에 7장");
    assert.match(peak.message, /2026-11-05/);
  }));

test("트래커 하이라이트 — 같은 날 3장까지, 4장째 거부", () =>
  tx(async () => {
    for (let i = 0; i < 3; i++) assert.ok((await tracker("2026-11-01", null)).ok);
    const fourth = await tracker("2026-11-02", "2026-11-03");
    assert.equal(fourth.ok, false);
    assert.match(fourth.message, /3장까지/);
    assert.ok((await story("2026-11-01", null)).ok, "트래커 상한은 스토리 카드와 따로 센다");
  }));

test("같은 대상을 겹치는 기간에 두 번 지정하면 거부, 겹치지 않으면 저장", () =>
  tx(async () => {
    const a = await article();
    const C = { kind: "story", article_id: a.id, created_by: "user:편집자" };
    assert.ok((await tryInsert("home_curations", { ...C, starts_on: "2026-11-01", ends_on: "2026-11-10" })).ok);
    const dup = await tryInsert("home_curations", { ...C, starts_on: "2026-11-10", ends_on: "2026-11-20" });
    assert.equal(dup.ok, false);
    assert.match(dup.message, /같은 대상/);
    assert.ok((await tryInsert("home_curations", { ...C, starts_on: "2026-11-11", ends_on: null })).ok);
  }));

test("기간을 늘려 상한을 넘기는 수정도 거부 (UPDATE도 같은 규칙)", () =>
  tx(async () => {
    for (let i = 0; i < 6; i++) assert.ok((await story("2026-11-01", "2026-11-30")).ok);
    const later = await story("2026-12-01", "2026-12-31");
    assert.ok(later.ok);
    const stretch = await attempt("update public.home_curations set starts_on = '2026-11-20' where id = $1", [later.rows[0].id]);
    assert.equal(stretch.ok, false);
    assert.match(stretch.message, /6장까지/);
    assert.ok((await attempt("update public.home_curations set sort = 99 where id = $1", [later.rows[0].id])).ok, "순서만 바꾸면 자기 자신은 세지 않는다");
  }));

test("광고(sponsored)·금주 핫뉴스(digest)는 스토리 카드로 둘 수 없다", () =>
  tx(async () => {
    const partner = await insert("partners", { name: "시험 제휴사", kind: "media" });
    const ad = await article({ content_type: "sponsored", label: "ad", partner_id: partner.id });
    const digest = await article({ content_type: "digest", digest_id: 1 });
    for (const a of [ad, digest]) {
      const r = await tryInsert("home_curations", { kind: "story", article_id: a.id, starts_on: "2026-11-01", created_by: "user:편집자" });
      assert.equal(r.ok, false, a.content_type);
      assert.match(r.message, /해설 스토리 카드로 둘 수 없습니다/);
    }
    for (const type of ["reported_news", "guide", "opinion"]) {
      const a = await article({ content_type: type });
      assert.ok((await tryInsert("home_curations", { kind: "story", article_id: a.id, starts_on: "2026-11-01", created_by: "user:편집자" })).ok, type);
    }
  }));

test("대상 기사·개정안을 지우면 배치도 지워진다", () =>
  tx(async () => {
    const a = await article();
    const m = await amendment();
    await insert("home_curations", { kind: "story", article_id: a.id, starts_on: "2026-11-01", created_by: "user:편집자" });
    await insert("home_curations", { kind: "tracker", amendment_id: m.id, starts_on: "2026-11-01", created_by: "user:편집자" });
    await client.query("delete from public.articles where id = $1", [a.id]);
    await client.query("delete from public.amendments where id = $1", [m.id]);
    const { rows } = await client.query("select count(*)::int n from public.home_curations where article_id = $1 or amendment_id = $2", [a.id, m.id]);
    assert.equal(rows[0].n, 0);
  }));
