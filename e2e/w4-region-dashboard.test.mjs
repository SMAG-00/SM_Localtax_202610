// W4 25단계 E2E — 지역 성과 대시보드·편집비 (REG1-15, docs/dev/W4_설계.md 1장 25단계 · 12장 #28)
// standalone 빌드를 로컬 Supabase에 붙인다. 비어 있는 지난 주에 지역 측정 이벤트와 지역 기사를 정해 넣고, /admin/metrics?tab=region 숫자를 손 계산과 비교한다.
//  a) 비율마다 분자 / 분모가 함께 — 자체 취재 2/2 · 근거 충족 1/2 · 지역 재방문 1/2(30일째 포함·31일째 제외) · 문제해결 이동 1/2(봇·편집국 세션 제외)
//  b) 편집비 빈 달 → '편집비 미입력'(추정값 0 아님) · 입력 API(관리자만, 사유 필수, 음수·없는 지역 422, 같은 금액 unchanged, 감사 기록) → 화면 금액·취재 1건당 편집비
//  c) 화면 폼으로 다른 달 편집비 입력 → 표가 바뀐다
//  d) 역할 — 편집 책임자는 화면 403·API 403, 로그인 안 하면 로그인 화면으로
//  e) 360px — 가로 스크롤 0, 탭·달 이동 터치 44px
// 넣은 이벤트·기사·편집비는 끝나면 지운다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e.example.test";
const ADMIN_EMAIL = "admin-region-dash-e2e@example.test";
const DAY = 86_400_000;

let sb, server, staff, db, browser, base, D1, REGION;
const u = {};
const contexts = [];
const sessions = [];

const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const kst = (date, hms) => new Date(`${date}T${hms}+09:00`).toISOString();
const d = (n) => addDays(D1, n);
const monthOf = (date) => date.slice(0, 7);
const shift = (month, delta) => {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
};
const URL_TAB = () => `/admin/metrics?tab=region&period=custom&from=${D1}&to=${d(6)}&month=${monthOf(D1)}`;

async function seed({ name = "region_viewed", date, hms = "12:00:00", visitor = null, session, bot = false, staff: isStaff = false, target = "situation" }) {
  const sid = session ?? crypto.randomUUID();
  sessions.push(sid);
  const props = { region_code: REGION, ...(name === "region_viewed" ? { level: "sido" } : { target }) };
  await db.query(
    `insert into public.analytics_events (name, occurred_at, session_id, visitor_id, first_visit, stage, entry, section, props, is_bot, is_staff)
     values ($1, $2, $3, $4, false, 1, 'direct', 'local', $5, $6, $7)`,
    [name, kst(date, hms), sid, visitor, JSON.stringify(props), bot, isStaff],
  );
  return sid;
}

async function emptyWeek() {
  for (let i = 0; i < 20; i++) {
    const offset = 120 + Math.floor(Math.random() * 160);
    const day = new Date(Date.now() + 9 * 3_600_000 - offset * DAY).toISOString().slice(0, 10);
    const { rows } = await db.query("select count(*)::int n from public.analytics_events where occurred_at >= $1 and occurred_at < $2", [kst(addDays(day, -2), "00:00:00"), kst(addDays(day, 40), "00:00:00")]);
    const month = await db.query("select count(*)::int n from public.articles a where $1 = any(a.region_codes) and a.first_published_at >= $2 and a.first_published_at < $3", [REGION, kst(`${monthOf(day)}-01`, "00:00:00"), kst(`${shift(monthOf(day), 1)}-01`, "00:00:00")]);
    const cost = await db.query("select count(*)::int n from public.region_editorial_costs where month = any($1::date[])", [[`${monthOf(day)}-01`, `${shift(monthOf(day), -1)}-01`, `${shift(monthOf(day), 1)}-01`]]);
    if (rows[0].n === 0 && month.rows[0].n === 0 && cost.rows[0].n === 0) return day;
  }
  throw new Error("비어 있는 시험 주를 찾지 못했다");
}

async function api(method, path, user, body) {
  const res = await fetch(`${base}/api/admin${path}`, {
    method,
    headers: { authorization: `Bearer ${user.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
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
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  u.admin = await staff.createUser({ label: "region-dash-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "region-dash-editor", roles: ["editor"], person: { name: "지역 대시보드 시험 편집자", roles: ["editor"] } });
  await db.query("update public.settings set value = $1::jsonb where key = 'domain_cutover'", [JSON.stringify({ version: "e2e-1", date: null })]);
  REGION = (await db.query("select code from public.regions where level = 'sido' order by code limit 1")).rows[0].code;
  D1 = await emptyWeek();

  // 지역 기사 — 발행 게이트 없이 사실 행만 넣는다(자체 취재 2건: 확인된 근거 1건 있음·없음)
  await db.query("begin");
  await db.query("set local session_replication_role = replica");
  const ids = [];
  for (const n of [1, 2]) {
    const r = await db.query(
      `insert into public.articles (slug, title, section, content_type, status, origin, region_codes, first_published_at)
       values ($1, $2, 'local', 'reported_news', 'published', 'new', $3, $4) returning id`,
      [`e2e-region-dash-${staff.run}-${n}`, `지역 대시보드 시험 기사 ${n}`, [REGION], kst(D1, `1${n}:00:00`)],
    );
    ids.push(Number(r.rows[0].id));
    staff.trackArticle(r.rows[0].id);
  }
  await db.query("insert into public.article_evidence (article_id, evidence_type, location, rights_status, verification_status) values ($1, 'dataset', '보관함/1', 'confirmed', 'verified')", [ids[0]]);
  await db.query("commit");

  // 지역 이벤트 — 방문자 v1: 첫 열람 D1 + 세금 이동, 30일째(D1+30) 재방문 / v2: 첫 열람 D1, 31일째(D1+31 0시) 열람 / 봇·편집국 세션은 뺀다
  const v1 = crypto.randomUUID(), v2 = crypto.randomUUID();
  const s1 = await seed({ date: d(0), visitor: v1 });
  await seed({ name: "region_to_tax_clicked", date: d(0), hms: "12:01:00", visitor: v1, session: s1 });
  await seed({ date: d(0), visitor: v2 });
  await seed({ date: d(30), hms: "23:00:00", visitor: v1 });
  await seed({ date: d(31), hms: "00:00:00", visitor: v2 });
  const bot = await seed({ date: d(1), bot: true });
  await seed({ name: "region_to_tax_clicked", date: d(1), hms: "12:01:00", session: bot, bot: true });
  const st = await seed({ date: d(1), staff: true });
  await seed({ name: "region_to_realestate_clicked", date: d(1), hms: "12:01:00", session: st, staff: true, target: "supply" });
  browser = await chromium.launch();
});

after(async () => {
  try {
    for (const c of contexts) await c.close().catch(() => {});
    await browser?.close();
    if (db) {
      if (sessions.length) await db.query("delete from public.analytics_events where session_id = any($1::uuid[])", [sessions]);
      await db.query("delete from public.region_editorial_costs where region_code = $1 and (updated_by = $2 or entered_by = $2)", [REGION, `user:${u.admin?.id}`]);
      await db.query("delete from public.audit_logs where target like 'region_editorial_costs:%' and actor = $1", [`user:${u.admin?.id}`]).catch(() => {});
    }
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

async function interactive(page) {
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^(로그아웃|로그인)$/.test(b.textContent.trim()) && !b.disabled));
}
async function open(page, path) {
  const res = await page.goto(`${base}${path}`);
  await interactive(page);
  return res;
}
async function login(user, { width = 1280, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`${base}/admin/login`);
  await interactive(page);
  await page.fill("#login-email", user.email);
  await page.fill("#login-password", user.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((url) => url.pathname !== "/admin/login");
  await interactive(page);
  return page;
}
const text = (page, sel) => page.locator(sel).first().innerText().then((t) => t.replace(/\s+/g, " ").trim());
const rowCell = (page, metric, name) => text(page, `table[data-metric="${metric}"] tr[data-row="${REGION}"] [data-cell="${name}"]`);

test("a) 비율마다 분자 / 분모 함께 — 자체 취재 2/2 · 근거 충족 1/2 · 지역 재방문 1/2(30일째 포함·31일째 제외) · 이동 1/2(봇·편집국 세션 제외)", async () => {
  const page = await login(u.admin);
  const res = await open(page, URL_TAB());
  assert.equal(res.status(), 200);
  assert.equal(await page.locator('nav[aria-label="지표 탭"] a[aria-current="page"]').innerText(), "지역");
  assert.match(await rowCell(page, "region-metrics", "own"), /^2 \/ 2 \(100%\)$/);
  assert.match(await rowCell(page, "region-metrics", "evidence"), /^1 \/ 2 \(50%\)$/);
  assert.match(await rowCell(page, "region-metrics", "returned"), /^1 \/ 2 \(50%\)/);
  assert.match(await rowCell(page, "region-metrics", "moved"), /^1 \/ 2 \(50%\)$/);
  // 정의 글자에 분모·분자·제외 조건
  const defs = await page.locator('[data-part="definition"]').allInnerTexts();
  assert.equal(defs.length, 4);
  assert.ok(defs.some((t) => /31일째는 넣지 않음/.test(t)), "region_returned 정의에 31일째 제외");
  // 전체 탭 링크
  assert.equal(await page.locator('nav[aria-label="지표 탭"] a', { hasText: "전체" }).getAttribute("href"), "/admin/metrics");
});

test("b) 편집비 빈 달 '편집비 미입력' → 입력 API(사유 필수·음수·없는 지역 422·같은 금액 unchanged·감사) → 금액과 취재 1건당 편집비", async () => {
  const page = await login(u.admin);
  await open(page, URL_TAB());
  const row = `table[data-metric="region-costs"] tr[data-row="${REGION}"]`;
  assert.equal(await page.locator(row).getAttribute("data-cost-state"), "missing");
  assert.equal(await text(page, `${row} [data-cell="cost"]`), "편집비 미입력");
  assert.equal(await text(page, `${row} [data-cell="per-article"]`), "편집비 미입력");
  assert.doesNotMatch(await text(page, `${row} [data-cell="cost"]`), /0원/);

  const month = monthOf(D1);
  const good = { regionCode: REGION, month, amountKrw: 1200000, reason: "시험용 가상 금액 입력" };
  assert.equal((await api("POST", "/region-costs", u.admin, { ...good, reason: "" })).status, 422);
  assert.equal((await api("POST", "/region-costs", u.admin, { ...good, amountKrw: -1 })).status, 422);
  assert.equal((await api("POST", "/region-costs", u.admin, { ...good, month: `${month}-15` })).status, 422);
  assert.equal((await api("POST", "/region-costs", u.admin, { ...good, regionCode: "0000000000" })).status, 422);
  const first = await api("POST", "/region-costs", u.admin, good);
  assert.equal(first.status, 200);
  assert.equal(first.body.unchanged, false);
  assert.equal((await api("POST", "/region-costs", u.admin, good)).body.unchanged, true);

  await open(page, URL_TAB());
  assert.equal(await page.locator(row).getAttribute("data-cost-state"), "entered");
  assert.equal(await text(page, `${row} [data-cell="cost"]`), "1,200,000원");
  assert.equal(await text(page, `${row} [data-cell="per-article"]`), "1,200,000원 ÷ 2건 = 600,000원");

  // 금액 변경은 같은 줄을 고치고 전·후 금액·사유가 감사에 남는다
  assert.equal((await api("POST", "/region-costs", u.admin, { ...good, amountKrw: 1000000, reason: "시험용 금액 정정" })).status, 200);
  const { rows } = await db.query("select before, after, reason from public.audit_logs where action = 'region_cost.set' and actor = $1 order by id", [`user:${u.admin.id}`]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].before, null);
  assert.deepEqual(rows[1].before, { amountKrw: 1200000 });
  assert.deepEqual(rows[1].after, { amountKrw: 1000000 });
  assert.equal(rows[1].reason, "시험용 금액 정정");
  const count = await db.query("select count(*)::int n from public.region_editorial_costs where region_code = $1 and month = $2", [REGION, `${month}-01`]);
  assert.equal(count.rows[0].n, 1);

  // 입력 안 한 앞 달 — 지역 기사도 편집비도 없어 줄이 없고 '편집비 미입력' 문장
  await open(page, `${URL_TAB().replace(/month=[\d-]+/, `month=${shift(month, -3)}`)}`);
  assert.equal(await page.locator(`table[data-metric="region-costs"] tr[data-row="${REGION}"]`).count(), 0);
  assert.equal(await text(page, '[data-cell="cost-missing"]'), "편집비 미입력");
});

test("c) 화면 폼으로 다른 달 편집비 입력 → 표에 금액, 사유 없으면 오류", async () => {
  const page = await login(u.admin);
  const other = shift(monthOf(D1), -1);
  await open(page, URL_TAB().replace(/month=[\d-]+/, `month=${other}`));
  await page.selectOption("#region-cost-region", REGION);
  await page.fill("#region-cost-amount", "300000");
  await page.getByRole("button", { name: "편집비 저장" }).click();
  await page.locator('[id="region-cost-error"]').waitFor();
  await page.fill("#region-cost-reason", "시험용 화면 입력");
  await page.getByRole("button", { name: "편집비 저장" }).click();
  await page.waitForSelector(`table[data-metric="region-costs"] tr[data-row="${REGION}"] [data-cell="cost"]`);
  assert.equal(await text(page, `table[data-metric="region-costs"] tr[data-row="${REGION}"] [data-cell="cost"]`), "300,000원");
  assert.equal(await text(page, `table[data-metric="region-costs"] tr[data-row="${REGION}"] [data-cell="per-article"]`), "— (자체 취재 0건)");
});

test("d) 편집 책임자는 화면 403·입력 API 403, 로그인 안 하면 로그인 화면으로", async () => {
  const page = await login(u.editor);
  const res = await open(page, URL_TAB());
  assert.equal(res.status(), 403);
  assert.equal(await page.locator('[data-part="region-tab"]').count(), 0);
  assert.equal((await api("POST", "/region-costs", u.editor, { regionCode: REGION, month: monthOf(D1), amountKrw: 1, reason: "시험" })).status, 403);
  const anonymous = await fetch(`${base}/admin/metrics?tab=region`, { redirect: "manual" });
  assert.ok([302, 303, 307].includes(anonymous.status));
  assert.match(anonymous.headers.get("location") ?? "", /\/admin\/login/);
});

test("e) 360px — 가로 스크롤 0, 탭·달 이동·기간 링크 터치 44px", async () => {
  const page = await login(u.admin, { width: 360, height: 740 });
  await open(page, URL_TAB());
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, "가로 스크롤");
  const small = await page.$$eval('nav[aria-label="지표 탭"] a, nav[aria-label="편집비 달"] a, nav[aria-label="기간"] a', (els) => els.map((e) => e.getBoundingClientRect().height).filter((h) => h < 44));
  assert.deepEqual(small, []);
});
