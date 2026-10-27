// W10-f 수용 E2E (docs/dev/W10-f_설계.md - PRD-02 PAY-01·02·03·05·07, BIZ-04, BRIEF-05 권한·페이월, PRD_최종 §8)
// standalone 빌드를 로컬 Supabase와 가짜 PG 서버(e2e/lib/fake-pg.mjs)에 붙인다. 상품·요금제·금액·본문·기사·회원은 전부 시험용 가짜다. 실제 돈·카드·PG 호출은 없다.
//  a) 권한 - 기자 403 · 스토어·구독 담당은 보드/상품/요금제/유료 본문까지(실결제 준비 기록은 403 + 거부 감사) · 관리자만 준비 기록
//  b) 키 꺼짐(기본) - 요금제·유료 본문이 다 있어도 /store/subscription 404 · 유료 기사 주소 404 · 결제 시작 404
//  c) 판매 권리 확인 전 - 키가 켜져도 /store/subscription 404 (권리 확인된 유료 본문이 있어야 열림)
//  d) 비구독자 어디에도 유료 본문 0 - 기사 주소(미리보기만)·RSS·검색 API·구조화 데이터·공개 API, 캐시 공개 지시 0 / 구독자 -> 비구독자 순서
//  e) 결제 - 약관 확인 없음 422 · 금액은 서버가 요금제에서 · 복귀 주소 값만으로 권한 0 · 가짜 PG 승인 뒤 구독자만 본문 · 같은 요청 반복도 구독 1개
//  f) 웹훅 - 위조 서명 401(기록 0) · 서명이 맞아도 본문 상태가 아니라 PG 조회가 최종 · 같은 웹훅 두 번 = 한 번 · PG 취소 -> 권한 즉시 회수
//  g) 해지·경계 - 남의 구독 해지 404 · 해지해도 남은 기간 이용 · valid_until 지나면 다음 요청부터 잠김
//  h) 정기 작업 - 고지 기록 없는 만기 구독은 갱신 0(닫힘) · 고지 기록이 있으면 갱신 결제 1건 · 카드번호 패턴 0
// 만든 계정·기사·상품·주문은 끝나면 지우고, 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";
import { signWebhookBody, startFakePg } from "./lib/fake-pg.mjs";

const ADMIN_EMAIL = "w10f-acceptance-e2e@example.test";
const SITE = "https://e2e-w10f.example.test";
const WEBHOOK_SECRET = "e2e-w10f-whsec";
const CRON = "e2e-w10f-cron";
const PLAN_AMOUNT = 4321; // 시험용 지어낸 금액 - 화면·주문이 이 값을 데이터에서 읽는지 본다

let sb, server, staff, db, base, browser, fake, run, MARK;
const u = {};
const fx = {};

const show = (r) => JSON.stringify(r.body).slice(0, 500);
async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const admin = (method, user, body) => api(method, "/api/admin/billing", user, body);
async function setFlags(patch) {
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...patch })]);
}
const get = async (p, headers = {}) => {
  const res = await fetch(`${base}${p}`, { redirect: "manual", headers });
  return { status: res.status, html: await res.text(), headers: res.headers };
};
const customerKeyOf = (userId) => `c_${crypto.createHash("sha256").update(`${userId}:fake-secret`).digest("hex").slice(0, 32)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function luhnRuns(text) {
  const out = [];
  // 무작위로 만든 UUID(숫자 구간이 이어지면 우연히 카드번호 모양이 됨)와 날짜·시각은 카드번호가 아니라서 먼저 뺀다 (packages/db/tests/w10f-billing.test.mjs와 같은 규칙)
  const scan = text
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "<uuid>")
    .replace(/[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9:.]+(?:[+-][0-9]{2}(?::?[0-9]{2})?|Z)?/g, "<ts>");
  for (const m of scan.matchAll(/(?<![0-9])[0-9](?:[ -]?[0-9]){12,18}(?![0-9])/g)) {
    const d = m[0].replace(/[ -]/g, "");
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      let n = Number(d[d.length - 1 - i]);
      if (i % 2 === 1) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
    }
    if (sum % 10 === 0) out.push(d);
  }
  return out;
}

async function webhook(payload, { secret = WEBHOOK_SECRET, time = new Date().toISOString() } = {}) {
  const raw = JSON.stringify(payload);
  const res = await fetch(`${base}/api/billing/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "tosspayments-webhook-signature": signWebhookBody(secret, raw, time), "tosspayments-webhook-transmission-time": time },
    body: raw,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** 브라우저로 로그인해서 쿠키 세션 페이지를 본다 */
async function pageAs(user) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', user.password);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/login")), page.click('button[type="submit"]')]);
  return { page, ctx };
}
async function bodyHtml(user, path) {
  const { page, ctx } = await pageAs(user);
  try {
    const res = await page.goto(`${base}${path}`);
    return { status: res.status(), html: await page.content() };
  } finally {
    await ctx.close();
  }
}

async function insertPaidArticle() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    const cat = (await db.query("select id from public.categories where section = 'tax' order by id limit 1")).rows[0];
    const r = (
      await db.query(
        `insert into public.articles (slug, title, summary, section, content_type, status, category_id, author_id, first_published_at, tax_review_status, body, is_paid)
         values ($1, $2, '시험용 요약', 'tax', 'explainer', 'published', $3, $4, now() - interval '1 hour', 'approved', $5::jsonb, true) returning id, slug`,
        [`e2e-w10f-paid-${run}`, `시험용 W10-f 유료 기사 ${run}`, cat.id, fx.personId, JSON.stringify({ blocks: [{ type: "paragraph", text: `${MARK} 기사 원문 칸` }], claims: [] })],
      )
    ).rows[0];
    await db.query("commit");
    staff.trackArticle(Number(r.id));
    return { id: Number(r.id), slug: r.slug };
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

async function purge() {
  const prods = (await db.query("select id from public.products where slug like $1", [`e2e-w10f-${run}-%`])).rows.map((r) => Number(r.id));
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    if (prods.length) {
      await db.query("delete from public.renewal_notices where subscription_id in (select id from public.subscriptions where product_id = any($1::bigint[]))", [prods]);
      await db.query("delete from public.entitlements where source = 'subscription' and source_ref in (select id::text from public.subscriptions where product_id = any($1::bigint[]))", [prods]);
      await db.query("delete from public.orders where product_id = any($1::bigint[])", [prods]);
      await db.query("delete from public.subscriptions where product_id = any($1::bigint[])", [prods]);
      await db.query("delete from public.product_plans where product_id = any($1::bigint[])", [prods]);
      await db.query("delete from public.products where id = any($1::bigint[])", [prods]);
    }
    await db.query("delete from public.paid_bodies where ref_key like $1 or title like $2", [`%${run}%`, `%${run}%`]);
    await db.query("delete from public.payment_events where pg_event_id like $1", [`e2e-w10f-${run}-%`]);
    await db.query("delete from public.commerce_readiness where confirmed_by = $1", [`e2e-w10f-${run}`]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  fake = await startFakePg();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
    PG_FAKE_URL: fake.url,
    PG_WEBHOOK_SECRET: WEBHOOK_SECRET,
    CRON_SECRET: CRON,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  MARK = `유료본문표식ZZ${run}`;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  u.admin = await staff.createUser({ label: "w10f-admin", email: ADMIN_EMAIL });
  u.reporter = await staff.createUser({ label: "w10f-reporter", roles: ["reporter"], person: { name: "시험용 기자", roles: ["reporter"] } });
  u.storeOps = await staff.createUser({ label: "w10f-store-ops", roles: ["store_ops"] });
  u.sub = await staff.createUser({ label: "w10f-sub" });
  u.other = await staff.createUser({ label: "w10f-other" });
  const person = (await db.query("insert into public.people (name, slug, roles, visibility, employment) values ('시험용 필자', $1, '{reporter}', 'hidden', 'staff') returning id", [`w10f-rep-${run}`])).rows[0];
  staff.personIds.add(Number(person.id));
  fx.personId = Number(person.id);
  await setFlags({ billing: false, digital_subscription: false, paywall: false });
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
    await fake?.close();
  }
});

test("a) 권한 - 기자 403, 스토어 담당은 상품·요금제·유료 본문까지, 실결제 준비 기록은 관리자만(스토어 담당 403 + 거부 감사)", async () => {
  assert.equal((await admin("GET", u.reporter)).status, 403);
  const board = await admin("GET", u.storeOps);
  assert.equal(board.status, 200, show(board));
  assert.deepEqual(board.body.flags, { billing: false, digital_subscription: false, paywall: false });
  const product = await admin("POST", u.storeOps, { op: "product", slug: `e2e-w10f-${run}-d`, title: "시험용 디지털 구독", summary: "시험용 한 줄 설명입니다.", status: "on_sale", verified_on: "2026-10-20", verified_ref: "시험 확인 기록" });
  assert.equal(product.status, 201, show(product));
  fx.productId = Number(product.body.product.id);
  const draftPlan = await admin("POST", u.storeOps, { op: "plan", product_id: fx.productId, plan_key: "monthly", title: "시험 월간", period_months: 1, amount: 0, status: "active" });
  assert.equal(draftPlan.status, 422, `활성 요금제는 금액 0을 받지 않는다: ${show(draftPlan)}`);
  const plan = await admin("POST", u.storeOps, { op: "plan", product_id: fx.productId, plan_key: "monthly", title: "시험 월간", period_months: 1, amount: PLAN_AMOUNT, status: "active" });
  assert.equal(plan.status, 201, show(plan));
  fx.planId = Number(plan.body.plan.id);
  fx.article = await insertPaidArticle();
  const noRights = await admin("POST", u.storeOps, { op: "paid_body", kind: "article", ref_key: String(fx.article.id), article_id: fx.article.id, preview: "시험 미리보기 문장", body: `시험 미리보기 문장 ${MARK} 이어지는 유료 본문`, sale_allowed: true });
  assert.equal(noRights.status, 422, `판매 권리 근거·확인일 없는 판매 허용은 거부: ${show(noRights)}`);
  const saved = await admin("POST", u.storeOps, { op: "paid_body", kind: "article", ref_key: String(fx.article.id), article_id: fx.article.id, preview: "시험 미리보기 문장", body: `시험 미리보기 문장 ${MARK} 이어지는 유료 본문` });
  assert.equal(saved.status, 201, show(saved));
  assert.ok(!JSON.stringify(saved.body).includes(MARK), "응답에 본문 글자가 없다");
  const listed = await admin("GET", u.storeOps);
  assert.ok(!JSON.stringify(listed.body).includes(MARK), "보드 응답에 본문 글자가 없다");

  const before = Number((await db.query("select count(*) from public.audit_logs where action like 'billing.readiness%denied%'")).rows[0].count);
  const ready = { op: "readiness", contract_ref: "시험 A", business_report_ref: "시험 B", policy_ref: "시험 C", vat_review_ref: "시험 D", confirmed_by: `e2e-w10f-${run}`, confirmed_on: "2026-10-25" };
  assert.equal((await admin("POST", u.storeOps, ready)).status, 403);
  const after = Number((await db.query("select count(*) from public.audit_logs where action like 'billing.readiness%denied%'")).rows[0].count);
  assert.equal(after, before + 1, "거부 시도가 감사에 남는다");
  const ok = await admin("POST", u.admin, ready);
  assert.equal(ok.status, 201, show(ok));
  fx.readinessId = Number(ok.body.readiness.id);
});

test("b) 키 꺼짐(기본) - 요금제·유료 본문이 있어도 /store/subscription 404 · 유료 기사 주소 404 · 결제 시작 404", async () => {
  assert.equal((await get("/store/subscription")).status, 404);
  assert.equal((await get(`/news/${fx.article.slug}`)).status, 404);
  const r = await api("POST", "/api/billing/checkout", u.sub, { planId: fx.planId, termsAck: true, idempotencyKey: `e2e-w10f-${run}-off-1` });
  assert.equal(r.status, 404, show(r));
  assert.equal((await db.query("select count(*)::int n from public.orders where plan_id = $1", [fx.planId])).rows[0].n, 0);
});

test("c) 판매 권리 확인 전에는 키가 켜져도 /store/subscription 404, 확인하면 열린다(금액은 데이터 값, 시험 결제 배너)", async () => {
  await setFlags({ billing: true, digital_subscription: true, paywall: true });
  assert.equal((await get("/store/subscription")).status, 404, "권리 확인된 유료 본문이 없으면 닫힌다");
  assert.equal((await get(`/news/${fx.article.slug}`)).status, 404, "판매 권리 미확인 기사는 미리보기도 없다");
  const rights = await admin("POST", u.storeOps, { op: "paid_body", kind: "article", ref_key: String(fx.article.id), article_id: fx.article.id, preview: "시험 미리보기 문장", body: `시험 미리보기 문장 ${MARK} 이어지는 유료 본문`, sale_allowed: true, rights_ref: "시험 권리 기록", sale_confirmed_on: "2026-10-20" });
  assert.equal(rights.status, 200, show(rights));
  const page = await get("/store/subscription");
  assert.equal(page.status, 200);
  assert.match(page.html, /data-part="test-mode-banner"/, "시험 결제 배너");
  assert.match(page.html, new RegExp(PLAN_AMOUNT.toLocaleString("ko-KR")), "금액은 요금제 데이터에서 온다");
  assert.ok(!/data-assistant-root/.test(page.html), "결제 화면에 AI 도우미 런처 0");
  const ld = await get("/robots.txt");
  assert.equal(ld.status, 200);
});

test("d) 비구독자에게는 어디에도 유료 본문 0 - 기사 주소는 미리보기만, RSS·검색·구조화 데이터·응답 머리글", async () => {
  const anon = await get(`/news/${fx.article.slug}`);
  assert.equal(anon.status, 200);
  assert.match(anon.html, /data-paywall="locked"/);
  assert.match(anon.html, /시험 미리보기 문장/);
  assert.ok(!anon.html.includes(MARK), "비구독자 HTML에 유료 본문 0");
  assert.ok(!anon.html.includes("기사 원문 칸"), "기사 원문 칸도 0");
  assert.match(anon.html, /"isAccessibleForFree":false/, "유료 콘텐츠 구조화 데이터");
  assert.match(anon.html, /noindex/, "유료 화면은 색인하지 않는다");
  assert.ok(!/s-maxage|public/.test(anon.headers.get("cache-control") ?? ""), `공유 캐시 지시 0: ${anon.headers.get("cache-control")}`);
  for (const p of ["/rss.xml", `/api/search?q=${encodeURIComponent(MARK)}`, "/sitemap.xml", "/sitemap-news.xml", "/news"]) {
    const r = await get(p);
    assert.ok(!r.html.includes(MARK), `${p} 에 유료 본문 0`);
    assert.ok(!r.html.includes(fx.article.slug) || p === "/news" || r.status !== 200, `${p} 목록에 유료 기사 0`);
  }
  // 로그인했지만 구독하지 않은 회원도 같다
  const member = await bodyHtml(u.other, `/news/${fx.article.slug}`);
  assert.equal(member.status, 200);
  assert.ok(!member.html.includes(MARK), "구독하지 않은 로그인 회원에게도 0");
});

test("e) 결제 - 약관 확인 없음 422 · 금액은 서버가 요금제에서 · 복귀 주소 값만으로 권한 0 · 가짜 PG 승인 뒤에만 본문 · 반복해도 구독 1개", async () => {
  const noAck = await api("POST", "/api/billing/checkout", u.sub, { planId: fx.planId, termsAck: false, idempotencyKey: `e2e-w10f-${run}-noack-1` });
  assert.equal(noAck.status, 422, show(noAck));
  const idem = `e2e-w10f-${run}-sub-1`;
  const c1 = await api("POST", "/api/billing/checkout", u.sub, { planId: fx.planId, termsAck: true, idempotencyKey: idem, amount: 1 });
  assert.equal(c1.status, 201, show(c1));
  assert.equal(c1.body.checkout.amount, PLAN_AMOUNT, "요청의 금액 칸은 읽지 않는다");
  assert.equal(c1.body.checkout.mode, "test");
  const c2 = await api("POST", "/api/billing/checkout", u.sub, { planId: fx.planId, termsAck: true, idempotencyKey: idem });
  assert.equal(c2.status, 200);
  assert.equal(c2.body.checkout.orderNo, c1.body.checkout.orderNo, "같은 멱등 키 = 같은 주문");
  fx.orderNo = c1.body.checkout.orderNo;

  // 복귀 주소 값만으로는 권한이 없다 - 상태·금액을 주소에 실어도, 가짜 PG가 모르는 인증 값이어도
  const { page, ctx } = await pageAs(u.sub);
  try {
    await page.goto(`${base}/store/subscription/complete?orderNo=${fx.orderNo}&status=DONE&amount=${PLAN_AMOUNT}&paymentKey=bogus_payment_key`);
    assert.match(await page.content(), /data-order-status="(created|failed)"/);
  } finally {
    await ctx.close();
  }
  assert.equal((await db.query("select count(*)::int n from public.entitlements where user_id = $1", [u.sub.id])).rows[0].n, 0);
  const forged = await api("POST", "/api/billing/confirm", u.sub, { orderNo: fx.orderNo, paymentKey: "bogus_payment_key_2", status: "DONE", amount: PLAN_AMOUNT });
  assert.ok(forged.status === 422 || forged.status === 502, show(forged));
  assert.equal((await db.query("select count(*)::int n from public.entitlements where user_id = $1", [u.sub.id])).rows[0].n, 0);

  // 남의 주문은 마무리할 수 없다
  const foreign = await api("POST", "/api/billing/confirm", u.other, { orderNo: fx.orderNo, paymentKey: "bogus_payment_key_3" });
  assert.equal(foreign.status, 404);

  // 정상: 카드 인증(authKey) -> 빌링키 발급 -> 첫 결제 -> PG 조회 -> 구독
  await fake.registerAuthKey(`auth_${run}`, customerKeyOf(u.sub.id));
  const done = await api("POST", "/api/billing/confirm", u.sub, { orderNo: fx.orderNo, authKey: `auth_${run}` });
  assert.equal(done.status, 200, show(done));
  assert.equal(done.body.orderStatus, "paid");
  const again = await api("POST", "/api/billing/confirm", u.sub, { orderNo: fx.orderNo, authKey: `auth_${run}` });
  assert.equal(again.status, 200);
  assert.equal(again.body.orderStatus, "paid");
  assert.equal((await db.query("select count(*)::int n from public.subscriptions where user_id = $1", [u.sub.id])).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int n from public.entitlements where user_id = $1", [u.sub.id])).rows[0].n, 1);
  const sub = (await db.query("select id, auto_renew, billing_key from public.subscriptions where user_id = $1", [u.sub.id])).rows[0];
  assert.equal(sub.auto_renew, true);
  assert.match(sub.billing_key, /^bk_fake_/, "빌링키 문자열만 저장");
  fx.subId = sub.id;

  // 구독자는 본문, 곧바로 비구독자는 본문 0 (구독자 -> 비구독자 순서)
  const mine = await bodyHtml(u.sub, `/news/${fx.article.slug}`);
  assert.match(mine.html, /data-paywall="open"/);
  assert.ok(mine.html.includes(MARK), "구독자에게는 본문");
  const anon = await get(`/news/${fx.article.slug}`);
  assert.ok(!anon.html.includes(MARK), "구독자 직후 비구독자 요청에 본문 0");
  const other = await bodyHtml(u.other, `/news/${fx.article.slug}`);
  assert.ok(!other.html.includes(MARK));
  const billing = await bodyHtml(u.sub, "/my/billing");
  assert.match(billing.html, /data-part="my-subscription"/);
  assert.match(billing.html, /data-part="renewal-notice"/, "구독 시작 때 기록된 갱신 안내가 보인다");
  assert.ok(!/data-assistant-root/.test(billing.html), "내 구독 화면에 AI 도우미 런처 0");
});

test("f) 웹훅 - 위조 서명 401(기록 0) · 최종 상태는 PG 조회 · 같은 웹훅 두 번 = 한 번 · PG 취소 -> 권한 즉시 회수", async () => {
  const evt = (id, status) => ({ eventId: `e2e-w10f-${run}-${id}`, eventType: "PAYMENT_STATUS_CHANGED", data: { orderId: fx.orderNo, status } });
  const bad = await webhook(evt("bad", "DONE"), { secret: "wrong-secret" });
  assert.equal(bad.status, 401);
  const unsigned = await fetch(`${base}/api/billing/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(evt("unsigned", "DONE")) });
  assert.equal(unsigned.status, 401);
  assert.equal((await db.query("select count(*)::int n from public.payment_events where pg_event_id like $1", [`e2e-w10f-${run}-%`])).rows[0].n, 0, "위조 웹훅은 기록도 남기지 않는다");

  // 서명이 맞아도 본문의 상태가 아니라 PG 조회가 최종이다 - 본문은 CANCELED라고 하지만 PG는 DONE
  const lie = await webhook(evt("lie", "CANCELED"));
  assert.equal(lie.status, 200);
  assert.equal((await db.query("select status from public.orders where order_no = $1", [fx.orderNo])).rows[0].status, "paid");
  const dup = await webhook(evt("lie", "CANCELED"));
  assert.equal(dup.status, 200);
  assert.equal(dup.body.duplicate, true, "같은 이벤트 번호 재전송은 처리하지 않는다");
  assert.equal((await db.query("select count(*)::int n from public.payment_events where pg_event_id = $1", [`e2e-w10f-${run}-lie`])).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int n from public.subscriptions where user_id = $1", [u.sub.id])).rows[0].n, 1);

  // PG가 실제로 취소하면 다음 요청부터 본문이 닫힌다
  await sleep(20);
  await fake.setStatus(fx.orderNo, "CANCELED");
  const cancel = await webhook(evt("cancel", "CANCELED"));
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.order_status, "refunded");
  assert.equal((await db.query("select status from public.orders where order_no = $1", [fx.orderNo])).rows[0].status, "refunded");
  const after = await bodyHtml(u.sub, `/news/${fx.article.slug}`);
  assert.ok(!after.html.includes(MARK), "환불 뒤 첫 요청부터 본문 0");

  // 새로 구독해 이후 시험에 쓴다
  const c = await api("POST", "/api/billing/checkout", u.sub, { planId: fx.planId, termsAck: true, idempotencyKey: `e2e-w10f-${run}-sub-2` });
  assert.equal(c.status, 201, show(c));
  fx.orderNo2 = c.body.checkout.orderNo;
  await fake.registerPayment(`pay_${run}_2`, fx.orderNo2, PLAN_AMOUNT);
  const done = await api("POST", "/api/billing/confirm", u.sub, { orderNo: fx.orderNo2, paymentKey: `pay_${run}_2` });
  assert.equal(done.body.orderStatus, "paid", show(done));
  fx.subId = (await db.query("select id from public.subscriptions where user_id = $1 and status = 'active'", [u.sub.id])).rows[0].id;
});

test("g) 해지·경계 - 남의 구독 404, 해지해도 남은 기간 이용, valid_until이 지나면 다음 요청부터 잠김", async () => {
  assert.equal((await api("POST", "/api/billing/cancel", u.other, { subscriptionId: fx.subId })).status, 404);
  const cancel = await api("POST", "/api/billing/cancel", u.sub, { subscriptionId: fx.subId });
  assert.equal(cancel.status, 200, show(cancel));
  assert.equal((await api("POST", "/api/billing/cancel", u.sub, { subscriptionId: fx.subId })).body.already, true, "같은 해지 요청은 같은 결과");
  const row = (await db.query("select auto_renew, status from public.subscriptions where id = $1", [fx.subId])).rows[0];
  assert.deepEqual(row, { auto_renew: false, status: "active" });
  assert.ok((await bodyHtml(u.sub, `/news/${fx.article.slug}`)).html.includes(MARK), "해지해도 남은 기간은 본문");
  // 끝 시각을 3초 뒤로 당긴다 - 그 직전 요청은 허용, 지난 뒤 요청은 거부 (서버 시각 기준)
  await db.query("update public.entitlements set valid_until = now() + interval '4 seconds' where source = 'subscription' and source_ref = $1", [fx.subId]);
  const { page, ctx } = await pageAs(u.sub);
  try {
    await page.goto(`${base}/news/${fx.article.slug}`);
    assert.ok((await page.content()).includes(MARK), "valid_until 직전 요청은 허용");
    await sleep(4500);
    await page.goto(`${base}/news/${fx.article.slug}`);
    assert.ok(!(await page.content()).includes(MARK), "valid_until 직후 요청은 거부");
  } finally {
    await ctx.close();
  }
});

test("h) 정기 작업 - 고지 기록 없는 만기 구독은 갱신 0(닫힘), 고지 기록이 있으면 갱신 결제 1건 / 카드번호 패턴 0", async () => {
  const job = async (name) => {
    const res = await fetch(`${base}/api/jobs/${name}`, { method: "POST", headers: { authorization: `Bearer ${CRON}` } });
    return res.status;
  };
  // 만기 1시간 지난 자동갱신 구독 하나를 직접 만든다(고지 기록 없음) - 빌링키는 가짜 PG에서 발급
  await fake.registerAuthKey(`auth_${run}_job`, customerKeyOf(u.other.id));
  const issued = await fetch(`${fake.url}/v1/billing/authorizations/issue`, { method: "POST", headers: { authorization: "Basic eDo=", "content-type": "application/json" }, body: JSON.stringify({ authKey: `auth_${run}_job`, customerKey: customerKeyOf(u.other.id) }) });
  const { billingKey } = await issued.json();
  await db.query("begin");
  let subId;
  try {
    await db.query("set local session_replication_role = replica");
    subId = (
      await db.query(
        `insert into public.subscriptions (user_id, product_id, plan_id, auto_renew, billing_key, current_period_start, current_period_end)
         values ($1, $2, $3, true, $4, now() - interval '1 month 1 hour', now() - interval '1 hour') returning id`,
        [u.other.id, fx.productId, fx.planId, billingKey],
      )
    ).rows[0].id;
    await db.query("insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until) values ($1, 'digital', 'subscription', $2, now() - interval '1 month 1 hour', now() - interval '1 hour')", [u.other.id, subId]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
  assert.equal(await job("billing-reconcile"), 200);
  assert.equal((await db.query("select count(*)::int n from public.orders where subscription_id = $1", [subId])).rows[0].n, 0, "고지 기록 없으면 갱신 주문 0");
  assert.equal((await db.query("select status from public.subscriptions where id = $1", [subId])).rows[0].status, "expired");

  // 고지 기록이 있는 만기 구독은 갱신 결제가 한 건 일어난다
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("update public.subscriptions set status = 'active', auto_renew = true where id = $1", [subId]);
    await db.query(
      "insert into public.renewal_notices (subscription_id, kind, period_end, amount, notified_at) select id, 'checkout', current_period_end, $2, current_period_start from public.subscriptions where id = $1",
      [subId, PLAN_AMOUNT],
    );
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
  assert.equal(await job("billing-reconcile"), 200);
  const orders = (await db.query("select status, kind, amount from public.orders where subscription_id = $1", [subId])).rows;
  assert.deepEqual(orders, [{ status: "paid", kind: "renewal", amount: PLAN_AMOUNT }]);
  assert.equal(await job("billing-reconcile"), 200);
  assert.equal((await db.query("select count(*)::int n from public.orders where subscription_id = $1", [subId])).rows[0].n, 1, "작업을 다시 돌려도 갱신 결제는 한 건");
  const periodEnd = (await db.query("select current_period_end > now() as future from public.subscriptions where id = $1", [subId])).rows[0];
  assert.equal(periodEnd.future, true);

  // 카드번호 패턴 0 - 결제 표 전체 (검사기 자체: 시험 카드번호는 잡고, 숫자만 이어진 UUID·시각은 거른다)
  assert.equal(luhnRuns("카드 4111 1111 1111 1111 입니다").length, 1);
  assert.equal(luhnRuns("2026-10-24 23:51:43.641+00 12345678-1234-4123-8123-123456789012").length, 0);
  for (const t of ["orders", "subscriptions", "payment_events", "renewal_notices", "entitlements", "product_plans"]) {
    const rows = (await db.query(`select x::text as s from public.${t} x`)).rows;
    for (const r of rows) assert.deepEqual(luhnRuns(r.s), [], `${t} 에 카드번호 모양 값`);
  }
  const events = (await db.query("select count(*)::int n from public.analytics_events where props::text ~ '(card|카드번호)'")).rows[0].n;
  assert.equal(events, 0);
});
