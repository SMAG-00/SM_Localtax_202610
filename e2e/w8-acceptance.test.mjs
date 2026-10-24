// W8 수용 E2E (docs/dev/W8_설계.md 1장 4단계 - PRD-01C BIZ-01·02·03·08·09, PRD_최종 §11.1 W8 "기사 -> 상품 -> 주문 E2E")
// standalone 빌드를 로컬 Supabase에 붙인다. 상품·판매처·기사는 전부 시험용 가짜다(*.example.test, 가상 이름). 결제는 없다.
//  a) 권한·입력 - 기자 403 · 편집 책임자는 스토어 보드 403 · 상품 담당은 상품 등록/제안만(승인·허용 도메인 403 + 승인 거부 감사) · 허용 도메인 밖 주소·할인 표기·확인일 없는 판매 중·판차 없는 도서 422
//  b) 키 꺼짐(기본) - 상품·연결이 다 있어도 /store·상세 404, 기사·홈에 '자사 상품' 카드 0
//  c) 기사 -> 상품 카드 -> 바깥 주문 링크: 카드 1개('자사 상품' 표시)·승인 전 0·기사당 두 번째 승인 409·홈 카드 1개·/store 목록의 새 창 주문 링크·가격/결제 요소 0·광고 정책 링크는 정책 페이지가 열릴 때만
//  d) 문의함 방식 - page_help 닫힘이면 신청서 상품 0, 열리면 /help/subscribe 링크 / 구독 상품은 구독 확인 기록 승인 뒤에만
//  e) 판매 중지 -> 다음 요청부터 /store·기사·홈 카드 0
//  f) 측정 - 브라우저로 카드 누름 = product_clicked 1건, 주문 링크 누름 = order_link_clicked 1건(출발 기사 번호 포함) / 수익 대시보드 API가 상품 x 위치 x 출처 기사로 센다(봇 제외)
// 만든 계정·기사·상품·측정 이벤트는 끝나면 지우고, 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { publishPolicies } from "./lib/policy-fixture.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w8-acceptance-e2e@example.test";
const SITE = "https://e2e-w8.example.test";
const SHOP = "shop.example.test";
const REAL_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

let sb, server, staff, db, base, browser, since, removePolicies;
const u = {};
const fx = {};
let run;

const show = (r) => JSON.stringify(r.body).slice(0, 500);
async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const store = (user, body) => api("POST", "/store", user, body);
const setting = (key, value) => api("PATCH", `/settings/${key}`, u.admin, { value });
async function flags(patch) {
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  const r = await setting("feature_flags", { ...cur, ...patch });
  assert.equal(r.status, 200, show(r));
}
const get = async (p) => {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
};
const count = (html, re) => [...html.matchAll(re)].length;
const OWN = /data-variant="own"/g;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const product = (over = {}) => ({
  op: "product",
  slug: `e2e-w8-${run}-a`,
  title: "가상 시험 강좌 A",
  kind: "education",
  summary: "시험용 한 줄 설명입니다.",
  audience: "시험 대상",
  order_mode: "existing_channel",
  order_url: `https://${SHOP}/e2e/${run}/a`,
  verified_on: "2026-10-20",
  verified_ref: "시험 확인 기록 A",
  ...over,
});

async function insertArticle(key) {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    const cat = (await db.query("select id from public.categories where section = 'tax' order by id limit 1")).rows[0];
    const r = (
      await db.query(
        `insert into public.articles (slug, title, summary, section, content_type, status, category_id, author_id, first_published_at, tax_review_status, body)
         values ($1, $2, '시험용 요약', 'tax', 'reported_news', 'published', $3, $4, now() - interval '1 hour', 'approved', '{"blocks":[{"type":"paragraph","text":"시험용 본문 문단입니다."}],"claims":[]}'::jsonb) returning id, slug`,
        [`e2e-w8-${key}-${run}`, `시험용 W8 기사 ${key}`, cat.id, fx.personId],
      )
    ).rows[0];
    await db.query("commit");
    staff.trackArticle(Number(r.id));
    return { id: Number(r.id), slug: r.slug, href: `/news/${r.slug}` };
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

async function purge() {
  const ids = (await db.query("select id from public.products where slug like $1", [`e2e-w8-${run}-%`])).rows.map((r) => Number(r.id));
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    if (ids.length) {
      await db.query("delete from public.analytics_events where name in ('product_clicked', 'order_link_clicked') and (props ->> 'product_id')::bigint = any($1::bigint[])", [ids]);
      await db.query("delete from public.product_links where product_id = any($1::bigint[])", [ids]);
      await db.query("delete from public.products where id = any($1::bigint[])", [ids]);
    }
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
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  since = new Date().toISOString();
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  u.admin = await staff.createUser({ label: "w8-admin", email: ADMIN_EMAIL });
  u.reporter = await staff.createUser({ label: "w8-reporter", roles: ["reporter"], person: { name: "시험용 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "w8-editor", roles: ["editor"], person: { name: "시험용 편집 책임자", roles: ["editor"] } });
  u.storeOps = await staff.createUser({ label: "w8-store-ops", roles: ["store_ops"] });
  const person = (await db.query("insert into public.people (name, slug, roles, visibility, employment) values ('시험용 필자', $1, '{reporter}', 'hidden', 'staff') returning id", [`w8acc-rep-${run}`])).rows[0];
  staff.personIds.add(Number(person.id));
  fx.personId = Number(person.id);
  // 시작 상태: 스토어 키 꺼짐 · 허용 도메인 빈 목록 · 구독 확인 기록 미승인
  await db.query("update public.settings set value = value || '{\"store\": false, \"page_help\": false}'::jsonb where key = 'feature_flags'");
  await db.query("update public.settings set value = '[]'::jsonb where key = 'store_order_domains'");
  await db.query("update public.settings set value = jsonb_build_object('approved', false, 'ref', '', 'reviewed_by', null, 'reviewed_on', null) where key = 'store_subscription_review'");
  await purge();
  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
    await purge();
    await removePolicies?.();
  } finally {
    await staff?.cleanup();
    server?.stop();
  }
});

test("a) 권한·입력 - 상품 담당은 제안까지, 승인은 편집 책임자, 허용 도메인은 관리자 / 허용 밖 주소·할인 표기·확인일 없는 판매 중 422", async () => {
  assert.equal((await api("GET", "/store", u.reporter)).status, 403);
  assert.equal((await api("GET", "/store", u.editor)).status, 403, "편집 책임자는 상품 운영 화면에 들어오지 않는다");
  const board = await api("GET", "/store", u.storeOps);
  assert.equal(board.status, 200, show(board));
  assert.deepEqual(board.body.domains, [], "허용 도메인 씨앗은 빈 목록");
  assert.equal(board.body.flags.store, false);
  assert.equal(board.body.subscriptionReview.approved, false);
  assert.equal((await store(u.storeOps, { op: "domains", domains: SHOP })).status, 403, "상품 담당은 허용 도메인을 바꾸지 못한다");
  assert.equal((await store(u.storeOps, { op: "subscription_review", approved: true, ref: "x", reviewed_by: "y", reviewed_on: "2026-10-20" })).status, 403);
  // 허용 목록이 비어 있으면 바깥 링크 상품은 저장되지 않는다
  const closed = await store(u.storeOps, product());
  assert.equal(closed.status, 422, show(closed));
  assert.equal((await store(u.admin, { op: "domains", domains: `${SHOP}\nbooks.example.test` })).status, 200);
  assert.equal((await store(u.admin, { op: "domains", domains: "Bad.Example.test" })).status, 422, "대문자 호스트");
  assert.equal((await store(u.storeOps, product({ order_url: "https://other.example.test/x" }))).status, 422, "허용 밖 도메인");
  assert.equal((await store(u.storeOps, product({ order_url: `http://${SHOP}/x` }))).status, 422, "http");
  assert.equal((await store(u.storeOps, product({ summary: "지금 20% 할인" }))).status, 422, "할인 표기");
  assert.equal((await store(u.storeOps, product({ title: "가상 도서 정가 15,000원", kind: "book" }))).status, 422, "가격 표기");
  const draft = await store(u.storeOps, product({ verified_on: "", verified_ref: "" }));
  assert.equal(draft.status, 201, show(draft));
  fx.a = { id: Number(draft.body.product.id), slug: draft.body.product.slug };
  const noVerify = await store(u.storeOps, { op: "product_status", id: fx.a.id, status: "on_sale" });
  assert.equal(noVerify.status, 422, `확인일·근거 없는 판매 중: ${show(noVerify)}`);
  assert.equal((await store(u.storeOps, product({ verified_on: "2026-10-20", verified_ref: "시험 확인 기록 A", id: fx.a.id }))).status, 200);
  assert.equal((await store(u.storeOps, { op: "product_status", id: fx.a.id, status: "on_sale" })).status, 200);
  const bookBare = await store(u.storeOps, product({ slug: `e2e-w8-${run}-bk`, kind: "book", order_mode: "request_form", order_url: "", title: "가상 도서 B" }));
  assert.equal(bookBare.status, 201, show(bookBare));
  fx.book = { id: Number(bookBare.body.product.id), slug: bookBare.body.product.slug };
  const bookSale = await store(u.storeOps, { op: "product_status", id: fx.book.id, status: "on_sale" });
  assert.equal(bookSale.status, 422, `판차·목차 없는 도서는 판매 중이 될 수 없다: ${show(bookSale)}`);
  const bookFull = await store(u.storeOps, product({ id: fx.book.id, slug: fx.book.slug, kind: "book", order_mode: "request_form", order_url: "", title: "가상 도서 B", edition: "제1판(시험)", toc: "제1장 시험\n제2장 시험" }));
  assert.equal(bookFull.status, 200, show(bookFull));
  assert.equal((await store(u.storeOps, { op: "product_status", id: fx.book.id, status: "on_sale" })).status, 200);
  // 연결 제안은 상품 담당, 승인은 상품 담당 403(+거부 감사) -> 편집 책임자 200
  fx.art1 = await insertArticle("one");
  fx.art2 = await insertArticle("two");
  const bad = await store(u.storeOps, { op: "link_propose", product_id: fx.a.id, placement: "article" });
  assert.equal(bad.status, 422, "기사 연결에 기사 번호 없음");
  const prop = await store(u.storeOps, { op: "link_propose", product_id: fx.a.id, placement: "article", article_id: fx.art1.id });
  assert.equal(prop.status, 201, show(prop));
  fx.link1 = Number(prop.body.link.id);
  const before = Number((await db.query("select count(*) from public.audit_logs where action like 'product.approve%denied%'")).rows[0].count);
  assert.equal((await store(u.storeOps, { op: "link_approve", id: fx.link1 })).status, 403, "상품 담당은 승인 권한이 없다");
  assert.equal((await store(u.reporter, { op: "link_approve", id: fx.link1 })).status, 403);
  const after = Number((await db.query("select count(*) from public.audit_logs where action like 'product.approve%denied%'")).rows[0].count);
  assert.ok(after >= before + 1, "승인 거부가 감사 로그에 남는다");
  assert.equal((await db.query("select status from public.product_links where id = $1", [fx.link1])).rows[0].status, "proposed");
  assert.equal((await store(u.editor, { op: "link_approve", id: fx.link1 })).status, 200);
  // 같은 기사에 두 번째 연결: 제안은 되지만 승인은 409
  const prop2 = await store(u.storeOps, { op: "link_propose", product_id: fx.book.id, placement: "article", article_id: fx.art1.id });
  assert.equal(prop2.status, 201);
  const second = await store(u.editor, { op: "link_approve", id: Number(prop2.body.link.id) });
  assert.equal(second.status, 409, `기사당 승인 1개: ${show(second)}`);
  assert.equal((await store(u.editor, { op: "link_revoke", id: Number(prop2.body.link.id) })).status, 200);
  // 홈 연결
  const home = await store(u.storeOps, { op: "link_propose", product_id: fx.a.id, placement: "home" });
  assert.equal(home.status, 201, show(home));
  fx.homeLink = Number(home.body.link.id);
  assert.equal((await store(u.editor, { op: "link_approve", id: fx.homeLink })).status, 200);
  assert.equal((await store(u.storeOps, { op: "link_propose", product_id: fx.a.id, placement: "home", article_id: fx.art1.id })).status, 422, "홈 연결에 기사 번호");
});

test("b) 스토어 키 꺼짐(기본) - 상품·승인 연결이 다 있어도 /store·상세 404, 기사·홈 카드 0", async () => {
  assert.equal((await get("/store")).status, 404);
  assert.equal((await get(`/store/${fx.a.slug}`)).status, 404);
  const article = await get(fx.art1.href);
  assert.equal(article.status, 200);
  assert.equal(count(article.html, OWN), 0, "기사 카드 0");
  assert.ok(!article.html.includes('data-part="own-product"'));
  assert.ok(!(await get("/")).html.includes('data-part="own-product"'), "홈 카드 0");
});

test("c) 기사 -> 상품 카드 -> 바깥 주문 링크 - 카드 1개·'자사 상품' 표시·승인 안 된 연결 0·홈 카드 1개·/store 새 창 링크·가격/결제 요소 0", async () => {
  await flags({ store: true });
  const article = await get(fx.art1.href);
  assert.equal(count(article.html, OWN), 1, "기사 하단 카드는 1개");
  assert.ok(article.html.includes("자사 상품"), "'자사 상품' 표시");
  assert.ok(article.html.includes("교육·상품"), "'교육·상품' 배지");
  assert.ok(article.html.includes("가상 시험 강좌 A"));
  assert.ok(article.html.includes(`/store/${fx.a.slug}?from=a${fx.art1.id}`), "상세 링크가 출발 기사를 싣는다");
  assert.equal(count((await get(fx.art2.href)).html, OWN), 0, "연결 없는 기사 0");
  const home = (await get("/")).html;
  assert.equal(count(home, OWN), 1, "홈 카드 1개");
  assert.ok(home.includes(`/store/${fx.a.slug}?from=h`));
  // 광고 정책 링크는 정책 페이지가 열려 있을 때만 (이 시험 환경에서는 정책 페이지가 닫혀 있다 -> 링크 0)
  const adOpen = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value.page_ad_policy === true;
  const adLinks = count(article.html, /data-part="ad-policy-link"/g);
  assert.equal(adLinks > 0, adOpen, "광고 정책 링크 = 정책 페이지 열림 여부");
  // 목록과 상세
  const list = await get("/store");
  assert.equal(list.status, 200);
  assert.ok(list.html.includes("가상 시험 강좌 A"));
  assert.ok(!list.html.includes("가상 도서 B"), "문의함이 닫혀 있으면 신청서 상품은 목록에 없다");
  const orderUrl = `https://${SHOP}/e2e/${run}/a`;
  const m = [...list.html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>/g)].map((x) => x[0]).find((t) => t.includes(orderUrl));
  assert.ok(m, "목록에 바깥 주문 링크");
  assert.match(m, /target="_blank"/);
  assert.match(m, /rel="[^"]*noopener/);
  const detail = await get(`/store/${fx.a.slug}?from=a${fx.art1.id}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.html.includes(orderUrl));
  for (const html of [list.html, detail.html, article.html]) {
    assert.ok(!/장바구니|결제하기|카드번호|cardnumber|할인|<input[^>]+type="tel"/i.test(html), "가격·결제 요소 0");
    assert.ok(!/js\.tosspayments|stripe|iamport|nicepay/i.test(html), "PG 스크립트 0");
  }
  assert.equal((await get("/store/not-a-product")).status, 404);
  // 승인 안 된 연결은 카드가 되지 않는다
  const p = await store(u.storeOps, { op: "link_propose", product_id: fx.a.id, placement: "article", article_id: fx.art2.id });
  assert.equal(p.status, 201);
  assert.equal(count((await get(fx.art2.href)).html, OWN), 0, "제안만 있으면 카드 0");
  assert.equal((await store(u.editor, { op: "link_revoke", id: Number(p.body.link.id) })).status, 200);
});

test("d) 문의함 방식은 page_help가 열려야만 보이고 /help/subscribe로 가며, 구독 상품은 구독 확인 기록 승인 뒤에만 보인다", async () => {
  assert.ok(!(await get("/store")).html.includes("가상 도서 B"));
  assert.equal((await get(`/store/${fx.book.slug}`)).status, 404, "문의함이 닫혀 있으면 상세도 404");
  removePolicies = await publishPolicies(db, staff.run, ["privacy"]);
  await flags({ page_help: true });
  const list = await get("/store");
  assert.ok(list.html.includes("가상 도서 B"));
  assert.ok(list.html.includes('href="/help/subscribe"'), "신청하기 -> 문의함");
  const detail = await get(`/store/${fx.book.slug}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.html.includes("제1판(시험)") && detail.html.includes("제2장 시험"), "판차·목차 표시");
  // 구독 상품
  const sub = await store(u.storeOps, product({ slug: `e2e-w8-${run}-sub`, title: "가상 구독 신청 C", kind: "subscription", order_mode: "request_form", order_url: "" }));
  assert.equal(sub.status, 201, show(sub));
  const subId = Number(sub.body.product.id);
  assert.equal((await store(u.storeOps, { op: "product_status", id: subId, status: "on_sale" })).status, 200);
  assert.ok(!(await get("/store")).html.includes("가상 구독 신청 C"), "구독 확인 기록 승인 전 0");
  assert.equal((await store(u.admin, { op: "subscription_review", approved: true, ref: "시험 기록", reviewed_by: "", reviewed_on: "2026-10-20" })).status, 422, "확인자 없는 승인");
  assert.equal((await store(u.admin, { op: "subscription_review", approved: true, ref: "시험 기록", reviewed_by: "시험 확인자", reviewed_on: "2026-10-20" })).status, 200);
  assert.ok((await get("/store")).html.includes("가상 구독 신청 C"));
  assert.equal((await store(u.admin, { op: "subscription_review", approved: false })).status, 200);
  assert.ok(!(await get("/store")).html.includes("가상 구독 신청 C"), "승인 철회 -> 다시 0");
});

test("f) 측정 - 카드 누름 product_clicked 1건, 주문 링크 누름 order_link_clicked 1건(출발 기사 번호), 수익 대시보드가 상품 x 위치 x 기사로 센다", async () => {
  const sent = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/events") sent.push(JSON.parse(r.postData() ?? "{}"));
  });
  const page = await context.newPage();
  const open = async (p) => {
    await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.addEventListener("click", (e) => e.preventDefault(), true));
  };
  const wait = async (n) => {
    const end = Date.now() + 8000;
    while (sent.length < n && Date.now() < end) await sleep(50);
    await sleep(300);
  };
  await open(fx.art1.href);
  const before = sent.filter((s) => s.name.startsWith("product") || s.name.startsWith("order")).length;
  await page.locator('[data-part="own-product"] a').first().click();
  await wait(sent.length + 1);
  const clicked = sent.filter((s) => s.name === "product_clicked");
  assert.equal(clicked.length - before, 1, JSON.stringify(sent));
  assert.deepEqual(clicked[0].props, { product_id: fx.a.id, placement: "article", article_id: fx.art1.id });
  await open(`/store/${fx.a.slug}?from=a${fx.art1.id}`);
  await page.locator(`a[href^="https://${SHOP}"]`).first().click();
  await wait(sent.length + 1);
  const orders = sent.filter((s) => s.name === "order_link_clicked");
  assert.equal(orders.length, 1, JSON.stringify(sent));
  assert.deepEqual(orders[0].props, { product_id: fx.a.id, placement: "article", mode: "existing_channel", article_id: fx.art1.id });
  for (const s of sent) for (const [k, v] of Object.entries(s.props ?? {})) assert.ok(!/https?:|example\.test/.test(String(v)), `${s.name}.${k}에 주소·이름 0`);
  await context.close();
  // 실제 방문자처럼 보내서 집계에 들어가는 이벤트 (자동화 브라우저는 봇으로 저장되어 집계에서 빠진다)
  const post = async (body) => (await fetch(`${base}/api/events`, { method: "POST", headers: { "content-type": "application/json", origin: base, "user-agent": REAL_UA }, body: JSON.stringify(body) })).status;
  const art = { product_id: fx.a.id, placement: "article", article_id: fx.art1.id };
  assert.equal(await post({ name: "product_clicked", section: "tax", props: art }), 202);
  assert.equal(await post({ name: "product_clicked", section: "tax", props: art }), 202);
  assert.equal(await post({ name: "order_link_clicked", section: "tax", props: { ...art, mode: "existing_channel" } }), 202);
  assert.equal(await post({ name: "product_clicked", props: { product_id: fx.a.id, placement: "store" } }), 202);
  assert.equal(await post({ name: "product_clicked", props: { ...art, price: 1 } }), 400, "가격 칸은 받지 않는다");
  assert.equal(await post({ name: "order_link_clicked", props: { product_id: fx.a.id, placement: "store", mode: "pg" } }), 400, "모르는 주문 방식");
  assert.equal(await post({ name: "product_clicked", props: { product_id: fx.a.id, placement: "sidebar" } }), 400, "모르는 위치");
  const rev = await api("GET", "/store/revenue?days=7", u.storeOps);
  assert.equal(rev.status, 200, show(rev));
  const mine = rev.body.rows.filter((r) => r.product_id === fx.a.id).map((r) => [r.placement, r.article_id, r.card_clicks, r.order_clicks]);
  assert.deepEqual(mine, [["article", fx.art1.id, 2, 1], ["store", null, 1, 0]], "봇(자동화 브라우저) 제외 · 위치·출처 기사별");
  const total = rev.body.totals.find((t) => t.product_id === fx.a.id);
  assert.deepEqual([total.card_clicks, total.order_clicks], [3, 1]);
  assert.equal(rev.body.rows.find((r) => r.product_id === fx.a.id).article_title, `시험용 W8 기사 one`);
  assert.equal((await api("GET", "/store/revenue", u.reporter)).status, 403);
  assert.equal((await api("GET", "/store/revenue", u.editor)).status, 403);
  assert.ok(Date.parse(since) > 0);
});

test("e) 판매 중지 -> 다음 요청부터 /store·상세·기사·홈 카드 0, 키를 끄면 전부 404", async () => {
  assert.equal((await store(u.storeOps, { op: "product_status", id: fx.a.id, status: "stopped" })).status, 200);
  assert.ok(!(await get("/store")).html.includes("가상 시험 강좌 A"));
  assert.equal((await get(`/store/${fx.a.slug}`)).status, 404);
  assert.equal(count((await get(fx.art1.href)).html, OWN), 0, "기사 카드 0");
  assert.equal(count((await get("/")).html, OWN), 0, "홈 카드 0");
  assert.equal((await store(u.storeOps, { op: "product_status", id: fx.a.id, status: "on_sale" })).status, 200);
  assert.equal(count((await get(fx.art1.href)).html, OWN), 1, "다시 판매 중이면 카드 복귀(승인 기록은 그대로)");
  assert.equal((await store(u.editor, { op: "link_revoke", id: fx.link1 })).status, 200);
  assert.equal(count((await get(fx.art1.href)).html, OWN), 0, "연결 철회 -> 카드 0");
  await flags({ store: false });
  assert.equal((await get("/store")).status, 404);
  assert.equal(count((await get("/")).html, OWN), 0);
});
