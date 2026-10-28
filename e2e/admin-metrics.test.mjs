// 측정 지표 대시보드 E2E (W2-c 3단계 — GROW-01, docs/dev/W2-c_설계.md 8.3)
// standalone 빌드를 로컬 Supabase에 붙인다. 비어 있는 지난 주를 골라 측정 이벤트를 정해 넣고(지난 시각 — 수집 API를 거치지 않는 자료), 화면 숫자를 손 계산과 맞춘다.
//  a) 숫자 = 넣은 자료의 손 계산 — 분야별 유효 방문(기사 29초 0·31초 1 · 다른 분야 기사 0) · 재방문(30일째 포함·31일째 제외 · 방문자 ID 없는 세션 분모 0) ·
//     첫 방문 깔때기 · 봇·편집국 세션 0 · 한국 날짜 경계(끝날 다음 날 0시 정각 세션은 기간 밖)
//  b) 전환일을 설정 API로 적으면 그 날 앞은 '시험 기간', 그 날부터 '운영'으로 나뉘어 따로 센다
//  c) 새 브라우저 시나리오 — 홈 → 4대 분야 카드 → 기사(29초에 30초 열람 0 → 35초에 1) → 다음 행동 클릭: 오늘 깔때기 세 칸이 1씩, 지방세 유효 방문 +1
//  d) 다른 문서가 정하는 지표는 '수집 전'(숫자 0)
//  e) 역할 — 관리자만 200·메뉴 '측정 지표', 편집 책임자·기자·광고 담당은 403·메뉴 0, 로그인 안 하면 로그인 화면으로
//  f) 360px — 가로 스크롤 0, AI 도우미 런처 0
// 넣은 측정 이벤트는 끝나면 지우고(세션 번호로), 계정·기사·설정은 StaffFixture가 시험 전으로 되돌린다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e.example.test";
const ADMIN_EMAIL = "admin-metrics-e2e@example.test";
const HUMAN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const DAY = 86_400_000;

let sb, server, staff, db, browser, base;
const u = {};
const fx = {};
const contexts = [];
const sessions = [];
let D1; // 시험 주의 첫날 (한국 날짜)

const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const kst = (date, hms) => new Date(`${date}T${hms}+09:00`).toISOString();
const PROPS = {
  hub_viewed: {},
  article_viewed: { article_id: 1, format: "general", content_type: "explainer" },
  article_engaged: { article_id: 1, format: "general", content_type: "explainer" },
  home_entry_clicked: {},
  next_action_clicked: { action: "same_section", screen: "article" },
};

async function seedSession({ visitor = crypto.randomUUID(), firstVisit = false, bot = false, staff: isStaff = false, events }) {
  const sid = crypto.randomUUID();
  sessions.push(sid);
  for (const [name, date, hms, section = "tax"] of events) {
    await db.query(
      `insert into public.analytics_events (name, occurred_at, session_id, visitor_id, first_visit, stage, entry, section, props, is_bot, is_staff)
       values ($1, $2, $3, $4, $5, 1, 'direct', $6, $7, $8, $9)`,
      [name, kst(date, hms), sid, visitor, firstVisit, name === "next_action_clicked" ? null : section, JSON.stringify(PROPS[name]), bot, isStaff],
    );
  }
  return visitor;
}

/** 지난 날 가운데 앞뒤 40일 안에 측정 이벤트가 하나도 없는 주 (다른 시험 자료와 섞이지 않게) */
async function emptyWeek() {
  for (let i = 0; i < 20; i++) {
    const offset = 120 + Math.floor(Math.random() * 160);
    const day = new Date(Date.now() + 9 * 3_600_000 - offset * DAY).toISOString().slice(0, 10);
    const { rows } = await db.query("select count(*)::int n from public.analytics_events where occurred_at >= $1 and occurred_at < $2", [kst(addDays(day, -2), "00:00:00"), kst(addDays(day, 40), "00:00:00")]);
    if (rows[0].n === 0) return day;
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
  u.admin = await staff.createUser({ label: "metrics-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "metrics-editor", roles: ["editor"], person: { name: "측정 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "metrics-reporter", roles: ["reporter"], person: { name: "측정 시험 기자", roles: ["reporter"] } });
  u.adOps = await staff.createUser({ label: "metrics-ad", roles: ["ad_ops"] });
  await db.query("update public.settings set value = $1::jsonb where key = 'domain_cutover'", [JSON.stringify({ version: "e2e-1", date: null })]);

  // 시나리오 기사 (지방세 · 공개) — 다음 행동 띠의 [같은 분야 더 보기]가 열린다
  const { rows } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, body, first_published_at)
     values ($1, $2, '측정 시나리오 기사입니다', 'tax', 'explainer', 'published', $3, $4, now() - interval '1 day') returning id, slug`,
    [`e2e-metrics-${staff.run}`, `측정 시나리오 기사 ${staff.run}`, u.reporter.personId, JSON.stringify({ blocks: [{ type: "paragraph", text: "본문 문장입니다." }], claims: [] })],
  );
  fx.article = { id: Number(rows[0].id), href: `/news/${rows[0].slug}` };
  staff.trackArticle(fx.article.id);

  // ── 지난 주 자료 (손 계산은 시험 a·b) ──
  D1 = await emptyWeek();
  const d = (n) => addDays(D1, n);
  const v1 = await seedSession({
    firstVisit: true,
    events: [
      ["home_entry_clicked", d(0), "10:00:00"],
      ["hub_viewed", d(0), "10:00:05"],
      ["article_viewed", d(0), "10:01:00"],
      ["article_engaged", d(0), "10:01:31"],
      ["next_action_clicked", d(0), "10:02:00"],
    ],
  });
  const v2 = await seedSession({ events: [["hub_viewed", d(0), "23:59:00"], ["article_viewed", d(0), "23:59:59"]] }); // 29초 — 30초 열람 이벤트 0
  const v3 = await seedSession({ events: [["hub_viewed", d(2), "12:00:00", "finance"], ["article_engaged", d(2), "12:01:00", "realestate"]] });
  await seedSession({ bot: true, firstVisit: true, events: [["hub_viewed", d(0), "14:00:00"], ["article_engaged", d(0), "14:01:00"]] });
  await seedSession({ staff: true, events: [["hub_viewed", d(0), "15:00:00"], ["article_engaged", d(0), "15:01:00"]] });
  await seedSession({ visitor: null, events: [["hub_viewed", d(1), "09:00:00", "local"]] });
  await seedSession({ events: [["hub_viewed", d(7), "00:00:00"]] }); // 끝날 다음 날 0시 정각 — 기간 밖
  await seedSession({ visitor: v1, events: [["article_viewed", d(30), "23:00:00"]] }); // 30일째 — 포함
  await seedSession({ visitor: v2, events: [["hub_viewed", d(31), "00:00:00"]] }); // 31일째 — 제외
  await seedSession({ visitor: v3, events: [["hub_viewed", d(10), "08:00:00", "finance"]] });
  browser = await chromium.launch();
});

after(async () => {
  try {
    for (const c of contexts) await c.close().catch(() => {});
    await browser?.close();
    if (db && sessions.length) await db.query("delete from public.analytics_events where session_id = any($1::uuid[])", [sessions]);
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

// ── 도우미 ─────────────────────────────────────────────

async function interactive(page) {
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^(로그아웃|로그인)$/.test(b.textContent.trim()) && !b.disabled));
}

async function open(page, path) {
  const res = await page.goto(`${base}${path}`);
  await interactive(page);
  assert.equal(await page.locator('[data-ui="assistant-launcher"]').count(), 0, `${path}: AI 도우미 런처가 있다`);
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

const menuLabels = (page) => page.locator('nav[aria-label="편집국 메뉴"] a').allInnerTexts();
const week = () => `/admin/metrics?period=custom&from=${D1}&to=${addDays(D1, 6)}`;

/** 화면의 숫자 칸 — 구간 · 지표 · 줄 · 칸 */
async function cell(page, segment, metric, row, name) {
  const sel = `[data-segment="${segment}"] [data-metric="${metric}"]${row === null ? "" : ` [data-row="${row}"]`} [data-cell="${name}"]`;
  return (await page.locator(sel).innerText()).trim();
}
async function table(page, segment, metric, rows, names) {
  const out = {};
  for (const r of rows) {
    out[r] = [];
    for (const n of names) out[r].push(await cell(page, segment, metric, r, n));
  }
  return out;
}
const exclusions = async (page, segment) =>
  Promise.all(["sessions", "bot", "staff"].map(async (n) => (await page.locator(`[data-segment="${segment}"] [data-part="exclusions"] [data-cell="${n}"]`).innerText()).trim()));

// ── a) 숫자 = 손 계산 ───────────────────────────────────

test("a) 지난 주 자료 — 유효 방문(29초 0·31초 1·다른 분야 0) · 재방문(30일째 포함·31일째 제외·방문자 ID 없는 세션 0) · 깔때기 · 봇·편집국 0 · 날짜 경계", async () => {
  const page = await login(u.admin);
  assert.equal((await open(page, week())).status(), 200);
  assert.deepEqual(await page.locator("[data-segment]").evaluateAll((els) => els.map((e) => e.getAttribute("data-segment"))), ["trial"], "전환일 없음 — 모두 시험 기간");
  assert.match(await page.locator('[data-part="period"]').innerText(), new RegExp(`${D1} ~ ${addDays(D1, 6)} \\(7일, 한국 날짜\\)`));
  assert.deepEqual(await exclusions(page, "trial"), ["6", "1", "1"], "구간에 시작한 세션 6 — 봇 1·편집국 1 (끝날 다음 날 0시 세션은 기간 밖)");
  assert.deepEqual(await table(page, "trial", "valid-visits", ["tax", "realestate", "finance", "local", "total"], ["denominator", "numerator", "rate"]), {
    tax: ["2", "1", "50%"],
    realestate: ["0", "0", "—"],
    finance: ["1", "0", "0%"],
    local: ["1", "0", "0%"],
    total: ["4", "1", "25%"],
  });
  assert.deepEqual(await table(page, "trial", "revisits", ["tax", "finance", "local", "total"], ["visitors", "revisited", "rate", "pending"]), {
    tax: ["2", "1", "50%", "0"],
    finance: ["1", "1", "100%", "0"],
    local: ["0", "0", "—", "0"],
    total: ["3", "2", "66.7%", "0"],
  });
  assert.equal((await page.locator('[data-segment="trial"] [data-cell="without-visitor"]').innerText()).trim(), "1");
  assert.deepEqual(await table(page, "trial", "funnel", ["1", "2", "3"], ["count", "from-previous", "from-first"]), {
    1: ["1", "—", "—"],
    2: ["1", "100%", "100%"],
    3: ["1", "100%", "100%"],
  });
  assert.deepEqual(await Promise.all(["numerator", "denominator", "rate"].map((n) => cell(page, "trial", "solved", null, n))), ["1", "1", "100%"]);
  // 지표마다 정의(분모·분자·제외 조건·소유 ID)가 숫자 아래에 있다
  const defs = await page.locator('[data-segment="trial"] [data-part="definition"]').allInnerTexts();
  assert.equal(defs.length, 4);
  for (const d of defs) for (const word of ["분모", "분자", "제외", "소유", "GROW-01", "봇·편집국·관리자"]) assert.ok(d.includes(word), `정의에 '${word}': ${d.slice(0, 80)}`);
});

// ── b) 전환일 ────────────────────────────────────────────

test("b) 전환일을 설정 API로 적으면 시험 기간(앞날까지)·운영(그날부터)을 따로 센다 — 다시 비우면 하나", async () => {
  const cutover = addDays(D1, 2);
  const set = await api("PATCH", "/settings/domain_cutover", u.admin, { value: { version: "e2e-2", date: cutover } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  const sameVersion = await api("PATCH", "/settings/domain_cutover", u.admin, { value: { version: "e2e-2", date: addDays(D1, 3) } });
  assert.equal(sameVersion.status, 422, "날짜만 바꾸고 버전을 그대로 두면 거부");
  const page = await login(u.admin);
  await open(page, week());
  assert.deepEqual(await page.locator("[data-segment]").evaluateAll((els) => els.map((e) => e.getAttribute("data-segment"))), ["trial", "live"]);
  assert.equal(await page.locator('[data-part="cutover"]').getAttribute("data-cutover"), cutover);
  assert.deepEqual(await exclusions(page, "trial"), ["5", "1", "1"]);
  assert.deepEqual(await exclusions(page, "live"), ["1", "0", "0"]);
  assert.deepEqual(await table(page, "trial", "valid-visits", ["total"], ["denominator", "numerator"]), { total: ["3", "1"] });
  assert.deepEqual(await table(page, "live", "valid-visits", ["finance"], ["denominator", "numerator"]), { finance: ["1", "0"] });
  assert.deepEqual(await table(page, "live", "revisits", ["finance"], ["visitors", "revisited"]), { finance: ["1", "1"] });
  // 전환일이 있으면 기간 고르기에 '전환 후 첫 4주 (기준선)'
  assert.equal(await page.getByRole("link", { name: "전환 후 첫 4주 (기준선)" }).count(), 1);
  const back = await api("PATCH", "/settings/domain_cutover", u.admin, { value: { version: "e2e-3", date: null } });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  await open(page, week());
  assert.equal(await page.locator("[data-segment]").count(), 1);
  assert.equal(await page.getByRole("link", { name: "전환 후 첫 4주 (기준선)" }).count(), 0);
});

// ── c) 새 브라우저 시나리오 ─────────────────────────────

async function todayNumbers(page) {
  await open(page, "/admin/metrics?period=7");
  const funnel = await table(page, "trial", "funnel", ["1", "2", "3"], ["count"]);
  const tax = await table(page, "trial", "valid-visits", ["tax"], ["denominator", "numerator"]);
  return { funnel: [funnel[1][0], funnel[2][0], funnel[3][0]].map(Number), tax: tax.tax.map(Number), solved: Number(await cell(page, "trial", "solved", null, "numerator")) };
}

test("c) 새 브라우저 — 홈 → 4대 분야 카드 → 기사 29초(30초 열람 0)·35초(1) → 다음 행동 클릭 → 깔때기 세 칸이 1씩, 지방세 유효 방문 +1 (PRD 수용 기준)", async () => {
  const admin = await login(u.admin);
  const before = await todayNumbers(admin);

  const context = await browser.newContext({ userAgent: HUMAN_UA, viewport: { width: 1280, height: 900 } });
  contexts.push(context);
  const sent = [];
  const answered = [];
  context.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/events") sent.push(JSON.parse(r.postData() ?? "{}").name);
  });
  context.on("response", (r) => {
    if (new URL(r.url()).pathname === "/api/events") answered.push(r.status());
  });
  const settled = async (n) => {
    const end = Date.now() + 15_000;
    while (answered.length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    assert.ok(answered.length >= n, `/api/events 응답 ${answered.length}/${n}: ${sent}`);
  };
  const page = await context.newPage();
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.locator('[data-ui="field-cards"] a[href="/tax"]').click();
  await page.locator('[data-ui="hub"][data-hub="tax"]').waitFor();
  await settled(2);
  await page.clock.install();
  await page.goto(`${base}${fx.article.href}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-ui="next-action-band"]').waitFor();
  await settled(3);
  await page.clock.fastForward(29_000);
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(!sent.includes("article_engaged"), `29초 — 30초 열람 이벤트 0 (${sent})`);
  await page.clock.fastForward(6_000);
  await settled(4);
  assert.equal(sent.at(-1), "article_engaged", "35초 — 30초 열람 1건");
  await page.locator('[data-ui="next-action-band"] [data-next-action] a').first().click();
  await settled(5);
  // 다음 행동 [같은 분야 더 보기]가 지방세 허브로 화면을 바꾸면 허브 열람이 한 번 더 온다(같은 세션 — 숫자에 영향 0)
  assert.deepEqual(sent.slice(0, 5), ["home_entry_clicked", "hub_viewed", "article_viewed", "article_engaged", "next_action_clicked"]);
  assert.ok(answered.every((s) => s === 202), `모두 저장: ${answered}`);
  const vid = (await context.cookies()).find((c) => c.name === "ltr_vid").value;
  const { rows } = await db.query("select name, first_visit, is_bot, is_staff, session_id, props from public.analytics_events where visitor_id = $1 order by id", [vid]);
  assert.ok(rows.every((r) => r.first_visit && !r.is_bot && !r.is_staff), "새 브라우저 — 첫 방문 · 사람");
  assert.equal(new Set(rows.map((r) => r.session_id)).size, 1, "한 세션");
  assert.deepEqual(rows.find((r) => r.name === "next_action_clicked").props, { action: "same_section", screen: "article" });
  await page.waitForLoadState("networkidle");

  const after = await todayNumbers(admin);
  assert.deepEqual(after.funnel, before.funnel.map((n) => n + 1), `깔때기 세 칸 +1: ${before.funnel} → ${after.funnel}`);
  assert.equal(after.solved, before.solved + 1, "첫 방문 문제해결 +1");
  assert.deepEqual(after.tax, [before.tax[0] + 1, before.tax[1] + 1], "지방세 허브 → 기사 35초 — 유효 방문 분모·분자 +1");
});

// ── d) 수집 전 ───────────────────────────────────────────

test("d) 다른 문서가 정하는 지표 — '수집 전'·'2단계부터' 글자뿐(숫자 0), 소유 ID", async () => {
  const page = await login(u.admin);
  await open(page, week());
  const rows = await page.locator('[data-metric="other"] [data-row]').evaluateAll((els) =>
    els.map((e) => [e.getAttribute("data-row"), e.querySelector('[data-cell="status"]').textContent.trim()]),
  );
  assert.deepEqual(rows, [
    ["tax-link", "수집 전"],
    ["assistant", "수집 전"],
    ["experts", "수집 전"],
    ["conversion", "수집 전"],
    ["contribution", "2단계부터"],
    ["ai-search", "수집 전"],
    ["readiness", "수집 전"],
  ]);
  const text = await page.locator('[data-metric="other"]').innerText();
  for (const owner of ["01B CORE-03", "01C CHAT-13", "01C EXPL-09", "01C BIZ-09", "OPT-09", "NAV-17"]) assert.ok(text.includes(owner), owner);
  assert.equal(await page.locator('[data-metric="other"] [data-cell]:not([data-cell="status"])').count(), 0, "숫자 칸 0");
});

// ── e) 역할 ──────────────────────────────────────────────

test("e) 관리자만 — 편집 책임자·기자·광고 담당은 403과 메뉴 0, 관리자는 메뉴 '측정 지표', 로그인 안 하면 로그인 화면", async () => {
  for (const user of [u.editor, u.reporter, u.adOps]) {
    const page = await login(user);
    assert.ok(!(await menuLabels(page)).includes("측정 지표"), `${user.email} 메뉴에 측정 지표`);
    const res = await open(page, "/admin/metrics");
    assert.equal(res.status(), 403, user.email);
    await page.getByRole("heading", { name: "이 화면을 쓸 권한이 없습니다" }).waitFor();
    assert.equal(await page.locator("[data-segment]").count(), 0, "숫자 0");
  }
  const admin = await login(u.admin);
  assert.ok((await menuLabels(admin)).includes("측정 지표"));
  await admin.locator('nav[aria-label="편집국 메뉴"] button[data-group]', { hasText: "운영·설정" }).click();
  await admin.locator('nav[aria-label="편집국 메뉴"] a', { hasText: "측정 지표" }).click();
  await admin.waitForURL(`${base}/admin/metrics`);
  assert.equal(await admin.locator('nav[aria-label="편집국 메뉴"] a[aria-current="page"]').innerText(), "측정 지표");
  const anonymous = await fetch(`${base}/admin/metrics`, { redirect: "manual" });
  assert.ok([302, 303, 307].includes(anonymous.status), `로그인 안 함: ${anonymous.status}`);
  assert.match(anonymous.headers.get("location") ?? "", /\/admin\/login/);
});

// ── f) 360px ─────────────────────────────────────────────

test("f) 360px — 가로 스크롤 0 (기간 고르기·표·정의), 직접 고른 기간이 틀리면 이유와 최근 30일", async () => {
  const page = await login(u.admin, { width: 360, height: 740 });
  for (const path of [week(), "/admin/metrics?period=custom&from=2026-03-08&to=2026-03-02"]) {
    await open(page, path);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${path}: 가로 스크롤`);
  }
  assert.match(await page.locator('[data-part="period-error"]').innerText(), /시작일이 끝날보다 늦습니다 — 최근 30일을 보입니다/);
  const small = await page.$$eval('nav[aria-label="기간"] a, form[aria-label="기간 직접 고르기"] button', (els) => els.map((e) => e.getBoundingClientRect().height).filter((h) => h < 44));
  assert.deepEqual(small, [], "기간 고르기 터치 44px");
});
