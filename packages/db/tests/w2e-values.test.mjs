// W2-e 1단계 값 목록 — docs/dev/W2-e_설계.md 2장 표와 DB가 같다 (w2d-values와 같은 방식 — 문서를 읽어 대조한다)
//  2.1 시도 횟수 범위·등급·모드·동의 종류·받은 곳 — 표의 값은 받고 표 밖 값은 check 위반(23514)
//  2.2 설정 씨앗 member · auth_limits · privacy_retention — 설계 문서의 JSON 블록과 DB 값이 같다
//  2.3 새 기능 키 5개 — 씨앗 false, 이미 있던 기능 키는 그대로
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const DESIGN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "dev", "W2-e_설계.md");
const MD = fs.readFileSync(DESIGN, "utf8");

function section(no) {
  const sec = MD.split(/^## /m).find((s) => s.startsWith("2. 값 목록"));
  assert.ok(sec, "설계 문서 2장을 찾지 못했다");
  const sub = sec.split(/^### /m).find((s) => s.startsWith(no));
  assert.ok(sub, `설계 문서 ${no} 소절이 없다`);
  return sub;
}
const ticks = (s) => [...s.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
const rowsOf = (sub) => sub.split("\n").filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
/** 2.1 — 이름(첫 낱말) → 값 배열 */
const VALUES = new Map(rowsOf(section("2.1")).slice(1).map(([name, cell]) => [name.split(/\s/)[0], ticks(cell)]));
const value = (name) => {
  const v = VALUES.get(name);
  assert.ok(v?.length, `설계 2.1에 '${name}'이 없다`);
  return v;
};
/** 2.2 설정 씨앗 블록 — 소제목 `이름` 아래 첫 json 코드 블록 */
function seedBlock(key) {
  const m = section("2.2").match(new RegExp("^#### `" + key + "`[^\\n]*\\n+```json\\n([\\s\\S]*?)\\n```", "m"));
  assert.ok(m, `설계 2.2에 ${key} 블록이 없다`);
  return JSON.parse(m[1]);
}
/** 2.3 기능 키 표 — 키 이름과 '이미 있나' 칸 */
function featureRows() {
  const out = [];
  for (const [keys, , exists] of rowsOf(section("2.3")).slice(1)) for (const k of ticks(keys)) out.push({ key: k, isNew: exists.includes("새로") });
  return out;
}

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
async function attempt(sql, params = []) {
  await client.query("savepoint t");
  try {
    const res = await client.query(sql, params);
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, code: err.code, message: err.message };
  }
}
const newUser = async () => (await client.query("insert into auth.users (id, aud, role, email) values (gen_random_uuid(), 'authenticated', 'authenticated', $1) returning id", [`v-${process.pid}-${Math.random().toString(36).slice(2)}@values.example.test`])).rows[0].id;
const HASH = "0123456789abcdef0123456789abcdef";

test("설계 문서 2장의 값 표·블록을 모두 읽었다", () => {
  assert.equal(value("throttle.scope").length, 12);
  assert.deepEqual(value("profile.tier"), ["basic", "premium", "institution"]);
  assert.deepEqual(value("profile.mode_pref"), ["general", "expert"]);
  assert.deepEqual(value("consent.kind"), ["signup", "receive", "marketing", "brief_prereg"]);
  assert.deepEqual(value("consent.channel"), ["web_signup", "web_my", "web_brief"]);
  for (const key of ["member", "auth_limits", "privacy_retention"]) assert.equal(seedBlock(key).version, "2026-10-20.1", key);
});

test("2.1 시도 횟수 범위 12개 — 표의 값은 받고 표 밖·대문자·빈 값은 check 위반", () =>
  tx(async () => {
    for (const scope of value("throttle.scope")) {
      const r = await attempt("insert into public.request_throttles (scope, key_hash, window_start, count) values ($1, $2, now(), 1)", [scope, HASH]);
      assert.ok(r.ok, `${scope}: ${r.message}`);
    }
    for (const bad of ["login", "LOGIN_PAIR", "", "login_pair ", "signup"]) {
      const r = await attempt("insert into public.request_throttles (scope, key_hash, window_start, count) values ($1, $2, now(), 1)", [bad, HASH]);
      assert.equal(r.code, "23514", `'${bad}': ${r.message}`);
    }
  }));

test("2.1 등급·모드 — 표의 값은 받고 표 밖 값(guest 포함)은 check 위반", () =>
  tx(async () => {
    for (const tier of value("profile.tier")) {
      const id = await newUser();
      assert.ok((await attempt("insert into public.profiles (id, tier) values ($1, $2)", [id, tier])).ok, tier);
    }
    for (const mode of value("profile.mode_pref")) {
      const id = await newUser();
      assert.ok((await attempt("insert into public.profiles (id, mode_pref) values ($1, $2)", [id, mode])).ok, mode);
    }
    for (const bad of ["guest", "BASIC", "", "admin"]) {
      const r = await attempt("insert into public.profiles (id, tier) values ($1, $2)", [await newUser(), bad]);
      assert.equal(r.code, "23514", `등급 '${bad}': ${r.message}`);
    }
    for (const bad of ["Expert", "", "admin"]) {
      const r = await attempt("insert into public.profiles (id, mode_pref) values ($1, $2)", [await newUser(), bad]);
      assert.equal(r.code, "23514", `모드 '${bad}': ${r.message}`);
    }
  }));

test("2.1 동의 종류 4개·받은 곳 3개 — 표의 값은 받고 표 밖 값은 check 위반", () =>
  tx(async () => {
    for (const kind of value("consent.kind")) {
      const id = await newUser();
      assert.ok((await attempt("insert into public.consents (user_id, kind, channel) values ($1, $2, 'web_my')", [id, kind])).ok, kind);
    }
    for (const channel of value("consent.channel")) {
      const id = await newUser();
      assert.ok((await attempt("insert into public.consents (user_id, kind, channel) values ($1, 'receive', $2)", [id, channel])).ok, channel);
    }
    for (const bad of ["local_weekly", "SIGNUP", "", "expert_contact"]) {
      const r = await attempt("insert into public.consents (user_id, kind, channel) values ($1, $2, 'web_my')", [await newUser(), bad]);
      assert.equal(r.code, "23514", `종류 '${bad}': ${r.message}`);
    }
    for (const bad of ["web", "api", ""]) {
      const r = await attempt("insert into public.consents (user_id, kind, channel) values ($1, 'receive', $2)", [await newUser(), bad]);
      assert.equal(r.code, "23514", `받은 곳 '${bad}': ${r.message}`);
    }
  }));

for (const key of ["member", "auth_limits", "privacy_retention"]) {
  test(`2.2 설정 씨앗 ${key} — DB 값이 설계 문서의 JSON 블록과 같다`, async () => {
    const { rows } = await client.query("select value, updated_by from public.settings where key = $1", [key]);
    assert.equal(rows.length, 1, `${key} 씨앗이 없다`);
    assert.deepEqual(rows[0].value, seedBlock(key));
  });
}

test("2.2 auth_limits — 시도 횟수 범위 12개와 같은 이름이고, 창(초)·한도는 양의 정수", async () => {
  const { rows } = await client.query("select value from public.settings where key = 'auth_limits'");
  const limits = rows[0].value;
  const scopes = Object.keys(limits).filter((k) => k !== "version").sort();
  assert.deepEqual(scopes, [...value("throttle.scope")].sort());
  for (const s of scopes) {
    assert.ok(Number.isInteger(limits[s].window) && limits[s].window >= 1 && limits[s].window <= 86400, `${s}.window`);
    assert.ok(Number.isInteger(limits[s].limit) && limits[s].limit >= 1, `${s}.limit`);
  }
  // 설계 4.1 — 로그인 세 겹: 이메일+IP 5회/15분 · 이메일 20회/15분 · IP 30회/15분
  assert.deepEqual(limits.login_pair, { window: 900, limit: 5 });
  assert.deepEqual(limits.login_account, { window: 900, limit: 20 });
  assert.deepEqual(limits.login_ip, { window: 900, limit: 30 });
});

test("2.3 새 기능 키 5개 — 설계 표의 '새로' 키가 모두 DB에 있고 false다 (이미 있던 키는 새로 만들지 않는다)", async () => {
  const rows = featureRows();
  const fresh = rows.filter((r) => r.isNew).map((r) => r.key);
  assert.deepEqual(fresh, ["page_terms", "page_no_email", "page_advertise", "members", "brief"]);
  const { rows: db } = await client.query("select value from public.settings where key = 'feature_flags'");
  for (const k of fresh) assert.equal(db[0].value[k], false, `${k}는 꺼짐으로 시작`);
  for (const r of rows) assert.ok(r.key in db[0].value, `${r.key}가 feature_flags에 없다`);
});

test("2.3 기능 키 씨앗은 이미 있는 값을 건드리지 않는다 — 켜 둔 키는 그대로, 없는 키만 false로 채운다", () =>
  tx(async () => {
    await client.query(
      `update public.settings set value = (value - 'members' - 'brief') || '{"search": true}'::jsonb where key = 'feature_flags'`);
    // 마이그레이션의 UPDATE 문을 그대로 다시 돌린다 (파일에서 읽어 같은 문장을 쓴다)
    const sql = fs.readFileSync(path.join(path.dirname(DESIGN), "..", "..", "packages", "db", "supabase", "migrations", "20261019000023_w2e_accounts.sql"), "utf8");
    const stmt = sql.slice(sql.indexOf("update public.settings s"));
    assert.ok(stmt.startsWith("update public.settings s"), "마이그레이션의 기능 키 UPDATE 문을 찾지 못했다");
    await client.query(stmt);
    const { rows } = await client.query("select value from public.settings where key = 'feature_flags'");
    assert.equal(rows[0].value.search, true, "켜 둔 search는 그대로");
    assert.equal(rows[0].value.members, false);
    assert.equal(rows[0].value.brief, false);
    assert.equal(rows[0].value.page_terms, false);
  }));
