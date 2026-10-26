// FND-07 사내 스케줄러 — Vercel Cron과 같은 일정(apps/web/vercel.json의 crons)을 읽어 같은 /api/jobs/*를 부른다.
// 일정 문법(분 시 일 월 요일)과 시각 판정을 구체적인 시각으로 확인한다. 시각은 UTC 기준 (Vercel Cron과 같다).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCron, matches, dueJobs } from "../../deploy/scheduler/cron.mjs";

const at = (iso) => new Date(iso);

test("매일 15:00 UTC(한국 00:00) — 15:00에만 맞고 14:59·15:01은 아니다", () => {
  const c = parseCron("0 15 * * *");
  assert.equal(matches(c, at("2026-10-17T15:00:00Z")), true);
  assert.equal(matches(c, at("2026-10-17T14:59:00Z")), false);
  assert.equal(matches(c, at("2026-10-17T15:01:00Z")), false);
});

test("간격(*/15)·목록(1,30)·범위(9-18)", () => {
  assert.equal(matches(parseCron("*/15 * * * *"), at("2026-10-17T10:45:00Z")), true);
  assert.equal(matches(parseCron("*/15 * * * *"), at("2026-10-17T10:46:00Z")), false);
  assert.equal(matches(parseCron("1,30 * * * *"), at("2026-10-17T10:30:00Z")), true);
  assert.equal(matches(parseCron("0 9-18 * * *"), at("2026-10-17T18:00:00Z")), true);
  assert.equal(matches(parseCron("0 9-18 * * *"), at("2026-10-17T19:00:00Z")), false);
});

test("요일 — 매주 월요일(1) 06:00, 일요일은 0과 7 모두", () => {
  assert.equal(matches(parseCron("0 6 * * 1"), at("2026-10-19T06:00:00Z")), true); // 월
  assert.equal(matches(parseCron("0 6 * * 1"), at("2026-10-20T06:00:00Z")), false); // 화
  assert.equal(matches(parseCron("0 0 * * 0"), at("2026-10-18T00:00:00Z")), true); // 일
  assert.equal(matches(parseCron("0 0 * * 7"), at("2026-10-18T00:00:00Z")), true);
});

test("일·월 경계 — 매월 1일 00:00, 12월 31일 → 1월 1일", () => {
  const c = parseCron("0 0 1 * *");
  assert.equal(matches(c, at("2027-01-01T00:00:00Z")), true);
  assert.equal(matches(c, at("2026-12-31T00:00:00Z")), false);
});

test("일과 요일을 둘 다 지정하면 둘 중 하나만 맞아도 실행 (표준 cron 규칙)", () => {
  const c = parseCron("0 0 13 * 5"); // 13일 또는 금요일
  assert.equal(matches(c, at("2026-10-13T00:00:00Z")), true); // 화요일 13일
  assert.equal(matches(c, at("2026-10-16T00:00:00Z")), true); // 금요일 16일
  assert.equal(matches(c, at("2026-10-14T00:00:00Z")), false);
});

for (const bad of ["", "* * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8", "a * * * *", "*/0 * * * *"]) {
  test(`잘못된 일정(${JSON.stringify(bad)})은 오류`, () => {
    assert.throws(() => parseCron(bad));
  });
}

test("vercel.json의 crons에서 지금 실행할 작업만 고른다 — 경로가 /api/jobs/*가 아니면 무시하지 않고 오류", () => {
  const crons = [
    { path: "/api/jobs/scheduler-heartbeat", schedule: "0 15 * * *" },
    { path: "/api/jobs/link-check", schedule: "0 21 * * 0" },
  ];
  assert.deepEqual(dueJobs(crons, at("2026-10-17T15:00:00Z")), ["scheduler-heartbeat"]);
  assert.deepEqual(dueJobs(crons, at("2026-10-18T21:00:00Z")), ["link-check"]);
  assert.deepEqual(dueJobs(crons, at("2026-10-18T21:01:00Z")), []);
  assert.throws(() => dueJobs([{ path: "/api/other", schedule: "* * * * *" }], at("2026-10-18T21:00:00Z")));
});

// ── 저장소의 일정 파일 (apps/web/vercel.json — Vercel Cron과 사내 스케줄러가 같이 읽는다) ─────────────
// Vercel Hobby 요금제는 일정 한 줄이 하루 한 번 넘게 돌면 배포가 실패한다(Vercel 문서 'Hobby scheduling limits').
// 그래서 1시간 집계(popular-hourly)는 하루 한 번짜리 줄 24개로 적는다 — Hobby는 그 시간 안 아무 때(±59분), Pro·사내 스케줄러는 정각 5분 (W2-c 설계 8.2)

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCHEDULE = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "vercel.json"), "utf8")).crons;
const DAY_MINUTES = Array.from({ length: 24 * 60 }, (_, m) => new Date(Date.UTC(2026, 9, 18, 0, m)));

// 한 주(일~토, 2026-10-18~24) 1주일치 분 — 요일을 지정한 주간 줄(W10-e 브리핑 초안·발행)은 일주일에 정확히 1번, 어느 날이든 하루 1번을 넘지 않는다
const WEEK_MINUTES = Array.from({ length: 7 * 24 * 60 }, (_, m) => new Date(Date.UTC(2026, 9, 18, 0, m)));

test("일정 파일의 줄마다 하루 한 번만 돈다 (Vercel Hobby 배포 조건) — 매일 줄은 하루 1,440분 중 맞는 분이 정확히 1개, 요일을 지정한 주간 줄은 일주일에 정확히 1개", () => {
  assert.ok(SCHEDULE.length >= 3);
  for (const { path: p, schedule } of SCHEDULE) {
    const c = parseCron(schedule);
    const weekly = schedule.trim().split(/\s+/)[4] !== "*";
    if (weekly) {
      const hits = WEEK_MINUTES.filter((d) => matches(c, d));
      assert.equal(hits.length, 1, `${p} ${schedule}: 주간 줄이 일주일에 ${hits.length}번`);
    } else {
      const hits = DAY_MINUTES.filter((d) => matches(c, d)).length;
      assert.equal(hits, 1, `${p} ${schedule}: 하루 ${hits}번`);
    }
  }
});

test("popular-hourly는 UTC 매시 5분에 한 번씩 — 24개 시간대마다 정확히 1번, 다른 작업은 하루 1번 (기준 일요일 — 일요일 줄 brief-draft 포함, 월요일 줄 brief-publish는 월요일 UTC 01:00)", () => {
  const perHour = Array.from({ length: 24 }, () => 0);
  for (const d of DAY_MINUTES) for (const job of dueJobs(SCHEDULE, d)) if (job === "popular-hourly") perHour[d.getUTCHours()] += 1;
  assert.deepEqual(perHour, Array.from({ length: 24 }, () => 1));
  assert.deepEqual(dueJobs(SCHEDULE, new Date("2026-10-18T07:05:00Z")), ["popular-hourly"]);
  assert.deepEqual(dueJobs(SCHEDULE, new Date("2026-10-18T07:06:00Z")), []);
  const daily = DAY_MINUTES.flatMap((d) => dueJobs(SCHEDULE, d)).filter((j) => j !== "popular-hourly");
  assert.deepEqual(daily.sort(), ["accuracy-run", "amendment-alert", "amendment-detect", "analytics-retention", "billing-reconcile", "brief-draft", "brief-reconfirm", "case-summary-draft", "consistency-watch", "index-refresh", "indexnow-submit", "institution-inquiry-purge", "issue-graph-stale", "link-check", "ops-ai-budget", "org-contract-close", "pipeline-docs", "pipeline-field-data", "pipeline-law", "privacy-retention", "readiness-monthly", "renewal-notice", "scheduler-heartbeat", "search-console-daily", "source-expiry", "zone-refresh"]);
  assert.deepEqual(dueJobs(SCHEDULE, new Date("2026-10-19T01:00:00Z")), ["brief-publish"], "월요일 UTC 01:00(한국 10:00)에 브리핑 발행");
  assert.deepEqual(dueJobs(SCHEDULE, new Date("2026-10-18T01:00:00Z")), [], "일요일 같은 시각에는 발행 0");
});

test("일정 파일의 작업은 모두 작업 목록(workflows)에 있다 — 없는 작업을 부르는 일정 0", async () => {
  const { jobs } = await import("../../workflows/src/index.ts");
  const names = [...new Set(SCHEDULE.map((c) => c.path.replace("/api/jobs/", "")))];
  for (const n of names) assert.ok(Object.hasOwn(jobs, n), `${n}이 workflows 작업 목록에 없다`);
  assert.deepEqual(names.sort(), Object.keys(jobs).sort(), "목록의 작업은 모두 일정이 있다");
});

test("source-expiry(공식 자료 시점 만료 — W4 6단계)는 한국 날짜 00시대에 하루 한 번 — 실행 키(한국 날짜)가 그날 하나 (Hobby ±59분이어도 같은 날짜)", () => {
  const rows = SCHEDULE.filter((c) => c.path === "/api/jobs/source-expiry");
  assert.equal(rows.length, 1, "일정 한 줄");
  const hits = DAY_MINUTES.filter((d) => dueJobs(rows, d).length > 0);
  assert.equal(hits.length, 1);
  const utcHour = hits[0].getUTCHours();
  assert.equal(utcHour, 15, "UTC 15시 = 한국 00시");
  // Hobby는 그 시간 안 아무 때 — 15:00~15:59 UTC는 모두 한국 날짜가 같다(다음 날 00:00~00:59)
  const kstDate = (d) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  assert.equal(kstDate(new Date("2026-10-18T15:00:00Z")), kstDate(new Date("2026-10-18T15:59:59Z")));
});
