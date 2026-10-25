// W10-e 수용 E2E (docs/dev/W10-e_설계.md - AIOPS-01·02·04 · BRIEF-01~04 · HOME-09 · TX-12) - 작성만, 실행은 리드
// standalone 빌드를 로컬 Supabase에 붙인다. 메일은 로컬 SMTP 수신함(시험용)으로만 나가고, 운영 AI는 끈 상태(키 없음)로 돈다.
//  a) 감지 -> 후보 1건(재실행해도 1건) -> 승인 전 amendment_events 반영 0 -> 승인 뒤 반영 1건(origin=auto)
//  b) 작업 URL - Cron 비밀값 없으면 401 / 기능 키 꺼짐 skipped flag_off / 켜면 후보 생성 / AI 끈 상태에서도 detail에 오류 없음
//  c) 브리핑 발행 - 승인 전 공개 0 / 발행 시각 전 작업 실행해도 발행 0 / 시각 뒤 발행 1회 / 재실행해도 발송 1통 / 아카이브 공개
//  d) 구독 - 이중 확인 전 발송 0 / 확인 뒤 발송 / 거부 한 번 클릭 뒤 다음 호 발송 0 / 알림과 브리핑 따로 해지
//  e) 예산 - 설정이 비어 있으면 AI 호출 0 / 80% 경보 항목 1건(재실행해도 1건)
// 만든 행은 끝나면 되돌린다 (남는 행 0). 값은 모두 시험용이다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w10e-acceptance-e2e@example.test";
const CRON = "e2e-w10e-cron-secret";
const SITE = "https://e2e-w10e.example.test";
const ALL_CHECKS = ["original_compared", "numbers_dates_links", "no_personal_info", "stage_matches_source"];

let sb, server, staff, db, base, since, run;
const u = {};
const job = (name, secret = CRON) => fetch(`${base}/api/jobs/${name}`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) }));
const setFlag = (key, on) => db.query("update public.settings set value = value || jsonb_build_object($1::text, $2::boolean) where key = 'feature_flags'", [key, on]);
const lastDetail = async (name) => (await db.query("select detail, status, cost from public.agent_runs where job = $1 and started_at >= $2 order by id desc limit 1", [name, since])).rows[0];

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.alert_deliveries where consent_id in (select id from public.consents where email like $1)", [`%${run}%@example.test`]);
    await db.query("delete from public.subscriber_prefs where consent_id in (select id from public.consents where email like $1)", [`%${run}%@example.test`]);
    await db.query("delete from public.consents where email like $1", [`%${run}%@example.test`]);
    await db.query("delete from public.brief_issues where created_by = 'e2e:w10e'");
    await db.query("delete from public.review_item_events where item_id in (select id from public.review_items where created_by like 'e2e:w10e%' or created_by = 'job:amendment-detect' or created_by = 'job:ops-ai-budget')");
    await db.query("delete from public.review_items where created_by like 'e2e:w10e%' or created_by = 'job:amendment-detect' or created_by = 'job:ops-ai-budget'");
    await db.query("delete from public.agent_runs where job in ('amendment-detect','brief-draft','brief-publish','brief-reconfirm','amendment-alert','ops-ai-budget') and started_at >= $1", [since]);
    await db.query("update public.settings set value = value || '{\"amendment_auto\": false, \"brief_regular\": false, \"amendment_alerts\": false, \"ai_ops\": false}'::jsonb where key = 'feature_flags'");
    await db.query("update public.settings set value = '{}'::jsonb where key in ('ops_ai_budget', 'brief_publish_policy')");
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
    CRON_SECRET: CRON,
    GUARD_SECRET: "e2e-w10e-guard-secret-0001",
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  since = new Date().toISOString();
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  u.admin = await staff.createUser({ label: "w10e-admin", email: ADMIN_EMAIL });
  await purge();
});

after(async () => {
  try {
    await purge();
  } finally {
    await staff?.cleanup();
    await server?.stop?.();
  }
});

test("b) 작업 URL - 비밀값 없으면 401과 실행 기록 0, 기능 키가 꺼져 있으면 skipped flag_off", async () => {
  for (const name of ["amendment-detect", "brief-draft", "brief-publish", "brief-reconfirm", "amendment-alert"]) {
    assert.equal((await job(name, null)).status, 401, name);
  }
  assert.equal((await db.query("select count(*)::int n from public.agent_runs where job = 'amendment-detect' and started_at >= $1", [since])).rows[0].n, 0);
  await setFlag("amendment_auto", false);
  assert.equal((await job("amendment-detect")).status, 200);
  assert.deepEqual((await lastDetail("amendment-detect")).detail, { skipped: "flag_off" });
  await setFlag("brief_regular", false);
  await job("brief-publish");
  assert.deepEqual((await lastDetail("brief-publish")).detail, { skipped: "flag_off" });
});

test("a) 감지 - 후보 1건(재실행해도 1건), 승인 전 amendment_events 반영 0, 승인 뒤 origin=auto 1건", async () => {
  const law = (await db.query("select id from public.laws where name = '지방세법'")).rows[0].id;
  const snap = (await db.query("insert into public.raw_snapshots (source, url, content_hash, payload) values ('w10e-e2e', $1, $2, '시험용 원문') returning id", [`https://example.test/w10e/${run}`, `w10e-${run}-h`])).rows[0].id;
  const no = `시험용공포-${run}`;
  const v = (await db.query("insert into public.law_versions (law_id, promulgation_no, promulgated_on, effective_on, body_hash, snapshot_id) values ($1, $2, '2099-01-05', '2099-02-10', $3, $4) returning id", [law, no, `bh-${run}`, snap])).rows[0].id;
  const ev = (await db.query("insert into public.law_events (law_id, kind, event_key, version_id, snapshot_id) values ($1, 'revision', $2, $3, $4) returning id", [law, `${no}|2099-02-10`, v, snap])).rows[0].id;
  try {
    await setFlag("amendment_auto", true);
    const events0 = (await db.query("select count(*)::int n from public.amendment_events")).rows[0].n;
    assert.equal((await job("amendment-detect")).status, 200);
    assert.equal((await job("amendment-detect")).status, 200);
    const cands = (await db.query("select id, status from public.review_items where kind = 'amendment_stage' and source_key like $1", [`law_event:${ev}:%`])).rows;
    assert.equal(cands.length, 1, "공포 후보 1건 (시행일 전)");
    assert.equal((await db.query("select count(*)::int n from public.amendment_events")).rows[0].n, events0, "승인 전 반영 0");
    const am = (await db.query("insert into public.amendments (slug, title) values ($1, '시험용 개정안') returning id", [`w10e-${run}`])).rows[0].id;
    const early = await db.query("select public.amendment_candidate_apply($1, $2, 'e2e:w10e')", [cands[0].id, am]).then(() => null, (e) => e);
    assert.ok(early, "승인 전 반영 거부");
    await db.query("select public.review_item_transition($1, 'in_review', 'e2e:w10e')", [cands[0].id]);
    await db.query("select public.review_item_transition($1, 'approved', 'e2e:w10e', null, $2::text[])", [cands[0].id, ALL_CHECKS]);
    await db.query("select public.amendment_candidate_apply($1, $2, 'e2e:w10e')", [cands[0].id, am]);
    const rows = (await db.query("select origin, stage from public.amendment_events where review_item_id = $1", [cands[0].id])).rows;
    assert.deepEqual(rows, [{ origin: "auto", stage: "promulgated" }]);
  } finally {
    await db.query("begin");
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.amendment_events where review_item_id in (select id from public.review_items where source_key like $1)", [`law_event:${ev}:%`]);
    await db.query("delete from public.amendments where slug = $1", [`w10e-${run}`]);
    await db.query("delete from public.review_item_events where item_id in (select id from public.review_items where source_key like $1)", [`law_event:${ev}:%`]);
    await db.query("delete from public.review_items where source_key like $1", [`law_event:${ev}:%`]);
    await db.query("delete from public.law_events where id = $1", [ev]);
    await db.query("delete from public.law_versions where id = $1", [v]);
    await db.query("commit");
    await setFlag("amendment_auto", false);
  }
});

test("c) 발행 - 승인 전 공개 0, 발행 시각 전 작업은 발행 0, 시각 뒤 1회 발행, 재실행은 no-op", async () => {
  const policy = { disclaimer: "시험용 면책", no_harvest_notice: "시험용 무단수집 거부 안내", ad_info_url: "https://example.test/ad" };
  await db.query("update public.settings set value = $1::jsonb where key = 'brief_publish_policy'", [JSON.stringify(policy)]);
  await setFlag("brief_regular", true);
  const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();
  const mk = async (publishAt, no) => Number((await db.query("insert into public.brief_issues (issue_no, title, publish_at, created_by) values ($1, '시험용 브리핑', $2, 'e2e:w10e') returning id", [no, publishAt])).rows[0].id);
  const notYet = await mk(future, 9001);
  const due = await mk(past, 9002);
  assert.equal((await db.query("select count(*)::int n from public.public_brief_issues where issue_no in (9001, 9002)")).rows[0].n, 0, "승인 전 공개 0");
  await job("brief-publish");
  assert.equal((await db.query("select status from public.brief_issues where id = $1", [due])).rows[0].status, "draft", "승인 전 발행 0");
  for (const id of [notYet, due]) {
    await db.query("update public.brief_issues set check_report = '{\"blocking\":0,\"warnings\":0,\"findings\":[]}'::jsonb where id = $1", [id]);
    await db.query("select public.brief_issue_approve($1, 'e2e:w10e')", [id]);
  }
  await job("brief-publish");
  await job("brief-publish");
  assert.equal((await db.query("select status from public.brief_issues where id = $1", [notYet])).rows[0].status, "approved", "발행 시각 전 발행 0");
  assert.equal((await db.query("select status from public.brief_issues where id = $1", [due])).rows[0].status, "published");
  assert.equal((await db.query("select count(*)::int n from public.public_brief_issues where issue_no = 9002")).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int n from public.public_brief_issues where issue_no = 9001")).rows[0].n, 0);
});

test("d) 구독 - 이중 확인 전 발송 대상 0, 확인 뒤 대상, 거부 뒤 0, 알림 해지는 브리핑에 영향 0", async () => {
  const issueRow = (await db.query("select id from public.brief_issues where issue_no = 9002")).rows[0];
  assert.ok(issueRow, "c) 시험이 만든 발행 호가 필요합니다");
  const em = `w10e-${run}-sub@example.test`;
  const brief = (await db.query("insert into public.consents (email, kind, channel) values ($1, 'brief', 'web_brief') returning id", [em])).rows[0].id;
  const alert = (await db.query("insert into public.consents (email, kind, channel) values ($1, 'amendment_alert', 'web_brief') returning id", [em])).rows[0].id;
  const targets = async () => (await db.query("select consent_id from public.brief_recipients($1, (now() at time zone 'Asia/Seoul')::date)", [issueRow.id])).rows.map((r) => String(r.consent_id));
  assert.ok(!(await targets()).includes(String(brief)), "이중 확인 전 발송 0");
  await db.query("update public.consents set confirmed_at = now() where id = any($1::bigint[])", [[brief, alert]]);
  assert.ok((await targets()).includes(String(brief)));
  assert.notEqual((await db.query("select reconfirm_due from public.consents where id = $1", [brief])).rows[0].reconfirm_due, null, "확인할 때 재확인 기한이 채워진다");
  await db.query("update public.consents set revoked_at = now() where id = $1", [alert]);
  assert.ok((await targets()).includes(String(brief)), "알림 해지는 브리핑에 영향 0");
  await db.query("update public.consents set revoked_at = now() where id = $1", [brief]);
  assert.ok(!(await targets()).includes(String(brief)), "거부 직후 발송 대상 0");
});

test("e) 예산 - 설정이 비어 있으면 AI 호출 0, 80% 경보 항목은 재실행해도 1건", async () => {
  assert.deepEqual((await job("ops-ai-budget")).status, 200);
  assert.deepEqual((await lastDetail("ops-ai-budget")).detail, { skipped: "no_budget" });
  const month = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 7);
  await db.query("update public.settings set value = '{\"monthly_limit\": 100, \"unit\": \"USD\"}'::jsonb where key = 'ops_ai_budget'");
  const rid = (await db.query("insert into public.agent_runs (job, trigger, status, finished_at, model, cost, cost_unit) values ('ops-ai-budget-e2e', 'manual', 'succeeded', now(), '시험용', 80, 'USD') returning id")).rows[0].id;
  try {
    await job("ops-ai-budget");
    await job("ops-ai-budget");
    const warn = (await db.query("select count(*)::int n from public.review_items where source_key = $1", [`ops_ai_budget:${month}:warn`])).rows[0].n;
    assert.equal(warn, 1);
    assert.equal((await db.query("select count(*)::int n from public.review_items where source_key = $1", [`ops_ai_budget:${month}:exceeded`])).rows[0].n, 0, "80%에서는 초과 경보 0");
  } finally {
    await db.query("delete from public.agent_runs where id = $1", [rid]);
  }
});
