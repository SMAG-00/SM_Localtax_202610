// W10-c DB 시험 공통 도우미 — 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0)
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";
import assert from "node:assert/strict";

export async function open() {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  return connect();
}
export function helpers(client) {
  let seq = 0;
  const uniq = (p) => `${p}-${process.pid}-${++seq}`;
  const one = async (sql, params) => (await client.query(sql, params)).rows[0];
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
  const snapshot = async (over = {}) => {
    const row = { source: "w10c-test", url: "https://example.test/시험용/" + uniq("s"), content_hash: uniq("h"), payload: "시험용 원문", ...over };
    const keys = Object.keys(row);
    return (await one(`insert into public.raw_snapshots (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, keys.map((k) => row[k]))).id;
  };
  return { uniq, one, attempt, tx, snapshot };
}
