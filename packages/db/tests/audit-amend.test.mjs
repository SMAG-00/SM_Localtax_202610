// 감사 기록 수정·삭제 — PO만 (2026-10-17 PO 결정). 직접 UPDATE·DELETE는 계속 막고,
// 전용 함수 audit_log_amend · audit_log_delete로만 바꾼다. 바꾼 사실(이전 내용·새 내용·누가·왜·언제)은
// audit_log_changes에 자동으로 남고, 이 변경 기록은 누구도 고치거나 지울 수 없다.
// PO인지 확인하는 일은 서버(관리자 화면)가 한다 — DB는 함수 경로·이름·이유·변경 기록을 강제한다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;

before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

/** 트랜잭션 안에서 시험 행을 만들고 fn을 돌린 뒤 항상 되돌린다 */
async function scenario(fn) {
  await client.query("begin");
  try {
    const { rows } = await client.query(
      "insert into public.audit_logs (actor, action, target, after, reason) values ('user:기자', 'article.publish', 'articles:7', '{\"status\":\"published\"}', '승인') returning id",
    );
    return await fn(rows[0].id);
  } finally {
    await client.query("rollback");
  }
}

/** savepoint 안에서 실행 — 실패해도 바깥 트랜잭션은 이어 간다 */
async function tryQuery(sql, params, role) {
  await client.query("savepoint t");
  try {
    if (role) await client.query(`set local role ${role}`);
    const res = await client.query(sql, params);
    await client.query("release savepoint t");
    if (role) await client.query("reset role");
    return { ok: true, res };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, message: err.message };
  }
}

const AMEND = "select public.audit_log_amend($1, $2::jsonb, $3, $4) as change_id";
const DELETE = "select public.audit_log_delete($1, $2, $3) as change_id";

test("수정 함수로 고치면 감사 기록이 바뀌고, 변경 기록에 이전·새 내용·누가·왜·언제가 남는다", () =>
  scenario(async (id) => {
    const r = await tryQuery(AMEND, [id, { reason: "편집 책임자 승인 (오기 정정)" }, "admin:admin@sunmyung.kr", "사유 오기"], "service_role");
    assert.ok(r.ok, r.message);
    const log = (await client.query("select reason from public.audit_logs where id = $1", [id])).rows[0];
    assert.equal(log.reason, "편집 책임자 승인 (오기 정정)");
    const ch = (await client.query("select * from public.audit_log_changes where id = $1", [r.res.rows[0].change_id])).rows[0];
    assert.equal(ch.log_id, String(id));
    assert.equal(ch.op, "update");
    assert.equal(ch.old_row.reason, "승인");
    assert.equal(ch.new_row.reason, "편집 책임자 승인 (오기 정정)");
    assert.equal(ch.actor, "admin:admin@sunmyung.kr");
    assert.equal(ch.reason, "사유 오기");
    assert.ok(ch.at instanceof Date);
  }));

test("삭제 함수로 지우면 감사 기록이 사라지고, 변경 기록에 지운 행 전체가 남는다", () =>
  scenario(async (id) => {
    const r = await tryQuery(DELETE, [id, "admin:admin@sunmyung.kr", "시험 데이터 정리"], "service_role");
    assert.ok(r.ok, r.message);
    assert.equal((await client.query("select count(*)::int n from public.audit_logs where id = $1", [id])).rows[0].n, 0);
    const ch = (await client.query("select * from public.audit_log_changes where id = $1", [r.res.rows[0].change_id])).rows[0];
    assert.equal(ch.op, "delete");
    assert.equal(ch.old_row.target, "articles:7");
    assert.equal(ch.old_row.after.status, "published");
    assert.equal(ch.new_row, null);
  }));

for (const [label, actor, reason] of [
  ["누가(actor)가 빈 값", "  ", "사유"],
  ["왜(reason)가 빈 값", "admin:admin@sunmyung.kr", ""],
  ["왜(reason)가 null", "admin:admin@sunmyung.kr", null],
]) {
  test(`${label}이면 수정·삭제 모두 거부하고 아무것도 바뀌지 않는다`, () =>
    scenario(async (id) => {
      const before = (await client.query("select count(*)::int n from public.audit_log_changes")).rows[0].n;
      assert.equal((await tryQuery(AMEND, [id, { reason: "x" }, actor, reason], "service_role")).ok, false);
      assert.equal((await tryQuery(DELETE, [id, actor, reason], "service_role")).ok, false);
      assert.equal((await client.query("select reason from public.audit_logs where id = $1", [id])).rows[0].reason, "승인");
      assert.equal((await client.query("select count(*)::int n from public.audit_log_changes")).rows[0].n, before);
    }));
}

test("고칠 수 없는 칸(id·at)이나 없는 칸을 넣으면 거부", () =>
  scenario(async (id) => {
    for (const changes of [{ id: 999 }, { at: "2020-01-01" }, { nope: 1 }, {}]) {
      const r = await tryQuery(AMEND, [id, changes, "admin:admin@sunmyung.kr", "사유"], "service_role");
      assert.equal(r.ok, false, JSON.stringify(changes));
    }
  }));

test("없는 감사 기록 번호는 거부하고 변경 기록도 남기지 않는다", () =>
  scenario(async () => {
    const before = (await client.query("select count(*)::int n from public.audit_log_changes")).rows[0].n;
    assert.equal((await tryQuery(AMEND, [-1, { reason: "x" }, "admin:a", "사유"], "service_role")).ok, false);
    assert.equal((await tryQuery(DELETE, [-1, "admin:a", "사유"], "service_role")).ok, false);
    assert.equal((await client.query("select count(*)::int n from public.audit_log_changes")).rows[0].n, before);
  }));

test("함수를 쓴 뒤에도 같은 트랜잭션의 직접 UPDATE는 여전히 거부 (예외 통로가 열린 채 남지 않는다)", () =>
  scenario(async (id) => {
    assert.ok((await tryQuery(AMEND, [id, { reason: "고침" }, "admin:a", "사유"], "service_role")).ok);
    const direct = await tryQuery("update public.audit_logs set reason = '몰래' where id = $1", [id], null);
    assert.equal(direct.ok, false);
    assert.match(direct.message, /추가만|전용 함수/);
  }));

for (const role of ["anon", "authenticated"]) {
  test(`${role}은 수정·삭제 함수를 실행할 수 없다`, () =>
    scenario(async (id) => {
      assert.equal((await tryQuery(AMEND, [id, { reason: "x" }, "admin:a", "사유"], role)).ok, false);
      assert.equal((await tryQuery(DELETE, [id, "admin:a", "사유"], role)).ok, false);
    }));
}

test("변경 기록은 소유자도 고치거나 지우거나 비울 수 없다", () =>
  scenario(async (id) => {
    const r = await tryQuery(DELETE, [id, "admin:a", "사유"], "service_role");
    const changeId = r.res.rows[0].change_id;
    for (const sql of [
      "update public.audit_log_changes set reason = '고침' where id = $1",
      "delete from public.audit_log_changes where id = $1",
    ]) {
      assert.equal((await tryQuery(sql, [changeId], null)).ok, false, sql);
      assert.equal((await tryQuery(sql, [changeId], "service_role")).ok, false, `service_role: ${sql}`);
    }
    assert.equal((await tryQuery("truncate public.audit_log_changes", [], null)).ok, false);
  }));

test("service_role은 변경 기록을 직접 추가할 수 없다 (함수로만 생긴다)", () =>
  scenario(async (id) => {
    const r = await tryQuery(
      "insert into public.audit_log_changes (log_id, op, old_row, actor, reason) values ($1, 'delete', '{}', 'x', 'y')",
      [id],
      "service_role",
    );
    assert.equal(r.ok, false);
  }));

test("PO는 변경 기록을 읽을 수 있고 외부는 읽을 수 없다", () =>
  scenario(async () => {
    assert.ok((await tryQuery("select count(*) from public.audit_log_changes", [], "service_role")).ok);
    for (const role of ["anon", "authenticated"]) {
      const r = await tryQuery("select count(*)::int n from public.audit_log_changes", [], role);
      assert.ok(!r.ok || r.res.rows[0].n === 0, role);
    }
  }));
