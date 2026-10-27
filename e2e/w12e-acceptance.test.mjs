// W12-e 수용 E2E - 평가·게이트·품질 콘솔 (docs/dev/W12-e_설계.md 7장 - PRD-04 EVAL-01~04 · QUAL-01~04)
// standalone 빌드를 로컬 Supabase에 붙인다. 실제 모델 API는 부르지 않는다(키를 넣지 않고, 평가 실행 시험은 가짜 모델만).
//  a) 작업 quality-daily 인증 - 비밀 없이/틀리게 호출하면 거부, 맞으면 200
//  b) 차단율 - 5분 안 검증 기록 6건 중 6건 차단 -> 경보 정확히 1건, 작업을 여러 번 돌려도 1건 (QUAL-03)
//  c) 예산 - 예산 값이 없으면 경보 0, 80%에서 경고 1건, 100%에서 초과 1건, 작업 반복해도 중복 0 (QUAL-04)
//  d) 승인 - 리포트 없이 공개 단계를 올리면 거부 + 감사 정확히 1행, 단계는 그대로 (EVAL-04)
//  e) 화면·API - 로그인 없이 /api/admin/quality는 거부, /admin/quality는 로그인 화면으로 보냄
//  f) 경계 - 평가 실행기·품질 콘솔 코드가 AI SDK·외부 주소·상속증여 엔진을 직접 부르지 않는다
// 만든 행은 끝나면 지운다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e-w12e.example.test";
const CRON = "e2e-w12e-cron";
const GUARD = "e2e-w12e-guard-secret";
const ROOT = path.resolve(import.meta.dirname, "..");

let sb, server, staff, db, base;
let saved = {};
const made = { sessions: [] };

const job = (secret = CRON) => fetch(`${base}/api/jobs/quality-daily`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} });
const openAlerts = async (kind) => (await db.query("select * from public.quality_alerts where kind = $1 and acked_at is null", [kind])).rows;
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

async function clean() {
  if (made.sessions.length) await db.query("delete from public.agent_sessions where id = any($1::uuid[])", [made.sessions]);
  made.sessions = [];
  await db.query("delete from public.quality_alerts");
  await db.query("delete from public.agent_usage_daily where day = $1::date and tier = 'member'", [kstToday()]);
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    NEXT_PUBLIC_SITE_URL: SITE,
    CRON_SECRET: CRON,
    GUARD_SECRET: GUARD,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  saved.budget = (await db.query("select value from public.settings where key = 'ask_budget'")).rows[0]?.value ?? null;
  saved.alert = (await db.query("select value from public.settings where key = 'quality_alert'")).rows[0]?.value ?? null;
  saved.usage = (await db.query("select * from public.agent_usage_daily where day = $1::date and tier = 'member'", [kstToday()])).rows[0] ?? null;
  await db.query("delete from public.settings where key in ('ask_budget', 'quality_alert')");
  await clean();
});

after(async () => {
  try {
    await clean();
    await db.query("delete from public.settings where key in ('ask_budget', 'quality_alert')");
    if (saved.budget) await db.query("insert into public.settings (key, value) values ('ask_budget', $1::jsonb)", [JSON.stringify(saved.budget)]);
    if (saved.alert) await db.query("insert into public.settings (key, value) values ('quality_alert', $1::jsonb)", [JSON.stringify(saved.alert)]);
    if (saved.usage) await db.query("insert into public.agent_usage_daily (day, tier, turns, tokens_in, tokens_out, cost) values ($1, 'member', $2, $3, $4, $5)", [saved.usage.day, saved.usage.turns, saved.usage.tokens_in, saved.usage.tokens_out, saved.usage.cost]);
  } finally {
    await staff?.cleanup();
    await server?.stop();
  }
});

test("a) 작업 quality-daily 인증 - 비밀이 없거나 틀리면 거부, 맞으면 200", async () => {
  assert.notEqual((await job("")).status, 200);
  assert.notEqual((await job("wrong")).status, 200);
  assert.equal((await job()).status, 200);
});

test("b) 차단율 - 5분 안 6건이 모두 차단이면 경보 정확히 1건이고, 작업을 반복해도 1건", async () => {
  const sid = crypto.randomUUID();
  made.sessions.push(sid);
  await db.query("insert into public.agent_sessions (id, mode, as_of_date, retain_until) values ($1, 'general', current_date, current_date + 30)", [sid]);
  const pv = (await db.query("select public.agent_register_prompt('agent_answer', 'e2e', $1) id", [`시험용 지시문 ${sid}`])).rows[0].id;
  for (let i = 1; i <= 6; i++) {
    const m = (await db.query("insert into public.agent_messages (session_id, turn, kind, scope, tier, model, prompt_version_id) values ($1, $2, 'answer', 'base', 'guest', 'e2e-model', $3) returning id", [sid, i, pv])).rows[0];
    await db.query("insert into public.agent_validations (message_id, v1, v2, v3, v4, v5, v6) values ($1, false, true, true, true, true, true)", [m.id]);
  }
  assert.equal((await openAlerts("block_rate")).length, 1, "검증 기록을 쓰는 거래에서 바로 경보");
  assert.equal((await job()).status, 200);
  assert.equal((await job()).status, 200);
  assert.equal((await openAlerts("block_rate")).length, 1, "작업 반복에도 중복 0");
  const view = (await db.query("select count(*)::int n from public.quality_blocked_log where message_id in (select id from public.agent_messages where session_id = $1)", [sid])).rows[0].n;
  assert.equal(view, 6, "차단 로그 뷰에 6건");
});

test("c) 예산 - 값이 없으면 경보 0, 80%에서 경고 1건, 100%에서 초과 1건, 작업 반복해도 중복 0", async () => {
  await db.query("delete from public.quality_alerts where kind in ('budget_warn', 'budget_over')");
  const today = kstToday();
  await db.query("insert into public.agent_usage_daily (day, tier, turns, cost) values ($1, 'member', 1, 9000)", [today]);
  assert.equal((await job()).status, 200);
  assert.equal((await openAlerts("budget_warn")).length + (await openAlerts("budget_over")).length, 0, "예산 값이 없으면 경보 0");

  await db.query("insert into public.settings (key, value) values ('ask_budget', '{\"monthly_won\": 10000}'::jsonb)");
  await db.query("update public.agent_usage_daily set cost = 7999 where day = $1 and tier = 'member'", [today]);
  await job();
  assert.equal((await openAlerts("budget_warn")).length, 0, "79.99%는 경보 0");

  await db.query("update public.agent_usage_daily set cost = 8000 where day = $1 and tier = 'member'", [today]);
  await job();
  await job();
  assert.equal((await openAlerts("budget_warn")).length, 1);
  assert.equal((await openAlerts("budget_over")).length, 0);

  await db.query("update public.agent_usage_daily set cost = 10000 where day = $1 and tier = 'member'", [today]);
  await job();
  await job();
  assert.equal((await openAlerts("budget_warn")).length, 1);
  assert.equal((await openAlerts("budget_over")).length, 1);
});

test("d) 리포트 없이 공개 단계를 올리면 거부 + 감사 정확히 1행, 단계는 그대로", async () => {
  const before = (await db.query("select value from public.settings where key = 'ask_rollout'")).rows[0]?.value;
  const n0 = (await db.query("select count(*)::int n from public.eval_audit")).rows[0].n;
  const r = (await db.query("select public.ask_rollout_approve('4a', null, 'admin:e2e-w12e', null) r")).rows[0].r;
  assert.equal(r.ok, false);
  assert.ok(r.code && r.code !== "ok");
  assert.equal((await db.query("select count(*)::int n from public.eval_audit")).rows[0].n, n0 + 1);
  assert.deepEqual((await db.query("select value from public.settings where key = 'ask_rollout'")).rows[0]?.value, before);
});

test("e) 로그인 없이 /api/admin/quality는 거부, /admin/quality는 로그인 화면으로", async () => {
  const api = await fetch(`${base}/api/admin/quality`);
  assert.ok([401, 403].includes(api.status), String(api.status));
  const post = await fetch(`${base}/api/admin/quality`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "run_daily" }) });
  assert.ok([401, 403].includes(post.status), String(post.status));
  const page = await fetch(`${base}/admin/quality`, { redirect: "manual" });
  assert.ok([302, 303, 307, 308, 401, 403, 404].includes(page.status), String(page.status));
  assert.ok(!(await page.text()).includes("지방세봇의 경보"), "화면 내용이 새지 않는다");
});

test("f) 경계 - 평가 실행기·품질 콘솔이 AI SDK·외부 주소·상속증여 엔진을 직접 부르지 않는다", () => {
  const files = ["apps/web/lib/eval/runner.ts", "apps/web/lib/eval/quality.ts", "apps/web/lib/server/eval/runner.ts", "apps/web/lib/server/quality/service.ts", "apps/web/app/api/admin/quality/route.ts"];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.ok(!/from\s+["'](ai|@ai-sdk\/[^"']*|openai|@anthropic-ai\/sdk|@google\/[^"']*)["']/.test(src), `${f}: AI SDK import`);
    assert.ok(!/https?:\/\//.test(src.replace(/\/\/.*$/gm, "")), `${f}: 외부 주소 직접 사용`);
    assert.ok(!/igt|inheritance-engine|gift-engine/i.test(src.replace(/\/\/.*$/gm, "").replace(/"inheritance"|'inheritance'|"gift"|'gift'/g, "")), `${f}: 상속·증여 엔진`);
  }
});
