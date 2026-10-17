// ADM-04 감사 로그 — 누가·언제·무엇을·왜. 추가만 가능하고 수정·삭제할 수 없다.
// 실제 로컬 Supabase DB에서 돌린다. 모든 시험은 트랜잭션 안에서 하고 되돌린다 (감사 로그에 시험 행을 남기지 않는다).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;

before(async () => {
  assert.ok(isLocal(dbUrl()), "감사 로그 시험은 로컬 DB에서만 돌린다 (DB_URL이 로컬이 아님)");
  client = await connect();
});
after(async () => client?.end());

/** 트랜잭션 안에서 role로 바꿔 실행하고 항상 되돌린다. 실패하면 오류 메시지를 돌려준다 */
async function attempt(role, sql, params = []) {
  await client.query("begin");
  try {
    if (role) await client.query(`set local role ${role}`);
    const res = await client.query(sql, params);
    return { ok: true, res };
  } catch (err) {
    return { ok: false, message: err.message, code: err.code };
  } finally {
    await client.query("rollback");
  }
}

const INSERT =
  "insert into public.audit_logs (actor, action, target, before, after, reason) values ($1, $2, $3, $4, $5, $6) returning id, at";
const ROW = ["user:시험", "article.publish", "articles:1", null, { status: "published" }, "편집 책임자 승인"];

/** 시험 행 하나를 넣은 뒤 같은 트랜잭션에서 sql을 실행한다 */
async function withRow(role, sql) {
  await client.query("begin");
  try {
    const { rows } = await client.query(INSERT, ROW);
    if (role) await client.query(`set local role ${role}`);
    await client.query(sql, [rows[0].id]);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message, code: err.code };
  } finally {
    await client.query("rollback");
  }
}

test("service_role은 감사 로그를 추가할 수 있고 시각(at)이 자동으로 찍힌다", async () => {
  const r = await attempt("service_role", INSERT, ROW);
  assert.ok(r.ok, r.message);
  assert.ok(r.res.rows[0].at instanceof Date);
  assert.ok(Math.abs(Date.now() - r.res.rows[0].at.getTime()) < 60_000);
});

for (const [label, col] of [
  ["누가(actor)", 0],
  ["무엇을(action)", 1],
  ["대상(target)", 2],
  ["왜(reason)", 5],
]) {
  test(`${label}이 빈 값이면 추가 거부`, async () => {
    for (const empty of [null, "", "   "]) {
      const row = [...ROW];
      row[col] = empty;
      const r = await attempt("service_role", INSERT, row);
      assert.equal(r.ok, false, `${JSON.stringify(empty)} 값이 통과됨`);
    }
  });
}

test("service_role로 UPDATE를 시도해도 거부", async () => {
  const r = await withRow("service_role", "update public.audit_logs set reason = '고침' where id = $1");
  assert.equal(r.ok, false);
});

test("service_role로 DELETE를 시도해도 거부", async () => {
  const r = await withRow("service_role", "delete from public.audit_logs where id = $1");
  assert.equal(r.ok, false);
});

test("테이블 소유자(postgres)의 UPDATE도 DB 트리거가 거부", async () => {
  const r = await withRow(null, "update public.audit_logs set reason = '고침' where id = $1");
  assert.equal(r.ok, false);
  assert.match(r.message, /추가만/);
});

test("테이블 소유자(postgres)의 DELETE도 DB 트리거가 거부", async () => {
  const r = await withRow(null, "delete from public.audit_logs where id = $1");
  assert.equal(r.ok, false);
  assert.match(r.message, /추가만/);
});

test("TRUNCATE도 거부", async () => {
  const r = await attempt(null, "truncate public.audit_logs");
  assert.equal(r.ok, false);
  assert.match(r.message, /추가만/);
});

for (const role of ["anon", "authenticated"]) {
  test(`${role}은 감사 로그를 읽을 수 없다`, async () => {
    const r = await attempt(role, "select count(*)::int as n from public.audit_logs");
    assert.ok(!r.ok || r.res.rows[0].n === 0, "읽기 결과가 0행이거나 권한 거부여야 한다");
  });

  test(`${role}은 감사 로그를 추가할 수 없다`, async () => {
    const r = await attempt(role, INSERT, ROW);
    assert.equal(r.ok, false);
  });
}
