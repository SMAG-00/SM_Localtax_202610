// W2-e 1단계 접근 — request_throttles · profiles · consents (docs/dev/W2-e_설계.md 3.1)
//  · RLS 켜짐 · anon·authenticated는 읽기·쓰기·고치기·지우기 모두 권한 거부(42501) — 공개 키로 직접 부를 길이 없다
//  · 함수 다섯(throttle_*)은 anon·authenticated 실행 거부, service_role만 실행
//  · 행이 있어도 anon·authenticated가 읽는 행 0 (권한 거부 또는 0행)
// service_role 전권(관리자 전권)은 admin-rights.test.mjs, 표 목록 전체의 RLS는 scripts/verify-rls.mjs가 본다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const TABLES = ["request_throttles", "profiles", "consents"];
const HASH = "0123456789abcdef0123456789abcdef";
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
    return { ok: false, code: err.code, message: err.message };
  }
}

test("새 표 셋 모두 RLS가 켜져 있다", async () => {
  const { rows } = await client.query("select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = any($1) order by relname", [TABLES]);
  assert.deepEqual(rows, [
    { relname: "consents", relrowsecurity: true },
    { relname: "profiles", relrowsecurity: true },
    { relname: "request_throttles", relrowsecurity: true },
  ]);
});

const UPDATES = { request_throttles: "count = 1", profiles: "tier = 'basic'", consents: "kind = 'signup'" };

for (const role of ["anon", "authenticated"]) {
  test(`${role} — 새 표 셋을 읽기·추가·고치기·지우기 모두 권한 거부(42501)`, () =>
    tx(async () => {
      for (const table of TABLES) {
        for (const [what, sql] of [
          ["읽기", `select * from public.${table} limit 1`],
          ["지우기", `delete from public.${table}`],
          ["고치기", `update public.${table} set ${UPDATES[table]}`],
        ]) {
          const r = await attempt(sql, [], role);
          assert.equal(r.code, "42501", `${role} ${table} ${what}: ${r.message ?? "허용됨"}`);
        }
      }
      assert.equal((await attempt("insert into public.request_throttles (scope, key_hash, window_start, count) values ('login_pair', $1, now(), 1)", [HASH], role)).code, "42501");
      assert.equal((await attempt("insert into public.profiles (id) values (gen_random_uuid())", [], role)).code, "42501");
      assert.equal((await attempt("insert into public.consents (email, kind, channel) values ('x@example.test', 'brief_prereg', 'web_brief')", [], role)).code, "42501");
    }));

  test(`${role} — 행이 들어 있어도 새 표에서 읽는 행 0 (RLS 검증과 같은 관점)`, () =>
    tx(async () => {
      await client.query("insert into public.request_throttles (scope, key_hash, window_start, count) values ('login_pair', $1, now(), 1)", [HASH]);
      await client.query("insert into public.consents (email, kind, channel) values ('seen@example.test', 'brief_prereg', 'web_brief')");
      for (const table of TABLES) {
        const r = await attempt(`select count(*)::int n from public.${table}`, [], role);
        assert.ok(!r.ok || r.rows[0].n === 0, `${role}가 ${table}을 읽었다`);
      }
    }));

  test(`${role} — throttle 함수 다섯을 실행할 수 없다(42501)`, () =>
    tx(async () => {
      for (const [sql, params] of [
        ["select public.throttle_check('login_pair', $1, 900, 5)", [HASH]],
        ["select public.throttle_hit('login_pair', $1, 900, 5)", [HASH]],
        ["select public.throttle_clear('login_pair', $1)", [HASH]],
        ["select public.throttle_purge(24)", []],
        ["select public.throttle_args_check('login_pair', $1, 900, 5)", [HASH]],
      ]) {
        const r = await attempt(sql, params, role);
        assert.equal(r.code, "42501", `${role}: ${sql} → ${r.message ?? "실행됨"}`);
      }
    }));
}

test("service_role — throttle 함수 다섯을 실행할 수 있다", () =>
  tx(async () => {
    for (const [sql, params] of [
      ["select public.throttle_check('login_pair', $1, 900, 5)", [HASH]],
      ["select public.throttle_hit('login_pair', $1, 900, 5)", [HASH]],
      ["select public.throttle_clear('login_pair', $1)", [HASH]],
      ["select public.throttle_purge(24)", []],
      ["select public.throttle_args_check('login_pair', $1, 900, 5)", [HASH]],
    ]) {
      const r = await attempt(sql, params, "service_role");
      assert.ok(r.ok, `${sql}: ${r.message}`);
    }
  }));

test("트리거 함수 profiles_guard는 anon·authenticated가 실행할 수 없고, 누가 불러도 트리거 밖에서는 돌지 않는다", async () => {
  const { rows } = await client.query(
    "select has_function_privilege('anon', 'public.profiles_guard()', 'EXECUTE') as anon_can, has_function_privilege('authenticated', 'public.profiles_guard()', 'EXECUTE') as auth_can",
  );
  assert.deepEqual(rows[0], { anon_can: false, auth_can: false });
  await client.query("begin");
  try {
    const r = await attempt("select public.profiles_guard()");
    assert.equal(r.ok, false, "트리거 밖 직접 호출은 거부");
  } finally {
    await client.query("rollback");
  }
});
