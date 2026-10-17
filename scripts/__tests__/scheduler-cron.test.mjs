// FND-07 사내 스케줄러 — Vercel Cron과 같은 일정(apps/web/vercel.json의 crons)을 읽어 같은 /api/jobs/*를 부른다.
// 일정 문법(분 시 일 월 요일)과 시각 판정을 구체적인 시각으로 확인한다. 시각은 UTC 기준 (Vercel Cron과 같다).
import { test } from "node:test";
import assert from "node:assert/strict";
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
