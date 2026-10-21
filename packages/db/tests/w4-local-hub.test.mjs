// W4 4단계 DB — 지자체 허브 블록 대응 설정·기능 키 (docs/dev/W4_설계.md 1장 4단계 · 2.2 · 2.4 · 3장, 마이그레이션 20261022000040)
//  · local_block_fields 씨앗 = 설계 2.2 (REG1-02 초기값) · 기능 키 weekly_digest·local_events·redevelopment_status·ordinance_texts = 설계 2.4, 씨앗 false
//  · 저장 검사: 객체 · 블록 두 칸(local_tax·realestate)만 · 블록마다 편집 분야(설계 2.1 editorial_field) 1개 이상 · 한 편집 분야는 한 블록에만
//  · anon은 이 키 한 줄만 더 읽는다(쓰기 0, 다른 비공개 키 0), 검사 함수 실행 0 · 기존 공개 키 정책 settings_public_read는 그대로
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = fs.readFileSync(path.join(HERE, "..", "..", "..", "docs", "dev", "W4_설계.md"), "utf8");
const line = (prefix) => {
  const l = DESIGN.split("\n").find((x) => x.startsWith(prefix));
  assert.ok(l, `설계 문서에 '${prefix}' 줄이 없다`);
  return l;
};
const SEED = JSON.parse(line("| `local_block_fields` |").split("|")[2].match(/`(\{[^`]+\})`/)[1]);
const EDITORIAL_FIELDS = [...line("| editorial_field (").split("|")[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const NEW_FLAGS = [...line("| `weekly_digest` · `local_events` (신규").split("|")[1].matchAll(/`([^`]+)`/g)]
  .map((m) => m[1])
  .concat([...line("| `redevelopment_status` · `ordinance_texts` (신규").split("|")[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]));

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

async function attempt(sql, params = [], role = null) {
  await client.query("savepoint t");
  try {
    if (role) await client.query(`set local role ${role}`);
    const res = await client.query(sql, params);
    if (role) await client.query("reset role");
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows, rowCount: res.rowCount };
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

const setFields = (value) => attempt("update public.settings set value = $1::jsonb where key = 'local_block_fields'", [JSON.stringify(value)]);

test("씨앗 — local_block_fields = 설계 2.2(REG1-02 초기값), 편집 분야는 설계 2.1 값만", async () => {
  assert.deepEqual(SEED, { local_tax: ["local_tax", "local_finance"], realestate: ["realestate", "urban_policy"] });
  const { rows } = await client.query("select value, updated_by from public.settings where key = 'local_block_fields'");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].value, SEED);
  assert.deepEqual([...SEED.local_tax, ...SEED.realestate].sort(), [...EDITORIAL_FIELDS].sort(), "네 편집 분야가 한 번씩");
});

test("기능 키 — 설계 2.4의 새 키 4개가 씨앗에 false", async () => {
  assert.deepEqual(NEW_FLAGS, ["weekly_digest", "local_events", "redevelopment_status", "ordinance_texts"]);
  const { rows } = await client.query("select value from public.settings where key = 'feature_flags'");
  for (const k of NEW_FLAGS) assert.equal(rows[0].value[k], false, k);
});

test("저장 검사 — 모양이 틀린 대응은 거부(check_violation), 맞는 대응은 저장", () =>
  tx(async () => {
    const bad = [
      [["local_tax"], /블록별 객체/],
      [{ local_tax: ["local_tax"] }, /\(realestate\)에는 편집 분야가 1개 이상/],
      [{ local_tax: [], realestate: ["realestate"] }, /\(local_tax\)에는 편집 분야가 1개 이상/],
      [{ ...SEED, weekly: ["local_tax"] }, /local_tax\(지방세·지방재정\)·realestate\(부동산·개발\)만/],
      [{ local_tax: ["local_tax", "tourism"], realestate: ["realestate"] }, /편집 분야는 local_tax·local_finance·realestate·urban_policy 중 하나/],
      [{ local_tax: ["local_tax", 1], realestate: ["realestate"] }, /중 하나/],
      [{ local_tax: ["local_tax", "urban_policy"], realestate: ["realestate", "urban_policy"] }, /urban_policy는 한 블록에 한 번만/],
      [{ local_tax: ["local_tax", "local_tax"], realestate: ["realestate"] }, /local_tax는 한 블록에 한 번만/],
    ];
    for (const [value, error] of bad) {
      const r = await setFields(value);
      assert.equal(r.ok, false, JSON.stringify(value));
      assert.equal(r.code, "23514", JSON.stringify(value));
      assert.match(r.message, error);
    }
    const moved = { local_tax: ["local_tax", "local_finance", "urban_policy"], realestate: ["realestate"] };
    const ok = await setFields(moved);
    assert.equal(ok.ok, true, ok.message);
    assert.deepEqual((await client.query("select value from public.settings where key = 'local_block_fields'")).rows[0].value, moved);
    // 새 행으로 넣는 길도 같은 검사 (지웠다 다시 넣기)
    await client.query("delete from public.settings where key = 'local_block_fields'");
    const ins = await attempt("insert into public.settings (key, value, description, updated_by) values ('local_block_fields', $1::jsonb, '시험용', 'test')", [JSON.stringify({ local_tax: [] })]);
    assert.equal(ins.ok, false);
    assert.equal(ins.code, "23514");
  }));

test("anon — local_block_fields 한 줄은 읽고(공개 화면), 쓰기·다른 비공개 키·검사 함수 실행은 0 · 기존 공개 키 정책은 그대로", () =>
  tx(async () => {
    const read = await attempt("select key, value from public.settings where key = 'local_block_fields'", [], "anon");
    assert.equal(read.ok, true, read.message);
    assert.deepEqual(read.rows.map((r) => r.key), ["local_block_fields"]);
    const hidden = await attempt("select key from public.settings where key in ('forbidden_phrases', 'similarity_internal', 'hub_tax_points')", [], "anon");
    assert.deepEqual(hidden.rows, [], "비공개 키 0");
    for (const role of ["anon", "authenticated"]) {
      const w = await attempt("update public.settings set value = '{\"local_tax\":[\"local_tax\"],\"realestate\":[\"realestate\"]}'::jsonb where key = 'local_block_fields'", [], role);
      assert.ok(!w.ok || w.rowCount === 0, `${role}: 쓰기 0`);
      const f = await client.query("select has_function_privilege($1, 'public.local_block_fields_guard()', 'execute') as can", [role]);
      assert.equal(f.rows[0].can, false, `${role}: 검사 함수 실행 권한 0`);
    }
    assert.deepEqual((await client.query("select value from public.settings where key = 'local_block_fields'")).rows[0].value, SEED, "anon 쓰기 뒤에도 씨앗 그대로");
    const policies = (await client.query("select polname from pg_policy where polrelid = 'public.settings'::regclass order by polname")).rows.map((r) => r.polname);
    assert.ok(policies.includes("settings_public_read") && policies.includes("settings_public_local_block_fields"), policies.join(","));
    const qual = (await client.query("select pg_get_expr(polqual, polrelid) q from pg_policy where polrelid = 'public.settings'::regclass and polname = 'settings_public_read'")).rows[0].q;
    assert.ok(!qual.includes("local_block_fields"), "기존 공개 키 목록(W2-b 2.3)은 바꾸지 않는다");
  }));
