// W10-h 수용 E2E (docs/dev/W10-h_설계.md - PRD-02 PR-06 · LG-15 · DF-06 · DF-07)
// standalone 빌드를 로컬 Supabase에 붙인다. 원천·후보·원문은 전부 시험용 가짜이고 외부 데이터 API로는 요청을 보내지 않는다
// (실제 원천 등록표의 주소 칸이 비어 있어 수집기가 요청 전에 멈춘다 - 그것도 이 시험이 확인한다).
//  a) 권한 - 기자 403 / 편집 책임자는 검수 큐와 후보 처리 모두 가능
//  b) 작업 URL - Cron 비밀값 없으면 401 / 기능 키 꺼짐 -> 원천 전부 flag_off / 켜고 인증키가 있어도 주소 칸이 비어 no_endpoint, 수집 스냅샷·후보 0 / 응답에 인증키 0
//  c) 승인 전 공개 0 -> 승인 -> 공개 반영 -> 공개 읽기(anon)에 1행 -> 같은 후보를 다시 반영해도 1행 / 유형 없는 후보 승인 422
//  d) 제4유형 - 원문을 그대로 옮긴 본문은 검사 차단 + 반영 422 + 공개 표 0, 다시 쓴 요지는 검사 통과 + 반영 200
// 만든 후보·반영·원천 상태·기능 키는 끝나면 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w10h-acceptance-e2e@example.test";
const CRON = "e2e-w10h-cron-secret";
const FAKE_KEY = "e2e-w10h-fake-data-key-0001";
const SITE = "https://e2e-w10h.example.test";
const SOURCES = ["applyhome_supply", "dart_disclosure"];

let sb, server, staff, db, base, since, flagsBefore;
const u = {};
const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const show = (r) => JSON.stringify(r.body).slice(0, 500);
const ALL_CHECKS = ["original_compared", "numbers_dates_links", "no_personal_info", "terms_allowed"];

async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const review = (user, body) => api("POST", "/review-items", user, body);
const field = (user, body) => api("POST", "/field-data", user, body);
const job = (name, secret = CRON) => fetch(`${base}/api/jobs/${name}`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} }).then(async (res) => ({ status: res.status, text: await res.text() }));
const anonRows = async (view, query) => {
  const res = await fetch(`${sb.url}/rest/v1/${view}?${query}`, { headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}` } });
  assert.equal(res.status, 200, `${view} ${res.status}`);
  return res.json();
};

async function snapshot(payload) {
  const r = await db.query("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e-w10h', $1, $2, $3) returning id", [`https://example.test/e2e-w10h/${Math.random().toString(36).slice(2)}`, `sha256:${sha(payload)}`, payload]);
  return Number(r.rows[0].id);
}
async function candidate({ source, target, fields, kogl = "kogl_1", payload = "{}" }) {
  const itemId = `e2e-w10h-${Math.random().toString(36).slice(2, 8)}`;
  const body = { target, source_item_id: itemId, value_hash: sha(itemId), kogl_type: kogl, changed_fields: [], fields };
  const r = await db.query(
    "insert into public.review_items (kind, source_key, title, data_source_key, snapshot_id, payload, created_by) values ('field_data', $1, '시험용 후보', $2, $3, $4::jsonb, 'e2e:w10h') returning id",
    [`e2e-w10h-${itemId}`, source, await snapshot(payload), JSON.stringify(body)],
  );
  return { id: Number(r.rows[0].id), itemId };
}
const approve = async (id) => {
  await review(u.editor, { op: "transition", id, to: "in_review" });
  return review(u.editor, { op: "transition", id, to: "approved", checked: ALL_CHECKS });
};
const regionCode = async () => (await db.query("select code from public.regions where (valid_to is null or valid_to >= current_date) order by code limit 1")).rows[0].code;
const setFlags = (flags) => db.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify(flags)]);

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.field_publications where review_item_id in (select id from public.review_items where created_by = 'e2e:w10h')");
    await db.query("delete from public.field_candidate_checks where review_item_id in (select id from public.review_items where created_by = 'e2e:w10h')");
    await db.query("delete from public.supply_notices where source_key = any($1::text[])", [SOURCES]);
    await db.query("delete from public.finance_indicators where source_key = any($1::text[])", [SOURCES]);
    await db.query("delete from public.review_item_events where item_id in (select id from public.review_items where created_by = 'e2e:w10h')");
    await db.query("delete from public.review_items where created_by = 'e2e:w10h'");
    await db.query("delete from public.raw_snapshots where source = 'e2e-w10h'");
    await db.query("delete from public.agent_runs where job = 'pipeline-field-data' and started_at >= $1", [since]);
    await db.query("update public.data_sources set terms_status = 'unchecked', terms_note = null, terms_checked_by = null, terms_checked_at = null, contract_verified_by = null, contract_verified_at = null where key = any($1::text[])", [SOURCES]);
    if (flagsBefore) await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify(flagsBefore)]);
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
    DATA_API_KEY: FAKE_KEY,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  since = new Date().toISOString();
  flagsBefore = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  u.admin = await staff.createUser({ label: "w10h-admin", email: ADMIN_EMAIL });
  u.reporter = await staff.createUser({ label: "w10h-reporter", roles: ["reporter"], person: { name: "시험용 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "w10h-editor", roles: ["editor"], person: { name: "시험용 편집 책임자", roles: ["editor"] } });
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

test("a) 권한 - 기자는 후보 처리 403, 편집 책임자는 허용(없는 항목은 404가 아니라 DB 판정)", async () => {
  assert.equal((await field(u.reporter, { op: "publish", id: 1 })).status, 403);
  assert.equal((await field(u.editor, { op: "알수없음", id: 1 })).status, 422);
  assert.equal((await field(u.editor, { op: "publish", id: 0 })).status, 422);
  const none = await field(u.editor, { op: "publish", id: 999999999 });
  assert.equal(none.status, 404, show(none));
});

test("b) 작업 URL - 비밀값 없으면 401, 키 꺼짐 flag_off, 켜도 주소 칸이 비어 no_endpoint, 수집 스냅샷·후보 0, 응답에 인증키 0", async () => {
  assert.equal((await job("pipeline-field-data", null)).status, 401);
  const counts = async () => (await db.query("select (select count(*)::int from public.raw_snapshots where source_key in (select key from public.data_sources where kind = 'field_data')) s, (select count(*)::int from public.review_items where kind = 'field_data' and created_by like 'pipeline:%') c")).rows[0];
  await setFlags({ field_data: false });
  const off = await job("pipeline-field-data");
  assert.equal(off.status, 200, off.text.slice(0, 300));
  assert.equal((off.text.match(/flag_off/g) ?? []).length, 7);
  await setFlags({ field_data: true });
  await db.query("update public.data_sources set terms_status = 'allowed', terms_checked_by = 'e2e:w10h', terms_checked_at = now(), contract_verified_by = 'e2e:w10h', contract_verified_at = now() where key = 'applyhome_supply'");
  const on = await job("pipeline-field-data");
  assert.equal(on.status, 200);
  assert.equal((on.text.match(/no_endpoint/g) ?? []).length, 7, "주소 칸이 비어 있으므로 허용된 원천도 요청 0");
  assert.deepEqual(await counts(), { s: 0, c: 0 });
  assert.equal(off.text.includes(FAKE_KEY) || on.text.includes(FAKE_KEY), false);
  const runs = await db.query("select detail::text d from public.agent_runs where job = 'pipeline-field-data' and started_at >= $1", [since]);
  assert.ok(runs.rowCount >= 2 && runs.rows.every((r) => !r.d.includes(FAKE_KEY)));
  await setFlags({ field_data: false });
});

test("c) 승인 전 공개 0 -> 승인 -> 공개 반영 -> 공개 읽기에 1행, 다시 반영해도 1행, 유형 없는 후보는 승인 422", async () => {
  await setFlags({ supply_notices: true });
  await db.query("update public.data_sources set terms_status = 'allowed', terms_checked_by = 'e2e:w10h', terms_checked_at = now(), contract_verified_by = 'e2e:w10h', contract_verified_at = now() where key = 'applyhome_supply'");
  const name = `시험용 분양 ${Date.now()}`;
  const fields = { name, region_code: await regionCode(), supply_scale: "100세대", apply_start: "2026-11-01", apply_end: "2026-11-03", notice_date: "2026-10-20", notice_issuer: "시험용 기관", official_notice_url: "https://example.test/notice/e2e" };
  const q = `name=eq.${encodeURIComponent(name)}&select=name,license_type,notice_issuer`;

  const item = await candidate({ source: "applyhome_supply", target: "supply_notice", fields });
  assert.deepEqual(await anonRows("public_supply_notices", q), [], "후보만 있을 때 공개 0");
  const early = await field(u.editor, { op: "publish", id: item.id });
  assert.equal(early.status, 422, show(early));
  assert.deepEqual(await anonRows("public_supply_notices", q), []);

  assert.equal((await approve(item.id)).status, 200);
  assert.deepEqual(await anonRows("public_supply_notices", q), [], "승인만으로는 공개 반영 전");
  const pub = await field(u.editor, { op: "publish", id: item.id });
  assert.equal(pub.status, 200, show(pub));
  assert.equal(pub.body.result.action, "created");
  assert.deepEqual(await anonRows("public_supply_notices", q), [{ name, license_type: "kogl_1", notice_issuer: "시험용 기관" }]);
  const again = await field(u.editor, { op: "publish", id: item.id });
  assert.equal(again.body.result.action, "already_published");
  assert.equal((await anonRows("public_supply_notices", q)).length, 1);
  const audit = await db.query("select action from public.audit_logs where target = $1 order by id", [`review_items:${item.id}`]);
  assert.ok(audit.rows.some((r) => r.action === "field_data.publish"));

  const noType = await candidate({ source: "applyhome_supply", target: "supply_notice", fields: { ...fields, name: `${name} 유형없음` }, kogl: null });
  await review(u.editor, { op: "transition", id: noType.id, to: "in_review" });
  const denied = await review(u.editor, { op: "transition", id: noType.id, to: "approved", checked: ALL_CHECKS });
  assert.equal(denied.status, 422, show(denied));
  assert.match(JSON.stringify(denied.body), /공공누리 유형/);
  assert.deepEqual(await anonRows("public_supply_notices", `name=eq.${encodeURIComponent(`${name} 유형없음`)}&select=name`), []);
  await setFlags({ supply_notices: false });
});

test("d) 제4유형 - 원문을 그대로 옮긴 본문은 검사 차단·반영 422·공개 표 0, 다시 쓴 요지는 통과·반영 200", async () => {
  await db.query("update public.data_sources set terms_status = 'allowed', terms_checked_by = 'e2e:w10h', terms_checked_at = now(), contract_verified_by = 'e2e:w10h', contract_verified_at = now() where key = 'dart_disclosure'");
  const original = "시험용 원문 첫째 문장은 가나다라마바사 아자차카타파하를 설명합니다. 시험용 원문 둘째 문장은 하나 둘 셋 넷 다섯 여섯 일곱을 설명합니다. 시험용 원문 셋째 문장은 동해물과 백두산이 마르고 닳도록을 설명합니다.";
  const snapshotPayload = JSON.stringify({ Items: [{ def: original }] });
  const indicator = (definition, key) => ({ indicator_key: key, label: "시험용 지표", definition, value: 1.5, unit: "%", as_of: "2026-09-30", released_on: "2026-10-01", provider: "시험용 기관", source_url: "https://example.test/f/e2e" });
  const count = async () => Number((await db.query("select count(*)::int n from public.finance_indicators where source_key = 'dart_disclosure'")).rows[0].n);

  const copied = await candidate({ source: "dart_disclosure", target: "finance_indicator", fields: indicator(original, "e2e_copied"), kogl: "kogl_4", payload: snapshotPayload });
  assert.equal((await approve(copied.id)).status, 200);
  const noCheck = await field(u.editor, { op: "publish", id: copied.id });
  assert.equal(noCheck.status, 422, show(noCheck));
  const blocked = await field(u.editor, { op: "rights-check", id: copied.id });
  assert.equal(blocked.status, 200, show(blocked));
  assert.equal(blocked.body.verdict.status, "blocked");
  const stillNo = await field(u.editor, { op: "publish", id: copied.id });
  assert.equal(stillNo.status, 422, show(stillNo));
  assert.equal(await count(), 0, "전재 본문은 공개 표에 들어가지 않는다");

  const rewritten = await candidate({ source: "dart_disclosure", target: "finance_indicator", fields: indicator("편집자가 다시 쓴 요지입니다. 자세한 내용은 아래 원문 링크를 보세요.", "e2e_rewritten"), kogl: "kogl_4", payload: snapshotPayload });
  assert.equal((await approve(rewritten.id)).status, 200);
  const pass = await field(u.editor, { op: "rights-check", id: rewritten.id });
  assert.equal(pass.body.verdict.status, "pass", show(pass));
  const ok = await field(u.editor, { op: "publish", id: rewritten.id });
  assert.equal(ok.status, 200, show(ok));
  assert.equal(await count(), 1);
});
