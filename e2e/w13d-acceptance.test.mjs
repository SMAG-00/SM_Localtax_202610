// W13-d 수용 E2E - 알림·맞춤 브리핑 (docs/dev/W13-d_설계.md, PRD-05 NOTI-01·WS-06) - 작성만, 실행은 리드가 db-e2e.sh로 한다
//  a) 작업 URL 인증 없으면 401 / 기능 키 꺼짐이면 화면·API 404, 작업은 알림을 만들지 않는다
//  b) 수신 동의 없으면 알림 켜기 거부(no_consent)·알림 0건
//  c) 지역 알림 - 새 공개 기사 -> 작업 -> 메일 1통(수신 거부 링크 포함) / 작업을 다시 돌려도 1통(같은 항목 한 번)
//  d) 수신 거부 - 토큰이 틀리면 거부 안 됨 / 맞으면 한 번에 모든 종류 꺼짐 -> 새 기사에 메일 0
//  e) 알림함 화면에 제목만 / 비공개로 바뀐 기사의 브리핑 항목은 화면에서 빠진다 / 남의 브리핑 열람 표시 404
//  f) /my에는 키가 켜졌을 때만 링크가 보인다
// 글은 시험용 가짜다. 정리 단계에서 설정·자료를 되돌린다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";
import { pageAuth } from "./lib/session-cookie.mjs";
import { inboxFor, mailEnv, waitForMail } from "./lib/mail.mjs";

const SITE = "https://e2e-w13d.example.test";
const CRON = "e2e-w13d-cron-secret";
const SECRET = "e2e-w13d-guard-secret-0001";
const KEYS = ["feature_flags", "briefing_policy"];

let sb, server, staff, db, base, saved, run, member, noConsent, other, regionCode, personId;
const articleIds = [];

async function setSetting(key, value) {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("update public.settings set value = $1::jsonb where key = $2", [JSON.stringify(value), key]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}
const auth = (u) => ({ authorization: `Bearer ${u.token}` });
const pageAuthFor = (u) => pageAuth(sb, u);
const form = (u, fields) => {
  const body = new URLSearchParams();
  for (const [k, v] of fields) body.append(k, v);
  return fetch(`${base}/api/my/notifications`, { method: "POST", redirect: "manual", headers: { ...auth(u), origin: base, "content-type": "application/x-www-form-urlencoded" }, body });
};
const job = (secret = CRON) => fetch(`${base}/api/jobs/notify-daily`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) }));
async function newArticle(title) {
  const r = await db.query(
    "insert into public.articles (slug, title, section, content_type, status, author_id, body, first_published_at, region_codes, editorial_field, public_question) values ($1, $2, 'local', 'explainer', 'published', $3, $4::jsonb, now(), $5, 'local_tax', '시험용 공익적 질문') returning id",
    [`w13d-${run}-${articleIds.length}`, title, personId, JSON.stringify({ blocks: [{ type: "paragraph", text: "시험용 본문" }], claims: [] }), [regionCode]],
  );
  articleIds.push(r.rows[0].id);
  return Number(r.rows[0].id); // 브리핑 항목 JSON의 id는 숫자
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
    GUARD_SECRET: SECRET,
    ...mailEnv(),
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  saved = Object.fromEntries((await db.query("select key, value from public.settings where key = any($1::text[])", [KEYS])).rows.map((r) => [r.key, r.value]));
  member = await staff.createUser({ label: "w13d-member" });
  noConsent = await staff.createUser({ label: "w13d-noconsent" });
  other = await staff.createUser({ label: "w13d-other" });
  regionCode = (await db.query("select code from public.regions where level = 'sido' and (valid_to is null or valid_to >= current_date) order by code limit 1")).rows[0].code;
  personId = (await db.query("insert into public.people (slug, name, roles, visibility) values ($1, '알림 시험 기자', '{reporter}', 'public') returning id", [`w13d-${run}`])).rows[0].id;
  for (const u of [member, noConsent, other]) await db.query("insert into public.profiles (id, interest_region_codes) values ($1, $2) on conflict (id) do update set interest_region_codes = excluded.interest_region_codes", [u.id, [regionCode]]);
  await db.query("insert into public.consents (user_id, kind, channel, confirmed_at) values ($1, 'receive', 'web_my', now()), ($2, 'receive', 'web_my', now())", [member.id, other.id]);
});

after(async () => {
  try {
    for (const k of KEYS) if (saved?.[k] !== undefined) await setSetting(k, saved[k]);
    await db.query("begin");
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.briefings where user_id = any($1::uuid[])", [[member.id, noConsent.id, other.id]]);
    await db.query("delete from public.notifications where user_id = any($1::uuid[])", [[member.id, noConsent.id, other.id]]);
    await db.query("delete from public.notification_prefs where user_id = any($1::uuid[])", [[member.id, noConsent.id, other.id]]);
    if (articleIds.length) await db.query("delete from public.articles where id = any($1::bigint[])", [articleIds]);
    await db.query("delete from public.people where id = $1", [personId]);
    await db.query("commit");
  } finally {
    await staff?.cleanup();
    await server?.stop();
  }
});

test("a 작업은 인증이 없으면 401, 기능 키가 꺼져 있으면 화면·API 404이고 작업은 알림을 만들지 않는다", async () => {
  assert.equal((await job(null)).status, 401);
  await setSetting("feature_flags", { ...saved.feature_flags, my_notifications: false, my_briefings: false });
  assert.equal((await fetch(`${base}/my/notifications`, { redirect: "manual", headers: await pageAuthFor(member) })).status, 404);
  assert.equal((await form(member, [["action", "save"], ["kinds", "region"], ["frequency", "instant"], ["briefing", "off"]])).status, 404);
  assert.equal((await job()).status, 200);
  assert.equal((await db.query("select count(*)::int as n from public.notifications where user_id = any($1::uuid[])", [[member.id, other.id]])).rows[0].n, 0);
});

test("b 수신 동의가 없으면 알림을 켤 수 없다 - 저장 거부, 알림 0건", async () => {
  await setSetting("feature_flags", { ...saved.feature_flags, my_notifications: true, my_briefings: true });
  const res = await form(noConsent, [["action", "save"], ["kinds", "region"], ["frequency", "instant"], ["briefing", "off"]]);
  assert.equal(res.status, 303);
  assert.match(res.headers.get("location"), /error=no_consent/);
  assert.equal((await db.query("select count(*)::int as n from public.notification_prefs where user_id = $1 and cardinality(kinds) > 0", [noConsent.id])).rows[0].n, 0);
});

test("c 지역 알림 - 새 공개 기사에 메일 1통(수신 거부 링크 포함), 작업을 다시 돌려도 1통", async () => {
  const res = await form(member, [["action", "save"], ["kinds", "region"], ["frequency", "instant"], ["briefing", "off"]]);
  assert.match(res.headers.get("location"), /saved=1/);
  const title = `시험용 지역 소식 ${run}`;
  await newArticle(title);
  assert.equal((await job()).status, 200);
  const mails = await waitForMail(member.email, 1);
  assert.equal(mails.length, 1);
  assert.match(mails[0].Text, /수신 거부: https:\/\/e2e-w13d\.example\.test\/notifications\/unsubscribe\?token=/);
  assert.ok(mails[0].Text.includes(title));
  await job();
  assert.equal((await inboxFor(member.email)).length, 1, "같은 항목은 두 번 보내지 않는다");
  assert.equal((await db.query("select count(*)::int as n from public.notifications where user_id = $1", [member.id])).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int as n from public.notifications where user_id = $1", [noConsent.id])).rows[0].n, 0);
});

test("d 수신 거부 - 틀린 토큰은 효과 없고, 맞는 토큰은 모든 종류를 끄고, 이후 새 기사에 메일 0", async () => {
  const mail = (await inboxFor(member.email))[0];
  const token = /token=([^\s]+)/.exec(mail.Text)[1];
  const bad = await fetch(`${base}/api/notifications/unsubscribe`, { method: "POST", redirect: "manual", body: new URLSearchParams({ token: `${token.slice(0, -2)}xx` }) });
  assert.match(bad.headers.get("location"), /error=expired/);
  assert.equal((await db.query("select cardinality(kinds)::int as n from public.notification_prefs where user_id = $1", [member.id])).rows[0].n, 1);
  const ok = await fetch(`${base}/api/notifications/unsubscribe`, { method: "POST", redirect: "manual", body: new URLSearchParams({ token: decodeURIComponent(token) }) });
  assert.match(ok.headers.get("location"), /done=1/);
  assert.equal((await db.query("select cardinality(kinds)::int as n from public.notification_prefs where user_id = $1", [member.id])).rows[0].n, 0);
  await newArticle(`시험용 거부 뒤 소식 ${run}`);
  await job();
  assert.equal((await inboxFor(member.email)).length, 1, "거부 뒤에는 새 메일 0");
});

test("e 알림함에는 제목만 보이고, 브리핑은 비공개가 된 기사를 화면에서 뺀다, 남의 브리핑 열람 표시는 404", async () => {
  const page = await fetch(`${base}/my/notifications`, { headers: await pageAuthFor(member) });
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes(`시험용 지역 소식 ${run}`));
  await db.query("insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until) values ($1, 'workspace', 'manual', $2, now() - interval '1 day', now() + interval '1 day')", [other.id, `w13d-${run}`]);
  await db.query("insert into public.notification_prefs (user_id, briefing) values ($1, 'web') on conflict (user_id) do update set briefing = 'web'", [other.id]);
  const pub = await newArticle(`시험용 브리핑 기사 ${run}`);
  const gone = await newArticle(`시험용 내려갈 기사 ${run}`);
  const items = [{ type: "article", id: pub, reason: "region", basis_on: "2026-10-26" }, { type: "article", id: gone, reason: "interest", basis_on: "2026-10-26" }];
  const made = (await db.query("select public.briefing_create($1, '2026-W44', $2::jsonb, now()) as r", [other.id, JSON.stringify(items)])).rows[0].r;
  assert.equal(made.created, true);
  let html = await (await fetch(`${base}/my/briefings`, { headers: await pageAuthFor(other) })).text();
  assert.ok(html.includes(`시험용 브리핑 기사 ${run}`) && html.includes(`시험용 내려갈 기사 ${run}`));
  await db.query("update public.articles set status = 'draft' where id = $1", [gone]);
  html = await (await fetch(`${base}/my/briefings`, { headers: await pageAuthFor(other) })).text();
  assert.ok(html.includes(`시험용 브리핑 기사 ${run}`));
  assert.ok(!html.includes(`시험용 내려갈 기사 ${run}`), "내려간 기사는 보이지 않는다");
  const open = (u) => fetch(`${base}/api/my/briefings`, { method: "POST", headers: { ...auth(u), origin: base, "content-type": "application/json" }, body: JSON.stringify({ id: made.id }) });
  assert.equal((await open(member)).status, 404);
  assert.equal((await open(other)).status, 200);
});

test("f /my에는 키가 켜졌을 때만 알림·브리핑 링크가 보인다", async () => {
  let html = await (await fetch(`${base}/my`, { headers: await pageAuthFor(member) })).text();
  assert.ok(html.includes("/my/notifications") && html.includes("/my/briefings"));
  await setSetting("feature_flags", { ...saved.feature_flags, my_notifications: false, my_briefings: false });
  html = await (await fetch(`${base}/my`, { headers: await pageAuthFor(member) })).text();
  assert.ok(!html.includes("/my/notifications") && !html.includes("/my/briefings"));
});
