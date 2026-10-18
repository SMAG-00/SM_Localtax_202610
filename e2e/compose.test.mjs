// FND-07 사내 서버 구성(deploy/compose.yaml) E2E — web·scheduler·proxy를 실제로 띄운다.
//  - 중계(Caddy)를 거쳐 상태 확인·첫 화면이 응답한다
//  - 컨테이너 스케줄러가 같은 /api/jobs/*를 불러 실행 기록(trigger=scheduler)이 남는다 — Vercel Cron 경로와 같은 형식
//  - 중계 설정이 응답을 모아 두지 않는다(flush_interval -1, SSE)
// 로컬 Supabase(호스트)에 붙인다. 시험용 설정은 임시 덮어쓰기 파일로만 넣고, 끝나면 컨테이너와 실행 기록을 지운다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import pg from "pg";
import { ROOT, localSupabase, freePort } from "./lib/local.mjs";

const PROJECT = "ltr-compose-e2e";
const COMPOSE = path.join(ROOT, "deploy", "compose.yaml");
let dir, override, envFile, port, db;
const runIds = [];
// 떠 있는 스케줄러는 일정(vercel.json)대로도 부른다 — 1시간 집계(popular-hourly, 매시 5분)가 시험 중에 돌 수 있다.
// 시험은 자기가 부른 작업(scheduler-heartbeat) 기록만 세고, 끝나면 시험 동안 스케줄러가 남긴 기록을 모두 지운다
const startedAt = new Date();
const HEARTBEAT = "scheduler-heartbeat";

const compose = (...args) =>
  spawnSync("docker", ["compose", "-p", PROJECT, "-f", COMPOSE, "-f", override, ...args], { cwd: ROOT, encoding: "utf8" });

before(async () => {
  const sb = localSupabase();
  const inContainer = (u) => u.replace("127.0.0.1", "host.docker.internal");
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ltr-compose-"));
  envFile = path.join(dir, "server.env");
  fs.writeFileSync(
    envFile,
    [
      `NEXT_PUBLIC_SUPABASE_URL=${inContainer(sb.url)}`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${sb.anonKey}`,
      `SUPABASE_SERVICE_ROLE_KEY=${sb.serviceRoleKey}`,
      `CRON_SECRET=${crypto.randomBytes(24).toString("hex")}`,
    ].join("\n") + "\n",
  );
  port = await freePort();
  override = path.join(dir, "override.yaml");
  const envPath = envFile.split(path.sep).join("/");
  fs.writeFileSync(
    override,
    [
      "services:",
      "  web:",
      `    env_file: ["${envPath}"]`,
      "    extra_hosts: ['host.docker.internal:host-gateway']",
      "  scheduler:",
      `    env_file: ["${envPath}"]`,
      "  proxy:",
      `    ports: !override ['127.0.0.1:${port}:80']`,
      "",
    ].join("\n"),
  );
  const up = compose("up", "-d", "--build", "--wait", "--wait-timeout", "180");
  assert.equal(up.status, 0, up.stderr.slice(-2000));
  db = new pg.Client({ connectionString: sb.dbUrl });
  await db.connect();
});

after(async () => {
  if (runIds.length) await db?.query("delete from public.agent_runs where id = any($1::bigint[])", [runIds]);
  await db?.query("delete from public.agent_runs where trigger = 'scheduler' and started_at >= $1", [startedAt]);
  await db?.end();
  if (override) compose("down", "-v", "--remove-orphans");
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test("중계(Caddy)를 거쳐 상태 확인이 200이고 DB ok — 사내 서버에서는 env 검사 skipped", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.checks.db, "ok");
  assert.equal(body.checks.env, "skipped");
});

test("중계를 거쳐 첫 화면이 응답한다", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<html lang="ko"/);
});

test("컨테이너 스케줄러가 /api/jobs/scheduler-heartbeat를 불러 trigger=scheduler 실행 기록 1건", async () => {
  const before = (await db.query("select coalesce(max(id),0)::bigint as m from public.agent_runs")).rows[0].m;
  const r = compose("run", "--rm", "--no-deps", "scheduler", "node", "run.mjs", "--once", "scheduler-heartbeat");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const line = JSON.parse(r.stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop());
  assert.equal(line.status, 200);
  const { rows } = await db.query("select * from public.agent_runs where id > $1 and job = $2 order by id", [before, HEARTBEAT]);
  runIds.push(...rows.map((x) => x.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].trigger, "scheduler");
  assert.equal(rows[0].status, "succeeded");
  assert.equal(String(rows[0].id), String(line.runId));
});

test("스케줄러에 CRON_SECRET이 틀리면 거절되고(401) 실행 기록이 생기지 않는다", async () => {
  const count = async () => (await db.query("select count(*)::int n from public.agent_runs where job = $1", [HEARTBEAT])).rows[0].n;
  const before = await count();
  const r = compose("run", "--rm", "--no-deps", "-e", "CRON_SECRET=wrong-secret", "scheduler", "node", "run.mjs", "--once", "scheduler-heartbeat");
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /"status":401/);
  assert.equal(await count(), before);
});

test("스케줄러는 Vercel Cron과 같은 일정 파일(apps/web/vercel.json)을 쓴다", () => {
  const out = execFileSync("docker", ["compose", "-p", PROJECT, "-f", COMPOSE, "-f", override, "config", "--format", "json"], { cwd: ROOT, encoding: "utf8" });
  const cfg = JSON.parse(out);
  const vol = cfg.services.scheduler.volumes.find((v) => v.target === "/schedule/vercel.json");
  assert.ok(vol, "일정 파일 마운트가 없다");
  assert.equal(path.resolve(vol.source), path.join(ROOT, "apps", "web", "vercel.json"));
});

test("중계 설정이 스트리밍 응답을 모아 두지 않는다 (flush_interval -1)", () => {
  const caddy = fs.readFileSync(path.join(ROOT, "deploy", "Caddyfile"), "utf8");
  assert.match(caddy, /reverse_proxy web:3000 \{[^}]*flush_interval -1/s);
});
