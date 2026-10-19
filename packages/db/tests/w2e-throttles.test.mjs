// W2-e 1단계 시도 횟수 — request_throttles · throttle_check · throttle_hit · throttle_clear · throttle_purge
// (docs/dev/W2-e_설계.md 2.2 auth_limits · 3.6 · 4.1, 마이그레이션 20261019000023_w2e_accounts.sql)
//  · 범위마다 설계 2.2의 한도로 n번째 허용 · n+1번째 차단 (창이 열린 뒤 첫 시도 기준) — 12개 범위 전부
//  · 차단 상태에서 더 쳐도 횟수는 n+1에서 멈춘다 · retry_after는 창이 끝날 때까지 남은 초
//  · 창 경계(DB 시각): 창이 끝나기 1초 전은 아직 막힘, 정확히 창 길이만큼 지나면 새 창 — 한 트랜잭션 안에서 now()가 고정이라 시험이 흔들리지 않는다
//  · 다른 키·다른 범위는 서로 영향이 없다 · 인자 검사 · 원문(이메일·IP)은 키가 될 수 없다
//  · 같은 키 동시 요청 — 연결 20개가 한꺼번에 쳐도 정확히 n번 허용 (자문 잠금)
//  · clear는 그 키만 지운다 · purge는 기준 시간보다 오래된 줄만 지운다
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const DESIGN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "dev", "W2-e_설계.md");
const MD = fs.readFileSync(DESIGN, "utf8");
const sec2 = MD.split(/^## /m).find((s) => s.startsWith("2. 값 목록"));
const LIMITS = JSON.parse(sec2.match(/^#### `auth_limits`[^\n]*\n+```json\n([\s\S]*?)\n```/m)[1]);
const SCOPES = Object.keys(LIMITS).filter((k) => k !== "version");

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
const key = () => crypto.randomBytes(16).toString("hex");
const hit = async (scope, k, w, l, c = client) => (await c.query("select public.throttle_hit($1, $2, $3, $4) as r", [scope, k, w, l])).rows[0].r;
const check = async (scope, k, w, l, c = client) => (await c.query("select public.throttle_check($1, $2, $3, $4) as r", [scope, k, w, l])).rows[0].r;
const countOf = async (scope, k) => (await client.query("select coalesce(sum(count), 0)::int n, count(*)::int rows from public.request_throttles where scope = $1 and key_hash = $2", [scope, k])).rows[0];

test("설계 2.2 auth_limits 블록을 읽었다 — 범위 12개", () => {
  assert.equal(SCOPES.length, 12);
  assert.deepEqual(LIMITS.login_pair, { window: 900, limit: 5 });
});

for (const scope of SCOPES) {
  const { window, limit } = LIMITS[scope];
  test(`${scope} — ${window}초 창에서 ${limit}번째까지 허용, ${limit + 1}번째부터 차단 (횟수는 ${limit + 1}에서 멈춘다)`, () =>
    tx(async () => {
      const k = key();
      assert.deepEqual(await check(scope, k, window, limit), { blocked: false, retry_after_seconds: 0 }, "시도 전에는 막히지 않는다");
      for (let n = 1; n <= limit; n++) {
        const r = await hit(scope, k, window, limit);
        assert.equal(r.allowed, true, `${n}번째는 허용`);
        assert.equal(r.count, n);
        assert.equal(r.retry_after_seconds, 0);
        // 한도 직전까지는 check도 막지 않는다 — n번째를 친 뒤 막히는 것은 n = limit일 때만
        assert.equal((await check(scope, k, window, limit)).blocked, n >= limit, `${n}번 친 뒤 check`);
      }
      const over = await hit(scope, k, window, limit);
      assert.equal(over.allowed, false, `${limit + 1}번째는 차단`);
      assert.equal(over.count, limit + 1);
      assert.equal(over.retry_after_seconds, window, "같은 트랜잭션이라 창이 열린 시각 = 지금 → 남은 시간 = 창 길이");
      const again = await hit(scope, k, window, limit);
      assert.equal(again.allowed, false);
      assert.equal(again.count, limit + 1, "차단된 뒤 더 쳐도 횟수는 한도 + 1에서 멈춘다");
      assert.deepEqual(await check(scope, k, window, limit), { blocked: true, retry_after_seconds: window });
      assert.deepEqual(await countOf(scope, k), { n: limit + 1, rows: 1 }, "창 하나, 한 줄");
    }));
}

test("다른 키·다른 범위는 영향이 없다 — 한 키가 막혀도 다른 키·같은 키의 다른 범위는 첫 시도부터 허용", () =>
  tx(async () => {
    const a = key();
    const b = key();
    for (let i = 0; i < 6; i++) await hit("login_pair", a, 900, 5);
    assert.equal((await check("login_pair", a, 900, 5)).blocked, true);
    assert.equal((await check("login_pair", b, 900, 5)).blocked, false, "다른 키");
    assert.deepEqual(await hit("login_pair", b, 900, 5), { allowed: true, count: 1, retry_after_seconds: 0 });
    assert.equal((await check("login_account", a, 900, 20)).blocked, false, "같은 키의 다른 범위");
    assert.deepEqual(await hit("login_account", a, 900, 20), { allowed: true, count: 1, retry_after_seconds: 0 });
  }));

test("창 경계(DB 시각) — 창이 끝나기 1초 전은 아직 막혀 있고 retry_after 1초, 창 길이만큼 지나면 새 창이 열려 첫 시도 허용", () =>
  tx(async () => {
    const k = key();
    // 창이 열린 지 899초 → 아직 같은 창 (한도까지 찬 상태)
    await client.query("insert into public.request_throttles (scope, key_hash, window_start, count) values ('login_pair', $1, now() - make_interval(secs => 899), 6)", [k]);
    assert.deepEqual(await check("login_pair", k, 900, 5), { blocked: true, retry_after_seconds: 1 });
    const still = await hit("login_pair", k, 900, 5);
    assert.deepEqual(still, { allowed: false, count: 6, retry_after_seconds: 1 });
    // 정확히 900초가 지났다 → 끝난 창. 새 창 1회
    const k2 = key();
    await client.query("insert into public.request_throttles (scope, key_hash, window_start, count) values ('login_pair', $1, now() - make_interval(secs => 900), 6)", [k2]);
    assert.deepEqual(await check("login_pair", k2, 900, 5), { blocked: false, retry_after_seconds: 0 });
    assert.deepEqual(await hit("login_pair", k2, 900, 5), { allowed: true, count: 1, retry_after_seconds: 0 });
    assert.deepEqual(await countOf("login_pair", k2), { n: 7, rows: 2 }, "옛 창 줄(6)은 purge 몫으로 남고 새 창 줄(1)이 생겼다");
    // 새 창이 한도까지 차면 다시 막힌다 — 옛 창의 횟수는 합쳐지지 않는다
    for (let i = 0; i < 4; i++) assert.equal((await hit("login_pair", k2, 900, 5)).allowed, true);
    assert.equal((await hit("login_pair", k2, 900, 5)).allowed, false);
  }));

test("창 길이를 줄이면 그 길이로 판정한다 — 같은 줄도 호출한 창 길이 기준 (설정을 바꿔도 새 값이 바로 적용)", () =>
  tx(async () => {
    const k = key();
    await client.query("insert into public.request_throttles (scope, key_hash, window_start, count) values ('form_ip', $1, now() - make_interval(secs => 600), 10)", [k]);
    assert.equal((await check("form_ip", k, 3600, 10)).blocked, true, "3600초 창이면 아직 막힘");
    assert.equal((await check("form_ip", k, 600, 10)).blocked, false, "600초 창이면 끝난 창");
  }));

test("인자 검사 — 목록 밖 범위·해시 모양이 아닌 키(이메일·IP 원문 포함)·창 길이·한도는 22023", () =>
  tx(async () => {
    const call = (fn, ...args) => attempt(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`, args);
    for (const fn of ["throttle_check", "throttle_hit"]) {
      assert.equal((await call(fn, "login", key(), 900, 5)).code, "22023", `${fn} 범위`);
      assert.equal((await call(fn, "login_pair", "admin@example.com", 900, 5)).code, "22023", `${fn} 이메일 원문 키`);
      assert.equal((await call(fn, "login_ip", "203.0.113.7", 900, 5)).code, "22023", `${fn} IP 원문 키`);
      assert.equal((await call(fn, "login_pair", key().toUpperCase(), 900, 5)).code, "22023", `${fn} 대문자 키`);
      assert.equal((await call(fn, "login_pair", key().slice(0, 31), 900, 5)).code, "22023", `${fn} 31글자 키`);
      assert.equal((await call(fn, "login_pair", key(), 0, 5)).code, "22023", `${fn} 창 0초`);
      assert.equal((await call(fn, "login_pair", key(), 86401, 5)).code, "22023", `${fn} 창 86401초`);
      assert.equal((await call(fn, "login_pair", key(), 900, 0)).code, "22023", `${fn} 한도 0`);
      assert.equal((await call(fn, "login_pair", key(), 900, 100001)).code, "22023", `${fn} 한도 100001`);
      assert.equal((await call(fn, "login_pair", key(), null, 5)).code, "22023", `${fn} 창 null`);
      assert.ok((await call(fn, "login_pair", key(), 1, 1)).ok, `${fn} 경계 창 1초·한도 1`);
      assert.ok((await call(fn, "login_pair", key(), 86400, 100000)).ok, `${fn} 경계 창 86400초·한도 100000`);
    }
    assert.equal((await call("throttle_clear", "login", key())).code, "22023");
    assert.equal((await call("throttle_clear", "login_pair", "a@b.kr")).code, "22023");
    for (const bad of [0, -1, 8761, null]) assert.equal((await call("throttle_purge", bad)).code, "22023", `purge ${bad}`);
    assert.ok((await call("throttle_purge", 8760)).ok);
  }));

test("표에 이메일·IP 원문을 직접 넣을 수 없다 — 키가 소문자 16진수 32글자가 아니면 check 위반, 횟수 0 이하도 거부", () =>
  tx(async () => {
    const ins = (k, c = 1) => attempt("insert into public.request_throttles (scope, key_hash, window_start, count) values ('login_pair', $1, now(), $2)", [k, c]);
    for (const bad of ["admin@example.com|203.0.113.7", "203.0.113.7", "", "ABCDEF0123456789ABCDEF0123456789", `${key()}0`]) assert.equal((await ins(bad)).code, "23514", bad);
    assert.equal((await ins(key(), 0)).code, "23514");
    assert.ok((await ins(key(), 1)).ok);
  }));

test("clear — 그 키의 모든 창을 지우고 지운 줄 수를 돌려준다 (다른 키·다른 범위는 그대로)", () =>
  tx(async () => {
    const a = key();
    const b = key();
    for (let i = 0; i < 3; i++) await hit("login_pair", a, 900, 5);
    await hit("login_account", a, 900, 20);
    await hit("login_pair", b, 900, 5);
    await client.query("insert into public.request_throttles (scope, key_hash, window_start, count) values ('login_pair', $1, now() - interval '2 hours', 2)", [a]);
    const removed = (await client.query("select public.throttle_clear('login_pair', $1) as n", [a])).rows[0].n;
    assert.equal(removed, 2, "a의 login_pair 줄 둘(열린 창·옛 창)");
    assert.deepEqual(await countOf("login_pair", a), { n: 0, rows: 0 });
    assert.deepEqual(await countOf("login_account", a), { n: 1, rows: 1 }, "같은 키의 다른 범위는 그대로");
    assert.deepEqual(await countOf("login_pair", b), { n: 1, rows: 1 }, "다른 키는 그대로");
    assert.equal((await check("login_pair", a, 900, 5)).blocked, false);
    assert.equal((await client.query("select public.throttle_clear('login_pair', $1) as n", [a])).rows[0].n, 0, "지울 것이 없으면 0");
  }));

test("purge — 창이 열린 지 기준 시간(경계 포함)이 지난 줄만 지운다: 23시간 59분은 남고 24시간 1분은 지워진다", () =>
  tx(async () => {
    const fresh = key();
    const justUnder = key();
    const justOver = key();
    await client.query("insert into public.request_throttles (scope, key_hash, window_start, count) values ('form_ip', $1, now(), 1)", [fresh]);
    await client.query("insert into public.request_throttles (scope, key_hash, window_start, count) values ('form_ip', $1, now() - interval '23 hours 59 minutes', 1)", [justUnder]);
    await client.query("insert into public.request_throttles (scope, key_hash, window_start, count) values ('form_ip', $1, now() - interval '24 hours 1 minute', 1)", [justOver]);
    const removed = (await client.query("select public.throttle_purge(24) as n")).rows[0].n;
    assert.ok(removed >= 1);
    assert.equal((await countOf("form_ip", fresh)).rows, 1);
    assert.equal((await countOf("form_ip", justUnder)).rows, 1);
    assert.equal((await countOf("form_ip", justOver)).rows, 0);
    // 기준을 1시간으로 줄이면 23시간 59분 줄도 지워진다
    await client.query("select public.throttle_purge(1)");
    assert.equal((await countOf("form_ip", justUnder)).rows, 0);
    assert.equal((await countOf("form_ip", fresh)).rows, 1, "방금 연 창은 남는다");
  }));

test("같은 키 동시 요청 — 별도 연결 20개가 한꺼번에 쳐도 정확히 한도(5)만큼 허용하고 나머지는 차단, 창은 하나", async () => {
  const k = key();
  const clients = await Promise.all(Array.from({ length: 20 }, () => connect()));
  try {
    const results = await Promise.all(clients.map((c) => hit("login_pair", k, 900, 5, c)));
    assert.equal(results.filter((r) => r.allowed).length, 5, "허용 정확히 5번");
    assert.equal(results.filter((r) => !r.allowed).length, 15);
    assert.deepEqual(results.map((r) => r.count).sort((a, b) => a - b).slice(0, 6), [1, 2, 3, 4, 5, 6], "횟수 1~5는 한 번씩, 그 뒤는 6에서 멈춘다");
    assert.deepEqual(await countOf("login_pair", k), { n: 6, rows: 1 }, "창이 둘 열려 횟수가 갈라지지 않았다");
  } finally {
    await client.query("delete from public.request_throttles where key_hash = $1", [k]);
    await Promise.all(clients.map((c) => c.end()));
  }
});
