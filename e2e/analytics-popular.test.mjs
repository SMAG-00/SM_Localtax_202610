// 1시간 집계·많이 본 기사·상담 사례 HOT·보존 기한 정리 E2E (W2-c 2단계 — ART-11 · HOME-05 · FND-06, docs/dev/W2-c_설계.md 8.2)
// standalone 빌드를 로컬 Supabase에 붙이고, 시각을 정해 측정 이벤트를 DB에 넣은 뒤 인증된 작업 경로(/api/jobs/*)로 배치를 돌린다.
//  a) 집계 배치 — 200·실행 기록(agent_runs)·시간 단위 집계(전체 = 봇·편집국 포함, 사람 = 제외·30분 안 반복 1회)·anon 원본 읽기 0
//  b) PRD 시험: 봇 조회 100회 + 사람 조회 3회인 기사 A < 사람 조회 5회인 기사 B
//  c) 168시간 전 시간대 포함 · 169시간 전 시간대 제외 · 편집국만 본 기사·광고 기사 0
//  d) /news/popular 20건 + 집계 시각 · 기사 사이드바 5건(지금 기사 제외, 1024px 이상 오른쪽 · 360px 본문 뒤)
//  e) 비공개(삭제)로 바뀐 기사는 다음 집계 전에 바로 빠진다
//  f) 같은 시간대를 다시 집계해도 두 번 세지 않는다 (지난 기록이 없어 창 전체를 다시 세도 같은 값)
//  g) 상담 사례 HOT — 집계 전에는 최신 상담 사례로 채우고 배지 0, 3번째 고정 409, 지방세 허브·상담 사례 목록 카드 3 + HOT 5(겹침 0·고정 맨 앞·배지)
//  h) 가중치 설정을 바꾸면 다음 집계부터 순서가 바뀐다 (그 전에는 그대로)
//  i) 누르면 popular_article_clicked(순위·위치)·hot_article_clicked(순위·고정 여부) 1건
//  j) 보존 기한 정리 — 기한보다 오래된 원본 이벤트·시간 단위 집계만 지운다
// 시험이 만든 기사·계정·이벤트·실행 기록·순위 행은 끝나면 지운다 (StaffFixture 정리 + 이 시험의 실행 기록).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SECRET = crypto.randomBytes(24).toString("hex");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SOLVED = (n) => ({
  situation: `한 납세자는 잔금 뒤 ${n}일이 지나 신고했다.`,
  issue: "신고 기간을 언제부터 세는지가 쟁점이었다.",
  result: "심판기관은 잔금일을 취득일로 보았다.",
  lesson: "신고 기간은 잔금일과 등기일 중 빠른 날부터 셉니다.",
  resultEvidence: [{ kind: "decision", number: `조심2025지00${10 + n}`, url: `https://decisions.example.kr/tt/2025-ji-00${10 + n}` }],
  conclusion: "rejected",
});

let sb, server, base, staff, db, browser;
const u = {};
const fx = {};
const runIds = [];
let H0; // 시험 자료의 기준 시간대 (UTC 정시) — 배치가 도는 시간대와 같아야 한다

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body).slice(0, 800);
const iso = (ms) => new Date(ms).toISOString();

async function api(method, apiPath, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${apiPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** 인증된 작업 경로로 배치 한 번 — 실행 기록 번호를 남겨 끝나면 지운다 */
async function runJob(job) {
  const res = await fetch(`${base}/api/jobs/${job}`, { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "x-job-trigger": "scheduler" } });
  const body = await res.json();
  if (body.runId) runIds.push(body.runId);
  const run = await one("select status, detail, error from public.agent_runs where id = $1", [body.runId]);
  assert.equal(res.status, 200, `${job}: ${res.status} ${run?.error ?? ""}`);
  assert.equal(run.status, "succeeded");
  return run.detail;
}

async function insertArticle(label, over = {}) {
  const contentType = over.contentType ?? "explainer";
  const cols = {
    slug: `e2e-pop-${label}-${staff.run}`.toLowerCase(),
    title: over.title ?? `집계 시험 ${label}`,
    summary: "무엇이 바뀌고 누구에게 영향이 있는지 정리했습니다",
    section: "tax",
    content_type: contentType,
    status: "published",
    author_id: u.reporter.personId,
    category_id: over.categoryId ?? null,
    subtype: over.solvedCase ? "solved_case" : "general",
    solved_case: over.solvedCase ? JSON.stringify(over.solvedCase) : null,
    label: contentType === "sponsored" ? "ad" : "none",
    body: JSON.stringify({ blocks: [{ type: "paragraph", text: "본문 문장입니다." }], claims: [] }),
    first_published_at: iso(Date.now() - (over.publishedDaysAgo ?? 3) * DAY),
  };
  const keys = Object.keys(cols);
  const { rows } = await db.query(`insert into public.articles (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id, slug`, Object.values(cols));
  const id = Number(rows[0].id);
  staff.trackArticle(id);
  fx[label] = { id, slug: rows[0].slug, href: `/news/${rows[0].slug}` };
  return fx[label];
}

const PROPS = {
  article_viewed: (id) => ({ article_id: id, format: "general", content_type: "explainer" }),
  article_engaged: (id) => ({ article_id: id, format: "general", content_type: "explainer" }),
  article_shared: (id) => ({ article_id: id, channel: "copy_link" }),
};

/** 측정 이벤트 넣기 — at(밀리초)·방문자·봇·편집국을 정해서 (수집 API를 거치지 않는 '지난 시각' 자료) */
async function seed(rows) {
  if (rows.length === 0) return;
  const cols = { name: [], at: [], sid: [], vid: [], props: [], bot: [], staff: [] };
  for (const r of rows) {
    const name = r.name ?? "article_viewed";
    cols.name.push(name);
    cols.at.push(iso(r.at));
    cols.sid.push(crypto.randomUUID());
    cols.vid.push(r.visitor === undefined ? crypto.randomUUID() : r.visitor);
    cols.props.push(JSON.stringify(PROPS[name](r.article)));
    cols.bot.push(r.bot === true);
    cols.staff.push(r.staff === true);
  }
  await db.query(
    `insert into public.analytics_events (name, occurred_at, session_id, visitor_id, first_visit, stage, entry, section, props, is_bot, is_staff)
     select n, a, s, v, false, 1, 'direct', 'tax', p::jsonb, b, st
     from unnest($1::text[], $2::timestamptz[], $3::uuid[], $4::uuid[], $5::text[], $6::boolean[], $7::boolean[]) as t(n, a, s, v, p, b, st)`,
    [cols.name, cols.at, cols.sid, cols.vid, cols.props, cols.bot, cols.staff],
  );
}

/** 사람 조회 n회 — 모두 다른 방문자 */
const humans = (article, n, at, name = "article_viewed") => Array.from({ length: n }, (_, i) => ({ article, at: at + i * 1000, name }));

const statsOf = async (ids) =>
  (await db.query("select article_id, hour, views_all, views_human, shares, engaged_views from public.article_stats where article_id = any($1::bigint[]) order by article_id, hour", [ids])).rows.map((r) => ({
    id: Number(r.article_id),
    hour: r.hour.toISOString(),
    all: r.views_all,
    human: r.views_human,
    shares: r.shares,
    engaged: r.engaged_views,
  }));

async function open(p, viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport });
  const res = await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
  return { page, status: res.status() };
}

const idOfHref = (href) => Object.values(fx).find((f) => f.href === href)?.id ?? null;
const popularIds = async (page, scope = "") => (await page.$$eval(`${scope} [data-ui="popular-articles"] a[data-rank]`, (as) => as.map((a) => a.getAttribute("href")))).map(idOfHref);
const hotView = (page, scope) =>
  page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    return {
      cards: [...root.querySelectorAll('[data-part="hot-cards"] > li')].map((li) => Number(li.getAttribute("data-article-id"))),
      cardTitles: root.querySelectorAll('[data-part="hot-cards"] [data-ui="solved-case-card"]').length,
      list: [...root.querySelectorAll('[data-part="hot-list"] > li')].map((li) => ({
        id: Number(li.getAttribute("data-article-id")),
        hot: li.getAttribute("data-hot") === "true",
        pinned: li.getAttribute("data-pinned") === "true",
        badge: li.querySelectorAll('[data-ui="hot-badge"]').length,
      })),
    };
  }, scope);

/** 시간대 경계에 걸리지 않게 — 정시 10분 전이면 다음 시간대로 넘어간 뒤 시작한다 (자료의 'N시간 전'과 배치의 기준 시간대가 같아야 한다) */
async function settleHour() {
  const into = Date.now() % HOUR;
  if (into > 50 * 60_000) await new Promise((r) => setTimeout(r, HOUR - into + 5_000));
  H0 = Math.floor(Date.now() / HOUR) * HOUR;
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    CRON_SECRET: SECRET,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.snapshotOperations();
  u.editor = await staff.createUser({ label: "pop-editor", roles: ["editor"], person: { name: "집계 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "pop-reporter", roles: ["reporter"], person: { name: "집계 시험 기자", roles: ["reporter"] } });
  const interpretations = Number((await one("select id from public.categories where section = 'tax' and slug = 'interpretations'")).id);
  fx.hotCategory = interpretations;

  // 많이 본 기사 시험 기사 — 발행 시각을 서로 다르게 (동점이면 최신 발행이 앞)
  await insertArticle("a", { publishedDaysAgo: 2 });
  await insertArticle("b", { publishedDaysAgo: 20 });
  await insertArticle("c", { publishedDaysAgo: 4 });
  await insertArticle("d168", { publishedDaysAgo: 9 });
  await insertArticle("d169", { publishedDaysAgo: 10 });
  await insertArticle("staff-only", { publishedDaysAgo: 1 });
  await insertArticle("ad", { contentType: "sponsored", publishedDaysAgo: 1 });
  await insertArticle("gone", { publishedDaysAgo: 5 });
  // 삭제 정정은 지금 판의 수정 이력이 있어야 전후 판을 남긴다 (W2-a — 편집국 API로 쓴 기사처럼)
  await db.query("insert into public.article_revisions (article_id, version, title, body, edited_by) values ($1, 1, $2, '[]'::jsonb, 'user:e2e')", [fx.gone.id, "집계 시험 gone"]);
  for (let i = 1; i <= 17; i++) await insertArticle(`f${i}`, { publishedDaysAgo: 30 + i });
  // 상담 사례(지방세 › 해석) — 해결 사례 4 · 일반 5 · 고정 1 · 가중치 시험 2
  for (let i = 1; i <= 4; i++) await insertArticle(`sc${i}`, { categoryId: interpretations, solvedCase: SOLVED(i), publishedDaysAgo: 10 + i });
  for (let i = 1; i <= 5; i++) await insertArticle(`g${i}`, { categoryId: interpretations, publishedDaysAgo: 20 + i });
  await insertArticle("pin", { categoryId: interpretations, publishedDaysAgo: 60 });
  await insertArticle("w-view", { categoryId: interpretations, publishedDaysAgo: 15 });
  await insertArticle("w-share", { categoryId: interpretations, publishedDaysAgo: 16 });
  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
    if (runIds.length) await db.query("delete from public.agent_runs where id = any($1::bigint[])", [runIds]);
    // 시험이 부른 배치가 만든 나머지 실행 기록 — 시작 시각 뒤의 집계 실행 (로컬 DB, 시험은 하나씩 돈다)
    await db.query("delete from public.agent_runs where job in ('popular-hourly', 'analytics-retention') and started_at >= $1", [staff.startedAt]);
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

// ── 집계 전 ─────────────────────────────────────────────

test("g-1) 집계 전 — /news/popular는 빈 목록 안내(200), 지방세 허브 HOT은 최신 상담 사례로 채우고 HOT 배지 0, 홈에 HOT 블록 0", async () => {
  const pop = await open("/news/popular");
  assert.equal(pop.status, 200);
  assert.equal((await pop.page.locator("h1").textContent()).trim(), "많이 본 기사");
  assert.match(await pop.page.locator('[data-part="empty-guide"]').textContent(), /아직 집계된 기사가 없습니다/);
  await pop.page.close();
  const tax = await open("/tax");
  const v = await hotView(tax.page, '[data-hub-part="hot"]');
  assert.ok(v, "지방세 허브에 상담 사례 HOT 자리");
  assert.equal(v.list.length, 5);
  assert.ok(v.list.every((x) => !x.hot && x.badge === 0), "점수·고정이 없으면 배지 없이 최신 상담 사례");
  assert.equal(v.cards.length, 3, "해결 사례 카드 3장 — 점수가 없으면 최신 해결 사례");
  await tax.page.close();
  const home = await fetch(`${base}/`).then((r) => r.text());
  assert.ok(!home.includes('data-ui="hot-badge"') && !home.includes('data-part="hot-block"'), "홈 HTML에 HOT 블록 0 (HOME-05)");
});

// ── 집계 ────────────────────────────────────────────────

test("a) 집계 배치 — 인증된 작업 경로 200·실행 기록, 시간 단위 집계: 전체 = 봇·편집국 포함, 사람 = 제외·같은 방문자 30분 안 반복 1회", async () => {
  await settleHour();
  const t3 = H0 - 3 * HOUR;
  const bot = crypto.randomUUID();
  const repeat = crypto.randomUUID();
  await seed([
    // A — 봇 100회 + 사람 3회 · B — 사람 5회 (PRD 시험)
    ...Array.from({ length: 100 }, (_, i) => ({ article: fx.a.id, at: t3 + 60_000 + i * 20_000, visitor: bot, bot: true })),
    ...humans(fx.a.id, 3, t3 + 5 * 60_000),
    ...humans(fx.b.id, 5, t3 + 6 * 60_000),
    // C — 같은 방문자 0·10·29분 (1회) + 편집국 10회 (사람 0)
    ...[0, 10, 29].map((m) => ({ article: fx.c.id, at: t3 + m * 60_000, visitor: repeat })),
    ...Array.from({ length: 10 }, (_, i) => ({ article: fx.c.id, at: t3 + 40 * 60_000 + i * 1000, staff: true })),
    // 168시간 전 시간대 사람 2회 · 169시간 전 시간대 사람 9회
    ...humans(fx.d168.id, 2, H0 - 168 * HOUR + 10 * 60_000),
    ...humans(fx.d169.id, 9, H0 - 169 * HOUR + 10 * 60_000),
    // 편집국만 50회 · 광고 기사 사람 50회 (순위 제외 유형) · 지울 기사 사람 4회 · 채움 기사 17개 사람 1회씩
    ...Array.from({ length: 50 }, (_, i) => ({ article: fx["staff-only"].id, at: t3 + i * 1000, staff: true })),
    ...humans(fx.ad.id, 50, H0 - 2 * HOUR),
    ...humans(fx.gone.id, 4, H0 - 2 * HOUR),
    ...Array.from({ length: 17 }, (_, i) => ({ article: fx[`f${i + 1}`].id, at: H0 - 4 * HOUR + i * 1000 })),
    // 상담 사례 — 조회·공유·30초 열람 (기본 가중치 1·5·2: w-share 22 > w-view 20 > g2 12 > sc1 10 > g1 8 > g3 7 > sc2 6 > g4 3 = g5 3 > sc3 1)
    ...humans(fx["w-view"].id, 20, H0 - 5 * HOUR),
    ...humans(fx["w-share"].id, 2, H0 - 5 * HOUR),
    ...humans(fx["w-share"].id, 4, H0 - 5 * HOUR + 60_000, "article_shared"),
    ...humans(fx.g2.id, 2, H0 - 6 * HOUR),
    ...humans(fx.g2.id, 2, H0 - 6 * HOUR + 60_000, "article_shared"),
    ...humans(fx.sc1.id, 10, H0 - 7 * HOUR),
    ...humans(fx.g1.id, 8, H0 - 8 * HOUR),
    ...humans(fx.g3.id, 7, H0 - 9 * HOUR),
    ...humans(fx.sc2.id, 6, H0 - 10 * HOUR),
    ...humans(fx.g4.id, 3, H0 - 11 * HOUR),
    ...humans(fx.g5.id, 1, H0 - 12 * HOUR),
    ...humans(fx.g5.id, 1, H0 - 12 * HOUR + 60_000, "article_engaged"),
    ...humans(fx.sc3.id, 1, H0 - 13 * HOUR),
  ]);
  // 169시간 전 시간대는 그때 집계됐던 행으로 둔다 — 순위 창(168시간) 밖이라 순위에 들지 않아야 한다
  await db.query("insert into public.article_stats (article_id, hour, views_all, views_human) values ($1, $2, 9, 9)", [fx.d169.id, iso(H0 - 169 * HOUR)]);

  const detail = await runJob("popular-hourly");
  assert.equal(detail.windowEnd, iso(H0), "창 끝 = 지금 시간대 시작");
  assert.ok(detail.watermark > 0 && detail.hours >= 14, JSON.stringify(detail));
  assert.equal(detail.popular.settings, "2026-10-18.1");
  const st = await statsOf([fx.a.id, fx.b.id, fx.c.id, fx["staff-only"].id, fx["w-share"].id]);
  const row = (id) => st.find((s) => s.id === id);
  assert.deepEqual([row(fx.a.id).all, row(fx.a.id).human], [103, 3], "A — 전체 103(봇 포함), 사람 3(봇 0회)");
  assert.deepEqual([row(fx.b.id).all, row(fx.b.id).human], [5, 5]);
  assert.deepEqual([row(fx.c.id).all, row(fx.c.id).human], [13, 1], "C — 같은 방문자 30분 안 3회는 1회, 편집국 10회는 사람 0");
  assert.deepEqual([row(fx["staff-only"].id).all, row(fx["staff-only"].id).human], [50, 0], "편집국 조회는 사람 조회 0");
  assert.deepEqual([row(fx["w-share"].id).human, row(fx["w-share"].id).shares], [2, 4]);
  for (const s of st) assert.equal(s.hour.slice(14), "00:00.000Z", "UTC 정시");

  // 원본·집계는 anon 키로 읽을 수 없다 — 순위 표도 점수 칸은 0
  for (const p of ["article_stats?select=article_id", "analytics_events?select=id", "article_rankings?select=score"]) {
    const r = await fetch(`${sb.url}/rest/v1/${p}`, { headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}` } });
    assert.ok(r.status === 401 || r.status === 403, `${p}: ${r.status}`);
  }
});

test("b) PRD 시험 — 봇 조회 100회 + 사람 조회 3회인 기사 A보다 사람 조회 5회인 기사 B가 위 (/news/popular·순위 표)", async () => {
  const { page } = await open("/news/popular");
  const ids = await popularIds(page);
  assert.ok(ids.includes(fx.a.id) && ids.includes(fx.b.id), JSON.stringify(ids));
  assert.ok(ids.indexOf(fx.b.id) < ids.indexOf(fx.a.id), "B가 A 위");
  await page.close();
  const ranks = Object.fromEntries((await db.query("select article_id, rank, score from public.article_rankings where list = 'popular' and article_id = any($1::bigint[])", [[fx.a.id, fx.b.id]])).rows.map((r) => [Number(r.article_id), [r.rank, Number(r.score)]]));
  assert.ok(ranks[fx.b.id][0] < ranks[fx.a.id][0]);
  assert.deepEqual([ranks[fx.b.id][1], ranks[fx.a.id][1]], [5, 3], "점수 = 사람 조회 (봇 0회)");
});

test("c) 168시간 전 시간대는 포함·169시간 전 시간대는 제외, 편집국만 본 기사·광고 기사는 순위 0", async () => {
  const rows = (await db.query("select article_id from public.article_rankings where list = 'popular'")).rows.map((r) => Number(r.article_id));
  assert.ok(rows.includes(fx.d168.id), "168시간 전 시간대 포함");
  assert.ok(!rows.includes(fx.d169.id), "169시간 전 시간대 제외 (9회여도)");
  assert.ok(!rows.includes(fx["staff-only"].id), "편집국 세션 조회는 순위에 들지 않는다");
  assert.ok(!rows.includes(fx.ad.id), "광고(sponsored)는 순위에서 뺀다 [결정 안건 — 설정]");
  const d169 = await statsOf([fx.d169.id]);
  assert.deepEqual(d169.map((s) => s.hour), [iso(H0 - 169 * HOUR)], "169시간 전 행은 그대로 있다 — 창이 뺀다");
});

test("d) /news/popular 20건 + '최근 7일' 기준·집계 시각(고정폭), 기사 사이드바 5건 — 지금 보는 기사 제외, 1024px 이상 오른쪽 열 · 360px 본문 뒤", async () => {
  const total = Number((await one("select count(*)::int n from public.article_rankings where list = 'popular'")).n);
  assert.ok(total > 20, `순위 후보 ${total}건 (20건 넘게 준비)`);
  const pop = await open("/news/popular");
  assert.equal((await popularIds(pop.page)).length, 20, "목록 20 (popular_rules.list_size)");
  const line = pop.page.locator('[data-part="computed-at"]');
  assert.match(await line.textContent(), /^최근 7일 기준 · 집계 \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(한국 시간\)$/);
  assert.match(await line.getAttribute("class"), /font-mono/);
  await pop.page.close();

  const wide = await open(fx["w-view"].href);
  const side = await popularIds(wide.page, '[data-part="popular-sidebar"]');
  assert.equal(side.length, 5, "사이드바 5 (popular_rules.sidebar_size)");
  assert.ok(!side.includes(fx["w-view"].id), "지금 보는 기사(1위)는 뺀다");
  const box = async (page, sel) => page.locator(sel).first().boundingBox();
  const [bodyW, sideW] = [await box(wide.page, '[data-part="article-body"]'), await box(wide.page, '[data-part="popular-sidebar"]')];
  assert.ok(sideW.x >= bodyW.x + bodyW.width, "1280px — 본문 오른쪽 열");
  await wide.page.close();
  const narrow = await open(fx["w-view"].href, { width: 360, height: 740 });
  const [bodyN, sideN] = [await box(narrow.page, '[data-part="article-body"]'), await box(narrow.page, '[data-part="popular-sidebar"]')];
  assert.ok(sideN.y >= bodyN.y + bodyN.height, "360px — 본문 뒤");
  assert.equal(await narrow.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "360px 가로 스크롤 0");
  await narrow.page.close();
});

test("e) 비공개(삭제)로 바뀐 기사는 다음 집계를 기다리지 않고 목록에서 빠진다 — 20건은 그대로 채운다", async () => {
  const before = await open("/news/popular");
  assert.ok((await popularIds(before.page)).includes(fx.gone.id));
  await before.page.close();
  const del = await api("POST", `/articles/${fx.gone.id}/corrections`, u.editor, { kind: "deletion", reason: "권리 문제로 내림" });
  assert.equal(del.status, 201, show(del));
  const after = await open("/news/popular");
  const ids = await popularIds(after.page);
  assert.ok(!ids.includes(fx.gone.id), "삭제된 기사 0");
  assert.equal(ids.length, 20);
  await after.page.close();
  assert.equal(Number((await one("select count(*)::int n from public.article_rankings where article_id = $1", [fx.gone.id])).n), 1, "순위 표 행은 다음 집계 전까지 남아도 공개 범위(RLS)가 뺀다");
});

test("f) 같은 시간대를 다시 집계해도 두 번 세지 않는다 — 바로 다시 돌리기·지난 기록 없이 창 전체 다시 세기 모두 같은 값", async () => {
  const ids = Object.values(fx).filter((f) => typeof f === "object" && f.id).map((f) => f.id);
  const first = await statsOf(ids);
  const again = await runJob("popular-hourly");
  assert.equal(again.hours, 1, "새 이벤트가 없으면 바로 앞 시간대 하나만 다시 센다");
  assert.deepEqual(await statsOf(ids), first);
  await db.query("delete from public.agent_runs where id = any($1::bigint[])", [runIds]);
  const full = await runJob("popular-hourly");
  assert.ok(full.hours >= 14, "지난 기록이 없으면 창 안 이벤트 시간대를 모두 다시 센다");
  assert.deepEqual(await statsOf(ids), first, "같은 이벤트 → 같은 집계 (멱등)");
  const popular = (await db.query("select article_id from public.article_rankings where list = 'popular' order by rank")).rows.map((r) => Number(r.article_id));
  assert.ok(!popular.includes(fx.gone.id), "다음 집계는 삭제된 기사를 순위 표에서도 뺀다");
});

// ── 상담 사례 HOT ───────────────────────────────────────

test("g-2) HOT 고정 — 상담 사례 기사 2건까지, 3번째 고정은 409, 다른 분야 기사 고정은 422, 고정 풀기는 된다", async () => {
  const until = iso(Date.now() + 7 * DAY);
  assert.equal((await api("POST", `/articles/${fx.pin.id}/placement`, u.editor, { hotPinUntil: until })).status, 200);
  assert.equal((await api("POST", `/articles/${fx.g4.id}/placement`, u.editor, { hotPinUntil: until })).status, 200);
  const third = await api("POST", `/articles/${fx.g3.id}/placement`, u.editor, { hotPinUntil: until });
  assert.equal(third.status, 409, show(third));
  assert.match(third.body.error, /최대 2건/);
  const outside = await api("POST", `/articles/${fx.b.id}/placement`, u.editor, { hotPinUntil: until });
  assert.equal(outside.status, 422, show(outside));
  assert.equal((await api("POST", `/articles/${fx.g4.id}/placement`, u.editor, { hotPinUntil: null })).status, 200, "고정 풀기");
  assert.equal((await one("select hot_pin_until from public.articles where id = $1", [fx.g3.id])).hot_pin_until, null, "막힌 고정은 저장 0");
});

const EXPECT_DEFAULT = () => ({ cards: [fx.sc1.id, fx.sc2.id, fx.sc3.id], list: [fx.pin.id, fx["w-share"].id, fx["w-view"].id, fx.g2.id, fx.g1.id] });

test("g-3) 지방세 허브·상담 사례 목록 — 해결 사례 카드 3(점수 순) + HOT 목록 5(카드 제외·고정 맨 앞·배지), 같은 기사 0", async () => {
  await runJob("popular-hourly");
  for (const [p, scope] of [
    ["/tax", '[data-hub-part="hot"]'],
    ["/tax/interpretations", '[data-hub-part="hot"]'],
  ]) {
    const { page, status } = await open(p);
    assert.equal(status, 200);
    const v = await hotView(page, scope);
    assert.deepEqual({ cards: v.cards, list: v.list.map((x) => x.id) }, EXPECT_DEFAULT(), p);
    assert.equal(v.cardTitles, 3, `${p}: 해결 사례 카드 컴포넌트 3`);
    assert.deepEqual(v.list.map((x) => [x.hot, x.badge]), [[true, 1], [true, 1], [true, 1], [true, 1], [true, 1]], `${p}: HOT 배지`);
    assert.deepEqual(v.list.map((x) => x.pinned), [true, false, false, false, false], `${p}: 고정 기사 맨 앞`);
    const all = [...v.cards, ...v.list.map((x) => x.id)];
    assert.equal(new Set(all).size, all.length, `${p}: 카드와 목록에 같은 기사 0`);
    await page.close();
  }
  // HOT 배지는 이 블록에만 — 많이 본 기사·기사 상세에는 0
  const pop = await fetch(`${base}/news/popular`).then((r) => r.text());
  assert.ok(!pop.includes('data-ui="hot-badge"'));
});

test("h) 가중치 설정을 바꾸면 다음 집계부터 순서가 바뀐다 — 바꾼 직후(집계 전)에는 그대로", async () => {
  const current = (await one("select value from public.settings where key = 'hot_weights'")).value;
  await db.query("update public.settings set value = $1::jsonb, updated_by = 'e2e:w2c' where key = 'hot_weights'", [JSON.stringify({ ...current, version: `${current.version}-e2e`, share: 1 })]);
  const read = async () => {
    const { page } = await open("/tax");
    const v = await hotView(page, '[data-hub-part="hot"]');
    await page.close();
    return { cards: v.cards, list: v.list.map((x) => x.id) };
  };
  assert.deepEqual(await read(), EXPECT_DEFAULT(), "설정만 바꾸고 집계 전 — 순서 그대로 (코드 상수 0, 배치가 매긴다)");
  const detail = await runJob("popular-hourly");
  assert.equal(detail.hot.settings, `${current.version}-e2e`, "다음 집계가 바꾼 가중치 버전을 쓴다");
  // 공유 가중치 5 → 1: w-share 2+4×1=6, g2 2+2×1=4 → 고정 → w-view 20 → (sc1 10 카드) → g1 8 → g3 7 → (sc2 6 카드) → w-share 6
  assert.deepEqual(await read(), { cards: [fx.sc1.id, fx.sc2.id, fx.sc3.id], list: [fx.pin.id, fx["w-view"].id, fx.g1.id, fx.g3.id, fx["w-share"].id] });
});

// ── 누름 측정 ───────────────────────────────────────────

test("i) 목록을 누르면 popular_article_clicked(순위·위치 list)·hot_article_clicked(순위·고정 여부) 1건", async () => {
  const since = new Date();
  const pop = await open("/news/popular");
  const second = pop.page.locator('[data-ui="popular-articles"] a[data-rank="2"]');
  const target = idOfHref(await second.getAttribute("href"));
  await Promise.all([pop.page.waitForResponse((r) => r.url().endsWith("/api/events") && r.request().postData()?.includes("popular_article_clicked")), second.click()]);
  await pop.page.close();
  const tax = await open("/tax");
  const first = tax.page.locator('[data-part="hot-list"] > li').first().locator("a");
  await Promise.all([tax.page.waitForResponse((r) => r.url().endsWith("/api/events") && r.request().postData()?.includes("hot_article_clicked")), first.click()]);
  await tax.page.close();
  const rows = (await db.query("select name, section, props from public.analytics_events where occurred_at >= $1 and name in ('popular_article_clicked', 'hot_article_clicked') order by id", [since])).rows;
  assert.deepEqual(
    rows.map((r) => [r.name, r.section, r.props]),
    [
      ["popular_article_clicked", "tax", { article_id: target, rank: 2, position: "list" }],
      ["hot_article_clicked", "tax", { article_id: fx.pin.id, rank: 1, pinned: true }],
    ],
  );
});

// ── 보존 기한 정리 ──────────────────────────────────────

test("j) 보존 기한 정리 — analytics.retention_days(395일)보다 오래된 원본 이벤트·시간 단위 집계만 지운다", async () => {
  const now = Date.now();
  const oldAt = now - 396 * DAY;
  const keepAt = now - 394 * DAY;
  await seed([...humans(fx.f1.id, 3, oldAt), ...humans(fx.f2.id, 2, keepAt)]);
  await db.query("insert into public.article_stats (article_id, hour, views_all, views_human) values ($1, $2, 3, 3), ($3, $4, 2, 2)", [
    fx.f1.id,
    iso(Math.floor(oldAt / HOUR) * HOUR),
    fx.f2.id,
    iso(Math.floor(keepAt / HOUR) * HOUR),
  ]);
  const count = async (sql, params) => Number((await one(sql, params)).n);
  const oldEvents = () => count("select count(*)::int n from public.analytics_events where props ->> 'article_id' = $1 and occurred_at < now() - interval '395 days'", [String(fx.f1.id)]);
  const keptEvents = () => count("select count(*)::int n from public.analytics_events where props ->> 'article_id' = $1 and occurred_at < now() - interval '393 days'", [String(fx.f2.id)]);
  assert.deepEqual([await oldEvents(), await keptEvents()], [3, 2]);
  const detail = await runJob("analytics-retention");
  assert.equal(detail.retentionDays, 395);
  assert.ok(detail.events >= 3 && detail.done === true, JSON.stringify(detail));
  assert.deepEqual([await oldEvents(), await keptEvents()], [0, 2], "기한 안(394일 전) 이벤트는 남는다");
  const stats = await statsOf([fx.f1.id, fx.f2.id]);
  assert.ok(!stats.some((s) => s.hour === iso(Math.floor(oldAt / HOUR) * HOUR)), "396일 전 시간대 집계 0");
  assert.ok(stats.some((s) => s.hour === iso(Math.floor(keepAt / HOUR) * HOUR)), "394일 전 시간대 집계는 남는다");
  assert.ok(stats.some((s) => s.id === fx.f1.id && s.hour === iso(H0 - 4 * HOUR)), "최근 집계는 그대로");
});
