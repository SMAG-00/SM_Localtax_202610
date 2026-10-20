// 공개 홈·공통 틀 E2E (W2-b 2단계 — HOME-01~04 · HOME-02 · FND-09 · UX-06 · UX-02 R1·R2, docs/dev/W2-b_설계.md 1장 2단계 증거)
// standalone 빌드를 띄우고 로컬 Supabase에 붙인다. 공개 기사·개정 트래커는 DB에 직접 넣고, 홈 배치·기능 공개 목록은 편집국 API로 고친다
// (API 쓰기는 공개 데이터 캐시를 바로 만료한다 — 설계 7.1).
//  a) 홈 섹션 순서 = PRD_최종 §4.1 (설계 2.3 home_sections) — DOM 순서와 화면 위치, 빈 DB 홈은 히어로·4대 분야만(오류 0)
//  b) 첫 화면 R1(360×740 글자 150자 이하)·R2(뷰포트마다 주 버튼 1개 이하) — 폭 360·640·1024
//  c) 사이트 안 링크는 화면 전환(Next.js 링크) — 홈 → 허브(상단 메뉴·4대 분야 카드) → 뒤로 가기까지 문서 새로고침 0, 페이지 표식 유지 (허브는 3단계 — e2e/site-hubs가 하위 분야·하위 메뉴까지 본다)
//  d) 기능 키가 모두 꺼지면 /calc·/experts·/store·/edu·/search·정책 페이지 링크 0, 켜면(API) 바로 그 메뉴·링크·검색 폼
//  e) v1.2 경로·단계 전 경로 링크 0
//  f) 360px 가로 스크롤 0 · 메뉴 버튼과 메뉴 항목 터치 영역 44px 이상 · 견본(/_design)·백오피스는 공개 틀 밖
//  g) HOME-03 — 확정 전 트래커 카드마다 '확정 아님' 1개, 확정 뒤 0, 끝난 카드 0, 스토리 7장째 거부, 단계가 바뀌면 바로(편집국 쓰기) 또는 1분 안(시간 재검증) 홈에 반영
//  h) 공개 데이터를 읽지 못하면(접속값 없음·DB 꺼짐) 닫힌 홈 200 — 4대 분야 카드와 안내 한 줄, 기능 링크 0
// 만든 계정·기사·개정안·배치·감사 로그는 끝나면 지우고, 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { ROOT, buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { measurePage } from "./lib/screen-rules.mjs";
import { StaffFixture } from "./lib/staff.mjs";
import { publishPolicies } from "./lib/policy-fixture.mjs";

const ADMIN_EMAIL = "site-home-e2e@example.test";
const SITE = "https://e2e.example.test";
const DESIGN = fs.readFileSync(path.join(ROOT, "docs", "dev", "W2-b_설계.md"), "utf8");
/** 설계 2.3 표의 한 줄 값 목록 (PRD_최종 §4.1 홈 섹션 순서 — 설계 문서와 PRD가 다르면 PRD가 맞다) */
const designList = (name) => [...DESIGN.split("\n").find((l) => l.startsWith(`| ${name} `)).split("|")[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const HOME_ORDER = designList("home_sections");
/** 기능 키로 여는 화면 — 유틸 메뉴(HOME-02)와 정책 페이지(HELP-05). 꺼져 있으면 링크 요소 0 */
const GATED = ["/calc", "/experts", "/store", "/edu", "/search", "/about", "/help"];
/** PRD-01A 3장·HOME-02 — 단계 전 경로와 v1.2 경로 (내부 링크 0) */
const NEVER = ["/calc/", "/law", "/cases", "/workspace", "/qna", "/library", "/region", "/resources", "/authors", "/news/cards", "/editorial-policy", "/corrections", "/advertise", "/terms", "/privacy", "/no-email-collection"];

let sb, server, staff, db, browser, base;
/** 정책 키는 게시본이 있어야 켜진다(W2-e 6.3) — 개인정보처리방침을 켜는 시험이 쓰는 가짜 게시본을 지우는 함수 */
let removePolicies;
/** 기능 키와 상관없이 늘 열린 화면 — 측정 거부 안내(W2-c). W2-e 4단계부터 바닥글에 항상 있다(W2-e 설계 6.4) */
const ALWAYS_OPEN = new Set(["/about/measurement"]);
const u = {};
const fx = { reports: [], stories: [] };

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
/** 한국 날짜 YYYY-MM-DD (오늘 + days) */
const kstDay = (days = 0) => new Date(Date.now() + 9 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);
const TODAY = kstDay(0);
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();

async function api(method, apiPath, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${apiPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** 운영 설정 한 줄 고치기 (관리자 — 쓰기가 공개 데이터 캐시를 바로 만료한다) */
async function setSetting(key, value) {
  const r = await api("PATCH", `/settings/${key}`, u.admin, { value });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 400));
}

async function setFeatures(on) {
  const current = (await one("select value from public.settings where key = 'feature_flags'")).value;
  await setSetting("feature_flags", Object.fromEntries(Object.keys(current).map((k) => [k, on.includes(k)])));
}

async function article(label, over = {}) {
  const { rows } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, reporting_method, status, author_id, format, first_published_at)
     values ($1, $2, $3, $4, $5, $6, 'published', $7, $8, $9) returning id`,
    [
      `e2e-site-${label}-${staff.run}`,
      over.title ?? `홈 시험 ${label}`,
      `${label} 요약 — 무엇이 바뀌고 누구에게 영향이 있는지`,
      over.section ?? "tax",
      over.contentType ?? "explainer",
      over.contentType === "reported_news" ? "qualitative" : null,
      u.reporter.personId,
      over.format ?? "general",
      over.publishedAt ?? hoursAgo(48),
    ],
  );
  const id = Number(rows[0].id);
  staff.trackArticle(id);
  return id;
}

async function approve(articleId) {
  await db.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision) values ($1, 'desk_edit', $2, 'approve')", [articleId, u.editor.personId]);
}

async function amendment(label, stages) {
  const { rows } = await db.query("insert into public.amendments (slug, title, status, law_names) values ($1, $2, 'public', $3) returning id", [
    `e2e-site-am-${label}-${staff.run}`,
    `시험 개정안 ${label} ${staff.run}`,
    ["지방세법"],
  ]);
  const id = Number(rows[0].id);
  staff.trackRow("amendments", id);
  for (const [stage, occurredOn] of stages) await stageEvent(id, stage, occurredOn);
  return id;
}

async function stageEvent(amendmentId, stage, occurredOn) {
  const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e', 'https://www.mois.go.kr/e2e', 'h', '원문') returning id");
  await db.query(
    "insert into public.amendment_events (amendment_id, stage, occurred_on, source_url, snapshot_id, recorded_by) values ($1, $2, $3, 'https://www.mois.go.kr/e2e', $4, 'user:e2e')",
    [amendmentId, stage, occurredOn, snap.id],
  );
}

async function curate(kind, targetId, extra = {}) {
  const r = await api("POST", "/home-curations", u.editor, { kind, targetId, startsOn: TODAY, ...extra });
  if (r.status === 201) staff.trackRow("home_curations", r.body.curation.id);
  return r;
}

async function openHome(viewport = { width: 1280, height: 800 }) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  return page;
}

/** 홈의 섹션 키 — DOM 순서와 화면 위치(위 → 아래) */
async function sectionLayout(page) {
  return page.$$eval("[data-home-section]", (els) => els.map((e) => ({ key: e.getAttribute("data-home-section"), top: e.getBoundingClientRect().top + window.scrollY })));
}

/** 페이지의 모든 링크 주소 (사이트 안 주소는 경로만) */
async function hrefs(page) {
  return page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
}

const pathOf = (href) => href.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
const hits = (list, prefixes) => list.filter((h) => h.startsWith("/") && prefixes.some((p) => (p.endsWith("/") ? pathOf(h).startsWith(p) : pathOf(h) === p || pathOf(h).startsWith(`${p}/`))));

async function trackerCards(page) {
  return page.$$eval('[data-part="tracker-card"]', (cards) =>
    cards.map((c) => ({
      id: Number(c.getAttribute("data-tracker-id")),
      stage: c.getAttribute("data-stage"),
      label: c.querySelector('[data-part="current-label"]')?.textContent ?? null,
      unconfirmed: c.querySelectorAll('[data-ui="unconfirmed-chip"]').length,
      unconfirmedText: [...c.querySelectorAll('[data-ui="unconfirmed-chip"]')].map((x) => x.textContent),
      sources: [...c.querySelectorAll('a[target="_blank"]')].map((a) => a.getAttribute("href")),
    })),
  );
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
  removePolicies = await publishPolicies(db, staff.run, ["terms", "privacy", "about"]);
  u.editor = await staff.createUser({ label: "site-editor", roles: ["editor"], person: { name: "홈 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "site-reporter", roles: ["reporter"], person: { name: "김가온", roles: ["reporter"] } });
  u.admin = await staff.createUser({ label: "site-admin", email: ADMIN_EMAIL });
  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
    await removePolicies?.(); // cleanup()이 DB 연결을 닫기 전에
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

test("빈 DB 홈 — 히어로(핵심 메시지 = 설정 값)와 4대 분야 카드 4장만, 빈 섹션·오류 0", async () => {
  const published = (await one("select count(*)::int n from public.articles where status = 'published'")).n;
  const trackers = (await one("select count(*)::int n from public.amendments where status = 'public'")).n;
  assert.equal(published + trackers, 0, "로컬 DB에 공개 기사·트래커가 남아 있다 — 빈 홈을 볼 수 없다");
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  assert.deepEqual((await sectionLayout(page)).map((s) => s.key), ["hero", "fields"]);
  const message = (await one("select value from public.settings where key = 'home_core_message'")).value;
  assert.equal((await page.locator("h1").textContent()).trim(), message, "핵심 메시지는 settings 한 곳에서 온다");
  const fields = await page.$$eval('[data-ui="field-cards"] a', (as) => as.map((a) => [a.textContent.trim(), a.getAttribute("href")]));
  assert.deepEqual(fields, [
    ["지방세", "/tax"],
    ["부동산", "/realestate"],
    ["부동산개발금융", "/finance"],
    ["지자체뉴스", "/local"],
  ]);
  assert.equal(await page.locator('[data-home-section] :text("준비 중")').count(), 0);
  assert.equal(await page.locator("[data-ui='home-search']").count(), 0, "검색 화면 공개 전 — 검색 폼 0");
  assert.deepEqual(errors, []);
  await page.close();
});

test("시험 자료 — 보도 7·해설 9·트래커 3과 홈 배치 (스토리 7장째 409·DB 거부)", async () => {
  for (let i = 1; i <= 6; i++) {
    const id = await article(`report${i}`, { contentType: "reported_news", publishedAt: hoursAgo(i), section: i % 2 ? "tax" : "realestate", title: `시험 보도 ${i}` });
    await approve(id);
    fx.reports.push(id);
  }
  fx.reportPending = await article("report-pending", { contentType: "reported_news", publishedAt: hoursAgo(0.5) }); // 편집 승인 전
  fx.explainerNew = await article("explainer-new", { publishedAt: hoursAgo(0.2) }); // 해설 — 자체 취재 목록 밖
  const formats = ["cardnews", "general", "infographic", "general", "video", "photo", "cardnews"];
  for (let i = 1; i <= 7; i++) fx.stories.push(await article(`story${i}`, { format: formats[i - 1], publishedAt: hoursAgo(10 + i), title: `시험 스토리 ${i}` }));

  fx.trackerA = await amendment("a", [["pre_notice", kstDay(-3)]]);
  fx.trackerB = await amendment("b", [
    ["announced", kstDay(-60)],
    ["promulgated", kstDay(-10)],
  ]);
  fx.trackerC = await amendment("c", [["pre_notice", kstDay(-20)]]);

  for (const id of fx.stories.slice(0, 6)) assert.equal((await curate("story", id)).status, 201);
  const seventh = await curate("story", fx.stories[6]);
  assert.equal(seventh.status, 409, "7장째 스토리 카드는 지정할 수 없다");
  await assert.rejects(
    db.query("insert into public.home_curations (kind, article_id, starts_on, sort, created_by) values ('story', $1, $2, 99, 'user:e2e')", [fx.stories[6], TODAY]),
    /6/,
    "직접 SQL로도 7장째는 거부된다 (DB 트리거)",
  );
  // 지난주에 끝난 카드 — API는 끝난 기간을 새로 만들지 않으므로 DB에 직접 (트리거 규칙은 그대로)
  for (const [kind, col, target] of [
    ["story", "article_id", fx.stories[6]],
    ["tracker", "amendment_id", fx.trackerC],
  ]) {
    const r = await one(`insert into public.home_curations (kind, ${col}, starts_on, ends_on, sort, created_by) values ($1, $2, $3, $4, 1, 'user:e2e') returning id`, [kind, target, kstDay(-10), kstDay(-3)]);
    staff.trackRow("home_curations", r.id);
  }
  const a = await curate("tracker", fx.trackerA, { sort: 10 });
  assert.equal(a.status, 201);
  fx.curationA = a.body.curation.id;
  assert.equal((await curate("tracker", fx.trackerB, { sort: 20 })).status, 201);
});

test("a) 홈 섹션 순서 = PRD_최종 §4.1 — DOM 순서와 화면 위치(360·1280), 내용 없는 섹션(금주 핫뉴스·칼럼·상품·전문가) 0", async () => {
  for (const viewport of [
    { width: 360, height: 740 },
    { width: 1280, height: 800 },
  ]) {
    const page = await openHome(viewport);
    const layout = await sectionLayout(page);
    const keys = layout.map((s) => s.key);
    assert.deepEqual(keys, ["hero", "fields", "latest_reports", "amendments"], `${viewport.width}px`);
    assert.deepEqual(keys, HOME_ORDER.filter((k) => keys.includes(k)), "DOM 순서가 설계 2.3 home_sections 순서와 같다");
    for (let i = 1; i < layout.length; i++) assert.ok(layout[i].top > layout[i - 1].top, `${viewport.width}px: ${layout[i].key}가 ${layout[i - 1].key}보다 아래에 있다`);
    // 섹션 바탕 — 보이는 순서대로 ivory·ivory-dark 번갈아
    const tones = await page.$$eval("section[data-home-section]", (els) => els.map((e) => (e.className.includes("bg-ivory-dark") ? "dark" : "ivory")));
    assert.deepEqual(tones, ["ivory", "dark", "ivory"]);
    await page.close();
  }
});

test("HOME-04 최신 자체 취재 — 편집 승인된 보도 5건만 최신 순(승인 전 보도·해설 0), 기사 유형 배지 '보도'·기자명", async () => {
  const page = await openHome();
  const ids = await page.$$eval('[data-part="latest-reports"] [data-article-id]', (els) => els.map((e) => Number(e.getAttribute("data-article-id"))));
  assert.deepEqual(ids, fx.reports.slice(0, 5));
  const badges = await page.$$eval('[data-part="latest-reports"] [data-ui="article-type-badge"]', (els) => els.map((e) => e.textContent));
  assert.deepEqual(badges, ["보도", "보도", "보도", "보도", "보도"]);
  assert.deepEqual(await page.$$eval('[data-part="latest-reports"] [data-part="byline"]', (els) => [...new Set(els.map((e) => e.textContent))]), ["김가온"]);
  await page.close();
});

test("g) HOME-03 — 트래커 지정 순서·끝난 카드 0, 확정 전 카드에 '확정 아님' 1개·확정 뒤 0, 원문 링크, 스토리 6장(형식 배지는 일반 0)", async () => {
  const page = await openHome();
  const cards = await trackerCards(page);
  assert.deepEqual(cards.map((c) => c.id), [fx.trackerA, fx.trackerB], "지정 순서, 끝난 카드(C) 0");
  assert.deepEqual(cards.map((c) => [c.stage, c.label, c.unconfirmed]), [
    ["pre_notice", "입법예고", 1],
    ["promulgated", "공포", 0],
  ]);
  assert.deepEqual(cards[0].unconfirmedText, ["확정 아님"]);
  for (const c of cards) assert.ok(c.sources.length >= 1 && c.sources.every((s) => s.startsWith("https://")), "현재 단계 원문 링크 (새 창)");
  assert.equal(await page.locator('[data-part="tracker-card"] a[href^="/tax/amendments"]').count(), 0, "트래커 페이지(01B W3) 공개 전 — 트래커 링크 0");

  const stories = await page.$$eval('[data-part="stories"] [data-story-id]', (els) => els.map((e) => Number(e.getAttribute("data-story-id"))));
  assert.deepEqual(stories, fx.stories.slice(0, 6), "지정 6장 — 7장째·끝난 카드 0");
  const formatBadges = await page.$$eval('[data-part="stories"] [data-story-id]', (els) => els.map((e) => e.querySelector("[data-format-badge]")?.textContent ?? null));
  assert.deepEqual(formatBadges, ["카드뉴스", null, "인포그래픽", null, "동영상", "포토"]);
  await page.close();
});

test("b) 첫 화면 R1·R2 — 폭 360·640·1024 (기능 꺼짐: 주 버튼 0)", async () => {
  for (const width of [360, 640, 1024]) {
    const r = await measurePage(browser, `${base}/`, { width, height: 740 });
    assert.ok(r.r1.pass, `${width}px R1 ${r.r1.chars}자 > 150`);
    assert.ok(r.r2.pass, `${width}px R2 주 버튼 ${r.r2.maxPerViewport}개`);
    assert.ok(r.r3.pass, `${width}px R3 오렌지 ${r.r3.ratio}`);
  }
});

test("d·e) 기능 키가 모두 꺼지면 유틸 메뉴·정책 링크·검색 폼 0, v1.2·단계 전 경로 0 — 켜면(API) 배포 없이 제자리에", async () => {
  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  assert.ok(Object.values(flags).every((v) => v === false), "시험 전 기능 공개 목록이 모두 꺼져 있어야 한다");
  let page = await openHome({ width: 1280, height: 800 });
  let links = await hrefs(page);
  assert.deepEqual(hits(links, GATED).filter((h) => !ALWAYS_OPEN.has(pathOf(h))), [], "꺼진 기능으로 가는 링크 0");
  assert.deepEqual(hits(links, NEVER), [], "v1.2·단계 전 경로 링크 0");
  assert.equal(await page.locator('nav[aria-label="유틸 메뉴"]').count(), 0);
  assert.equal(await page.locator('form[action="/search"]').count(), 0);
  // 기능 키가 모두 꺼져도 바닥글에는 측정 거부 하나만 (W2-e 6.4)
  assert.deepEqual(await page.$$eval('nav[aria-label="바닥글 메뉴"] a', (as) => as.map((a) => a.getAttribute("href"))), ["/about/measurement"]);
  assert.deepEqual(await page.$$eval('nav[aria-label="분야 메뉴"] [data-part="section-link"]', (as) => as.map((a) => a.textContent)), ["지방세", "부동산", "부동산개발금융", "지자체뉴스"]);
  // 하위 메뉴 — 빈 DB에서는 분야마다 공통 '뉴스 전체'만 (기사 있는 하위 분야가 없다, HOME-02)
  assert.deepEqual(await page.$$eval('nav[aria-label="분야 메뉴"] [data-part="sub-link"]', (as) => as.map((a) => a.getAttribute("href"))), ["/news?section=tax", "/news?section=realestate", "/news?section=finance", "/news?section=local"]);
  for (const word of ["지방세봇", "지역·축제", "AI 도우미"]) assert.equal(await page.locator("header").getByText(word).count(), 0, `헤더에 ${word} 0`);
  await page.close();

  // 검색·개인정보처리방침을 켠다 (관리자 설정 API — 쓰기가 캐시를 바로 만료한다)
  await setFeatures(["search", "page_privacy"]);
  await setSetting("home_search_chips", ["취득세", "개편안", "책임준공"]);
  page = await openHome({ width: 1280, height: 800 });
  assert.deepEqual(await page.$$eval('nav[aria-label="유틸 메뉴"] a', (as) => as.map((a) => [a.textContent, a.getAttribute("href")])), [["검색", "/search"]]);
  assert.equal(await page.locator('form[role="search"][action="/search"]').count(), 1, "히어로에 /search로 제출하는 검색 폼 1개");
  assert.deepEqual(await page.$$eval('[data-ui="home-search"] ul[aria-label="추천 검색어"] a', (as) => as.map((a) => a.textContent)), ["취득세", "개편안", "책임준공"]);
  const privacy = page.locator('nav[aria-label="바닥글 메뉴"] a', { hasText: "개인정보처리방침" });
  assert.equal(await privacy.getAttribute("href"), "/about/privacy");
  assert.ok((await privacy.getAttribute("class")).includes("font-bold"), "개인정보처리방침은 굵게 (HELP-05)");
  links = await hrefs(page);
  assert.deepEqual(hits(links, ["/calc", "/experts", "/store", "/edu", "/help"]), [], "켜지 않은 기능은 여전히 링크 0");
  assert.deepEqual(hits(links, NEVER), []);
  await page.close();

  // 검색이 열리면 첫 화면 주 버튼은 [검색하기] 하나 — R1·R2 (칩 3개 포함)
  for (const width of [360, 640, 1024]) {
    const r = await measurePage(browser, `${base}/`, { width, height: 740 });
    assert.ok(r.r1.pass, `${width}px R1 ${r.r1.chars}자 > 150 (검색 폼·칩 포함)`);
    assert.equal(r.r2.maxPerViewport, 1, `${width}px 주 버튼은 [검색하기] 하나`);
    assert.ok(r.r3.pass, `${width}px R3 오렌지 ${r.r3.ratio} > 5% (주 버튼 포함)`);
  }

  // 다시 끄면 바로 사라진다
  await setFeatures([]);
  await setSetting("home_search_chips", []);
  page = await openHome({ width: 1280, height: 800 });
  assert.deepEqual(hits(await hrefs(page), GATED).filter((h) => !ALWAYS_OPEN.has(pathOf(h))), []);
  assert.equal(await page.locator('form[action="/search"]').count(), 0);
  await page.close();
});

test("c) 사이트 안 이동은 화면 전환 — 워드마크로 홈, 상단 메뉴·4대 분야 카드로 허브, 뒤로 가기까지 문서 새로고침 0·페이지 표식 유지", async () => {
  const page = await openHome({ width: 1280, height: 800 });
  await page.evaluate(() => {
    window.__e2eMarker = "kept";
  });
  const documents = [];
  page.on("request", (r) => {
    if (r.resourceType() === "document") documents.push(new URL(r.url()).pathname);
  });
  await page.locator('header a[href="/"]').click();
  await page.waitForLoadState("networkidle");
  assert.equal(await page.evaluate(() => window.__e2eMarker), "kept", "워드마크 링크로 홈 — 문서 새로고침 없음");
  assert.deepEqual(documents, []);
  assert.equal(await page.evaluate(() => performance.getEntriesByType("navigation").length), 1);

  // 허브(3단계) — 상단 메뉴·4대 분야 카드로 가고 뒤로 가기로 돌아와도 같은 문서(표식 유지), 지금 보는 분야 표시
  for (const [selector, hub, name] of [
    ['nav[aria-label="분야 메뉴"] a[href="/tax"]', "tax", "지방세"],
    ['[data-ui="field-cards"] a[href="/finance"]', "finance", "부동산개발금융"],
  ]) {
    await page.locator(selector).click();
    await page.waitForURL(`${base}/${hub}`);
    await page.locator(`[data-ui="hub"][data-hub="${hub}"]`).waitFor();
    assert.equal(await page.locator('nav[aria-label="분야 메뉴"] a[aria-current="page"]').textContent(), name);
    await page.goBack();
    await page.waitForURL(`${base}/`);
    await page.locator('[data-home-section="fields"]').waitFor();
  }
  assert.equal(await page.evaluate(() => window.__e2eMarker), "kept", "허브를 오가도 문서 새로고침 0");
  assert.deepEqual(documents, []);
  assert.equal(await page.evaluate(() => performance.getEntriesByType("navigation").length), 1);
  await page.close();
});

test("f) 360px — 가로 스크롤 0(메뉴 닫힘·열림), 메뉴 버튼·메뉴 항목·바닥글 링크 터치 영역 44px 이상", async () => {
  await setFeatures(["search", "calc", "page_about", "page_privacy"]);
  const page = await openHome({ width: 360, height: 740 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok((await overflow()) <= 0, "메뉴 닫힘");
  const button = page.getByRole("button", { name: "메뉴", exact: true });
  const box = await button.boundingBox();
  assert.ok(box.width >= 44 && box.height >= 44, `메뉴 버튼 ${box.width}×${box.height}`);
  await button.click();
  assert.equal(await button.getAttribute("aria-expanded"), "true");
  assert.ok((await overflow()) <= 0, "메뉴 열림");
  // 펼친 분야의 하위 메뉴까지 — 닫힌 하위 메뉴(hidden)는 화면에 없으므로 보이는 것만 잰다
  await page.getByRole("button", { name: "지방세 하위 메뉴" }).click();
  const targets = await page.$$eval('header nav a, header nav button, nav[aria-label="바닥글 메뉴"] a', (els) =>
    els.filter((e) => e.getClientRects().length > 0).map((e) => ({ t: e.textContent, ...e.getBoundingClientRect().toJSON() })),
  );
  assert.ok(targets.length >= 4 + 4 + 1 + 2 + 2, `메뉴 항목 ${targets.length}개 (분야 4 · 펼침 단추 4 · 하위 메뉴 1 · 유틸 2 · 바닥글 2)`);
  for (const t of targets) assert.ok(t.height >= 44 && t.width >= 44, `${t.t}: ${t.width}×${t.height}`);
  assert.ok((await overflow()) <= 0, "하위 메뉴 펼침");
  await page.close();
  await setFeatures([]);
});

test("f) 견본(/_design)·백오피스는 공개 틀 밖 — 공개 바닥글·건너뛰기 링크·본문 자리(main#main) 0, 백오피스 AI 도우미 런처 0", async () => {
  const page = await browser.newPage();
  for (const p of ["/_design", "/admin/login"]) {
    await page.goto(`${base}${p}`, { waitUntil: "load" });
    assert.equal(await page.getByText("이 사이트의 정보는 일반 정보이며 세무 자문이 아닙니다.").count(), 0, `${p}: 공개 바닥글 0`);
    assert.equal(await page.locator("main#main").count(), 0, `${p}: 공개 본문 자리 0`);
    assert.equal(await page.getByRole("link", { name: "본문으로 건너뛰기" }).count(), 0, `${p}: 공개 건너뛰기 링크 0`);
  }
  assert.equal(await page.locator('[data-ui="assistant-launcher"]').count(), 0);
  const robots = await page.getAttribute('meta[name="robots"]', "content");
  assert.match(robots ?? "", /noindex/);
  await page.goto(`${base}/`, { waitUntil: "load" });
  assert.match((await page.getAttribute('meta[name="robots"]', "content")) ?? "", /noindex/, "공개 홈도 검색 노출 차단 그대로 (SITE_INDEXING off)");
  assert.equal(await page.locator("main#main").count(), 1);
  assert.equal(await page.getByRole("link", { name: "본문으로 건너뛰기" }).count(), 1);
  await page.close();
});

test("g) 단계가 바뀌면 — 편집국 쓰기는 바로 홈에 반영(캐시 만료), 손으로 고친 DB 값은 1분 안에(시간 재검증)", async () => {
  let page = await openHome();
  assert.equal((await trackerCards(page))[0].stage, "pre_notice");
  await page.close();

  // A가 공포 — DB에 직접 기록. 캐시가 있어 바로는 그대로다
  await stageEvent(fx.trackerA, "promulgated", TODAY);
  page = await openHome();
  assert.equal((await trackerCards(page))[0].stage, "pre_notice", "캐시 — 직접 고친 DB 값은 아직 안 보인다");
  await page.close();
  // 편집국 쓰기(배치 순서 고치기) → 공개 데이터 캐시 만료 → 다음 요청이 새로 읽는다
  const patched = await api("PATCH", `/home-curations/${fx.curationA}`, u.editor, { sort: 15 });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  page = await openHome();
  let [a] = await trackerCards(page);
  assert.deepEqual([a.stage, a.label, a.unconfirmed], ["promulgated", "공포", 0], "공포 뒤에는 '확정 아님' 0");
  await page.close();

  // B에 시행일(30일 뒤) 기록 — 편집국 쓰기 없이 DB만. 30초 재검증으로 1분 안에 '시행 예정'
  const started = Date.now();
  await stageEvent(fx.trackerB, "effective", kstDay(30));
  let label = null;
  while (Date.now() - started < 70_000) {
    page = await openHome();
    label = (await trackerCards(page)).find((c) => c.id === fx.trackerB)?.label ?? null;
    await page.close();
    if (label === "시행 예정") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const elapsed = Date.now() - started;
  assert.equal(label, "시행 예정", `70초 동안 반영되지 않았다 (${elapsed}ms)`);
  assert.ok(elapsed < 60_000, `1분 안에 반영 — ${elapsed}ms`);
});

test("공개 데이터를 읽지 못하면(접속값 없음·DB 꺼짐) 닫힌 홈 200 — 상단 메뉴 4·4대 분야 카드·안내 한 줄, 유틸 메뉴·정책 링크·히어로 0", async () => {
  for (const env of [{}, { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9", NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey }]) {
    const down = await startServer(env);
    try {
      await setFeatures(["search", "page_privacy"]); // 켜져 있어도 읽지 못하면 닫힌 쪽
      const res = await fetch(`${down.base}/`);
      assert.equal(res.status, 200);
      const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
      await page.goto(`${down.base}/`, { waitUntil: "networkidle" });
      assert.deepEqual((await sectionLayout(page)).map((s) => s.key), ["fields"]);
      assert.equal(await page.locator('[role="status"]').textContent(), "새 소식을 잠시 불러오지 못했습니다. 잠시 뒤 다시 확인해 주세요.");
      assert.deepEqual(await page.$$eval('nav[aria-label="분야 메뉴"] [data-part="section-link"]', (as) => as.map((a) => a.getAttribute("href"))), ["/tax", "/realestate", "/finance", "/local"]);
      assert.deepEqual(hits(await hrefs(page), GATED).filter((h) => !ALWAYS_OPEN.has(pathOf(h))), []);
      assert.equal(await page.locator("h1").count(), 1, "페이지 제목 1개 (화면 읽기용)");
      await page.close();
      // 닫힌 화면은 한 곳(lib/server/public/fallback.ts readPublic)이 로그를 남긴다 — "[public] <화면> — 공개 데이터를 읽지 못해 …"
      assert.match(down.log(), /\[public\] (홈|화면 틀) — 공개 데이터를 읽지 못해/, "원인은 서버 로그에 남는다");
    } finally {
      down.stop();
      await setFeatures([]);
    }
  }
});

test("시험 동안 예상 못 한 서버 오류가 없었다", () => {
  assert.doesNotMatch(server.log(), /\[api\] 처리 중 오류|\[public\]/);
});
