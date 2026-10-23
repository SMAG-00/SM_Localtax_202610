// W4 21단계 DB — 부동산 칼럼 이해관계 3항목 (docs/dev/W4_설계.md 1장 21단계 · 11.21 · 12장 #170, 마이그레이션 20261023000055 · PRD-01B PR-14)
//  · 값 목록 = 설계 2.1 · 하위 분야 realestate/columns · 씨앗 행 0
//  · 부동산 칼럼 발행: 3항목 중 하나라도 비면 거부(빠진 항목이 문장에) · 다른 분야 칼럼은 그대로 · 대상 아님(칼럼 기록 없음 + 기능 키 꺼짐)은 그대로
//  · '없음'은 확인자·시각이 있어야만 저장 · 부동산 칼럼이 아닌 기사에는 항목 저장 거부 · 발행된 칼럼의 항목은 지울 수 없음
//  · 공개 뷰: 공개 기사의 항목만, 확인자 칸 없음 · 표 anon 거부
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0). 칼럼·필자 내용은 시험용 가짜다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

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
async function tx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}
let seq = 0;
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const col = (over = {}) => {
  const row = { slug: `w4rc-${process.pid}-${++seq}`, title: "시험용 부동산 칼럼", section: "realestate", content_type: "opinion", status: "draft", ...over };
  const keys = Object.keys(row);
  return client.query(`insert into public.articles (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => row[k])).then((r) => r.rows[0]);
};
const item = (id, name, state, extra = {}) => {
  const row = { article_id: id, item: name, state, ...(state === "declared" ? { interest_text: "시험용 자문 관계" } : { confirmed_by: "시험용 확인자", confirmed_at: new Date().toISOString() }), ...extra };
  const keys = Object.keys(row);
  return attempt(`insert into public.column_interest_items (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => row[k]));
};
const publish = (id) => attempt("update public.articles set status = 'published' where id = $1 returning status", [id]);
const flagOn = (on) => client.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify({ tax_columns: on })]);
async function addMeta(articleId) {
  const p = await one("insert into public.people (slug, name, roles, employment) values ($1, '시험용 필자', array['writer'], 'external') returning id", [`w4rc-p-${process.pid}-${++seq}`]);
  await client.query("insert into public.column_meta (article_id, person_id, interest_state, interest_text) values ($1, $2, 'declared', '시험용')", [articleId, p.id]);
}

test("값 목록 — 항목은 조합·시공사·신탁사 3종, 상태는 declared·none_confirmed (설계 2.1), 하위 분야 realestate/columns, 씨앗 행 0", async () => {
  await tx(async () => {
    const a = await col();
    const bad = await item(a.id, "architect", "declared");
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "23514");
    const badState = await item(a.id, "union", "maybe", { interest_text: "x" });
    assert.equal(badState.ok, false);
    assert.equal(badState.code, "23514");
    for (const name of ["union", "contractor", "trust_company"]) assert.ok((await item(a.id, name, "declared")).ok, name);
    const c = await one("select name, visible from public.categories where section = 'realestate' and slug = 'columns'");
    assert.deepEqual(c, { name: "칼럼", visible: true });
  });
  const seed = await one("select count(*)::int as n from public.column_interest_items");
  assert.equal(seed.n, 0, "씨앗 행 0");
});

test("저장 검사 — declared는 내용 필수, none_confirmed는 확인자·시각 필수, 같은 항목 두 번 0", async () => {
  await tx(async () => {
    const a = await col();
    assert.equal((await item(a.id, "union", "declared", { interest_text: "  " })).ok, false, "빈 내용");
    assert.equal((await item(a.id, "union", "none_confirmed", { confirmed_by: null })).ok, false, "확인자 없음");
    assert.equal((await item(a.id, "union", "none_confirmed", { confirmed_at: null })).ok, false, "확인 시각 없음");
    assert.ok((await item(a.id, "union", "none_confirmed")).ok);
    const dup = await item(a.id, "union", "declared");
    assert.equal(dup.ok, false);
    assert.equal(dup.code, "23505");
  });
});

test("부동산 칼럼이 아닌 기사(다른 분야 칼럼·부동산 보도기사)에는 항목 저장 거부", async () => {
  await tx(async () => {
    const tax = await col({ section: "tax" });
    const news = await col({ content_type: "reported_news" });
    for (const a of [tax, news]) {
      const r = await item(a.id, "union", "declared");
      assert.equal(r.ok, false);
      assert.match(r.message, /부동산 칼럼/);
    }
  });
});

test("발행 검사 — 칼럼 기록이 있는 부동산 칼럼은 3항목 중 하나라도 비면 거부하고 빠진 항목을 문장에 담는다", async () => {
  await tx(async () => {
    const a = await col();
    await addMeta(a.id);
    const none = await publish(a.id);
    assert.equal(none.ok, false);
    assert.equal(none.code, "23514");
    assert.match(none.message, /빠진 항목: 조합 자문 관계·시공사 자문 관계·신탁사 자문 관계/);
    await item(a.id, "union", "declared");
    await item(a.id, "trust_company", "none_confirmed");
    const two = await publish(a.id);
    assert.equal(two.ok, false);
    assert.match(two.message, /빠진 항목: 시공사 자문 관계\./);
    assert.ok(!two.message.includes("조합 자문 관계"), "채운 항목은 빠진 항목에 없다");
    assert.ok((await item(a.id, "contractor", "none_confirmed")).ok);
    // W3 칼럼 발행 검사(필자 검증 등)가 따로 막을 수 있으므로, 여기서는 이 규칙의 문장이 더는 나오지 않는 것을 본다
    const done = await publish(a.id);
    assert.ok(done.ok || !/3항목/.test(done.message), done.message);
  });
});

test("대상 판정 — 칼럼 기록 없음 + 기능 키 tax_columns 꺼짐이면 W3처럼 그대로, 켜지면 모든 부동산 칼럼에 적용", async () => {
  await tx(async () => {
    await flagOn(false);
    const off = await col();
    assert.ok((await publish(off.id)).ok, "대상 아님 — 달라진 것 없음");
    await flagOn(true);
    const on = await col();
    const r = await publish(on.id);
    assert.equal(r.ok, false);
    assert.match(r.message, /3항목/, "기능 키가 켜지면 칼럼 기록이 없어도 3항목 문장이 먼저 막는다");
  });
});

test("다른 분야 칼럼과 보도기사는 달라지지 않는다 — 항목 0이어도 이 규칙에 걸리지 않는다", async () => {
  await tx(async () => {
    await flagOn(false);
    const tax = await col({ section: "tax" });
    const finance = await col({ section: "finance" });
    const news = await col({ content_type: "reported_news" });
    for (const a of [tax, finance, news]) assert.ok((await publish(a.id)).ok, a.section);
  });
});

test("이미 공개된 칼럼은 그대로 두고, 발행된 칼럼의 항목은 지울 수 없다(고치기만)", async () => {
  await tx(async () => {
    await flagOn(false);
    const a = await col();
    await item(a.id, "union", "declared");
    assert.ok((await publish(a.id)).ok);
    await flagOn(true);
    assert.ok((await attempt("update public.articles set title = '시험용 고침' where id = $1", [a.id])).ok, "공개분 유지");
    const del = await attempt("delete from public.column_interest_items where article_id = $1 and item = 'union'", [a.id]);
    assert.equal(del.ok, false);
    assert.match(del.message, /지울 수 없습니다/);
    assert.ok((await attempt("update public.column_interest_items set interest_text = '시험용 고친 내용' where article_id = $1", [a.id])).ok);
  });
});

test("공개 뷰 — 공개 기사의 항목만, 내용은 declared일 때만, 확인자·시각 칸 없음 / 표는 anon 거부", async () => {
  await tx(async () => {
    const pub = await col({ status: "published", first_published_at: new Date().toISOString() });
    const draft = await col();
    await item(pub.id, "union", "declared");
    await item(pub.id, "contractor", "none_confirmed");
    await item(draft.id, "union", "declared");
    const rows = (await client.query("select item, state, interest_text from public.public_column_interest_items where article_id = any($1::bigint[]) order by item", [[pub.id, draft.id]])).rows;
    assert.deepEqual(rows, [
      { item: "contractor", state: "none_confirmed", interest_text: null },
      { item: "union", state: "declared", interest_text: "시험용 자문 관계" },
    ]);
    const cols = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'public_column_interest_items'")).rows.map((r) => r.column_name).sort();
    assert.deepEqual(cols, ["article_id", "interest_text", "item", "state"]);
    await client.query("set local role anon");
    const t = await attempt("select * from public.column_interest_items");
    assert.equal(t.ok, false);
    assert.equal(t.code, "42501");
    assert.ok((await attempt("select * from public.public_column_interest_items")).ok, "뷰는 읽힌다");
    const fn = await attempt("select public.realestate_column_interest_problem(a) from public.articles a limit 1");
    assert.equal(fn.ok, false);
    assert.equal(fn.code, "42501");
  });
});
