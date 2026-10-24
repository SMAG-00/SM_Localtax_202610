// 측정 기반 E2E (W2-c 1단계 — FND-06 · GROW-01 · ART-11, docs/dev/W2-c_설계.md 4·5·6장). standalone 빌드를 로컬 Supabase에 붙인다.
//  a) 정상 이벤트 → 202 · PRD 칸으로 저장 · User-Agent·IP·리퍼러 글자 0 · 방문자 쿠키(HttpOnly)
//  b) 세션 경계 — 29분 뒤 같은 세션 · 31분 뒤 새 세션(first_visit=false)
//  c) 봇 User-Agent·빈 User-Agent → is_bot=true로 저장 (원문 0)
//  d) 측정 거부 쿠키 · GPC(Sec-GPC: 1) → 204 · 저장 0 · 방문자 ID 0 · 남은 쿠키 지움
//  e) 측정 거부 화면·API — 폼 303·거부 쿠키·다른 사이트 403
//  f) 잘못된 입력(형식·크기·다른 사이트·모르는 칸·개인정보 모양 경로) → 4xx · 저장 0 · 500 0
//  g) 속도 제한 → 429 + retry-after
//  h) 편집국 로그인 세션 → is_staff=true
//  i) 칸 검사 — analytics_events 칸 = PRD 14칸, 개인정보·원문 모양 칸 0
//  j) 브라우저 — 기사·허브 열람·홈 분야 카드가 이벤트로 저장(같은 방문자·세션), GPC·측정 거부면 /api/events 요청 0, 자동화 브라우저는 봇
// 시험이 만든 측정 행·계정·기사는 끝나면 지운다 (StaffFixture 정리 — 시작 시각 뒤의 측정 행).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e.example.test";
const ADMIN_EMAIL = "analytics-e2e@example.test";
const HUMAN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const HEADLESS_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36";
const FAKE_IP = "203.0.113.77";
const PRD_COLUMNS = ["id", "name", "occurred_at", "session_id", "visitor_id", "first_visit", "stage", "mode", "tier", "entry", "section", "props", "is_bot", "is_staff"];
const ARTICLE_EVENT = (id) => ({ name: "article_viewed", section: "tax", props: { article_id: id, format: "general", content_type: "explainer" } });

let sb, server, base, staff, db, browser;
const fx = {};

/** Set-Cookie 줄 → { 이름: { value, attrs(소문자) } } */
function setCookies(res) {
  const out = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair, ...attrs] = line.split(";").map((s) => s.trim());
    const i = pair.indexOf("=");
    out[pair.slice(0, i)] = { value: pair.slice(i + 1), attrs: attrs.map((a) => a.toLowerCase()) };
  }
  return out;
}

async function send(body, { headers = {}, cookie } = {}) {
  const res = await fetch(`${base}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": HUMAN_UA, origin: base, "sec-fetch-site": "same-origin", ...(cookie ? { cookie } : {}), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, set: setCookies(res), body: text ? JSON.parse(text) : null, headers: res.headers };
}

const since = () => fx.startedAt;
const countEvents = async () => Number((await db.query("select count(*)::int n from public.analytics_events where occurred_at >= $1", [since()])).rows[0].n);
const rowsOfSession = async (sid) => (await db.query("select * from public.analytics_events where session_id = $1 order by id", [sid])).rows;

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
  fx.startedAt = staff.startedAt;
  await staff.removeLeftover(ADMIN_EMAIL);
  fx.editor = await staff.createUser({ label: "an-editor", roles: ["editor"], person: { name: "측정 시험 편집자", roles: ["editor"] } });
  fx.reporter = await staff.createUser({ label: "an-reporter", roles: ["reporter"], person: { name: "측정 시험 기자", roles: ["reporter"] } });
  const { rows } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, body, first_published_at)
     values ($1, '측정 시험 기사 — 취득세 신고 기한', '무엇이 바뀌었는지 정리했습니다', 'tax', 'explainer', 'published', $2, $3, now() - interval '1 day') returning id, slug`,
    [`e2e-analytics-${staff.run}`, fx.reporter.personId, JSON.stringify({ blocks: [{ type: "paragraph", text: "본문 문장입니다." }], claims: [] })],
  );
  fx.article = { id: Number(rows[0].id), href: `/news/${rows[0].slug}` };
  staff.trackArticle(fx.article.id);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await staff?.cleanup();
  server?.stop();
});

// ── a) 정상 이벤트 ──────────────────────────────────────

test("a) 정상 이벤트 → 202, PRD 칸으로 저장 — User-Agent·IP·리퍼러 글자 0, 방문자·세션 쿠키는 HttpOnly·SameSite=Lax", async () => {
  const r = await send({ ...ARTICLE_EVENT(fx.article.id), referrer: "www.google.com" }, { headers: { "x-forwarded-for": FAKE_IP } });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(r.headers.get("cache-control"), "no-store");
  const vid = r.set.ltr_vid;
  const sid = r.set.ltr_sid;
  assert.ok(vid && sid, "방문자·세션 쿠키");
  for (const c of [vid, sid]) {
    assert.ok(c.attrs.includes("httponly") && c.attrs.includes("samesite=lax") && c.attrs.includes("path=/"), JSON.stringify(c));
    assert.ok(!c.attrs.includes("secure"), "http 시험 서버 — Secure 없음");
  }
  assert.ok(vid.attrs.includes(`max-age=${365 * 86400}`), "방문자 ID 365일 (설정)");
  assert.ok(sid.attrs.includes("max-age=1800"), "세션 30분 (설정)");
  const rows = await rowsOfSession(sid.value.slice(0, 36));
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.deepEqual(Object.keys(row), PRD_COLUMNS);
  assert.equal(row.visitor_id, vid.value);
  assert.deepEqual(
    { name: row.name, first_visit: row.first_visit, stage: row.stage, mode: row.mode, tier: row.tier, entry: row.entry, section: row.section, is_bot: row.is_bot, is_staff: row.is_staff },
    { name: "article_viewed", first_visit: true, stage: 1, mode: "general", tier: "guest", entry: "search", section: "tax", is_bot: false, is_staff: false },
  );
  assert.deepEqual(row.props, { article_id: fx.article.id, format: "general", content_type: "explainer" });
  assert.ok(Math.abs(row.occurred_at.getTime() - Date.now()) < 60_000, "서버 시각");
  const text = JSON.stringify(row);
  for (const leak of [HUMAN_UA, "Chrome/", FAKE_IP, "google"]) assert.ok(!text.includes(leak), `저장된 행에 '${leak}' 0`);
  fx.visit = { vid: vid.value, sid: sid.value.slice(0, 36) };
});

// ── b) 세션 경계 ─────────────────────────────────────────

test("b) 세션 경계 — 마지막 활동 29분 전이면 같은 세션(first_visit 그대로), 31분 전이면 새 세션·first_visit=false (GROW-01)", async () => {
  const sessionCookie = (minutesAgo) => `ltr_vid=${fx.visit.vid}; ltr_sid=${fx.visit.sid}.${Date.now() - minutesAgo * 60_000}.1.search`;
  const same = await send({ name: "hub_viewed", section: "tax" }, { cookie: sessionCookie(29) });
  assert.equal(same.status, 202);
  assert.equal(same.set.ltr_vid, undefined, "방문자 쿠키는 다시 쓰지 않는다");
  assert.ok(same.set.ltr_sid.value.startsWith(`${fx.visit.sid}.`), "같은 세션 ID");
  const sameRows = await rowsOfSession(fx.visit.sid);
  assert.deepEqual(sameRows.map((r) => [r.name, r.first_visit, r.entry]), [["article_viewed", true, "search"], ["hub_viewed", true, "search"]]);

  const fresh = await send({ name: "hub_viewed", section: "tax" }, { cookie: sessionCookie(31) });
  assert.equal(fresh.status, 202);
  const newSid = fresh.set.ltr_sid.value.slice(0, 36);
  assert.notEqual(newSid, fx.visit.sid);
  const [row] = await rowsOfSession(newSid);
  assert.equal(row.visitor_id, fx.visit.vid, "같은 방문자");
  assert.equal(row.first_visit, false, "31분 뒤 새 세션은 첫 방문이 아니다");
  assert.equal(row.entry, "direct");
});

// ── c) 봇 ───────────────────────────────────────────────

test("c) 봇 User-Agent(Googlebot·네이버 Yeti·HeadlessChrome)·빈 User-Agent → is_bot=true로 저장, 원문 0", async () => {
  const bots = ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)", HEADLESS_UA, ""];
  for (const ua of bots) {
    const r = await send(ARTICLE_EVENT(fx.article.id), { headers: { "user-agent": ua } });
    assert.equal(r.status, 202, ua);
    const [row] = await rowsOfSession(r.set.ltr_sid.value.slice(0, 36));
    assert.equal(row.is_bot, true, `봇: '${ua}'`);
    if (ua) assert.ok(!JSON.stringify(row).includes(ua.slice(0, 20)), "User-Agent 원문 0");
  }
});

// ── d) 측정 거부·GPC ─────────────────────────────────────

test("d) 측정 거부 쿠키 → 204, 저장 0, 방문자 ID를 만들지 않고 남은 방문자·세션 쿠키를 지운다", async () => {
  const before = await countEvents();
  const r = await send(ARTICLE_EVENT(fx.article.id), { cookie: `ltr_optout=1; ltr_vid=${fx.visit.vid}; ltr_sid=${fx.visit.sid}.${Date.now()}.1.search` });
  assert.equal(r.status, 204);
  assert.equal(r.body, null);
  assert.equal(r.set.ltr_vid?.value, "", "방문자 쿠키 지움");
  assert.ok(r.set.ltr_vid.attrs.includes("max-age=0"));
  assert.equal(r.set.ltr_sid?.value, "");
  assert.equal(await countEvents(), before, "저장 0");
});

test("d) GPC(Sec-GPC: 1) → 204, 저장 0, 방문자 쿠키 0 — 틀린 본문이어도 보지 않는다", async () => {
  const before = await countEvents();
  for (const body of [ARTICLE_EVENT(fx.article.id), "not json"]) {
    const r = await send(body, { headers: { "sec-gpc": "1" } });
    assert.equal(r.status, 204);
    assert.deepEqual(Object.keys(r.set), [], "쿠키 0");
  }
  assert.equal(await countEvents(), before);
});

// ── e) 측정 거부 화면·API ────────────────────────────────

test("e) 측정 거부 API — 폼 거부는 303 + 거부 쿠키(스크립트가 읽는다, 400일) + 방문자 쿠키 지움, 허용은 거부 쿠키 지움, 다른 사이트 403·형식 415·값 400", async () => {
  const form = (choice, headers = {}) =>
    fetch(`${base}/api/measurement`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: base, ...headers }, body: `choice=${choice}` });
  const refuse = await form("refuse");
  assert.equal(refuse.status, 303);
  assert.equal(refuse.headers.get("location"), "/about/measurement?done=refuse");
  const set = setCookies(refuse);
  assert.equal(set.ltr_optout.value, "1");
  assert.ok(!set.ltr_optout.attrs.includes("httponly"), "브라우저 도우미가 읽는다");
  assert.ok(set.ltr_optout.attrs.includes(`max-age=${400 * 86400}`));
  assert.equal(set.ltr_vid.value, "");
  const allow = await form("allow");
  assert.equal(allow.status, 303);
  assert.deepEqual(Object.keys(setCookies(allow)), ["ltr_optout"]);
  assert.ok(setCookies(allow).ltr_optout.attrs.includes("max-age=0"));

  const cross = await form("allow", { origin: "https://evil.example" });
  assert.equal(cross.status, 403, "다른 사이트가 남의 거부를 풀지 못한다");
  assert.deepEqual(cross.headers.getSetCookie(), []);
  const json = await fetch(`${base}/api/measurement`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: '{"choice":"refuse"}' });
  assert.equal(json.status, 200);
  assert.deepEqual(await json.json(), { choice: "refuse" });
  assert.equal((await fetch(`${base}/api/measurement`, { method: "POST", headers: { "content-type": "text/plain" }, body: "choice=refuse" })).status, 415);
  assert.equal((await form("maybe")).status, 400);
});

test("e) 측정 거부 화면 — 지금 상태와 반대 버튼 하나, GPC 신호면 'GPC 신호를 받아'", async () => {
  const html = async (headers) => (await fetch(`${base}/about/measurement`, { headers })).text();
  assert.match(await html({}), /data-state="measuring"[\s\S]*방문 통계 수집 거부/);
  assert.match(await html({ cookie: "ltr_optout=1" }), /data-state="refused"[\s\S]*다시 허용/);
  assert.match(await html({ "sec-gpc": "1" }), /data-state="gpc"[\s\S]*GPC 신호를 받아/);
});

// ── f) 잘못된 입력 ──────────────────────────────────────

test("f) 잘못된 입력은 4xx이고 저장 0·쿠키 0 — 500 0", async () => {
  const before = await countEvents();
  const cases = [
    ["본문 형식 text/plain", JSON.stringify(ARTICLE_EVENT(fx.article.id)), { "content-type": "text/plain" }, 415],
    ["JSON 아님", "{name:", {}, 400],
    ["없는 이벤트 이름", { name: "page_view", section: "tax" }, {}, 400],
    ["필수 속성 빠짐", { name: "article_viewed", section: "tax", props: { article_id: fx.article.id } }, {}, 400],
    ["모르는 속성(검색어 원문)", { ...ARTICLE_EVENT(fx.article.id), props: { ...ARTICLE_EVENT(fx.article.id).props, query: "취득세 계산" } }, {}, 400],
    ["모르는 맨 위 칸(브라우저 시각)", { ...ARTICLE_EVENT(fx.article.id), occurred_at: "2020-01-01T00:00:00Z" }, {}, 400],
    ["경로에 이메일 모양", { name: "not_found_viewed", props: { path: "/u/hong%40example.com" } }, {}, 400],
    ["경로에 쿼리", { name: "not_found_viewed", props: { path: "/search?q=취득세" } }, {}, 400],
    ["크기 초과(5KB)", JSON.stringify({ ...ARTICLE_EVENT(fx.article.id), pad: "x".repeat(5000) }), {}, 413],
    ["다른 사이트 Origin", ARTICLE_EVENT(fx.article.id), { origin: "https://evil.example", "sec-fetch-site": "cross-site" }, 403],
    ["Sec-Fetch-Site cross-site", ARTICLE_EVENT(fx.article.id), { "sec-fetch-site": "cross-site" }, 403],
  ];
  for (const [label, body, headers, status] of cases) {
    const r = await send(body, { headers });
    assert.equal(r.status, status, `${label}: ${JSON.stringify(r.body)}`);
    assert.deepEqual(Object.keys(r.set), [], `${label}: 쿠키 0`);
  }
  const bad = await send({ ...ARTICLE_EVENT(fx.article.id), props: { ...ARTICLE_EVENT(fx.article.id).props, query: "취득세 계산" } });
  assert.deepEqual(bad.body, { error: "이벤트 형식이 맞지 않습니다", errors: ["props.query: 이 이벤트가 받지 않는 칸입니다"] });
  assert.equal((await fetch(`${base}/api/events`)).status, 405, "GET은 없다");
  assert.equal(await countEvents(), before, "잘못된 입력은 저장 0");
});

// ── g) 속도 제한 ────────────────────────────────────────

test("g) 같은 방문자가 1분 상한(120)을 넘겨 보내면 429 + retry-after, 저장은 상한 근처까지만 — 5xx 0", async () => {
  const first = await send({ name: "hub_viewed", section: "finance" });
  assert.equal(first.status, 202);
  const cookie = `ltr_vid=${first.set.ltr_vid.value}`;
  const vid = first.set.ltr_vid.value;
  const statuses = [];
  const t0 = Date.now();
  for (let i = 0; i < 15; i++) {
    const batch = await Promise.all(Array.from({ length: 10 }, () => send({ name: "hub_viewed", section: "finance" }, { cookie })));
    statuses.push(...batch.map((r) => r.status));
    const limited = batch.find((r) => r.status === 429);
    if (limited) fx.retryAfter = limited.headers.get("retry-after");
  }
  const elapsed = (Date.now() - t0) / 1000;
  assert.deepEqual([...new Set(statuses)].sort(), [202, 429], "202와 429만");
  assert.match(fx.retryAfter ?? "", /^[1-9]\d*$/, "retry-after 초");
  const stored = Number((await db.query("select count(*)::int n from public.analytics_events where visitor_id = $1", [vid])).rows[0].n);
  assert.ok(stored <= 1 + 120 + Math.ceil(elapsed * 2) + 1, `저장 ${stored}건 (${elapsed}s)`);
  assert.ok(statuses.filter((s) => s === 429).length >= 150 - 120 - Math.ceil(elapsed * 2) - 1);
});

// ── h) 편집국 ───────────────────────────────────────────

test("h) 편집국 로그인 세션의 이벤트는 is_staff=true (집계에서 뺀다 — GROW-01)", async () => {
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email: fx.editor.email, password: fx.editor.password }),
  });
  assert.equal(login.status, 200);
  const auth = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => c.startsWith("sb-"))
    .join("; ");
  assert.ok(auth, "로그인 쿠키");
  const r = await send(ARTICLE_EVENT(fx.article.id), { cookie: auth });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  const [row] = await rowsOfSession(r.set.ltr_sid.value.slice(0, 36));
  assert.equal(row.is_staff, true);
  assert.equal(row.is_bot, false);
  assert.ok(!JSON.stringify(row).includes(fx.editor.id), "회원 ID 0");
});

// ── i) 칸 검사 ──────────────────────────────────────────

test("i) analytics_events 칸 = PRD-01A 6.1 14칸, IP·User-Agent·이메일·주소·좌표·검색어·질문·계산 입력값·회원 ID 모양 칸 0 (FND-06)", async () => {
  const { rows } = await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'analytics_events' order by ordinal_position");
  const cols = rows.map((r) => r.column_name);
  assert.deepEqual(cols, PRD_COLUMNS);
  const forbidden = /(^|_)(ip|ua|user_agent|agent|email|phone|address|addr|lat|lng|coord|geo|location|query|keyword|search_term|question|prompt|answer|input|amount|user|user_id|member|profile|referrer|url)(_|$)/;
  assert.deepEqual(cols.filter((c) => forbidden.test(c)), []);
  const { rows: events } = await db.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'events'");
  assert.equal(events[0].n, 0, "events 이름 표 0");
});

// ── j) 브라우저 ─────────────────────────────────────────

/** 브라우저 창 하나 — /api/events 요청·응답을 기록한다 */
async function openContext(options = {}) {
  const context = await browser.newContext({ userAgent: HUMAN_UA, viewport: { width: 1280, height: 900 }, ...options });
  const requests = [];
  const responses = [];
  context.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/events") requests.push(r);
  });
  context.on("response", (r) => {
    if (new URL(r.url()).pathname === "/api/events") responses.push(r.status());
  });
  /** /api/events 응답이 n개가 될 때까지 기다린다 (보내기는 화면 그리기와 따로 차례차례 간다) */
  const settled = async (n) => {
    const end = Date.now() + 15_000;
    while (responses.length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    return responses.slice();
  };
  return { context, requests, responses, settled };
}
const eventResponse = (page) => page.waitForResponse((r) => new URL(r.url()).pathname === "/api/events", { timeout: 15_000 });

test("j) 사람 브라우저 — 기사 열람·허브 열람·홈 분야 카드가 차례로 저장되고 모두 같은 방문자·세션(첫 방문), 방문자 쿠키는 스크립트가 못 읽는다", async () => {
  const { context, requests, settled } = await openContext();
  try {
    const page = await context.newPage();
    const viewed = eventResponse(page);
    // 네트워크가 조용해지기까지 기다릴 수 있다 — 측정 요청이 끝나지 않은 요청으로 남지 않는다 (W2-b E2E의 networkidle 대기)
    await page.goto(`${base}${fx.article.href}`, { waitUntil: "networkidle", timeout: 15_000 });
    assert.equal((await viewed).status(), 202);
    const vid = (await context.cookies()).find((c) => c.name === "ltr_vid");
    assert.ok(vid?.httpOnly, "방문자 쿠키 HttpOnly");
    assert.ok(!(await page.evaluate(() => document.cookie)).includes("ltr_vid"), "스크립트가 방문자 ID를 읽지 못한다");

    // 홈 → 4대 분야 카드(부동산금융) — 클릭 이벤트와 허브 열람이 겹쳐도 방문자 ID는 하나
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    const before = requests.length;
    await page.locator('[data-ui="field-cards"] a[href="/finance"]').click();
    await page.waitForURL(`${base}/finance`);
    await page.locator('[data-ui="hub"][data-hub="finance"]').waitFor();
    assert.deepEqual(await settled(before + 2), [202, 202, 202], "기사 열람 · 카드 클릭 · 허브 열람 — 모두 저장");
    assert.equal(requests.length - before, 2, "카드 클릭 1 + 허브 열람 1");

    const { rows } = await db.query("select name, section, visitor_id, session_id, first_visit, is_bot, props from public.analytics_events where visitor_id = $1 order by id", [vid.value]);
    assert.deepEqual(
      rows.map((r) => [r.name, r.section]),
      [
        ["article_viewed", "tax"],
        ["home_entry_clicked", "finance"],
        ["hub_viewed", "finance"],
      ],
    );
    assert.equal(new Set(rows.map((r) => r.session_id)).size, 1, "같은 세션");
    assert.ok(rows.every((r) => r.first_visit === true && r.is_bot === false));
    assert.deepEqual(rows[0].props, { article_id: fx.article.id, format: "general", content_type: "explainer" });
  } finally {
    await context.close();
  }
});

test("j) GPC를 켠 브라우저 — 기사·허브·분야 카드를 다녀도 /api/events 요청 0, 방문자 쿠키 0 (PRD-00 13장 E2E)", async () => {
  const { context, requests } = await openContext({ extraHTTPHeaders: { "Sec-GPC": "1" } });
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }));
  try {
    const page = await context.newPage();
    await page.goto(`${base}${fx.article.href}`, { waitUntil: "networkidle" });
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await page.locator('[data-ui="field-cards"] a[href="/tax"]').click();
    await page.locator('[data-ui="hub"][data-hub="tax"]').waitFor();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    assert.equal(requests.length, 0, "이벤트 전송 0");
    assert.ok(!(await context.cookies()).some((c) => c.name === "ltr_vid"), "방문자 ID 0");
    assert.match(await (await page.goto(`${base}/about/measurement`)).text(), /data-state="gpc"/);
  } finally {
    await context.close();
  }
});

test("j) 측정 거부 화면에서 [방문 통계 수집 거부] → 그 뒤 화면들은 /api/events 요청 0, [다시 허용] → 다시 보낸다", async () => {
  const { context, requests } = await openContext();
  try {
    const page = await context.newPage();
    await page.goto(`${base}/about/measurement`, { waitUntil: "networkidle" });
    assert.equal(await page.locator('[data-ui="measurement-page"]').getAttribute("data-state"), "measuring");
    await page.getByRole("button", { name: "방문 통계 수집 거부" }).click();
    await page.waitForURL(`${base}/about/measurement?done=refuse`);
    assert.equal(await page.locator('[data-part="notice"]').textContent(), "측정 거부를 저장했습니다.");
    assert.equal(await page.locator('[data-ui="measurement-page"]').getAttribute("data-state"), "refused");
    assert.ok((await context.cookies()).some((c) => c.name === "ltr_optout" && c.value === "1"));

    await page.goto(`${base}${fx.article.href}`, { waitUntil: "networkidle" });
    await page.goto(`${base}/local`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    assert.equal(requests.length, 0, "측정 거부 뒤 전송 0");

    await page.goto(`${base}/about/measurement`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "다시 허용" }).click();
    await page.waitForURL(`${base}/about/measurement?done=allow`);
    const viewed = eventResponse(page);
    await page.goto(`${base}${fx.article.href}`, { waitUntil: "domcontentloaded" });
    assert.equal((await viewed).status(), 202, "허용 뒤 다시 보낸다");
  } finally {
    await context.close();
  }
});

test("j) 자동화 브라우저(HeadlessChrome User-Agent)의 열람은 봇으로 저장된다", async () => {
  const { context } = await openContext({ userAgent: HEADLESS_UA });
  try {
    const page = await context.newPage();
    const viewed = eventResponse(page);
    await page.goto(`${base}${fx.article.href}`, { waitUntil: "domcontentloaded" });
    assert.equal((await viewed).status(), 202);
    const vid = (await context.cookies()).find((c) => c.name === "ltr_vid").value;
    const { rows } = await db.query("select is_bot from public.analytics_events where visitor_id = $1", [vid]);
    assert.deepEqual(
      rows.map((r) => r.is_bot),
      [true],
    );
  } finally {
    await context.close();
  }
});

test("시험 동안 예상 못 한 서버 오류가 없었다 (수집 API 500·저장 실패 0)", () => {
  assert.doesNotMatch(server.log(), /\[api\] 처리 중 오류|\[analytics\]|⨯/);
});
