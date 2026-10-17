#!/usr/bin/env node
// 사내 서버 스케줄러 (FND-07) — Vercel Cron 대신 같은 일정(vercel.json의 crons)으로 같은 /api/jobs/*를 부른다.
// 매 분 0초에 지금 실행할 작업을 골라 POST하고, 결과를 한 줄 JSON으로 남긴다.
// 인증은 Vercel Cron과 같은 `Authorization: Bearer <CRON_SECRET>`, 호출 경로 표시는 `x-job-trigger: scheduler`.
// 사용: node run.mjs                 (계속 돈다)
//       node run.mjs --once <작업>   (그 작업을 한 번 부르고 결과대로 끝낸다 — 운영자가 손으로 돌릴 때)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dueJobs } from "./cron.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEDULE_FILE = process.env.SCHEDULE_FILE || path.join(HERE, "..", "..", "apps", "web", "vercel.json");
const BASE = process.env.JOBS_BASE_URL;
const SECRET = process.env.CRON_SECRET;

function log(entry) {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));
}

async function call(job) {
  try {
    const res = await fetch(`${BASE}/api/jobs/${job}`, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}`, "x-job-trigger": "scheduler" },
      signal: AbortSignal.timeout(10 * 60_000),
    });
    const body = await res.json().catch(() => ({}));
    log({ job, status: res.status, runId: body.runId ?? null, result: body.status ?? body.error ?? null });
    return res.ok;
  } catch (err) {
    log({ job, status: null, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

if (!BASE || !SECRET) {
  console.error("JOBS_BASE_URL과 CRON_SECRET이 필요합니다 (사내 서버 환경 파일)");
  process.exit(2);
}

const onceIndex = process.argv.indexOf("--once");
if (onceIndex !== -1) {
  const job = process.argv[onceIndex + 1];
  if (!job) {
    console.error("사용: node run.mjs --once <작업 이름>");
    process.exit(2);
  }
  process.exit((await call(job)) ? 0 : 1);
}

const { crons = [] } = JSON.parse(fs.readFileSync(SCHEDULE_FILE, "utf8"));
dueJobs(crons, new Date()); // 시작할 때 일정 문법을 한 번 검사한다 (틀리면 여기서 멈춘다)
log({ started: true, jobs: crons.map((c) => `${c.path} ${c.schedule}`) });

function scheduleNextMinute() {
  const now = Date.now();
  setTimeout(tick, 60_000 - (now % 60_000) + 50);
}

async function tick() {
  scheduleNextMinute();
  const now = new Date();
  now.setUTCSeconds(0, 0);
  for (const job of dueJobs(crons, now)) await call(job);
}

scheduleNextMinute();
