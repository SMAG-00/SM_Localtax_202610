// FND-04 — 모든 테이블 RLS 기본 거부. anon·authenticated로 비공개 테이블 접근 0.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";
import { tablesWithoutRls, exposedTables } from "../scripts/verify-rls.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "verify-rls.mjs");
let client;

before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

async function inTx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

test("RLS를 켜지 않은 테이블을 찾아낸다", async () => {
  const found = await inTx(async () => {
    await client.query("create table public.__rls_probe (id int)");
    return tablesWithoutRls(client);
  });
  assert.ok(found.includes("public.__rls_probe"), JSON.stringify(found));
});

test("RLS를 켜고 정책이 없으면 anon이 행을 볼 수 없다", async () => {
  const exposed = await inTx(async () => {
    await client.query("create table public.__rls_probe (id int)");
    await client.query("alter table public.__rls_probe enable row level security");
    await client.query("insert into public.__rls_probe values (1)");
    return exposedTables(client, "anon");
  });
  assert.ok(!exposed.some((e) => e.table === "public.__rls_probe"), JSON.stringify(exposed));
});

test("anon에게 열린 정책이 있으면 노출로 판정한다", async () => {
  const exposed = await inTx(async () => {
    await client.query("create table public.__rls_probe (id int)");
    await client.query("alter table public.__rls_probe enable row level security");
    await client.query("create policy probe_read on public.__rls_probe for select to anon using (true)");
    await client.query("insert into public.__rls_probe values (1)");
    return exposedTables(client, "anon");
  });
  assert.ok(exposed.some((e) => e.table === "public.__rls_probe" && e.rows === 1), JSON.stringify(exposed));
});

test("현재 로컬 DB 전체 검사 — 스크립트가 종료 코드 0", () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env: { ...process.env, DB_URL: dbUrl() } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /통과/);
});
