// W11-f 수용 E2E - 기관 계약 시험 (docs/dev/W11-f_설계.md - PRD-03 BIZ-07·PAY-04, PRD_최종 §11.1 W11 완료 증거 ②)
// standalone 빌드를 로컬 Supabase에 붙인다. 기관·계약·회원·리포트·견적은 전부 시험용 가짜다. 결제는 없다(기관 온라인 결제 없음 - 계약서·세금계산서 기록뿐).
//  a) 키 꺼짐(기본) - 견적 양식·리포트·초대 수락·좌석 API가 모두 404
//  b) 견적 요청 - 연락 동의 없음 422 · 이메일 형식 오류 422 · 접수 201(수신 동의 기본 해제) · 같은 IP 속도 제한 429
//  c) 계약 - 기자 403 · 확인표 미승인이면 개통·초대 거부 · 승인은 관리자만(스토어 담당 403) · 개통 뒤 좌석 n=2: 2번째 초대 201, 3번째 409 · 비관리자 404
//  d) 수락 - 같은 초대 두 번째는 거부 · 좌석 회원 둘 수락
//  e) 리포트 - 발행 조건(법률 검토 기록 등) 없으면 422 · 발행 뒤 좌석 회원만 전문 / 비좌석 회원·비회원·RSS·검색·사이트맵에 전문 0 · 좌석 -> 비좌석 -> 비회원 순서에서도 0
//  f) 회수 - 기관 관리자가 회수하면 다음 요청부터 전문 0, 좌석은 즉시 돌아온다 / 다른 기관 좌석 번호는 404
//  g) 종료 - 종료일 당일 23:59:59(KST)는 허용, 다음 날 00:00:00(KST)부터 거부 (DB 판정 함수에 시각 주입) / 정리 작업 / 종료 뒤 새 초대 거부
//  h) 세금계산서 - 사업자 정보 없으면 422 · 있으면 접수(금액은 계약 데이터) · 수기 발행 기록 · 매출 원장에 개인 식별 칸 0
//  i) 파기 - 보존일이 지난 견적 요청은 작업이 개인 칸을 비운다
// 만든 행은 끝나면 지우고 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w11f-acceptance-e2e@example.test";
const SITE = "https://e2e-w11f.example.test";
const CRON = "e2e-w11f-cron";
const GUARD = "e2e-w11f-guard-secret";
const KST = (s) => `${s}+09:00`;

let sb, server, staff, db, base, browser, run, MARK, saved;
const u = {};
const fx = { receipts: [], seatIds: [] };

const show = (r) => JSON.stringify(r.body).slice(0, 500);
async function api(method, path, user, body) {
  const headers = {};
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  headers.origin = base;
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const adm = (user, body) => api("POST", "/api/admin/orgs", user, body);
async function setFlags(patch) {
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...patch })]);
}
const get = async (p) => {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
};
async function bodyHtml(user, path) {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(`${base}/login`);
    await page.fill('input[name="email"]', user.email);
    await page.fill('input[name="password"]', user.password);
    await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/login")), page.click('button[type="submit"]')]);
    const res = await page.goto(`${base}${path}`);
    return { status: res.status(), html: await page.content() };
  } finally {
    await ctx.close();
  }
}
const has = async (userId, key, at) => (await db.query("select public.has_entitlement($1,$2,$3) as ok", [userId, key, at])).rows[0].ok;
const inquiry = (over = {}) => ({ orgType: "tax_firm", orgName: `시험기관-${run}`, contactName: "홍시험", contactEmail: "buyer@example.com", seatsWanted: 3, consentContact: true, ...over });

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    const orgs = (await db.query("select id from public.orgs where name like $1", [`%${run}%`])).rows.map((r) => r.id);
    if (orgs.length) {
      await db.query("delete from public.entitlements where source = 'org' and split_part(source_ref, ':', 1) in (select id::text from public.org_seats where org_id = any($1::uuid[]))", [orgs]);
      await db.query("delete from public.tax_invoice_requests where org_id = any($1::uuid[])", [orgs]);
      await db.query("delete from public.org_seats where org_id = any($1::uuid[])", [orgs]);
      await db.query("delete from public.org_contracts where org_id = any($1::uuid[])", [orgs]);
      await db.query("delete from public.org_admins where org_id = any($1::uuid[])", [orgs]);
      await db.query("delete from public.org_security_reviews where org_id = any($1::uuid[])", [orgs]);
      await db.query("delete from public.orgs where id = any($1::uuid[])", [orgs]);
    }
    await db.query("delete from public.paid_bodies where kind = 'premium_report' and ref_key like $1", [`e2e-w11f-${run}%`]);
    await db.query("delete from public.premium_reports where slug like $1", [`e2e-w11f-${run}%`]);
    if (fx.receipts.length) await db.query("delete from public.institution_inquiries where receipt_no = any($1::text[])", [fx.receipts]);
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
    GUARD_SECRET: GUARD,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  MARK = `리포트전문표식ZZ${run}`;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  saved = (await db.query("select key, value from public.settings where key in ('feature_flags', 'premium_report_policy', 'institution_inquiry_policy')")).rows;
  u.admin = await staff.createUser({ label: "w11f-admin", email: ADMIN_EMAIL });
  u.reporter = await staff.createUser({ label: "w11f-reporter", roles: ["reporter"], person: { name: "시험용 기자", roles: ["reporter"] } });
  u.storeOps = await staff.createUser({ label: "w11f-store-ops", roles: ["store_ops"] });
  u.orgAdmin = await staff.createUser({ label: "w11f-org-admin" });
  u.seatA = await staff.createUser({ label: "w11f-seat-a" });
  u.seatB = await staff.createUser({ label: "w11f-seat-b" });
  u.outsider = await staff.createUser({ label: "w11f-outsider" });
  u.otherAdmin = await staff.createUser({ label: "w11f-other-admin" });
  await setFlags({ institution_subscription: false, premium_reports: false, institution_inquiry: false });
  await db.query("update public.settings set value = '{\"preview_max_chars\": 100}'::jsonb where key = 'premium_report_policy'");
  await db.query("update public.settings set value = '{\"retention_days\": 365}'::jsonb where key = 'institution_inquiry_policy'");
  await purge();
  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
    await purge();
    for (const s of saved ?? []) await db.query("update public.settings set value = $2::jsonb where key = $1", [s.key, JSON.stringify(s.value)]);
  } finally {
    await staff?.cleanup();
    server?.stop();
  }
});

test("a) 키 꺼짐(기본) - 견적 양식·리포트·초대 수락·좌석 API가 모두 404", async () => {
  assert.equal((await get("/store/institution")).status, 404);
  assert.equal((await get("/finance/reports")).status, 404);
  assert.equal((await get(`/finance/reports/e2e-w11f-${run}`)).status, 404);
  assert.equal((await get(`/org/accept?token=${"a".repeat(64)}`)).status, 404);
  assert.equal((await api("POST", "/api/institution/inquiries", null, inquiry())).status, 404);
  assert.equal((await api("POST", "/api/org/accept", u.seatA, { token: "a".repeat(64) })).status, 404);
  assert.equal((await api("GET", "/api/org/00000000-0000-4000-8000-000000000000/seats", u.orgAdmin)).status, 404);
});

test("b) 견적 요청 - 연락 동의 없음·이메일 오류 422, 접수 201(수신 동의 기본 해제), 같은 IP 속도 제한 429", async () => {
  await setFlags({ institution_subscription: true, institution_inquiry: true });
  assert.equal((await get("/store/institution")).status, 200);
  const noConsent = await api("POST", "/api/institution/inquiries", null, inquiry({ consentContact: false }));
  assert.equal(noConsent.status, 422, show(noConsent));
  assert.equal((await api("POST", "/api/institution/inquiries", null, inquiry({ contactEmail: "not-an-email" }))).status, 422);
  const ok = await api("POST", "/api/institution/inquiries", null, inquiry());
  assert.equal(ok.status, 201, show(ok));
  fx.receipts.push(ok.body.receiptNo);
  const row = (await db.query("select consent_marketing, to_char(retention_until, 'YYYY-MM-DD') as ru from public.institution_inquiries where receipt_no = $1", [ok.body.receiptNo])).rows[0];
  assert.equal(row.consent_marketing, false);
  assert.ok(row.ru > new Date().toISOString().slice(0, 10), "보존일은 접수일 뒤");
  let limited = false;
  for (let i = 0; i < 12 && !limited; i++) {
    const r = await api("POST", "/api/institution/inquiries", null, inquiry({ consentContact: false }));
    limited = r.status === 429;
  }
  assert.ok(limited, "짧은 시간에 반복하면 429");
});

test("c) 계약 - 확인표 미승인 개통·초대 거부, 승인은 관리자만, 개통 뒤 n=2 좌석에서 3번째 초대 409, 비관리자 404", async () => {
  assert.equal((await api("GET", "/api/admin/orgs", u.reporter)).status, 403);
  assert.equal((await api("GET", "/api/admin/orgs", u.storeOps)).status, 200);
  const org = await adm(u.storeOps, { op: "org", name: `시험기관 ${run}`, org_type: "local_government" });
  assert.equal(org.status, 201, show(org));
  fx.orgId = org.body.org.id;
  assert.equal((await adm(u.storeOps, { op: "admin_add", org_id: fx.orgId, user_id: u.orgAdmin.id })).status, 200);
  const contract = await adm(u.storeOps, { op: "contract", org_id: fx.orgId, seats: 2, starts_on: "2026-01-01", ends_on: "2099-12-31", amount: 1234, contract_ref: "시험용 계약서 위치" });
  assert.equal(contract.status, 201, show(contract));
  fx.contractId = contract.body.contract.id;
  const early = await adm(u.storeOps, { op: "contract_activate", id: fx.contractId });
  assert.equal(early.status, 409, `확인표 미승인 개통 거부: ${show(early)}`);
  const sec = { op: "security", org_id: fx.orgId, status: "approved", checklist_ref: "시험용 확인표 위치", reviewer: "시험 검토자", reviewed_on: "2026-10-25" };
  assert.equal((await adm(u.storeOps, sec)).status, 403, "승인 기록은 관리자만");
  assert.equal((await adm(u.admin, sec)).status, 201);
  assert.equal((await adm(u.storeOps, { op: "contract_activate", id: fx.contractId })).status, 200);
  await setFlags({ institution_subscription: true });
  const inv = (user, days = 7) => api("POST", `/api/org/${fx.orgId}/seats`, user, { op: "invite", expiresInDays: days });
  assert.equal((await inv(u.orgAdmin, 0)).status, 422, "유효 일수 0 거부");
  const i1 = await inv(u.orgAdmin);
  const i2 = await inv(u.orgAdmin);
  assert.equal(i1.status, 201, show(i1));
  assert.equal(i2.status, 201, show(i2));
  fx.tokens = [i1.body.token, i2.body.token];
  const i3 = await inv(u.orgAdmin);
  assert.equal(i3.status, 409, `n+1번째 초대 거부: ${show(i3)}`);
  assert.equal((await inv(u.outsider)).status, 404, "비관리자는 기관이 있는지도 모른다");
  assert.equal((await api("GET", `/api/org/${fx.orgId}/seats`, u.outsider)).status, 404);
  const board = await api("GET", `/api/org/${fx.orgId}/seats`, u.orgAdmin);
  assert.equal(board.status, 200);
  assert.equal(board.body.board.usedSeats, 2);
  assert.ok(!JSON.stringify(board.body).includes(u.seatA.email), "보드에 회원 메일 0");
});

test("d) 수락 - 좌석 회원 둘 수락, 같은 초대 두 번째는 거부", async () => {
  const a = await api("POST", "/api/org/accept", u.seatA, { token: fx.tokens[0] });
  assert.equal(a.status, 201, show(a));
  assert.equal((await api("POST", "/api/org/accept", u.outsider, { token: fx.tokens[0] })).status, 404, "이미 쓴 링크");
  assert.equal((await api("POST", "/api/org/accept", u.seatB, { token: fx.tokens[1] })).status, 201);
  const keys = (await db.query("select key from public.entitlements where user_id = $1 and source = 'org' order by key", [u.seatA.id])).rows.map((r) => r.key);
  assert.deepEqual(keys, ["digital", "premium_report"]);
  const board = await api("GET", `/api/org/${fx.orgId}/seats`, u.orgAdmin);
  fx.seatIds = board.body.board.seats.map((s) => s.id);
});

test("e) 리포트 - 발행 조건 미달 422, 발행 뒤 좌석 회원만 전문, 비좌석·비회원·RSS·검색·사이트맵에 전문 0(좌석 -> 비좌석 -> 비회원 순서)", async () => {
  const slug = `e2e-w11f-${run}`;
  fx.slug = slug;
  const rpt = (body) => api("POST", "/api/admin/reports", u.admin, body);
  assert.equal((await rpt({ op: "report", slug, title: "시험 분기 리포트", period_label: "2026-Q4", as_of: "2026-09-30", sources: [{ title: "시험 출처" }], tax_reviewer: "시험 감수자", tax_reviewed_on: "2026-10-20", editor_approved_by: "시험 편집장", editor_approved_on: "2026-10-21" })).status, 201);
  const saved = await rpt({ op: "body", slug, title: "시험 분기 리포트", preview: "시험용 미리보기 문장입니다.", body: `시험용 미리보기 문장입니다.\n\n${MARK} 이어지는 전문입니다.`, sale_allowed: true, rights_ref: "시험 권리 위치", sale_confirmed_on: "2026-10-25" });
  assert.equal(saved.status, 201, show(saved));
  assert.ok(!JSON.stringify(saved.body).includes(MARK), "응답에 본문 글자 0");
  const noLegal = await rpt({ op: "publish", slug });
  assert.equal(noLegal.status, 422, `법률 검토 기록 없는 발행 거부: ${show(noLegal)}`);
  assert.equal((await rpt({ op: "report", slug, title: "시험 분기 리포트", period_label: "2026-Q4", as_of: "2026-09-30", sources: [{ title: "시험 출처" }], tax_reviewer: "시험 감수자", tax_reviewed_on: "2026-10-20", editor_approved_by: "시험 편집장", editor_approved_on: "2026-10-21", legal_review_ref: "시험 법률 검토 위치" })).status, 200);
  assert.equal((await rpt({ op: "publish", slug })).status, 200);
  assert.equal((await get(`/finance/reports/${slug}`)).status, 404, "키(premium_reports) 꺼짐이면 발행돼도 404");
  await setFlags({ premium_reports: true });

  const seat = await bodyHtml(u.seatA, `/finance/reports/${slug}`);
  assert.equal(seat.status, 200);
  assert.ok(seat.html.includes(MARK), "좌석 회원은 전문");
  const out = await bodyHtml(u.outsider, `/finance/reports/${slug}`);
  assert.equal(out.status, 200);
  assert.ok(!out.html.includes(MARK), "비좌석 회원(좌석 회원 다음 요청)에게 전문 0");
  assert.ok(out.html.includes("시험용 미리보기 문장입니다."), "미리보기는 보인다");
  assert.match(out.html, /data-part="report-lock"/);
  const anon = await get(`/finance/reports/${slug}`);
  assert.equal(anon.status, 200);
  assert.ok(!anon.html.includes(MARK), "비회원 전문 0");
  assert.match(anon.html, /noindex/);
  const list = await get("/finance/reports");
  assert.equal(list.status, 200);
  assert.ok(!list.html.includes(MARK));
  for (const p of ["/rss.xml", `/api/search?q=${encodeURIComponent(MARK)}`, "/sitemap.xml", "/sitemap-news.xml"]) {
    const r = await get(p);
    assert.ok(!r.html.includes(MARK), `${p} 전문 0`);
    assert.ok(!r.html.includes(slug), `${p} 리포트 주소 0`);
  }
  const ld = [...anon.html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
  assert.ok(!ld.includes(MARK));
});

test("f) 회수 - 회수한 좌석은 다음 요청부터 전문 0, 좌석은 즉시 돌아오고, 다른 기관 좌석 번호는 404", async () => {
  const seatA = (await db.query("select id from public.org_seats where user_id = $1", [u.seatA.id])).rows[0].id;
  assert.equal((await api("POST", `/api/org/${fx.orgId}/seats`, u.orgAdmin, { op: "revoke", seatId: "00000000-0000-4000-8000-000000000001" })).status, 404);
  assert.equal((await api("POST", `/api/org/${fx.orgId}/seats`, u.orgAdmin, { op: "revoke", seatId: seatA })).status, 200);
  const after = await bodyHtml(u.seatA, `/finance/reports/${fx.slug}`);
  assert.ok(!after.html.includes(MARK), "회수 다음 요청부터 전문 0");
  const board = await api("GET", `/api/org/${fx.orgId}/seats`, u.orgAdmin);
  assert.equal(board.body.board.usedSeats, 1);
  assert.equal((await api("POST", `/api/org/${fx.orgId}/seats`, u.orgAdmin, { op: "invite", expiresInDays: 3 })).status, 201, "회수한 좌석으로 다시 초대");
  const other = await api("GET", `/api/org/${fx.orgId}/seats`, u.otherAdmin);
  assert.equal(other.status, 404);
});

test("g) 종료 - 종료일 당일 23:59:59 KST 허용·다음 날 00:00:00 KST 거부, 종료 뒤 새 초대 거부, 정리 작업이 계약을 끝낸다", async () => {
  const set = await adm(u.storeOps, { op: "contract_end", id: fx.contractId, ends_on: "2099-06-30" });
  assert.equal(set.status, 200, show(set));
  assert.equal(await has(u.seatB.id, "premium_report", KST("2099-06-30T23:59:59")), true, "종료일 당일 허용");
  assert.equal(await has(u.seatB.id, "premium_report", KST("2099-07-01T00:00:00")), false, "다음 날 00:00 KST 거부");
  assert.equal(await has(u.seatB.id, "digital", KST("2099-07-01T00:00:00")), false);
  const ended = await adm(u.storeOps, { op: "contract_end", id: fx.contractId, ends_on: "2026-01-02" });
  assert.equal(ended.status, 200);
  assert.equal((await db.query("select status from public.org_contracts where id = $1", [fx.contractId])).rows[0].status, "ended");
  const seatB = await bodyHtml(u.seatB, `/finance/reports/${fx.slug}`);
  assert.ok(!seatB.html.includes(MARK), "종료 뒤 다음 요청부터 전문 0");
  const inv = await api("POST", `/api/org/${fx.orgId}/seats`, u.orgAdmin, { op: "invite", expiresInDays: 3 });
  assert.equal(inv.status, 409, "종료된 계약은 초대 거부");
  const job = await fetch(`${base}/api/jobs/org-contract-close`, { method: "POST", headers: { authorization: `Bearer ${CRON}` } });
  assert.equal(job.status, 200);
});

test("h) 세금계산서 - 사업자 정보 없으면 422, 있으면 접수(금액은 계약 데이터), 수기 발행 기록, 매출 원장에 식별 칸 0", async () => {
  const url = `/api/org/${fx.orgId}/seats`;
  const noInfo = await api("POST", url, u.orgAdmin, { op: "tax_invoice", kind: "tax_invoice", supplyAmount: 999999 });
  assert.equal(noInfo.status, 422, show(noInfo));
  assert.equal((await adm(u.storeOps, { op: "org", id: fx.orgId, name: `시험기관 ${run}`, org_type: "local_government", business_no: "1234567890", tax_invoice_email: "tax@example.com" })).status, 200);
  const req = await api("POST", url, u.orgAdmin, { op: "tax_invoice", kind: "tax_invoice", supplyAmount: 999999 });
  assert.equal(req.status, 201, show(req));
  const row = (await db.query("select supply_amount, status from public.tax_invoice_requests where id = $1", [req.body.id])).rows[0];
  assert.deepEqual(row, { supply_amount: 1234, status: "requested" }, "요청의 금액 값은 무시하고 계약 금액을 쓴다");
  assert.equal((await api("POST", url, u.outsider, { op: "tax_invoice", kind: "receipt" })).status, 404);
  assert.equal((await adm(u.storeOps, { op: "tax_issued", id: req.body.id, issued_ref: "수기-시험-1", issued_on: "2026-10-26" })).status, 200);
  assert.equal((await db.query("select status from public.tax_invoice_requests where id = $1", [req.body.id])).rows[0].status, "issued");
  const cols = (await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'org_revenue_ledger'")).rows.map((r) => r.column_name);
  for (const bad of ["name", "business_no", "user_id", "email", "org_id"]) assert.ok(!cols.includes(bad), `원장에 ${bad} 칸 0`);
});

test("i) 파기 - 보존일이 지난 견적 요청은 작업 institution-inquiry-purge가 개인 칸을 비운다", async () => {
  const receipt = fx.receipts[0];
  await db.query("update public.institution_inquiries set retention_until = (now() at time zone 'Asia/Seoul')::date - 1 where receipt_no = $1", [receipt]);
  const job = await fetch(`${base}/api/jobs/institution-inquiry-purge`, { method: "POST", headers: { authorization: `Bearer ${CRON}` } });
  assert.equal(job.status, 200);
  const row = (await db.query("select org_name, contact_name, contact_email, message, purged_at is not null as purged from public.institution_inquiries where receipt_no = $1", [receipt])).rows[0];
  assert.deepEqual(row, { org_name: null, contact_name: null, contact_email: null, message: null, purged: true });
});
