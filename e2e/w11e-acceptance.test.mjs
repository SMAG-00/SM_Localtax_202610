// W11-e 수용 E2E (docs/dev/W11-e_설계.md - PRD-03 RDV-06 · RDV-07 · TX-13 · AIOPS-14 · 4-H)
// standalone 빌드를 로컬 Supabase에 붙인다. 조례 이름·원문·숫자·출처는 전부 시험용 가짜이고 외부 자치법규 API로는 요청을 보내지 않는다.
//  a) 권한 - 기자 등록 403 / 편집 책임자 등록 201 / 요약 서명은 세무 감수위원만(편집 책임자·관리자 403)
//  b) 요약 숫자 - 원문에 없는 숫자가 든 요약은 등록·저장 모두 422, 원문에 있는 숫자는 통과
//  c) 공개 조건 - 기능 키 꺼짐이면 공개 읽기(anon) 0행 / 켜면 서명 전 요약 null -> 서명 뒤 요약 보임 -> 요약을 고치면 서명 무효
//  d) 출처·시행일·확인일 - 확인일 없는 조례는 공개 상태로 바꾸기 422
//  e) 확인일 경고 - 시각 주입으로 90일째 경고 0, 91일째 경고 1 (stale_check_warnings)
//  f) 작업 zone-refresh - Cron 비밀값 없으면 401, 있으면 200이고 외부 요청 0·자치법규 원천은 이용 조건 미확인(source_not_runnable)
//  g) 허브 - 조례가 있는 시·군·구 허브에는 조례 블록(원문 상자·요약 상자 분리), 키를 끄면 블록 0
//  h) redevelopment_zones는 뷰(표 아님)이고 기능 키 꺼짐이면 공개 읽기 0행, 룰셋 표는 변하지 않음(자동 반영 0)
// 만든 조례·원문·감사·작업 기록·기능 키는 끝나면 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w11e-acceptance-e2e@example.test";
const CRON = "e2e-w11e-cron-secret";
const SITE = "https://e2e-w11e.example.test";
const NAME = "시험용 e2e 감면 조례";
const BODY = "시험용 원문 감면 비율 7 한도 1,200 기간 2.5";

let sb, server, staff, db, base, since, flagsBefore, policyBefore, rulesetCount;
const u = {};
const show = (r) => JSON.stringify(r.body).slice(0, 500);

async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const ord = (user, body) => api("POST", "/ordinances", user, body);
const job = (name, secret = CRON) => fetch(`${base}/api/jobs/${name}`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} }).then(async (res) => ({ status: res.status, text: await res.text() }));
const anonRows = async (view, query) => {
  const res = await fetch(`${sb.url}/rest/v1/${view}?${query}`, { headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}` } });
  assert.equal(res.status, 200, `${view} ${res.status}`);
  return res.json();
};
const setFlags = (flags) => db.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify(flags)]);

async function pickRegion() {
  const r = (await db.query("select c.code, c.slug, p.slug as parent_slug from public.regions c join public.regions p on p.code = c.parent_code where c.level = 'sigungu' and (c.valid_to is null or c.valid_to >= current_date) order by c.code limit 1")).rows[0];
  assert.ok(r, "시군구 지역 시드가 필요합니다");
  return r;
}

const registerBody = (region, over = {}) => ({
  op: "register", name: NAME, region_code: region.code, kind: "tax_reduction", source_url: "https://example.test/e2e-w11e/ord",
  promulgation_no: "시험용-1", promulgated_on: "2026-01-01", effective_from: "2026-02-01", verified_at: "2026-03-01", body_text: BODY, article_no: 3, article_title: "시험용 조", ...over,
});

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.ordinance_links where law_id in (select id from public.laws where name like '시험용 e2e %')");
    await db.query("delete from public.law_articles where version_id in (select v.id from public.law_versions v join public.laws l on l.id = v.law_id where l.name like '시험용 e2e %')");
    await db.query("delete from public.law_versions where law_id in (select id from public.laws where name like '시험용 e2e %')");
    await db.query("delete from public.laws where name like '시험용 e2e %'");
    await db.query("delete from public.raw_snapshots where source = 'ordinance_manual' and url like 'https://example.test/e2e-w11e/%'");
    await db.query("delete from public.agent_runs where job = 'zone-refresh' and started_at >= $1", [since]);
    if (flagsBefore) await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify(flagsBefore)]);
    if (policyBefore) await db.query("update public.settings set value = $1::jsonb where key = 'stale_check_policy'", [JSON.stringify(policyBefore)]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

const serverEnv = () => ({
  NEXT_PUBLIC_SUPABASE_URL: sb.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
  ADMIN_EMAILS: ADMIN_EMAIL,
  NEXT_PUBLIC_SITE_URL: SITE,
  CRON_SECRET: CRON,
});
async function startAll() {
  server = await startServer(serverEnv());
  base = server.base;
}
/** 공개 데이터 캐시(30초)를 새로 시작하려고 서버를 다시 띄운다 - 기능 키·행을 바꾼 뒤 */
async function restart() {
  await server?.stop?.();
  await startAll();
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  await startAll();
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  since = new Date().toISOString();
  flagsBefore = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  policyBefore = (await db.query("select value from public.settings where key = 'stale_check_policy'")).rows[0].value;
  rulesetCount = (await db.query("select (select count(*)::int from public.rulesets) r, (select count(*)::int from public.rules_audit) a")).rows[0];
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  u.admin = await staff.createUser({ label: "w11e-admin", email: ADMIN_EMAIL });
  u.reporter = await staff.createUser({ label: "w11e-reporter", roles: ["reporter"], person: { name: "시험용 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "w11e-editor", roles: ["editor"], person: { name: "시험용 편집 책임자", roles: ["editor"] } });
  u.reviewer = await staff.createUser({ label: "w11e-reviewer", roles: ["reviewer"], person: { name: "시험용 감수위원", roles: ["reviewer"] } });
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

test("a) 권한 - 기자 등록 403, 편집 책임자 등록 201, 서명은 감수위원만", async () => {
  const region = await pickRegion();
  assert.equal((await ord(u.reporter, registerBody(region))).status, 403);
  const made = await ord(u.editor, registerBody(region, { summary: "시험용 요약 7" }));
  assert.equal(made.status, 201, show(made));
  u.linkId = made.body.registered.id;
  assert.equal((await ord(u.editor, { op: "sign", id: u.linkId })).status, 403);
  assert.equal((await ord(u.admin, { op: "sign", id: u.linkId })).status, 403);
  assert.equal((await ord(u.editor, { op: "알수없음" })).status, 422);
});

test("b) 요약 숫자 - 원문에 없는 숫자는 등록·저장 모두 422, 원문에 있는 숫자는 통과", async () => {
  const region = await pickRegion();
  const bad = await ord(u.editor, registerBody(region, { name: "시험용 e2e 숫자 불일치 조례", summary: "시험용 요약 99" }));
  assert.equal(bad.status, 422, show(bad));
  assert.equal((await db.query("select count(*)::int c from public.laws where name = '시험용 e2e 숫자 불일치 조례' and id in (select law_id from public.ordinance_links)")).rows[0].c, 0);
  const save = await ord(u.editor, { op: "summary", id: u.linkId, summary: "시험용 요약 99" });
  assert.equal(save.status, 422, show(save));
  const ok = await ord(u.editor, { op: "summary", id: u.linkId, summary: "시험용 요약 1200 과 2.5" });
  assert.equal(ok.status, 200, show(ok));
});

test("c) 공개 읽기 - 키 꺼짐 0행, 켜면 서명 전 요약 null, 서명 뒤 요약, 요약을 고치면 서명 무효", async () => {
  assert.equal((await ord(u.editor, { op: "status", id: u.linkId, status: "public" })).status, 200);
  await setFlags({ ordinance_texts: false });
  assert.deepEqual(await anonRows("public_ordinance_links", `id=eq.${u.linkId}&select=id`), []);
  await setFlags({ ordinance_texts: true });
  let rows = await anonRows("public_ordinance_links", `id=eq.${u.linkId}&select=id,summary,summary_signed,ordinance_name`);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].summary, rows[0].summary_signed, rows[0].ordinance_name], [null, false, NAME]);
  assert.equal((await ord(u.reviewer, { op: "sign", id: u.linkId })).status, 200);
  rows = await anonRows("public_ordinance_links", `id=eq.${u.linkId}&select=summary,summary_signed`);
  assert.deepEqual([rows[0].summary, rows[0].summary_signed], ["시험용 요약 1200 과 2.5", true]);
  const arts = await anonRows("public_ordinance_articles", `link_id=eq.${u.linkId}&select=article_no,body`);
  assert.deepEqual(arts, [{ article_no: 3, body: BODY }]);
  assert.equal((await ord(u.editor, { op: "summary", id: u.linkId, summary: "시험용 고친 요약 7" })).status, 200);
  rows = await anonRows("public_ordinance_links", `id=eq.${u.linkId}&select=summary,summary_signed`);
  assert.deepEqual([rows[0].summary, rows[0].summary_signed], [null, false]);
});

test("d) 확인일이 없는 조례는 공개 상태로 바꿀 수 없다", async () => {
  await db.query("update public.ordinance_links set verified_at = null, status = 'draft' where id = $1", [u.linkId]);
  const r = await ord(u.editor, { op: "status", id: u.linkId, status: "public" });
  assert.equal(r.status, 422, show(r));
  assert.equal((await ord(u.editor, { op: "verify", id: u.linkId })).status, 200);
  assert.equal((await ord(u.editor, { op: "status", id: u.linkId, status: "public" })).status, 200);
});

test("e) 확인일 경고 - 90일째 경고 0, 91일째 경고 1 (시각 주입)", async () => {
  await db.query("update public.settings set value = '{\"zone_days\": 90, \"ordinance_days\": 90}'::jsonb where key = 'stale_check_policy'");
  await db.query("update public.ordinance_links set verified_at = '2026-03-01T12:00:00+09:00', status = 'public' where id = $1", [u.linkId]);
  const warn = async (now) => (await db.query("select count(*)::int c from public.stale_check_warnings($1::timestamptz) where target = 'ordinance' and target_id = $2", [now, u.linkId])).rows[0].c;
  assert.equal(await warn("2026-05-30T23:00:00+09:00"), 0);
  assert.equal(await warn("2026-05-31T00:00:00+09:00"), 1);
});

test("f) 작업 zone-refresh - 비밀값 없으면 401, 있으면 200 + 외부 요청 0 + 자치법규 원천 미확인", async () => {
  assert.equal((await job("zone-refresh", null)).status, 401);
  const res = await job("zone-refresh");
  assert.equal(res.status, 200, res.text.slice(0, 300));
  const detail = (await db.query("select detail from public.agent_runs where id = $1", [JSON.parse(res.text).runId])).rows[0].detail;
  assert.equal(detail.externalRequests, 0);
  assert.equal(detail.ordinanceSource, "source_not_runnable");
  assert.equal((await db.query("select terms_status from public.data_sources where key = 'ordinance_api'")).rows[0].terms_status, "unchecked");
});

test("g) 허브 - 조례 블록은 원문 상자와 요약 상자가 분리되고, 키를 끄면 블록이 없다", async () => {
  const region = await pickRegion();
  await db.query("update public.ordinance_links set verified_at = now(), status = 'public' where id = $1", [u.linkId]);
  await ord(u.editor, { op: "summary", id: u.linkId, summary: "시험용 요약 7" });
  assert.equal((await ord(u.reviewer, { op: "sign", id: u.linkId })).status, 200);
  await setFlags({ region_hubs: true, ordinance_texts: true });
  await restart();
  const path = `/local/${region.parent_slug}/${region.slug}`; // 서버를 다시 띄우면 포트가 바뀌므로 주소는 그때그때 만든다
  const url = `${base}${path}`;
  const onRes = await fetch(url);
  const on = await onRes.text();
  const seen = (await db.query("select id, kind, region_code, summary_signed from public.public_ordinance_links where region_code = $1", [region.code])).rows;
  const flagsNow = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  assert.ok(on.includes('data-ui="region-ordinances"'), `조례 블록이 있어야 한다 (HTTP ${onRes.status}, 공개 뷰 ${JSON.stringify(seen)}, 키 ${flagsNow.region_hubs}/${flagsNow.ordinance_texts}, ${url})`);
  assert.ok(on.includes('data-part="ordinance-text"') && on.includes('data-part="ordinance-summary"'), "원문 상자와 요약 상자가 따로 있어야 한다");
  assert.ok(on.includes(NAME));
  await setFlags({ ordinance_texts: false });
  await restart();
  const off = await (await fetch(`${base}${path}`)).text();
  assert.ok(!off.includes('data-ui="region-ordinances"'), "키가 꺼지면 조례 블록 0");
});

test("h) redevelopment_zones는 뷰이고 키 꺼짐이면 0행, 룰셋 표는 변하지 않는다", async () => {
  assert.deepEqual((await db.query("select relkind from pg_class where oid = 'public.redevelopment_zones'::regclass")).rows, [{ relkind: "v" }]);
  await setFlags({ redevelopment_status: false });
  assert.deepEqual(await anonRows("redevelopment_zones", "select=project_id"), []);
  const after = (await db.query("select (select count(*)::int from public.rulesets) r, (select count(*)::int from public.rules_audit) a")).rows[0];
  assert.deepEqual(after, rulesetCount);
});
