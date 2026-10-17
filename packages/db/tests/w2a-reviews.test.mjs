// 편집 승인·세무 감수 기록(editorial_reviews) — NAV-03 · NAV-12 · ART-01.
// ① 작성 기자 본인의 편집 승인(desk_edit)은 거부 — 관리자(PO)도 예외 없음 (PRD-00 6장)
// ② desk_edit와 tax_review는 서로를 대신하지 않는다 — 기사의 편집 승인 상태(editorial_status)와 세무 감수 상태(tax_review_status)는
//    각각 자기 종류의 기록으로만 '승인'이 된다
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
    return { ok: false, message: err.message, code: err.code };
  }
}

let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
const person = async (roles = ["reporter"]) => (await client.query("insert into public.people (slug, name, roles) values ($1, '시험', $2) returning id", [uniq("p"), roles])).rows[0].id;
const article = async (authorId, over = {}) =>
  (
    await client.query("insert into public.articles (slug, title, section, content_type, author_id, tax_review_status) values ($1, 't', 'tax', $2, $3, $4) returning *", [
      uniq("a"),
      over.content_type ?? "reported_news",
      authorId,
      over.tax_review_status ?? "not_required",
    ])
  ).rows[0];
const REVIEW = "insert into public.editorial_reviews (article_id, kind, reviewer_id, decision, reason) values ($1, $2, $3, $4, $5) returning *";
const statusOf = async (id) => (await client.query("select editorial_status, tax_review_status from public.articles where id = $1", [id])).rows[0];

for (const decision of ["approve", "reject", "hold"]) {
  for (const role of ["service_role", null]) {
    test(`작성 기자 본인의 desk_edit(${decision})는 거부 — ${role ?? "테이블 소유자"}`, () =>
      tx(async () => {
        const reporter = await person(["reporter", "editor"]);
        const a = await article(reporter);
        const r = await attempt(REVIEW, [a.id, "desk_edit", reporter, decision, "사유"], role);
        assert.equal(r.ok, false);
        assert.match(r.message, /작성|NAV-12/);
        assert.equal((await statusOf(a.id)).editorial_status, "pending");
      }));
  }
}

test("다른 편집자의 desk_edit 승인은 저장되고 기사의 편집 승인 상태가 approved가 된다", () =>
  tx(async () => {
    const a = await article(await person());
    const editor = await person(["editor"]);
    const r = await attempt(REVIEW, [a.id, "desk_edit", editor, "approve", null], "service_role");
    assert.ok(r.ok, r.message);
    assert.equal((await statusOf(a.id)).editorial_status, "approved");
  }));

test("desk_edit 승인은 세무 감수를 대신하지 않는다 — 세무 감수 상태는 그대로", () =>
  tx(async () => {
    const a = await article(await person(), { content_type: "explainer", tax_review_status: "pending" });
    await client.query(REVIEW, [a.id, "desk_edit", await person(["editor"]), "approve", null]);
    assert.deepEqual(await statusOf(a.id), { editorial_status: "approved", tax_review_status: "pending" });
  }));

test("tax_review 승인은 편집 승인을 대신하지 않는다 — 편집 승인 상태는 그대로", () =>
  tx(async () => {
    const a = await article(await person(), { content_type: "explainer", tax_review_status: "pending" });
    await client.query(REVIEW, [a.id, "tax_review", await person(["reviewer"]), "approve", null]);
    assert.deepEqual(await statusOf(a.id), { editorial_status: "pending", tax_review_status: "approved" });
  }));

test("기록 없이 상태 칸만 approved로 바꾸면 거부 — 소유자·service_role 모두", () =>
  tx(async () => {
    const a = await article(await person(), { content_type: "explainer", tax_review_status: "pending" });
    for (const role of ["service_role", null]) {
      assert.equal((await attempt("update public.articles set editorial_status = 'approved' where id = $1", [a.id], role)).ok, false, `편집 ${role}`);
      assert.equal((await attempt("update public.articles set tax_review_status = 'approved' where id = $1", [a.id], role)).ok, false, `감수 ${role}`);
    }
    const insertApproved = await attempt(
      "insert into public.articles (slug, title, section, content_type, editorial_status) values ($1, 't', 'tax', 'explainer', 'approved')",
      [uniq("a")],
    );
    assert.equal(insertApproved.ok, false, "처음부터 approved로 넣을 수 없다");
  }));

test("desk_edit 기록만 있는 기사의 세무 감수 상태를 approved로 바꾸면 거부 (서로 다른 종류)", () =>
  tx(async () => {
    const a = await article(await person(), { content_type: "explainer", tax_review_status: "pending" });
    await client.query(REVIEW, [a.id, "desk_edit", await person(["editor"]), "approve", null]);
    assert.equal((await attempt("update public.articles set tax_review_status = 'approved' where id = $1", [a.id])).ok, false);
  }));

test("두 승인은 서로 다른 행으로 남고, 가장 최근 기록이 상태를 정한다", () =>
  tx(async () => {
    const a = await article(await person(), { content_type: "explainer", tax_review_status: "pending" });
    const ed1 = await person(["editor"]);
    const ed2 = await person(["editor"]);
    await client.query(REVIEW, [a.id, "desk_edit", ed1, "approve", null]);
    await client.query(REVIEW, [a.id, "tax_review", await person(["reviewer"]), "approve", null]);
    assert.deepEqual(await statusOf(a.id), { editorial_status: "approved", tax_review_status: "approved" });
    await client.query(REVIEW, [a.id, "desk_edit", ed2, "reject", "출처 보강 필요"]);
    assert.deepEqual(await statusOf(a.id), { editorial_status: "rejected", tax_review_status: "approved" });
    const kinds = (await client.query("select kind, count(*)::int n from public.editorial_reviews where article_id = $1 group by kind order by kind", [a.id])).rows;
    assert.deepEqual(kinds, [
      { kind: "desk_edit", n: 2 },
      { kind: "tax_review", n: 1 },
    ]);
  }));

test("승인 기록을 지우면 상태가 다시 계산된다 (관리자 전권으로 지워도 approved가 남지 않는다)", () =>
  tx(async () => {
    const a = await article(await person());
    const r = (await client.query(REVIEW, [a.id, "desk_edit", await person(["editor"]), "approve", null])).rows[0];
    assert.ok((await attempt("delete from public.editorial_reviews where id = $1", [r.id], "service_role")).ok);
    assert.equal((await statusOf(a.id)).editorial_status, "pending");
  }));

test("승인한 편집자를 나중에 작성자로 바꾸면 거부 (본인 승인 우회 차단)", () =>
  tx(async () => {
    const a = await article(await person());
    const editor = await person(["editor", "reporter"]);
    await client.query(REVIEW, [a.id, "desk_edit", editor, "approve", null]);
    const r = await attempt("update public.articles set author_id = $2 where id = $1", [a.id, editor], "service_role");
    assert.equal(r.ok, false);
    assert.ok((await attempt("update public.articles set author_id = $2 where id = $1", [a.id, await person()], "service_role")).ok, "다른 기자로는 바꿀 수 있다");
  }));

test("승인 기록의 검토자를 작성자로 고쳐도 거부 (UPDATE 경로)", () =>
  tx(async () => {
    const reporter = await person();
    const a = await article(reporter);
    const r = (await client.query(REVIEW, [a.id, "desk_edit", await person(["editor"]), "approve", null])).rows[0];
    assert.equal((await attempt("update public.editorial_reviews set reviewer_id = $2 where id = $1", [r.id, reporter], "service_role")).ok, false);
  }));

test("anon·authenticated는 승인 기록을 추가할 수 없다", () =>
  tx(async () => {
    const a = await article(await person());
    const editor = await person(["editor"]);
    for (const role of ["anon", "authenticated"]) assert.equal((await attempt(REVIEW, [a.id, "desk_edit", editor, "approve", null], role)).ok, false, role);
  }));
