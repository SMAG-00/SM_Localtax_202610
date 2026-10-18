// 통합 검색 화면·API E2E (W2-d 2단계 — SRCH-01 · SRCH-02 · HOME-01 · HOME-02 · UX-05 · UX-06 · W2-c search_submitted, docs/dev/W2-d_설계.md 1장 2단계 증거)
// standalone 빌드를 로컬 Supabase에 붙인다. 상황 카드·용어·운영 설정(기능 키·추천 검색어)은 편집국 API로, 공개 기사·개정 트래커는 DB에 직접 넣는다(다른 공개 화면 E2E와 같다).
//  a) 기능 키 search가 꺼져 있으면 /search·/api/search 404, 홈·허브에 /search 링크·검색 폼 0 → 켜면(API) 배포 없이 헤더 '검색'·히어로 검색 폼, 히어로에서 찾으면 /search?q=
//  b) 띄어쓰기 변형 같은 결과(화면) — '취득세'·'취득 세', '재건축'·'재 건축' · "차 팔았" → 상황 · "개편안" → 트래커(링크 0·현재 단계 원문·확정 아님)
//  c) JS를 꺼도 — 탭은 주소 링크, 거르개·검색은 GET 폼, 쪽 넘김 링크 · reported_news만 고르면 다른 유형·다른 종류 0 · 지역 거르개
//  d) 결과 없음 — 추천 검색어 3개(설정 — 지금 검색어는 뺀다)·상황 카드(공개만)·[AI 도우미에게 묻기] 0 · 상황 카드를 누르면 situation_card_clicked(search_empty)
//  e) 결과 목록에 도우미 답변 0 · 비공개 행(초안 기사·감수 전 상황·비공개 트래커·숨긴 인물) 0 — 화면과 API 모두
//  f) search_submitted — 저장된 행의 속성 칸은 정확히 4개, 검색어 원문 0, 탭을 바꿔도 1건, 새 검색이면 또 1건
//  g) /api/search — 틀린 입력 400(칸마다 사유)·어떤 입력에도 500 0 · no-store · 같은 IP 상한(1분 120) 넘으면 429
//  h) 화면 규칙 R1~R3(360·640·1024 — R1은 360) · 360px 가로 스크롤 0 · 터치 44px · noindex·no-store · 접근성 95
// 만든 계정·기사·상황·트래커·용어·감사 로그·측정 이벤트는 끝나면 지우고, 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { measurePage } from "./lib/screen-rules.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "site-search-e2e@example.test";
const SITE = "https://e2e.example.test";
const CHIPS = ["취득세", "개편안", "책임준공", "재산세"];
const EVENT_PROPS = ["query_length", "region_classified", "result_count", "result_type_count"];

let sb, server, staff, db, browser, base, port, M;
const u = {};
const fx = { pageArticles: [] };

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
const show = (r) => JSON.stringify(r.body).slice(0, 800);

async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function setSetting(key, value) {
  const r = await api("PATCH", `/settings/${key}`, u.admin, { value });
  assert.equal(r.status, 200, show(r));
}

async function setFeatures(on) {
  const current = (await one("select value from public.settings where key = 'feature_flags'")).value;
  await setSetting("feature_flags", Object.fromEntries(Object.keys(current).map((k) => [k, on.includes(k)])));
}

/** 공개 검색 API — 머리글(속도 제한 열쇠 등)을 줄 수 있다 */
async function searchApi(qs, headers = {}) {
  const res = await fetch(`${base}/api/search?${qs}`, { headers });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}

async function article(label, over = {}) {
  const { rows } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, reporting_method, status, author_id, body, region_codes, first_published_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id, slug`,
    [
      `e2e-search-${label}-${staff.run}`,
      over.title,
      over.summary ?? "무엇이 바뀌고 누구에게 영향이 있는지 정리했습니다.",
      over.section ?? "tax",
      over.contentType ?? "explainer",
      over.contentType === "reported_news" ? "qualitative" : null,
      over.status ?? "published",
      u.reporter.personId,
      JSON.stringify({ blocks: [{ type: "paragraph", text: over.text ?? "본문 첫 문단입니다." }], claims: [] }),
      over.regionCodes ?? [],
      over.publishedAt ?? hoursAgo(24),
    ],
  );
  staff.trackArticle(rows[0].id);
  return { id: Number(rows[0].id), slug: rows[0].slug };
}

async function amendment(label, title, status) {
  const am = await one("insert into public.amendments (slug, title, status, law_names) values ($1, $2, $3, '{지방세법}') returning id", [`e2e-search-am-${label}-${staff.run}`, title, status]);
  staff.trackRow("amendments", am.id);
  const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e', 'https://www.mois.go.kr/e2e-search', 'h', '원문') returning id");
  await db.query(
    "insert into public.amendment_events (amendment_id, stage, occurred_on, source_url, snapshot_id, recorded_by) values ($1, 'pre_notice', current_date - 3, 'https://www.mois.go.kr/e2e-search', $2, 'user:e2e')",
    [am.id, snap.id],
  );
  return Number(am.id);
}

/** 상황 카드 — 편집자가 만들고(검색 별칭 포함) 감수위원 서명 뒤 편집자가 공개 (publish=false면 감수 전 그대로) */
async function situation(label, body, publish) {
  const checks = [{ title: "자동차세를 미리 냈는지" }, { title: "등록 말소일" }, { title: "돌려받을 계좌" }];
  const r = await api("POST", "/situations", u.editor, { slug: `e2e-search-${label}-${staff.run}`, section: "tax", pictogram: "car-sold", checks, ...body });
  assert.equal(r.status, 201, show(r));
  const id = r.body.situation.id;
  staff.trackRow("situations", id);
  if (publish) {
    const row = await one("select updated_at from public.situations where id = $1", [id]);
    assert.equal((await api("POST", `/situations/${id}/review`, u.reviewer, { updatedAt: row.updated_at.toISOString() })).status, 200);
    assert.equal((await api("PATCH", `/situations/${id}`, u.editor, { visible: true })).status, 200);
  }
  return { id, slug: r.body.situation.slug };
}

const searchUrl = (q, extra = "") => `${base}/search?q=${encodeURIComponent(q)}${extra}`;
const hitsOf = (page) => page.$$eval("[data-search-hit]", (els) => els.map((e) => `${e.getAttribute("data-kind")}:${e.getAttribute("data-ref")}`));
const sorted = (xs) => [...xs].sort();

async function open(url, { viewport = { width: 1280, height: 800 }, javaScriptEnabled = true } = {}) {
  const context = await browser.newContext({ viewport, javaScriptEnabled });
  const page = await context.newPage();
  const res = await page.goto(url, { waitUntil: javaScriptEnabled ? "networkidle" : "load" });
  return { context, page, res };
}

/** 이 시험 동안 생긴 측정 이벤트 (이름) */
const eventsSince = async (name, since) => (await db.query("select * from public.analytics_events where name = $1 and occurred_at >= $2 order by id", [name, since])).rows;
async function waitEvents(name, since, n) {
  for (let i = 0; i < 50; i++) {
    const rows = await eventsSince(name, since);
    if (rows.length >= n) return rows;
    await new Promise((r) => setTimeout(r, 100));
  }
  return eventsSince(name, since);
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
  M = `검색시험${staff.run}`;
  u.editor = await staff.createUser({ label: "search-editor", roles: ["editor"], person: { name: "검색 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "search-reporter", roles: ["reporter"], person: { name: "김가온", roles: ["reporter"] } });
  u.reviewer = await staff.createUser({ label: "search-reviewer", roles: ["reviewer"], person: { name: "검색 시험 감수위원", roles: ["reviewer"] } });
  u.admin = await staff.createUser({ label: "search-admin", email: ADMIN_EMAIL });
  port = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
});

after(async () => {
  try {
    await browser?.close();
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

test("시험 자료 — 공개 기사·트래커는 DB, 상황 카드(검색 별칭)·용어는 편집국 API, 비공개 행도 같은 표식으로", async () => {
  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  assert.equal(flags.search, false, "시험 전 기능 키 search는 꺼져 있어야 한다 (기본값 — 설계 12장 #17)");
  fx.explainer = await article("explainer", { title: `${M} 취득세 감면 안내`, publishedAt: hoursAgo(2) });
  fx.guide = await article("guide", { title: `${M} 부동산 거래 신고`, section: "realestate", contentType: "guide", text: "주택을 사면 취득 세 신고를 60일 안에 합니다." });
  fx.report = await article("report", { title: `${M} 취득세 보도`, contentType: "reported_news", regionCodes: ["1100000000"], publishedAt: hoursAgo(1) });
  fx.rebuild = await article("rebuild", { title: `${M} 재건축 조합원이 내는 세금`, contentType: "reported_news", section: "realestate" });
  fx.draft = await article("draft", { title: `${M} 취득세 초안 재건축 개편안`, status: "draft" });
  for (let i = 1; i <= 22; i++) fx.pageArticles.push((await article(`page${i}`, { title: `${M} 쪽넘김 시험 ${i}`, publishedAt: hoursAgo(30 + i) })).id);

  fx.tracker = await amendment("reform", `2026년 지방세제 개편안 ${M}`, "public");
  fx.privateTracker = await amendment("private", `${M} 비공개 개편안`, "draft");
  fx.hiddenPerson = Number((await one("insert into public.people (slug, name, roles, visibility) values ($1, $2, '{reporter}', 'hidden') returning id", [`e2e-search-hidden-${staff.run}`, `${M} 숨은 기자`])).id);
  staff.personIds.add(fx.hiddenPerson);

  fx.car = await situation("car", { title: "차를 팔았어요·폐차했어요", subtitle: "돌려받을 자동차세가 있는지 확인합니다", aliases: ["차 팔았어요", "폐차", M] }, true);
  fx.hiddenSituation = await situation("hidden", { title: `${M} 감수 전 상황`, aliases: ["감수전별칭"] }, false);
  const term = await api("POST", "/glossary", u.editor, { term: `${M} 취득세`, plain: "부동산을 살 때 내는 지방세", jargon: true, section: ["tax"], visible: true });
  assert.equal(term.status, 201, show(term));
  fx.term = term.body.term.id;
  staff.trackRow("glossary_terms", fx.term);
  await setSetting("home_search_chips", CHIPS);
});

test("a) 기능 키 search가 꺼져 있으면 /search·/api/search 404, 홈·허브에 /search 링크·검색 폼 0 → 켜면 헤더 '검색'·히어로 검색 폼, 히어로에서 찾으면 결과 화면", async () => {
  assert.equal((await fetch(`${base}/search?q=${encodeURIComponent(M)}`)).status, 404);
  assert.equal((await fetch(`${base}/search`)).status, 404);
  assert.equal((await searchApi(`q=${encodeURIComponent(M)}`)).status, 404);
  for (const p of ["/", "/tax", "/news"]) {
    const { context, page } = await open(`${base}${p}`);
    const links = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
    assert.deepEqual(links.filter((h) => h === "/search" || h.startsWith("/search?") || h.startsWith("/search/")), [], `${p}: /search 링크 0`);
    assert.equal(await page.locator('form[action="/search"]').count(), 0, `${p}: 검색 폼 0`);
    await context.close();
  }

  await setFeatures(["search"]);
  const { context, page } = await open(`${base}/`);
  assert.deepEqual(await page.$$eval('nav[aria-label="유틸 메뉴"] a', (as) => as.map((a) => [a.textContent, a.getAttribute("href")])), [["검색", "/search"]]);
  assert.equal(await page.locator('[data-ui="home-search"][action="/search"]').count(), 1);
  await page.fill('[data-ui="home-search"] input[name="q"]', `  ${M} 취득세  `);
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => url.pathname === "/search");
  await page.locator("[data-search-hit]").first().waitFor();
  assert.equal(new URL(page.url()).searchParams.get("q"), `${M} 취득세`, "히어로는 앞뒤 공백을 지우고 /search?q=로 보낸다");
  assert.equal(await page.locator("h1").textContent(), `‘${M} 취득세’ 검색 결과`);
  await context.close();
});

test("b) 띄어쓰기 변형 같은 결과(화면) — '취득세'·'취득 세', '재건축'·'재 건축' · 공개 행만", async () => {
  const pairs = [
    [`${M} 취득세`, `${M} 취득 세`],
    [`${M} 재건축`, `${M} 재 건축`],
  ];
  for (const [a, b] of pairs) {
    const results = [];
    for (const q of [a, b]) {
      const { context, page } = await open(searchUrl(q));
      results.push(sorted(await hitsOf(page)));
      await context.close();
    }
    assert.ok(results[0].length > 0, `${a}: 결과가 있어야 한다`);
    assert.deepEqual(results[1], results[0], `'${a}'와 '${b}'는 같은 결과`);
  }
  const { context, page } = await open(searchUrl(`${M} 취득세`));
  const hits = await hitsOf(page);
  for (const id of [fx.explainer.id, fx.guide.id, fx.report.id]) assert.ok(hits.includes(`article:${id}`), `기사 ${id}`);
  assert.ok(hits.includes(`glossary:${fx.term}`), "용어");
  assert.ok(!hits.includes(`article:${fx.draft.id}`), "초안 기사 0");
  // 종류별 묶음 — 기사와 다른 종류를 섞지 않는다, 유형 표시
  assert.deepEqual(await page.$$eval('[data-part="hit-group"]', (els) => els.map((e) => e.getAttribute("data-kind"))), ["glossary", "article"]);
  assert.deepEqual(await page.$$eval('[data-part="hit-group"][data-kind="glossary"] [data-part="type-label"]', (els) => els.map((e) => e.textContent)), ["용어"]);
  const badges = await page.$$eval('[data-part="hit-group"][data-kind="article"] [data-search-hit]', (els) => els.map((e) => [e.getAttribute("data-content-type"), e.querySelector('[data-ui="article-type-badge"]')?.textContent]));
  assert.deepEqual(new Map(badges), new Map([["reported_news", "보도"], ["explainer", "해설"], ["guide", "가이드"]]));
  assert.equal(await page.locator('[data-search-hit][data-kind="glossary"] a').count(), 0, "기능 키 glossary가 꺼져 있으면 — 용어 결과에 링크 0 (켜진 모습은 site-glossary)");
  const articleLink = await page.locator(`[data-search-hit][data-ref="${fx.explainer.id}"] h3 a`).getAttribute("href");
  assert.equal(articleLink, `/news/${fx.explainer.slug}`);
  await context.close();
});

test("b) \"차 팔았\" → '차를 팔았어요·폐차했어요' 상황 · \"개편안\" → 「2026년 지방세제 개편안」 트래커(링크 0·현재 단계 원문 새 창·확정 아님)", async () => {
  let { context, page } = await open(searchUrl("차 팔았"));
  const car = page.locator(`[data-search-hit][data-kind="situation"][data-ref="${fx.car.id}"]`);
  assert.equal(await car.count(), 1, "차 팔았 → 상황");
  assert.equal(await car.locator("h3 a").getAttribute("href"), `/situations/${fx.car.slug}`);
  assert.equal(await car.locator('[data-part="type-label"]').textContent(), "상황");
  await context.close();

  ({ context, page } = await open(searchUrl("개편안")));
  const tracker = page.locator(`[data-search-hit][data-kind="tracker"][data-ref="${fx.tracker}"]`);
  assert.equal(await tracker.count(), 1, "개편안 → 트래커");
  assert.equal(await page.locator(`[data-search-hit][data-kind="tracker"][data-ref="${fx.privateTracker}"]`).count(), 0, "비공개 트래커 0");
  assert.equal(await tracker.locator('a[href^="/tax/amendments"]').count(), 0, "트래커 화면(기능 키 amendments) 전 — 트래커 링크 0");
  const source = tracker.locator('a[target="_blank"]');
  assert.equal(await source.getAttribute("href"), "https://www.mois.go.kr/e2e-search");
  assert.equal(await source.getAttribute("rel"), "noopener noreferrer");
  assert.equal(await tracker.locator('[data-ui="unconfirmed-chip"]').textContent(), "확정 아님");
  await context.close();
});

test("c) JS를 꺼도 — 탭은 주소 링크, 거르개는 GET 폼(reported_news만 → 다른 유형·종류 0, 지역), 쪽 넘김, 검색 폼", async () => {
  const { context, page } = await open(searchUrl(`${M} 취득세`), { javaScriptEnabled: false });
  // JS가 꺼져 있으면 링크·폼마다 문서를 새로 받는다 (JS가 켜져 있으면 사이트 안 링크는 화면 전환 — 문서 요청 0)
  const documents = [];
  page.on("request", (r) => {
    if (r.resourceType() === "document") documents.push(new URL(r.url()).search);
  });
  const tabs = await page.$$eval('[data-ui="tab-nav"] a', (as) => as.map((a) => [a.textContent, a.getAttribute("aria-current")]));
  assert.deepEqual(tabs.map((t) => t[0].split(" ")[0]), ["전체", "기사", "용어"], "결과 있는 탭만 (행사·전문가 탭 0)");
  assert.equal(tabs[0][1], "page");
  await page.locator('[data-ui="tab-nav"] a', { hasText: "기사" }).click();
  await page.waitForURL((url) => url.searchParams.get("tab") === "article");
  assert.equal(documents.length, 1, "탭 링크 — 문서를 새로 받았다(JS 꺼짐)");
  assert.match(documents[0], /tab=article/);
  assert.ok((await hitsOf(page)).every((h) => h.startsWith("article:")), "기사 탭 — 기사만");
  assert.equal(await page.locator('[data-ui="tab-nav"] a[aria-current="page"]').textContent(), `기사 ${(await hitsOf(page)).length}`);

  // 거르개 — 펼침(details)과 GET 폼
  await page.locator('[data-part="search-filters"] summary').click();
  await page.selectOption("#search-type", "reported_news");
  await page.locator('[data-part="filter-form"] button[type="submit"]').click();
  await page.waitForURL((url) => url.searchParams.get("type") === "reported_news");
  const url = new URL(page.url());
  assert.equal(url.searchParams.get("tab"), "article", "거르개는 지금 탭을 지킨다");
  const types = await page.$$eval("[data-search-hit]", (els) => els.map((e) => [e.getAttribute("data-kind"), e.getAttribute("data-content-type")]));
  assert.deepEqual(types, [["article", "reported_news"]], "reported_news만 — 다른 유형 0");
  assert.equal(await page.locator('[data-part="search-filters"]').getAttribute("open"), "", "거르개를 썼으면 펼친 채로");
  // 전체 탭으로 돌아가도 기사 유형 거르개 → 다른 종류(용어·상황) 0
  await page.locator('[data-ui="tab-nav"] a', { hasText: "전체" }).click();
  await page.waitForURL((u2) => !u2.searchParams.has("tab"));
  assert.deepEqual(sorted(await hitsOf(page)), [`article:${fx.report.id}`]);
  // 지역 거르개 — 서울특별시 태그 기사만
  await page.selectOption("#search-type", "");
  await page.selectOption("#search-region", "1100000000");
  await page.locator('[data-part="filter-form"] button[type="submit"]').click();
  await page.waitForURL((u2) => u2.searchParams.get("region") === "1100000000");
  assert.deepEqual(sorted(await hitsOf(page)), [`article:${fx.report.id}`]);
  assert.match(await page.locator('[data-part="search-filters"] summary').textContent(), /지역 서울특별시/);
  await page.getByRole("link", { name: "거르개 지우기" }).click();
  await page.waitForURL((u2) => !u2.searchParams.has("region"));
  assert.ok((await hitsOf(page)).length > 1);

  // 쪽 넘김 — 기사 탭 20개씩
  await page.goto(searchUrl(`${M} 쪽넘김`, "&tab=article"), { waitUntil: "load" });
  assert.equal((await hitsOf(page)).length, 20);
  await page.getByRole("link", { name: "다음 쪽" }).click();
  await page.waitForURL((u2) => u2.searchParams.get("page") === "2");
  assert.equal((await hitsOf(page)).length, 2);
  assert.match(await page.locator('[data-part="pager"]').textContent(), /2쪽 · 모두 22건/);
  assert.equal(await page.getByRole("link", { name: "다음 쪽" }).count(), 0);

  // 검색 폼 (JS 없이 GET) — 새 검색어
  await page.fill("#search-q", "개편안");
  await page.keyboard.press("Enter");
  await page.waitForURL((u2) => u2.searchParams.get("q") === "개편안");
  assert.ok((await hitsOf(page)).includes(`tracker:${fx.tracker}`));
  // 빈 검색어 — 안내 문구, 검색하지 않는다
  await page.fill("#search-q", "   ");
  await page.keyboard.press("Enter");
  await page.waitForLoadState("load");
  assert.equal(await page.locator("#search-q-error").textContent(), "검색어를 입력해 주세요.");
  assert.equal(await page.locator("#search-q").getAttribute("aria-invalid"), "true");
  assert.equal(await page.locator("[data-search-hit]").count(), 0);
  await context.close();
});

test("d) 결과 없음 — 추천 검색어 3개(설정, 지금 검색어는 뺀다)·상황 카드(공개만)·[AI 도우미에게 묻기] 0, 카드를 누르면 situation_card_clicked(search_empty)", async () => {
  const since = new Date();
  const { context, page } = await open(searchUrl(`없는낱말${M}`));
  assert.equal(await page.locator('[data-search-part="empty"] h2').textContent(), `‘없는낱말${M}’ 결과가 없습니다`);
  assert.deepEqual(await page.$$eval('[data-part="search-suggestions"] a', (as) => as.map((a) => [a.textContent, a.getAttribute("href")])), CHIPS.slice(0, 3).map((c) => [c, `/search?q=${encodeURIComponent(c)}`]));
  const cards = await page.$$eval('[data-part="search-situations"] [data-situation-slug]', (els) => els.map((e) => e.getAttribute("data-situation-slug")));
  assert.ok(cards.includes(fx.car.slug), "공개 상황 카드");
  assert.ok(!cards.includes(fx.hiddenSituation.slug), "감수 전 상황 0");
  assert.equal(await page.locator('[data-part="ask-assistant"]').count(), 0);
  assert.equal(await page.getByText("AI 도우미에게 묻기").count(), 0, "도우미 공개 승인 전 — 링크 0");
  assert.equal(await page.locator('[data-ui="tab-nav"]').count(), 0, "결과가 없으면 탭 0");
  await page.locator(`[data-situation-slug="${fx.car.slug}"] a`).click();
  await page.waitForURL(`${base}/situations/${fx.car.slug}`);
  const clicks = await waitEvents("situation_card_clicked", since, 1);
  assert.deepEqual(clicks.map((e) => [e.section, e.props]), [["tax", { situation: fx.car.slug, position: "search_empty" }]]);
  await context.close();

  // 지금 검색어가 추천 검색어면 빼고 다음 칩으로 (책임준공 — 결과 0)
  const again = await open(searchUrl("책임 준공"));
  assert.deepEqual(await again.page.$$eval('[data-part="search-suggestions"] a', (as) => as.map((a) => a.textContent)), ["취득세", "개편안", "재산세"]);
  await again.context.close();
});

test("e) 결과 목록 위·안에 도우미 답변 0 · 비공개 행(초안 기사·감수 전 상황·비공개 트래커·숨긴 인물) 0 — 화면과 API 모두", async () => {
  const { context, page } = await open(searchUrl(M));
  const hits = await hitsOf(page);
  assert.ok(hits.includes(`situation:${fx.car.id}`), "별칭에 표식이 든 공개 상황은 찾힌다");
  for (const hidden of [`article:${fx.draft.id}`, `situation:${fx.hiddenSituation.id}`, `tracker:${fx.privateTracker}`, `person:${fx.hiddenPerson}`]) assert.ok(!hits.includes(hidden), `${hidden} 0`);
  for (const sel of ['[data-ui="answer-card"]', '[data-ui="assistant-panel"]', '[data-ui="assistant-launcher"]']) assert.equal(await page.locator(`main ${sel}`).count(), 0, `${sel} 0`);
  assert.equal(await page.locator("main").getByText("AI 답변").count(), 0);
  await context.close();

  for (const tab of ["all", "article", "tracker", "region", "glossary"]) {
    const r = await searchApi(`q=${encodeURIComponent(M)}&tab=${tab}`);
    assert.equal(r.status, 200);
    const refs = r.body.items.map((i) => `${i.kind}:${i.ref}`);
    for (const hidden of [`article:${fx.draft.id}`, `situation:${fx.hiddenSituation.id}`, `tracker:${fx.privateTracker}`, `person:${fx.hiddenPerson}`]) assert.ok(!refs.includes(hidden), `API ${tab}: ${hidden} 0`);
  }
  const alias = await searchApi(`q=${encodeURIComponent("감수전별칭")}`);
  assert.equal(alias.body.total, 0, "감수 전 상황의 별칭으로도 0");
});

test("f) search_submitted — 저장된 속성 칸은 정확히 4개·검색어 원문 0, 탭·쪽만 바꾸면 그대로 1건, 새 검색이면 또 1건", async () => {
  const since = new Date();
  const q = `${M} 취득세`;
  const expected = (await searchApi(`q=${encodeURIComponent(q)}`)).body;
  const { context, page } = await open(searchUrl(q));
  let rows = await waitEvents("search_submitted", since, 1);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0].props).sort(), EVENT_PROPS);
  assert.deepEqual(rows[0].props, {
    query_length: [...q].length,
    result_count: Object.values(expected.counts).reduce((a, b) => a + b, 0),
    result_type_count: Object.values(expected.counts).filter((n) => n > 0).length,
    region_classified: false,
  });
  const raw = JSON.stringify(rows[0]);
  for (const piece of [M, "취득세", encodeURIComponent(q)]) assert.ok(!raw.includes(piece), `저장된 행에 검색어 조각 '${piece}' 0`);
  assert.equal(rows[0].section, null);

  // 탭을 바꿔도(화면 전환) 같은 검색 — 이벤트 0
  await page.locator('[data-ui="tab-nav"] a', { hasText: "기사" }).click();
  await page.waitForURL((url) => url.searchParams.get("tab") === "article");
  await page.waitForLoadState("networkidle");
  await new Promise((r) => setTimeout(r, 500));
  assert.equal((await eventsSince("search_submitted", since)).length, 1, "탭을 바꾸면 새 검색이 아니다");
  // 새 검색 — 지역 이름만 쓴 검색어는 지역 분류 참
  await page.fill("#search-q", "서울특별시");
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => url.searchParams.get("q") === "서울특별시");
  rows = await waitEvents("search_submitted", since, 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].props.region_classified, true);
  assert.equal(rows[1].props.query_length, 5);
  assert.ok(!JSON.stringify(rows[1]).includes("서울특별시"));
  await context.close();
});

test("g) /api/search — 틀린 입력 400(칸마다 사유)·어떤 입력에도 500 0 · 200은 no-store · 같은 IP 한꺼번에 140번이면 상한(120) 넘는 요청은 429", async () => {
  const bad = [
    "",
    "q=",
    "q=%20%20",
    `q=${encodeURIComponent("가".repeat(101))}`,
    "q=a&tab=place",
    "q=a&tab=article&page=0",
    "q=a&tab=article&page=99999",
    "q=a&page=2",
    "q=a&section=seoul",
    "q=a&type=digest",
    "q=a&region=12",
    "q=a&from=2026-13-01",
    "q=a&from=2026-10-20&to=2026-10-19",
    "q=a&q=b",
    "q=a&unknown=1",
  ];
  for (const qs of bad) {
    const r = await searchApi(qs);
    assert.equal(r.status, 400, `${qs}: ${r.status} ${JSON.stringify(r.body)}`);
    assert.ok(Array.isArray(r.body.errors) && r.body.errors.length > 0, `${qs}: 칸마다 사유`);
    assert.equal(r.headers.get("cache-control"), "no-store");
  }
  for (const odd of [`q=${encodeURIComponent("?!·")}`, `q=${encodeURIComponent("'; drop table articles; --")}`, `q=${encodeURIComponent('"()|*\\')}`, `q=${encodeURIComponent("가".repeat(100))}`, "q=a&tab=event", "q=%E0%A4%A"]) {
    const r = await searchApi(odd);
    assert.equal(r.status, 200, `${odd}: ${r.status}`);
    assert.ok(Array.isArray(r.body.items));
  }
  const ok = await searchApi(`q=${encodeURIComponent(`${M} 취득세`)}&tab=article&type=reported_news`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.deepEqual(ok.body.items.map((i) => [i.kind, i.contentType]), [["article", "reported_news"]]);
  assert.equal(ok.body.total, 1);
  assert.equal(ok.body.tab, "article");

  // 속도 제한 — 이 시험만의 IP(문서용 주소)로 한꺼번에 140번(틀린 입력도 센다): 상한 120번 남짓은 받고 나머지는 429
  // (통은 1분에 120개씩 다시 차므로 보내는 동안 한두 개 더 받을 수 있다)
  const ip = { "x-real-ip": "198.51.100.77" };
  const burst = await Promise.all(Array.from({ length: 140 }, () => searchApi("q=", ip)));
  const statuses = burst.map((r) => r.status);
  const accepted = statuses.filter((s) => s === 400).length;
  assert.ok(accepted >= 120 && accepted <= 125, `받은 요청 ${accepted}개 (상한 120)`);
  assert.equal(accepted + statuses.filter((s) => s === 429).length, 140, `400·429 밖의 상태 0: ${[...new Set(statuses)]}`);
  const limited = burst.find((r) => r.status === 429);
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  assert.equal(limited.headers.get("cache-control"), "no-store");
  assert.equal((await searchApi(`q=${encodeURIComponent(M)}`, { "x-real-ip": "198.51.100.78" })).status, 200, "다른 IP는 그대로");
  assert.doesNotMatch(server.log(), /\[search\]|\[api\] 처리 중 오류/, "검색 API 서버 오류 0");
});

test("h) 화면 규칙 R1~R3 — 결과·결과 없음·첫 화면, 폭 360·640·1024 (R1은 360×740)", async () => {
  for (const url of [searchUrl(`${M} 취득세`), searchUrl(`${M} 쪽넘김`, "&tab=article"), searchUrl(`없는낱말${M}`), `${base}/search`]) {
    for (const width of [360, 640, 1024]) {
      const r = await measurePage(browser, url, { width, height: 740 });
      console.log(`화면 규칙 ${url.replace(base, "").slice(0, 40)} ${r.viewport} — R1 ${r.r1.chars}자 · R2 ${r.r2.maxPerViewport}개 · R3 ${(r.r3.ratio * 100).toFixed(2)}%`);
      if (width === 360) assert.ok(r.r1.pass, `${url} ${width}px R1 ${r.r1.chars}자 > 150`);
      assert.ok(r.r2.pass, `${url} ${width}px R2 주 버튼 ${r.r2.maxPerViewport}개`);
      assert.ok(r.r3.pass, `${url} ${width}px R3 오렌지 ${r.r3.ratio}`);
    }
  }
});

test("h) 360px — 가로 스크롤 0(거르개 펼침 포함), 탭·칩·버튼·링크 터치 44px · noindex·no-store", async () => {
  for (const url of [searchUrl(`${M} 취득세`, "&type=reported_news"), searchUrl(`${M} 쪽넘김`, "&tab=article&page=2"), searchUrl(`없는낱말${M}`)]) {
    const { context, page, res } = await open(url, { viewport: { width: 360, height: 740 } });
    assert.match(res.headers()["cache-control"] ?? "", /no-store/, `${url}: no-store`);
    assert.match((await page.getAttribute('meta[name="robots"]', "content")) ?? "", /noindex/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `${url}: 가로 스크롤 ${overflow}px`);
    const targets = await page.$$eval(
      'main [data-ui="tab-nav"] a, main [data-search-hit] h3 a, main [data-part$="suggestions"] a, main [data-part="pager"] a, main summary, main button, main [data-part="hit-group"] p > a',
      (els) => els.filter((e) => e.getClientRects().length > 0).map((e) => ({ t: e.textContent.trim().slice(0, 20), ...e.getBoundingClientRect().toJSON() })),
    );
    assert.ok(targets.length >= 2, `${url}: 잴 요소 ${targets.length}`);
    for (const t of targets) assert.ok(t.height >= 44, `${url} ${t.t}: 높이 ${t.height}`);
    await context.close();
  }
});

test("h) 접근성 95점 이상 — 결과 화면(탭·거르개·결과 목록)과 결과 없음 화면(추천 검색어·상황 카드)", async () => {
  for (const url of [searchUrl(`${M} 취득세`), searchUrl(`없는낱말${M}`)]) {
    const r = await accessibility(url, port);
    assert.ok(r.score >= A11Y_MIN, `${url} 점수 ${r.score} — 실패 항목: ${r.failing.join(", ")}`);
  }
});

test("기능 키를 다시 끄면 바로 — /search 404, 헤더·히어로 검색 0", async () => {
  await setFeatures([]);
  assert.equal((await fetch(searchUrl(M))).status, 404);
  assert.equal((await searchApi(`q=${encodeURIComponent(M)}`)).status, 404);
  const { context, page } = await open(`${base}/`);
  assert.equal(await page.locator('a[href="/search"], form[action="/search"]').count(), 0);
  await context.close();
  assert.doesNotMatch(server.log(), /\[search\]|\[api\] 처리 중 오류|\[public\]|\[db\]/, "시험 동안 예상 못 한 서버 오류 0");
});
