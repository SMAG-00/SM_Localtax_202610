// FND-04 — 실제 API(PostgREST)에 anon 키로 요청해 비공개 테이블·함수 접근 0을 확인한다.
// 로컬 Supabase의 REST 주소와 개발용 anon 키로 돌린다. 노출 판정 시험은 일부러 새는 표를 만들었다가 지운다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";
import { probeRest, classify, ANON_EXECUTE_ALLOWED } from "../scripts/verify-rls-remote.mjs";

const DB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let client;
let rest;

before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
  const out = execFileSync("supabase", ["status", "-o", "json"], { cwd: DB_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: process.platform === "win32" });
  const j = JSON.parse(out.slice(out.indexOf("{")));
  rest = { url: j.API_URL, anonKey: j.ANON_KEY };
});

after(async () => {
  await client?.query("drop table if exists public.__rls_leak_probe");
  await client?.end();
});

test("판정 — 빈 배열·401·403·404는 차단, 행이 있는 200은 노출", () => {
  assert.equal(classify(200, []), "blocked");
  assert.equal(classify(401, { message: "x" }), "blocked");
  assert.equal(classify(403, {}), "blocked");
  assert.equal(classify(404, {}), "blocked");
  assert.equal(classify(200, [{ id: 1 }]), "exposed");
  assert.equal(classify(500, {}), "error");
});

test("실제 로컬 API — 지금 테이블 3개(audit_logs·audit_log_changes·agent_runs)는 anon으로 0행", async () => {
  const r = await probeRest(rest.url, rest.anonKey, ["audit_logs", "audit_log_changes", "agent_runs"], []);
  assert.deepEqual(r.exposed, []);
  assert.deepEqual(r.errors, []);
  assert.equal(r.checked, 3);
});

test("실제 로컬 API — 감사 기록 수정·삭제 함수는 anon이 부를 수 없다", async () => {
  const r = await probeRest(rest.url, rest.anonKey, [], ["audit_log_amend", "audit_log_delete"]);
  assert.deepEqual(r.exposed, []);
});

test("허용된 공개 함수(health_ping)만 anon 실행 허용 목록에 있다", () => {
  assert.deepEqual([...ANON_EXECUTE_ALLOWED], ["health_ping"]);
});

test("일부러 새는 표(anon 읽기 정책 + 행 1개)를 만들면 노출로 잡는다", async () => {
  await client.query("create table public.__rls_leak_probe (id int)");
  await client.query("alter table public.__rls_leak_probe enable row level security");
  await client.query("grant select on public.__rls_leak_probe to anon");
  await client.query("create policy leak on public.__rls_leak_probe for select to anon using (true)");
  await client.query("insert into public.__rls_leak_probe values (1)");
  await client.query("notify pgrst, 'reload schema'");
  // PostgREST가 스키마를 다시 읽을 때까지 잠시 기다린다
  let r;
  for (let i = 0; i < 20; i++) {
    r = await probeRest(rest.url, rest.anonKey, ["__rls_leak_probe"], []);
    if (r.exposed.length) break;
    await new Promise((s) => setTimeout(s, 250));
  }
  assert.deepEqual(r.exposed, ["__rls_leak_probe"]);
});
