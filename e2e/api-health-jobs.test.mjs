// FND-06 상태 확인 /api/health · FND-07 배치 /api/jobs/* (CRON_SECRET 인증, 실행 기록 agent_runs)
// standalone 빌드(Docker 이미지와 같은 산출물)를 실제로 띄우고 로컬 Supabase에 붙여 확인한다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import { buildWeb, localSupabase, startServer, freePort } from "./lib/local.mjs";

const SECRET = crypto.randomBytes(24).toString("hex");
const JOB = "scheduler-heartbeat";
let sb, ok, dbDown, noSecret, db;
const createdRuns = [];

before(async () => {
  sb = localSupabase();
  buildWeb();
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    CRON_SECRET: SECRET,
  };
  ok = await startServer(env);
  dbDown = await startServer({ ...env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${await freePort()}` });
  noSecret = await startServer({ ...env, CRON_SECRET: "" });
  db = new pg.Client({ connectionString: sb.dbUrl });
  await db.connect();
});

after(async () => {
  if (createdRuns.length) await db.query("delete from public.agent_runs where id = any($1::bigint[])", [createdRuns]);
  await db?.end();
  for (const s of [ok, dbDown, noSecret]) s?.stop();
});

const countRuns = async () => (await db.query("select count(*)::int n from public.agent_runs where job = $1", [JOB])).rows[0].n;

test("DB가 응답하면 /api/health는 200과 항목별 ok", async () => {
  const res = await fetch(`${ok.base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.checks.db, "ok");
  assert.equal(res.headers.get("cache-control")?.includes("no-store"), true);
});

test("DB 연결이 끊기면 /api/health는 503과 실패 항목 이름(db)", async () => {
  const res = await fetch(`${dbDown.base}/api/health`);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, "fail");
  assert.deepEqual(body.failed, ["db"]);
});

test("/api/health 응답에 키·접속 주소가 없다", async () => {
  const text = await (await fetch(`${ok.base}/api/health`)).text();
  for (const secret of [sb.serviceRoleKey, sb.anonKey, sb.url, SECRET]) assert.ok(!text.includes(secret));
});

test("CRON_SECRET 없이 부르면 401이고 실행 기록이 생기지 않는다", async () => {
  const before = await countRuns();
  for (const headers of [{}, { authorization: "Bearer wrong" }, { authorization: SECRET }, { authorization: `Bearer ${SECRET}x` }]) {
    const res = await fetch(`${ok.base}/api/jobs/${JOB}`, { method: "POST", headers });
    assert.equal(res.status, 401, JSON.stringify(headers).slice(0, 30));
  }
  assert.equal(await countRuns(), before);
});

test("서버에 CRON_SECRET이 설정되지 않았으면 어떤 값으로도 401 (닫힌 쪽으로 실패)", async () => {
  for (const auth of ["Bearer ", "Bearer undefined", `Bearer ${SECRET}`]) {
    const res = await fetch(`${noSecret.base}/api/jobs/${JOB}`, { method: "POST", headers: { authorization: auth } });
    assert.equal(res.status, 401);
  }
});

test("Vercel Cron 경로와 사내 스케줄러 경로로 한 번씩 부르면 같은 형식의 실행 기록 2건", async () => {
  const cron = await fetch(`${ok.base}/api/jobs/${JOB}`, {
    headers: { authorization: `Bearer ${SECRET}`, "user-agent": "vercel-cron/1.0" },
  });
  const sched = await fetch(`${ok.base}/api/jobs/${JOB}`, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}`, "x-job-trigger": "scheduler" },
  });
  assert.equal(cron.status, 200);
  assert.equal(sched.status, 200);
  const a = await cron.json();
  const b = await sched.json();
  createdRuns.push(a.runId, b.runId);
  const { rows } = await db.query("select * from public.agent_runs where id = any($1::bigint[]) order by id", [[a.runId, b.runId]]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.trigger), ["vercel-cron", "scheduler"]);
  for (const r of rows) {
    assert.equal(r.job, JOB);
    assert.equal(r.status, "succeeded");
    assert.ok(r.finished_at >= r.started_at);
  }
  assert.deepEqual(Object.keys(rows[0]).sort(), Object.keys(rows[1]).sort());
});

test("없는 작업 이름은 인증이 맞아도 404이고 기록이 생기지 않는다", async () => {
  const before = (await db.query("select count(*)::int n from public.agent_runs")).rows[0].n;
  const res = await fetch(`${ok.base}/api/jobs/no-such-job`, { method: "POST", headers: { authorization: `Bearer ${SECRET}` } });
  assert.equal(res.status, 404);
  assert.equal((await db.query("select count(*)::int n from public.agent_runs")).rows[0].n, before);
});
