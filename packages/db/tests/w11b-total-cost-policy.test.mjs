// W11-b DB - 총비용 정책 설정 (마이그레이션 20261025000115·116, docs/dev/W11-b_설계.md 3장)
//  · 설정 total_cost_policy: 빈 객체({} = 씨앗)는 그대로 저장되고, 값이 있으면 칸 4개만·0 이상 정수만·compare_years는 정수 2개이며 보유 연수 상한 이하여야 저장된다
//  · 다른 설정 키에는 영향이 없다
//  · 공개 뷰 public_total_cost_policy: 빈 값이면 0행, 채워지면 1행, anon이 읽을 수 있고 settings 표는 읽을 수 없다
// 값은 모두 시험용으로 지어낸 숫자다(PO 입력값이 아니다). 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0).
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
const setPolicy = (value) => attempt("update public.settings set value = $1::jsonb where key = 'total_cost_policy'", [JSON.stringify(value)]);
const VALID = { max_holding_years: 7, max_rate_bp: 2000, max_extra_items: 2, compare_years: [3, 5] };

test("씨앗은 빈 객체이고 빈 객체로 다시 저장해도 된다", () =>
  tx(async () => {
    const seed = (await client.query("select value from public.settings where key = 'total_cost_policy'")).rows[0];
    assert.ok(seed, "씨앗 행이 있어야 한다");
    assert.deepEqual(seed.value, {});
    assert.equal((await setPolicy({})).ok, true);
  }));

test("모양이 맞으면 저장된다 (상한과 같은 비교 연수·0 값은 허용)", () =>
  tx(async () => {
    assert.equal((await setPolicy(VALID)).ok, true);
    assert.equal((await setPolicy({ ...VALID, compare_years: [0, 7] })).ok, true);
    assert.equal((await setPolicy({ ...VALID, max_extra_items: 0, max_rate_bp: 0 })).ok, true);
  }));

test("모르는 칸·빠진 칸·객체가 아닌 값은 23514로 거부된다", () =>
  tx(async () => {
    const { max_extra_items: _drop, ...missing } = VALID;
    for (const bad of [{ ...VALID, extra: 1 }, missing, [], "x", 5, null]) {
      const r = await setPolicy(bad);
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.equal(r.code, "23514", JSON.stringify(bad));
    }
  }));

test("음수·소수·글자 숫자·비교 연수 개수 오류와 상한 초과는 거부된다", () =>
  tx(async () => {
    const bads = [
      { ...VALID, max_holding_years: -1 },
      { ...VALID, max_rate_bp: 1.5 },
      { ...VALID, max_extra_items: "2" },
      { ...VALID, compare_years: [3] },
      { ...VALID, compare_years: [3, 5, 6] },
      { ...VALID, compare_years: [3, -1] },
      { ...VALID, compare_years: [3, 8] },
      { ...VALID, compare_years: [8, 3] },
      { ...VALID, compare_years: "3,5" },
    ];
    for (const bad of bads) {
      const r = await setPolicy(bad);
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.equal(r.code, "23514", JSON.stringify(bad));
    }
  }));

test("다른 설정 키는 같은 모양이 아니어도 영향 없이 저장된다", () =>
  tx(async () => {
    const r = await attempt("update public.settings set value = '{\"anything\": [1, \"x\"]}'::jsonb where key = 'seo_lint_params'");
    assert.equal(r.ok, true, r.message);
  }));

test("공개 뷰 - 빈 값이면 0행, 채워지면 anon이 정책 1행을 읽고 settings 표는 읽지 못한다", () =>
  tx(async () => {
    const empty = await attempt("select policy from public.public_total_cost_policy", [], "anon");
    assert.equal(empty.ok, true, empty.message);
    assert.equal(empty.rows.length, 0);

    assert.equal((await setPolicy(VALID)).ok, true);
    const filled = await attempt("select policy from public.public_total_cost_policy", [], "anon");
    assert.equal(filled.ok, true, filled.message);
    assert.equal(filled.rows.length, 1);
    assert.deepEqual(filled.rows[0].policy, VALID);

    const direct = await attempt("select value from public.settings where key = 'total_cost_policy'", [], "anon");
    // 권한 거부(오류)이거나 공개 키 목록 밖이라 0행이어야 한다 - 어느 쪽이든 정책 값이 settings로는 새지 않는다
    assert.ok(!direct.ok || direct.rows.length === 0, "settings 표로는 total_cost_policy를 읽을 수 없어야 한다");
  }));
