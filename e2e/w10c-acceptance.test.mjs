// W10-c 수용 E2E (docs/dev/W10-c_설계.md - PRD-02 REV-01~03 · PIPE-01~08 · AIOPS-06)
// standalone 빌드를 로컬 Supabase에 붙인다. 검수 항목·원천은 전부 시험용 가짜이고, 외부 법령 API로는 요청을 보내지 않는다
// (기관코드는 가짜 값이며 원천이 미확인이라 수집기가 요청 전에 멈춘다 - 그것도 이 시험이 확인한다).
//  a) 권한 - 기자 403 / 편집 책임자는 검수 큐만(원천 등록부 403) / 관리자는 둘 다
//  b) 검수 흐름 - drafted -> published 직행 422 / 체크 빠짐 승인 422 / 정상 승인 -> 처리 완료 + 감사 / 반려 사유 없음 422 / 실패 -> 재시도 3회, 4번째 422
//  c) 작업 URL - Cron 비밀값 없으면 401과 실행 기록 0 / 키 꺼짐 skipped flag_off / 켜도 원천 미확인이면 skipped source_not_runnable, 개정판·조문·스냅샷 0
//  d) 원천 등록부 - 허용에 근거 없으면 422 / 허용 + 견본 확인 전에는 수집 불가, 둘 다 있어야 수집 가능 / 감사 기록
//  e) 키 비노출 - 공개 화면 HTML과 작업 응답·실행 기록에 기관코드 0
// 만든 검수 항목·실행 기록·원천 상태는 끝나면 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";
import { findCredentials } from "../workflows/src/pipelines/credentials.ts";

const ADMIN_EMAIL = "w10c-acceptance-e2e@example.test";
const CRON = "e2e-w10c-cron-secret";
const FAKE_OC = "e2e-w10c-fake-oc-0001";
const SITE = "https://e2e-w10c.example.test";

let sb, server, staff, db, base, since, run;
const u = {};
const ALL_CHECKS = ["original_compared", "numbers_dates_links", "no_personal_info", "promulgation_effective_match"];
const show = (r) => JSON.stringify(r.body).slice(0, 500);

async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const review = (user, body) => api("POST", "/review-items", user, body);
const job = (name, secret = CRON) => fetch(`${base}/api/jobs/${name}`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} }).then(async (res) => ({ status: res.status, text: await res.text() }));

async function newItem(kind = "law_change") {
  const key = `e2e-w10c-${run}-${Math.random().toString(36).slice(2, 8)}`;
  const r = await db.query("insert into public.review_items (kind, source_key, title, created_by) values ($1, $2, '시험용 검수 항목', 'e2e:w10c') returning id", [kind, key]);
  return Number(r.rows[0].id);
}
const statusOf = async (id) => (await db.query("select status, attempts from public.review_items where id = $1", [id])).rows[0];
const runnable = async (key) => (await db.query("select public.data_source_runnable($1) as r", [key])).rows[0].r;
const lawCounts = async () => (await db.query("select (select count(*)::int from public.law_versions) v, (select count(*)::int from public.law_articles) a, (select count(*)::int from public.raw_snapshots where source_key is not null) s")).rows[0];

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    const ids = (await db.query("select id from public.review_items where created_by = 'e2e:w10c'")).rows.map((r) => Number(r.id));
    if (ids.length) {
      await db.query("delete from public.review_item_events where item_id = any($1::bigint[])", [ids]);
      await db.query("delete from public.review_items where id = any($1::bigint[])", [ids]);
    }
    await db.query("delete from public.agent_runs where job in ('pipeline-law', 'pipeline-docs') and started_at >= $1", [since]);
    await db.query("update public.data_sources set terms_status = 'unchecked', terms_note = null, terms_checked_by = null, terms_checked_at = null, contract_verified_by = null, contract_verified_at = null where key in ('law_api', 'admrul')");
    await db.query("update public.settings set value = value || '{\"pipelines\": false}'::jsonb where key = 'feature_flags'");
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
    LAW_API_OC: FAKE_OC,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  since = new Date().toISOString();
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  u.admin = await staff.createUser({ label: "w10c-admin", email: ADMIN_EMAIL });
  u.reporter = await staff.createUser({ label: "w10c-reporter", roles: ["reporter"], person: { name: "시험용 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "w10c-editor", roles: ["editor"], person: { name: "시험용 편집 책임자", roles: ["editor"] } });
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

test("a) 권한 - 기자는 검수 큐 403, 편집 책임자는 검수 큐만, 관리자는 둘 다", async () => {
  assert.equal((await api("GET", "/review-items", u.reporter)).status, 403);
  assert.equal((await api("GET", "/review-items", u.editor)).status, 200);
  assert.equal((await api("GET", "/data-sources", u.editor)).status, 403);
  assert.equal((await api("GET", "/review-items", u.admin)).status, 200);
  const sources = await api("GET", "/data-sources", u.admin);
  assert.equal(sources.status, 200, show(sources));
  assert.ok(sources.body.sources.every((s) => s.terms_status === "unchecked"), "씨앗 원천은 모두 미확인");
});

test("b) 검수 흐름 - 허용 밖 전이 422, 체크 빠짐 422, 정상 승인과 감사, 반려 사유, 재시도 3회", async () => {
  const id = await newItem();
  const direct = await review(u.editor, { op: "transition", id, to: "published" });
  assert.equal(direct.status, 422, show(direct));
  assert.equal((await statusOf(id)).status, "drafted");
  assert.equal((await review(u.editor, { op: "transition", id, to: "in_review" })).status, 200);
  const missing = await review(u.editor, { op: "transition", id, to: "approved", checked: ALL_CHECKS.slice(0, 2) });
  assert.equal(missing.status, 422, show(missing));
  assert.equal((await statusOf(id)).status, "in_review");
  const ok = await review(u.editor, { op: "transition", id, to: "approved", checked: ALL_CHECKS });
  assert.equal(ok.status, 200, show(ok));
  assert.equal((await review(u.editor, { op: "transition", id, to: "published" })).status, 200);
  const audit = await db.query("select action from public.audit_logs where target = $1 order by id", [`review_items:${id}`]);
  assert.deepEqual(audit.rows.map((r) => r.action), ["review_item.in_review", "review_item.approved", "review_item.published"]);

  const rej = await newItem();
  assert.equal((await review(u.editor, { op: "transition", id: rej, to: "rejected" })).status, 422, "사유 없는 반려");
  assert.equal((await review(u.editor, { op: "transition", id: rej, to: "rejected", reason: "근거 부족" })).status, 200);
  assert.equal((await review(u.editor, { op: "transition", id: rej, to: "in_review" })).status, 422, "반려는 끝 상태");

  const failing = await newItem();
  await review(u.editor, { op: "transition", id: failing, to: "in_review" });
  for (let n = 1; n <= 3; n++) {
    await db.query("select * from public.review_item_transition($1, 'failed', 'e2e:w10c', '시험용 게시 실패')", [failing]);
    const retry = await review(u.editor, { op: "transition", id: failing, to: "retry" });
    assert.equal(retry.status, 200, `재시도 ${n}: ${show(retry)}`);
  }
  await db.query("select * from public.review_item_transition($1, 'failed', 'e2e:w10c', '시험용 게시 실패 4')", [failing]);
  const fourth = await review(u.editor, { op: "transition", id: failing, to: "retry" });
  assert.equal(fourth.status, 422, show(fourth));
  assert.deepEqual(await statusOf(failing), { status: "failed", attempts: 3 });
});

test("b2) 72시간 경고 - 목록 API는 열린 항목을 오래된 순으로, DB 함수는 72시간 넘은 항목만", async () => {
  const young = await newItem();
  const old = await newItem();
  await db.query("begin");
  await db.query("select set_config('ltr.review_write', '1', true)");
  await db.query("update public.review_items set status_changed_at = now() - interval '71 hours 59 minutes' where id = $1", [young]);
  await db.query("update public.review_items set status_changed_at = now() - interval '72 hours 1 minute' where id = $1", [old]);
  await db.query("commit");
  const stale = (await db.query("select id from public.review_items_stale(now()) where id = any($1::bigint[])", [[young, old]])).rows.map((r) => Number(r.id));
  assert.deepEqual(stale, [old]);
  const list = await api("GET", "/review-items", u.editor);
  const order = list.body.open.map((r) => Number(r.id));
  assert.ok(order.indexOf(old) < order.indexOf(young), "오래 머문 항목이 먼저");
});

test("c) 작업 URL - 비밀값 없으면 401과 실행 0, 키 꺼짐은 건너뜀, 켜도 원천 미확인이면 요청 전에 멈추고 저장 0", async () => {
  const before = (await db.query("select count(*)::int n from public.agent_runs where job = 'pipeline-law'")).rows[0].n;
  assert.equal((await job("pipeline-law", null)).status, 401);
  assert.equal((await job("pipeline-law", "wrong-secret")).status, 401);
  assert.equal((await db.query("select count(*)::int n from public.agent_runs where job = 'pipeline-law'")).rows[0].n, before);

  const counts = await lawCounts();
  const off = await job("pipeline-law");
  assert.equal(off.status, 200, off.text);
  let detail = (await db.query("select detail from public.agent_runs where job = 'pipeline-law' order by id desc limit 1")).rows[0].detail;
  assert.equal(detail.skipped, "flag_off");

  await db.query("update public.settings set value = value || '{\"pipelines\": true}'::jsonb where key = 'feature_flags'");
  assert.equal((await job("pipeline-law")).status, 200);
  detail = (await db.query("select detail from public.agent_runs where job = 'pipeline-law' order by id desc limit 1")).rows[0].detail;
  assert.equal(detail.skipped, "source_not_runnable", "기관코드가 있어도 원천이 미확인이면 실행 0");
  assert.equal((await job("pipeline-docs")).status, 200);
  const docs = (await db.query("select detail from public.agent_runs where job = 'pipeline-docs' order by id desc limit 1")).rows[0].detail;
  assert.ok(docs.sources.length >= 3 && docs.sources.every((s) => s.skipped === "source_not_runnable"), JSON.stringify(docs));
  assert.deepEqual(await lawCounts(), counts, "건너뛴 실행은 개정판·조문·스냅샷을 만들지 않는다");
  await db.query("update public.settings set value = value || '{\"pipelines\": false}'::jsonb where key = 'feature_flags'");
});

test("d) 원천 등록부 - 허용은 근거 필수, 허용 + 견본 확인 둘 다 있어야 수집 가능, 감사 기록", async () => {
  const noNote = await api("POST", "/data-sources", u.admin, { key: "admrul", op: "terms", terms: "allowed" });
  assert.equal(noNote.status, 422, show(noNote));
  assert.equal((await api("POST", "/data-sources", u.editor, { key: "admrul", op: "terms", terms: "denied" })).status, 403);
  const allowed = await api("POST", "/data-sources", u.admin, { key: "admrul", op: "terms", terms: "allowed", note: "시험용 근거 문서" });
  assert.equal(allowed.status, 200, show(allowed));
  assert.equal(await runnable("admrul"), false, "허용만으로는 수집 불가");
  assert.equal((await api("POST", "/data-sources", u.admin, { key: "admrul", op: "contract" })).status, 200);
  assert.equal(await runnable("admrul"), true);
  assert.equal((await api("POST", "/data-sources", u.admin, { key: "admrul", op: "terms", terms: "link_only" })).status, 200);
  assert.equal(await runnable("admrul"), false, "링크만 허용이면 수집 불가");
  assert.equal((await api("POST", "/data-sources", u.admin, { key: "없는_원천", op: "terms", terms: "denied" })).status, 422);
  const audit = await db.query("select action from public.audit_logs where target = 'data_sources:admrul' and at >= $1 order by id", [since]);
  assert.deepEqual(audit.rows.map((r) => r.action), ["pipeline.source_terms", "pipeline.source_contract", "pipeline.source_terms"]);
});

test("e) 키 비노출 - 공개 화면 HTML과 작업 응답에 기관코드가 없다", async () => {
  for (const path of ["/", "/tax", "/realestate", "/finance", "/local", "/calc"]) {
    const res = await fetch(`${base}${path}`, { redirect: "manual" });
    const html = await res.text();
    assert.deepEqual(findCredentials(html, [FAKE_OC]), [], `${path} (${res.status})`);
  }
  const r = await job("pipeline-law");
  assert.ok(!r.text.includes(FAKE_OC));
  const runs = await db.query("select detail::text d, error from public.agent_runs where job in ('pipeline-law', 'pipeline-docs') and started_at >= $1", [since]);
  for (const row of runs.rows) assert.ok(!`${row.d}${row.error ?? ""}`.includes(FAKE_OC));
});
