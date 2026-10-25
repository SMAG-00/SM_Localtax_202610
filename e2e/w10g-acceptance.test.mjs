// W10-g 수용 E2E (docs/dev/W10-g_설계.md - PRD-02 BIZ-06, 교육원 "연결" 방식 + 세미나)
// standalone 빌드를 로컬 Supabase에 붙인다. 강좌·세미나·견적 내용은 전부 시험용 가짜다. 실제 개인 정보·결제는 없다.
//  a) 권한 - 기자 403 · 스토어 담당은 보드·강좌·세미나까지(견적 정책은 403) · 관리자만 정책·견적 상태·견적 상세(열람 감사 1행)
//  b) 키 꺼짐(기본) - 강좌·세미나·견적 양식·견적 제출 모두 404
//  c) 결제·수료증 후보 경로 0 - 키를 다 켜도 /edu/checkout · /edu/certificates · /api/edu/checkout 등 404 (연결 방식)
//  d) 공개 화면 - 강좌·회차 + 교육원 신청 링크(점검 오류면 링크만 숨김) · Course 구조화 데이터 = 화면(수강료 없음) · 세미나 협찬 표기·연사 이해관계 공개·Event 구조화 데이터
//  e) 견적 제출 - Origin 없음 403 · 동의 빠짐 422 · 긴 숫자 422 · 결제 칸을 보내도 저장 0 · 응답에 기관명·연락처 0 · 양식에 결제·카드 입력 칸 0
//  f) 철회 - 틀린 연락처 거부, 맞으면 즉시 파기(통계 칸 유지)
//  g) 보관 기간 파기 - 기존 privacy-retention 작업이 마지막 보관일 당일은 남기고 다음 날 파기
// 만든 계정·강좌·세미나·견적·바깥 연결은 끝나면 지우고, 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w10g-acceptance-e2e@example.test";
const SITE = "https://e2e-w10g.example.test";
const CRON = "e2e-w10g-cron";

let sb, server, staff, db, base, browser, run;
const u = {};
const fx = {};

const show = (r) => JSON.stringify(r.body).slice(0, 500);
async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const admin = (method, user, body) => api(method, "/api/admin/education", user, body);
async function startAll() {
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
    CRON_SECRET: CRON,
  });
  base = server.base;
}
/** 공개 데이터는 서버가 30초 디스크 캐시에 둔다(설계 7.1) - 키·공개 행을 바꾼 직후에는 서버를 다시 띄워 새 배포와 같은 출발점에서 읽는다 (w10b·w10d·w10i와 같다) */
async function restart() {
  await server?.stop?.();
  await startAll();
}
async function setFlags(patch) {
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...patch })]);
  if (server) await restart();
}
const get = async (p) => {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
};
async function publicPost(path, body, { origin = base } = {}) {
  await db.query("delete from public.request_throttles where scope = 'form_ip'"); // 같은 IP 시도 횟수에 걸리지 않게 - 시험은 횟수 제한 자체를 보지 않는다
  const headers = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  const res = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const jsonLdOf = (html) =>
  [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => {
    const v = JSON.parse(m[1]);
    return Array.isArray(v) ? v : [v];
  });
const runJob = async (name) => {
  const res = await fetch(`${base}/api/jobs/${name}`, { method: "POST", headers: { authorization: `Bearer ${CRON}` } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.training_quotes where org_name like $1 or consent_version = $2", [`%${run}%`, `e2e-w10g-${run}`]);
    await db.query("delete from public.seminars where slug like $1", [`e2e-w10g-${run}-%`]);
    await db.query("delete from public.courses where slug like $1", [`e2e-w10g-${run}-%`]);
    await db.query("delete from public.official_links where key like $1", [`e2e_w10g_${run}%`]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  await startAll();
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  u.admin = await staff.createUser({ label: "w10g-admin", email: ADMIN_EMAIL });
  u.reporter = await staff.createUser({ label: "w10g-reporter", roles: ["reporter"], person: { name: "시험용 기자", roles: ["reporter"] } });
  u.storeOps = await staff.createUser({ label: "w10g-store-ops", roles: ["store_ops"] });
  await setFlags({ edu: false, education_billing: false, seminars: false });
  await purge();
  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
    await purge();
  } finally {
    await staff?.cleanup();
    server?.stop();
  }
});

const POLICY = () => ({
  op: "policy", retention_days: 30, target_business_days: 3, message_max_chars: 200,
  consent_version: `e2e-w10g-${run}`, intro: ["시험용 안내 문단입니다."], consent_items: ["시험용 동의 항목 1", "시험용 동의 항목 2"],
  approved: true, reviewed_by: "시험용 검토자", reviewed_on: "2026-10-25", legal_review_ref: "시험용-기록",
});

test("a) 권한 - 기자 403, 스토어 담당은 보드·강좌·세미나까지(정책·견적 상태는 403), 관리자만 정책·견적 상세(열람 감사 1행)", async () => {
  assert.equal((await admin("GET", u.reporter)).status, 403);
  const board = await admin("GET", u.storeOps);
  assert.equal(board.status, 200, show(board));
  assert.deepEqual(board.body.flags, { edu: false, education_billing: false, seminars: false });
  assert.equal((await admin("POST", u.storeOps, POLICY())).status, 403);
  assert.equal((await admin("POST", u.storeOps, { op: "quote_status", id: 1, status: "contacted" })).status, 403);

  const link = (await db.query("insert into public.official_links (kind, key, label, url) values ('edu_site', $1, '시험용 교육원', 'https://edu.example.test/apply') returning id", [`e2e_w10g_${run}`])).rows[0];
  fx.linkId = Number(link.id);
  const draft = await admin("POST", u.storeOps, { op: "course", slug: `e2e-w10g-${run}-c`, title: "시험용 개정세법 강좌", summary: "시험용 강좌 소개입니다.", audience: "시험용 담당 공무원", provider_name: "시험용 교육기관", apply_link_id: fx.linkId, status: "published" });
  assert.equal(draft.status, 422, `출처·확인일 없는 게시는 거부: ${show(draft)}`);
  const course = await admin("POST", u.storeOps, { op: "course", slug: `e2e-w10g-${run}-c`, title: "시험용 개정세법 강좌", summary: "시험용 강좌 소개입니다.", audience: "시험용 담당 공무원", provider_name: "시험용 교육기관", apply_link_id: fx.linkId, status: "published", verified_on: "2026-10-20", verified_ref: "시험용 공지" });
  assert.equal(course.status, 201, show(course));
  fx.course = { id: Number(course.body.course.id), slug: `e2e-w10g-${run}-c` };
  const session = await admin("POST", u.storeOps, { op: "session", course_id: fx.course.id, starts_on: "2099-12-01", ends_on: "2099-12-03", mode: "onsite", location_name: "시험용 강의실", verified_on: "2026-10-20", verified_ref: "시험용 공지" });
  assert.equal(session.status, 201, show(session));
  const noDisclosure = await admin("POST", u.storeOps, { op: "seminar", slug: `e2e-w10g-${run}-s`, title: "시험용 개발금융 세미나", topic: "dev_finance", starts_at: "2099-11-10T10:00:00+09:00", ends_at: "2099-11-10T12:00:00+09:00", mode: "online", organizer_name: "시험용 주최", sponsored: true, sponsor_name: "시험용 협찬사", status: "published", verified_on: "2026-10-20", verified_ref: "시험용 공지" });
  assert.equal(noDisclosure.status, 422, `연사 이해관계 공개 없는 게시는 거부: ${show(noDisclosure)}`);
  const sem = await admin("POST", u.storeOps, { op: "seminar", slug: `e2e-w10g-${run}-s`, title: "시험용 개발금융 세미나", topic: "dev_finance", starts_at: "2099-11-10T10:00:00+09:00", ends_at: "2099-11-10T12:00:00+09:00", mode: "online", organizer_name: "시험용 주최", sponsored: true, sponsor_name: "시험용 협찬사", speaker_disclosure: "시험용 연사 이해관계 없음", apply_link_id: fx.linkId, status: "published", verified_on: "2026-10-20", verified_ref: "시험용 공지" });
  assert.equal(sem.status, 201, show(sem));
  fx.seminarSlug = `e2e-w10g-${run}-s`;

  const policy = await admin("POST", u.admin, POLICY());
  assert.equal(policy.status, 200, show(policy));
});

test("b) 키 꺼짐(기본) - 강좌·세미나·견적 양식·견적 제출이 모두 404", async () => {
  for (const p of ["/edu", `/edu/${fx.course.slug}`, "/edu/quote", "/edu/seminars", `/edu/seminars/${fx.seminarSlug}`]) assert.equal((await get(p)).status, 404, p);
  const r = await publicPost("/api/edu/quotes", { org_name: `시험용 ${run}` });
  assert.equal(r.status, 404);
});

test("c) 결제·수료증 후보 경로는 키를 다 켜도 404 (연결 방식)", async () => {
  await setFlags({ edu: true, education_billing: true, seminars: true });
  for (const p of ["/edu/checkout", "/edu/pay", "/edu/certificates", "/edu/certificates/verify", "/edu/enroll"]) assert.equal((await get(p)).status, 404, p);
  // /my/* 는 로그인하지 않은 방문자를 로그인 화면으로 보낸다(307) - 라우트가 있는지는 소스에 폴더가 없다는 것으로 따로 본다
  assert.equal((await get("/my/certificates")).status, 307, "로그아웃 상태의 /my/*는 로그인으로 307");
  const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "app");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [path.join(d, e.name), ...walk(path.join(d, e.name))] : []));
  // 수료증·수강 신청은 어디에도 없고, 결제는 교육 경로 아래에만 없으면 된다 (디지털 구독 결제 /api/billing/checkout는 W10-f 몫). 경로 구분자는 /로 맞춘다(윈도·리눅스 같게)
  const rel = (d) => path.relative(appDir, d).split(path.sep).join("/");
  const eduRoutes = walk(appDir).map(rel).filter((r) => /(^|\/)(certificates?|enroll)$/.test(r) || (/(^|\/)edu(\/|$)/.test(r) && /(^|\/)(checkout|pay)$/.test(r)));
  assert.deepEqual(eduRoutes, [], "수료증·수강 신청 라우트 폴더 0, 교육 경로 아래 결제 폴더 0 (연결 방식)");
  for (const p of ["/api/edu/checkout", "/api/edu/enroll", "/api/edu/certificates", "/api/edu/pay"]) {
    const res = await fetch(`${base}${p}`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: "{}" });
    assert.equal(res.status, 404, p);
  }
});

test("d) 공개 화면 - Course·Event 구조화 데이터 = 화면, 신청 링크는 점검 오류면 숨김, 협찬 표기·연사 이해관계 공개", async () => {
  const list = await get("/edu");
  assert.equal(list.status, 200);
  assert.ok(list.html.includes("시험용 개정세법 강좌") && list.html.includes("2099-12-01"));
  assert.ok(list.html.includes("교육원에서 신청하기"), "정상 링크는 보인다");
  assert.ok(list.html.includes("https://edu.example.test/apply"));

  const detail = await get(`/edu/${fx.course.slug}`);
  assert.equal(detail.status, 200);
  const course = jsonLdOf(detail.html).find((n) => n["@type"] === "Course");
  assert.ok(course, "Course 노드");
  assert.equal(course.name, "시험용 개정세법 강좌");
  assert.ok(detail.html.includes(course.name), "구조화 데이터 강좌명이 화면에 있다");
  assert.equal(course.provider.name, "시험용 교육기관");
  assert.equal(course.hasCourseInstance[0].startDate, "2099-12-01");
  assert.ok(!JSON.stringify(course).match(/offers|price/), "수강료는 내지 않는다");
  assert.ok(!/(결제하기|수료증)/.test(detail.html), "결제·수료증 요소 0");

  await db.query("update public.official_links set status = 'broken' where id = $1", [fx.linkId]);
  await restart(); // 공개 데이터 30초 캐시
  const broken = await get(`/edu/${fx.course.slug}`);
  assert.ok(!broken.html.includes("교육원에서 신청하기") && broken.html.includes("2099-12-01"), "링크만 숨고 일정은 그대로");
  await db.query("update public.official_links set status = 'ok' where id = $1", [fx.linkId]);
  await restart();

  const sem = await get(`/edu/seminars/${fx.seminarSlug}`);
  assert.equal(sem.status, 200);
  const semText = sem.html.replace(/<!-- -->/g, ""); // React가 값 사이에 넣는 빈 주석은 화면 글자가 아니다
  assert.ok(semText.includes("협찬 시험용 협찬사") && semText.includes("연사 이해관계 공개: 시험용 연사 이해관계 없음"));
  const ev = jsonLdOf(sem.html).find((n) => n["@type"] === "Event");
  assert.ok(ev, "Event 노드");
  assert.ok(String(ev.name).includes("광고") && String(ev.name).includes("시험용 개발금융 세미나"));
  assert.equal(ev.eventStatus, "https://schema.org/EventScheduled");
  assert.ok((await get("/edu/seminars")).html.includes("시험용 개발금융 세미나"));
});

test("e) 견적 제출 - Origin 없음 403 · 동의 빠짐 422 · 긴 숫자 422 · 결제 칸을 보내도 저장 0 · 응답에 기관명·연락처 0 · 양식에 결제 칸 0", async () => {
  const valid = { org_name: `시험용 시청 ${run}`, org_type: "public", contact_name: "시험용 담당", email: "w10g-tester@example.test", course_id: String(fx.course.id), headcount: "25", preferred_period: "시험용 다음 분기", message: "시험용 문의입니다.", consent_0: "on", consent_1: "on" };
  assert.equal((await publicPost("/api/edu/quotes", valid, { origin: null })).status, 403);
  const noConsent = await publicPost("/api/edu/quotes", { ...valid, consent_1: "" });
  assert.equal(noConsent.status, 422);
  assert.equal(noConsent.body.code, "consent");
  assert.equal((await publicPost("/api/edu/quotes", { ...valid, message: "계좌 110-123-456-789" })).body.code, "sensitive");
  assert.equal((await publicPost("/api/edu/quotes", { ...valid, headcount: "0" })).body.code, "headcount");
  assert.equal((await db.query("select count(*)::int n from public.training_quotes where org_name like $1", [`%${run}%`])).rows[0].n, 0, "거부된 요청은 저장 0");

  const ok = await publicPost("/api/edu/quotes", { ...valid, card_number: "4111111111111111", amount: "100000" });
  assert.equal(ok.status, 201, show(ok));
  assert.match(ok.body.ref, /^TQ-[0-9A-F]{8}$/);
  assert.ok(!JSON.stringify(ok.body).includes(run) && !JSON.stringify(ok.body).includes("w10g-tester"), "응답에 기관명·연락처 0");
  fx.receipt = ok.body.ref;
  const row = (await db.query("select * from public.training_quotes where receipt_no = $1", [fx.receipt])).rows[0];
  assert.equal(row.consent_version, `e2e-w10g-${run}`);
  assert.equal(row.status, "received");
  assert.equal(row.headcount, 25);
  assert.ok(!JSON.stringify(row).includes("4111111111111111"), "카드번호 저장 0");
  assert.ok(Object.keys(row).every((k) => !/(pay|card|amount|price|fee)/i.test(k)), "결제 칸 0");
  fx.quoteId = Number(row.id);

  const form = await get("/edu/quote");
  assert.equal(form.status, 200);
  assert.ok(form.html.includes("시험용 동의 항목 1") && form.html.includes(`e2e-w10g-${run}`));
  assert.ok(!/name="(card|amount|pay|price)[^"]*"/i.test(form.html), "결제·카드 입력 칸 0");
  assert.ok(!form.html.includes("data-ui=\"assistant"), "견적 양식에는 AI 도우미 런처가 없다");
});

test("a2) 관리 - 견적 목록에는 개인 정보가 없고, 상세는 관리자만 보며 열람마다 감사 1행, 상태는 앞으로만", async () => {
  const board = await admin("GET", u.storeOps);
  const q = board.body.quotes.find((x) => x.receipt_no === fx.receipt);
  assert.ok(q);
  assert.ok(!("org_name" in q) && !("email" in q) && !("phone" in q) && !("message" in q), "목록에 개인 칸 0");
  assert.equal((await api("GET", `/api/admin/education/quotes/${fx.quoteId}`, u.storeOps)).status, 403);
  const before = (await db.query("select count(*)::int n from public.audit_logs where action = 'education.quote.view' and target = $1", [`training_quotes:${fx.quoteId}`])).rows[0].n;
  const detail = await api("GET", `/api/admin/education/quotes/${fx.quoteId}`, u.admin);
  assert.equal(detail.status, 200, show(detail));
  assert.equal(detail.body.quote.contact_name, "시험용 담당");
  const after1 = (await db.query("select count(*)::int n from public.audit_logs where action = 'education.quote.view' and target = $1", [`training_quotes:${fx.quoteId}`])).rows[0].n;
  assert.equal(after1, before + 1);
  assert.equal((await admin("POST", u.admin, { op: "quote_status", id: fx.quoteId, status: "closed" })).status, 422, "사유 없는 종결 거부");
  assert.equal((await admin("POST", u.admin, { op: "quote_status", id: fx.quoteId, status: "contacted" })).status, 200);
  assert.equal((await admin("POST", u.admin, { op: "quote_status", id: fx.quoteId, status: "closed", close_reason: "quoted" })).status, 200);
});

test("f) 철회 - 틀린 연락처는 거부, 맞으면 즉시 파기하고 통계 칸은 남는다", async () => {
  const valid = { org_name: `시험용 철회 ${run}`, org_type: "corporate", contact_name: "시험용 철회자", phone: "010-1234-5678", course_text: "시험용 맞춤 과정", headcount: "5", consent_0: "on", consent_1: "on" };
  const made = await publicPost("/api/edu/quotes", valid);
  assert.equal(made.status, 201, show(made));
  const bad = await publicPost("/api/edu/quotes/withdraw", { receipt: made.body.ref, contact: "wrong@example.test" });
  assert.equal(bad.status, 422);
  assert.equal((await db.query("select purged_at from public.training_quotes where receipt_no = $1", [made.body.ref])).rows[0].purged_at, null);
  const done = await publicPost("/api/edu/quotes/withdraw", { receipt: made.body.ref, contact: "01012345678" });
  assert.equal(done.status, 200, show(done));
  const row = (await db.query("select org_name, contact_name, phone, org_type, headcount, status, close_reason, purged_at from public.training_quotes where receipt_no = $1", [made.body.ref])).rows[0];
  assert.deepEqual([row.org_name, row.contact_name, row.phone], [null, null, null]);
  assert.deepEqual([row.org_type, row.headcount, row.status, row.close_reason], ["corporate", 5, "closed", "withdrawn"]);
  assert.notEqual(row.purged_at, null);
});

test("g) 보관 기간 - privacy-retention 작업이 마지막 보관일 당일은 남기고 다음 날 파기한다", async () => {
  const id = fx.quoteId;
  const last = (await db.query("select purge_at::text d from public.training_quotes where id = $1", [id])).rows[0].d;
  // 작업은 현재 시각 기준이라, 시험은 마지막 보관일을 오늘(한국)로 맞췄을 때 남고, 어제로 맞췄을 때 지워지는지 본다
  await db.query("begin");
  await db.query("set local session_replication_role = replica");
  await db.query("update public.training_quotes set purge_at = (now() at time zone 'Asia/Seoul')::date where id = $1", [id]);
  await db.query("commit");
  const keep = await runJob("privacy-retention");
  assert.equal(keep.status, 200, show(keep));
  assert.notEqual((await db.query("select org_name from public.training_quotes where id = $1", [id])).rows[0].org_name, null, `마지막 보관일(${last} -> 오늘) 당일은 보존`);
  await db.query("begin");
  await db.query("set local session_replication_role = replica");
  await db.query("update public.training_quotes set purge_at = (now() at time zone 'Asia/Seoul')::date - 1 where id = $1", [id]);
  await db.query("commit");
  const gone = await runJob("privacy-retention");
  assert.equal(gone.status, 200, show(gone));
  const row = (await db.query("select org_name, contact_name, email, message, headcount, org_type, status from public.training_quotes where id = $1", [id])).rows[0];
  assert.deepEqual([row.org_name, row.contact_name, row.email, row.message], [null, null, null, null]);
  assert.deepEqual([row.headcount, row.org_type, row.status], [25, "public", "closed"]);
});
