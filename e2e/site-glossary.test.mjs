// 용어사전·본문 용어 풀이 E2E (W2-d 3단계 — GLO-01 · GLO-02 · UX-06, docs/dev/W2-d_설계.md 1장 3단계 증거 · 8.2)
// standalone 빌드를 로컬 Supabase에 붙인다. 용어는 편집국 사전 API로(공개 6 · 숨김 1 — 모두 시험용 가짜 낱말과 가짜 풀이), 공개 기사는 DB에 직접 넣는다.
//  a) 기능 키 glossary가 꺼져 있으면 /glossary·/glossary/[번호] 404, 사이트 안 용어사전 링크 0(홈·허브·기사·검색 결과·용어 칩) — 본문 풀이는 보이되 '용어사전에서 보기' 0
//  b) 켜면 — 가나다 색인에서 공개 용어를 모두 찾는다(DB의 공개 용어 전부) · 숨긴 용어 0 · 영문·숫자 묶음 · 색인 줄은 묶음으로 간다 · 용어마다 정의·쉬운 풀이·관련 용어(쪽 안 링크)·출처
//  c) 분야 거르개(탭) — 고른 분야 용어만 · 용어 쪽 /glossary/[번호] (숨긴 용어·형식 밖 번호 404) · glossary_opened 1건
//  d) 본문 풀이 — 용어마다 한 번(첫 등장) · 숨긴 용어 0 · 제목·링크·상자 제목·인용 발언자 안 0 · 긴 용어 먼저 · 조사가 붙어도 · 키보드 포커스로 열리고 Esc로 닫힌다 ·
//     누르면 열리고 바깥을 누르면 닫힌다 · '용어사전에서 보기' = 용어 쪽 · 키보드로 열면 glossary_opened 1건 · 구조화 데이터의 화면 값(제목) 그대로
//  e) 검색 결과의 용어 링크 = 용어 쪽 (켜졌을 때만) · 허브 용어 칩 링크 (켜졌을 때만)
//  f) 화면 규칙 R1~R3(360·640·1024) · 360px 가로 스크롤 0(풀이를 연 채로도) · 터치 44px · 접근성 95
//  g) 다시 끄면 바로 404·링크 0
// 만든 계정·용어·기사·감사 로그·측정 이벤트는 끝나면 지우고, 운영 설정(기능 키)은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { measurePage } from "./lib/screen-rules.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "site-glossary-e2e@example.test";
const SITE = "https://e2e.example.test";

let sb, server, staff, db, browser, base, port;
const u = {};
const fx = {};
const T = {};

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body).slice(0, 800);
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();

async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function setFeatures(on) {
  const current = (await one("select value from public.settings where key = 'feature_flags'")).value;
  const r = await api("PATCH", "/settings/feature_flags", u.admin, { value: Object.fromEntries(Object.keys(current).map((k) => [k, on.includes(k)])) });
  assert.equal(r.status, 200, show(r));
}

/** 이 실행만의 한글 표식 — 실행 번호(영문·숫자)를 한글 음절로 바꾼다 (가짜 낱말이 진짜 용어와 겹치지 않게) */
function hangulTag(run) {
  const digits = "0123456789abcdefghijklmnopqrstuvwxyz";
  return [...run.slice(-4)].map((c) => {
    const i = digits.indexOf(c);
    return String.fromCodePoint(0xac00 + ((i % 19) * 21 + Math.floor(i / 19) * 4) * 28);
  }).join("");
}

async function term(key, body) {
  const r = await api("POST", "/glossary", u.editor, body);
  assert.equal(r.status, 201, `${key}: ${show(r)}`);
  staff.trackRow("glossary_terms", r.body.term.id);
  T[key] = { id: Number(r.body.term.id), term: body.term };
}

async function open(url, { viewport = { width: 1280, height: 800 }, javaScriptEnabled = true, hasTouch = false } = {}) {
  const context = await browser.newContext({ viewport, javaScriptEnabled, hasTouch });
  const page = await context.newPage();
  const res = await page.goto(url, { waitUntil: javaScriptEnabled ? "networkidle" : "load" });
  return { context, page, res };
}

const glossaryLinks = (page) => page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")).filter((h) => h === "/glossary" || h.startsWith("/glossary/") || h.startsWith("/glossary?") || h.startsWith("/glossary#")));
const articleUrl = () => `${base}/news/${fx.article.slug}`;
const tipCounts = (page) =>
  page.$$eval("[data-glossary-tip]", (els) => {
    const out = {};
    for (const e of els) out[e.getAttribute("data-term-id")] = (out[e.getAttribute("data-term-id")] ?? 0) + 1;
    return out;
  });
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
  u.editor = await staff.createUser({ label: "glossary-editor", roles: ["editor"], person: { name: "용어 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "glossary-reporter", roles: ["reporter"], person: { name: "용어 시험 기자", roles: ["reporter"] } });
  u.admin = await staff.createUser({ label: "glossary-admin", email: ADMIN_EMAIL });
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

test("시험 자료 — 가짜 용어 7개(공개 6·숨김 1)는 사전 API로, 그 용어가 든 공개 기사는 DB에", async () => {
  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  assert.equal(flags.glossary, false, "시험 전 기능 키 glossary는 꺼져 있어야 한다 (기본값 — 설계 2.5)");
  const H = hangulTag(staff.run);
  fx.H = H;
  const plain = (n) => `시험용 가짜 풀이 ${n}`;
  await term("short", { term: `${H}세`, plain: plain("하나"), definition: "시험용 가짜 뜻 하나", related: [`${H}세율`, `${H}숨김말`, "사전에없는말"], section: ["tax"], source: "시험용 가짜 출처", visible: true });
  await term("long", { term: `${H}세율`, plain: plain("둘"), section: ["tax"], visible: true });
  await term("prefix", { term: `지방${H}세`, plain: plain("셋"), section: ["local"], visible: true });
  await term("fin", { term: `${H}금융말`, plain: plain("넷"), section: ["finance"], visible: true });
  await term("latin", { term: `Qz${staff.run}`, plain: plain("다섯"), section: ["realestate"], visible: true });
  await term("noPlain", { term: `${H}풀이없는말`, jargon: false, section: ["tax"], visible: true });
  await term("hidden", { term: `${H}숨김말`, plain: plain("여섯"), section: ["tax"] });
  assert.equal((await one("select visible from public.glossary_terms where id = $1", [T.hidden.id])).visible, false, "공개를 고르지 않으면 숨김");

  const blocks = [
    { type: "paragraph", text: `[${T.short.term} 안내](/news) 목록을 먼저 보세요.` },
    { type: "paragraph", text: `${T.long.term}은 ${T.short.term}를 매기는 비율이다. ${T.short.term}는 두 번 나온다.` },
    { type: "paragraph", text: `${T.prefix.term}와 ${T.short.term} 그리고 ${T.hidden.term}, ${T.noPlain.term}도 있다.` },
    { type: "callout", kind: "info", title: `${T.fin.term} 상자 제목`, text: `상자 글에도 ${T.fin.term}이 있다.` },
    { type: "quote", text: "인용 글입니다.", speaker: `${T.latin.term} 담당자` },
    { type: "paragraph", text: `줄 끝 가까이에 영문 용어가 나오는 문단입니다 ${T.latin.term}` },
  ];
  const { rows } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, body, first_published_at)
     values ($1, $2, $3, 'tax', 'explainer', 'published', $4, $5, $6) returning id, slug`,
    [`e2e-glossary-${staff.run}`, `${T.short.term} 시험 기사`, "용어 풀이를 시험하는 가짜 기사입니다.", u.reporter.personId, JSON.stringify({ blocks, claims: [] }), hoursAgo(2)],
  );
  staff.trackArticle(rows[0].id);
  fx.article = { id: Number(rows[0].id), slug: rows[0].slug };
});

test("a) 기능 키 glossary가 꺼져 있으면 /glossary·/glossary/[번호] 404, 사이트 안 용어사전 링크 0 — 본문 풀이는 보이되 '용어사전에서 보기' 0", async () => {
  await setFeatures(["search"]);
  assert.equal((await fetch(`${base}/glossary`)).status, 404);
  assert.equal((await fetch(`${base}/glossary?section=tax`)).status, 404);
  assert.equal((await fetch(`${base}/glossary/${T.short.id}`)).status, 404);
  for (const p of ["/", "/tax", "/realestate", "/finance", "/local", "/news", `/news/${fx.article.slug}`, `/search?q=${encodeURIComponent(T.short.term)}`]) {
    const { context, page, res } = await open(`${base}${p}`);
    assert.equal(res.status(), 200, p);
    assert.deepEqual(await glossaryLinks(page), [], `${p}: 용어사전 링크 0`);
    await context.close();
  }
  const { context, page } = await open(articleUrl());
  assert.ok((await page.locator("[data-glossary-tip]").count()) >= 5, "꺼져 있어도 본문 풀이는 있다 (GLO-02)");
  assert.equal(await page.locator("[data-tip-pop] a").count(), 0, "'용어사전에서 보기' 0");
  await context.close();
  const search = await open(`${base}/search?q=${encodeURIComponent(T.short.term)}&tab=glossary`);
  assert.equal(await search.page.locator(`[data-search-hit][data-kind="glossary"][data-ref="${T.short.id}"]`).count(), 1, "용어 결과는 있다");
  assert.equal(await search.page.locator('[data-search-hit][data-kind="glossary"] a').count(), 0, "용어 결과 링크 0");
  await search.context.close();
});

test("b) 켜면 /glossary — 가나다 색인에서 공개 용어를 모두 찾는다(DB의 공개 용어 전부) · 숨긴 용어 0 · 묶음 · 정의·쉬운 풀이·관련 용어·출처", async () => {
  await setFeatures(["search", "glossary"]);
  const { context, page, res } = await open(`${base}/glossary`);
  assert.equal(res.status(), 200);
  assert.equal(await page.locator("h1").textContent(), "용어사전");
  const visible = (await db.query("select id from public.glossary_terms where visible")).rows.map((r) => Number(r.id));
  const onPage = (await page.$$eval("[data-glossary-term]", (els) => els.map((e) => Number(e.getAttribute("data-glossary-term"))))).sort((a, b) => a - b);
  assert.deepEqual(onPage, [...visible].sort((a, b) => a - b), "공개 용어마다 한 칸 — 빠짐·겹침 0");
  assert.ok(!onPage.includes(T.hidden.id), "숨긴 용어 0");
  for (const k of ["short", "long", "prefix", "fin", "latin", "noPlain"]) assert.ok(onPage.includes(T[k].id), k);
  // 묶음 — 영문으로 시작하는 용어는 영문·숫자 묶음, '지방…'은 ㅈ
  const groupOf = (id) => page.locator(`[data-glossary-term="${id}"]`).evaluate((el) => el.closest("[data-glossary-group]")?.getAttribute("data-glossary-group"));
  assert.equal(await groupOf(T.latin.id), "A–Z·0–9");
  assert.equal(await groupOf(T.prefix.id), "ㅈ");
  // 색인 줄 — 한글 14자 + 영문·숫자(+ 기타가 있으면), 용어가 있는 묶음만 링크이고 그 묶음 자리로 간다
  const nav = await page.$$eval('[data-part="glossary-index"] li', (lis) => lis.map((li) => [li.textContent.trim(), li.querySelector("a")?.getAttribute("href") ?? null]));
  assert.deepEqual(nav.slice(0, 14).map((n) => n[0]), ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"]);
  const jieut = nav.find((n) => n[0] === "ㅈ");
  assert.ok(jieut[1], "ㅈ 묶음 링크");
  await page.locator(`[data-part="glossary-index"] a[href="${jieut[1]}"]`).click();
  await page.waitForFunction((hash) => location.hash === hash, jieut[1]);
  assert.equal(await page.locator(jieut[1]).getAttribute("data-glossary-group"), "ㅈ");
  // 용어 칸 — 쉬운 풀이·뜻·관련 용어(공개 용어는 쪽 안 자리, 숨긴·없는 용어는 글자)·출처·분야, 제목은 용어 쪽 링크
  const card = page.locator(`[data-glossary-term="${T.short.id}"]`);
  assert.equal(await card.locator("h3 a").getAttribute("href"), `/glossary/${T.short.id}`);
  assert.match(await card.locator('[data-term-part="plain"]').textContent(), /시험용 가짜 풀이 하나/);
  assert.equal((await card.locator('[data-term-part="definition"] dd').textContent()).trim(), "시험용 가짜 뜻 하나");
  assert.equal((await card.locator('[data-term-part="source"] dd').textContent()).trim(), "시험용 가짜 출처");
  const related = await card.locator('[data-part="glossary-related"] li').evaluateAll((lis) => lis.map((li) => [li.textContent.trim(), li.querySelector("a")?.getAttribute("href") ?? null]));
  assert.deepEqual(related, [
    [T.long.term, `#term-${T.long.id}`],
    [T.hidden.term, null],
    ["사전에없는말", null],
  ]);
  await card.locator(`a[href="#term-${T.long.id}"]`).click();
  await page.waitForFunction((hash) => location.hash === hash, `#term-${T.long.id}`);
  assert.equal(await page.locator(`#term-${T.long.id}`).getAttribute("data-glossary-term"), String(T.long.id));
  // 풀이 없는 용어는 풀이 줄 0, 다른 칸은 그대로
  assert.equal(await page.locator(`[data-glossary-term="${T.noPlain.id}"] [data-term-part="plain"]`).count(), 0);
  await context.close();
});

test("c) 분야 거르개(탭 — JS 없이 링크) · 용어 쪽 /glossary/[번호] (숨긴 용어·형식 밖 404) · 용어 쪽을 열면 glossary_opened 1건", async () => {
  const { context, page } = await open(`${base}/glossary`, { javaScriptEnabled: false });
  const tabs = await page.$$eval('[data-ui="tab-nav"] a', (as) => as.map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")]));
  assert.deepEqual(tabs[0], ["전체", "/glossary", "page"]);
  for (const [label, href] of [["지방세·부동산세금", "/glossary?section=tax"], ["부동산재테크", "/glossary?section=realestate"], ["부동산금융", "/glossary?section=finance"], ["지자체뉴스", "/glossary?section=local"]]) {
    assert.ok(tabs.some((t) => t[0] === label && t[1] === href), `${label} 탭`);
  }
  await page.locator('[data-ui="tab-nav"] a', { hasText: "부동산금융" }).click();
  await page.waitForURL((url) => url.searchParams.get("section") === "finance");
  const ids = await page.$$eval("[data-glossary-term]", (els) => els.map((e) => Number(e.getAttribute("data-glossary-term"))));
  assert.ok(ids.includes(T.fin.id), "개발금융 용어");
  for (const k of ["short", "long", "prefix", "latin"]) assert.ok(!ids.includes(T[k].id), `${k}는 다른 분야`);
  assert.equal(await page.locator('[data-ui="tab-nav"] a[aria-current="page"]').textContent(), "부동산금융");
  // 다른 분야 쪽의 관련 용어는 용어 쪽 주소로 (지방세 쪽에서 본 개발금융 용어 — 여기선 거꾸로 빈 칸 확인만)
  await page.goto(`${base}/glossary?section=nope`, { waitUntil: "load" });
  assert.equal(await page.locator('[data-ui="tab-nav"] a[aria-current="page"]').textContent(), "전체", "모르는 분야 값은 전체");
  await context.close();

  const since = new Date();
  const t = await open(`${base}/glossary/${T.short.id}`);
  assert.equal(t.res.status(), 200);
  assert.equal((await t.page.locator("h1").textContent()).trim(), T.short.term);
  assert.equal((await t.page.locator('[data-term-part="plain"]').textContent()).trim(), "시험용 가짜 풀이 하나");
  const rel = await t.page.$$eval('[data-part="glossary-related"] li', (lis) => lis.map((li) => li.querySelector("a")?.getAttribute("href") ?? null));
  assert.deepEqual(rel, [`/glossary/${T.long.id}`, null, null], "용어 쪽의 관련 용어 — 공개 용어는 그 용어 쪽");
  assert.equal(await t.page.locator(`a[href="/glossary#term-${T.short.id}"]`).count(), 1, "색인의 이 용어 자리로");
  const opened = await waitEvents("glossary_opened", since, 1);
  assert.deepEqual(opened.map((e) => [e.props.term_id, e.section]), [[T.short.id, "tax"]]);
  await t.context.close();
  for (const p of [`/glossary/${T.hidden.id}`, "/glossary/0", "/glossary/012", "/glossary/abc", "/glossary/99999999999"]) assert.equal((await fetch(`${base}${p}`)).status, 404, p);
});

test("d) 본문 풀이 — 용어마다 한 번 · 숨긴·풀이 없는 용어 0 · 제목·링크·상자 제목·인용 발언자 0 · 긴 용어 먼저 · 조사가 붙어도", async () => {
  const { context, page } = await open(articleUrl());
  const counts = await tipCounts(page);
  for (const k of ["short", "long", "prefix", "fin", "latin"]) assert.equal(counts[T[k].id], 1, `${k}: 한 번`);
  for (const k of ["hidden", "noPlain"]) assert.equal(counts[T[k].id], undefined, `${k}: 0`);
  assert.equal(await page.locator("h1 [data-glossary-tip], a [data-glossary-tip], figcaption [data-glossary-tip]").count(), 0, "제목·링크·발언자 안 0");
  assert.equal(await page.locator('[data-block-type="callout"] [data-glossary-tip]').count(), 1, "상자는 글에만");
  assert.equal(await page.locator('[data-block-type="callout"] p.font-black [data-glossary-tip]').count(), 0, "상자 제목 0");
  // 첫 등장 자리 — 링크 안의 첫 등장은 건너뛰고 다음 글 조각, 긴 용어(…세율)가 같은 자리의 짧은 용어(…세)보다 먼저
  const where = (id) => page.locator(`[data-glossary-tip][data-term-id="${id}"]`).evaluate((el) => [el.closest("[data-block-index]").getAttribute("data-block-index"), el.querySelector("[data-tip-trigger]").textContent]);
  assert.deepEqual(await where(T.short.id), ["1", T.short.term], "링크 안(0번 문단)이 아니라 1번 문단 — '…세를'의 조사 앞까지");
  assert.deepEqual(await where(T.long.id), ["1", T.long.term], "긴 용어 먼저");
  assert.deepEqual(await where(T.prefix.id), ["2", T.prefix.term], "'지방…세' 안의 '…세'에는 붙지 않는다");
  // 본문 글자는 그대로 — 문단 글(풀이 상자 글 제외)이 저장한 글과 같다
  const para1 = await page.locator('[data-block-index="1"] p').evaluate((p) => {
    const c = p.cloneNode(true);
    c.querySelectorAll("[data-tip-pop]").forEach((x) => x.remove());
    return c.textContent;
  });
  assert.equal(para1, `${T.long.term}은 ${T.short.term}를 매기는 비율이다. ${T.short.term}는 두 번 나온다.`);
  // 구조화 데이터의 제목 = 화면 제목 (풀이가 제목을 건드리지 않는다)
  const ld = JSON.parse(await page.$eval('script[type="application/ld+json"]', (s) => s.textContent));
  const headline = [ld].flat().find((n) => n.headline)?.headline;
  assert.equal(headline, (await page.locator("h1").textContent()).trim());
  await context.close();
});

test("d) 키보드 — Tab 포커스로 열리고 Esc로 닫힌다(포커스는 용어 단추) · 풀이 안 링크에서 Esc도 · '용어사전에서 보기' = 용어 쪽 · glossary_opened 1건", async () => {
  const since = new Date();
  const { context, page } = await open(articleUrl());
  const root = page.locator(`[data-glossary-tip][data-term-id="${T.short.id}"]`);
  const trigger = root.locator("[data-tip-trigger]");
  const pop = root.locator("[data-tip-pop]");
  assert.equal(await pop.isVisible(), false, "평소 숨김");
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  await page.locator('[data-block-index="0"] a[href="/news"]').focus();
  for (let i = 0; i < 12 && !(await trigger.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  assert.ok(await trigger.evaluate((el) => el === document.activeElement), "Tab으로 용어 단추에 닿는다");
  await pop.waitFor({ state: "visible" });
  assert.equal(await trigger.getAttribute("aria-expanded"), "true");
  assert.match(await pop.textContent(), /시험용 가짜 풀이 하나/);
  assert.equal(await trigger.evaluate((el) => document.getElementById(el.getAttribute("aria-describedby"))?.textContent), "시험용 가짜 풀이 하나", "단추 설명 = 쉬운 풀이");
  assert.equal(await pop.locator("a").getAttribute("href"), `/glossary/${T.short.id}`);
  await page.keyboard.press("Escape");
  await pop.waitFor({ state: "hidden" });
  assert.ok(await trigger.evaluate((el) => el === document.activeElement), "Esc 뒤에도 포커스는 용어 단추");
  // 풀이 안 링크로 들어가 Esc — 닫히고 포커스는 단추로
  await page.keyboard.press("Enter");
  await pop.waitFor({ state: "visible" });
  await page.keyboard.press("Tab");
  assert.ok(await pop.locator("a").evaluate((el) => el === document.activeElement), "풀이 안 링크");
  await page.keyboard.press("Escape");
  await pop.waitFor({ state: "hidden" });
  assert.ok(await trigger.evaluate((el) => el === document.activeElement));
  // 포커스가 풀이 밖으로 나가면 닫힌다
  await page.keyboard.press("Enter");
  await pop.waitFor({ state: "visible" });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await pop.waitFor({ state: "hidden" });
  const opened = await waitEvents("glossary_opened", since, 1);
  await new Promise((r) => setTimeout(r, 400));
  const mine = (await eventsSince("glossary_opened", since)).filter((e) => e.props.term_id === T.short.id);
  assert.equal(mine.length, 1, `같은 용어를 여러 번 열어도 한 번 (${opened.length})`);
  assert.equal(mine[0].section, "tax");
  // '용어사전에서 보기'를 누르면 용어 쪽 (화면 전환)
  await trigger.focus();
  await page.keyboard.press("Enter");
  await pop.waitFor({ state: "visible" });
  await pop.locator("a").click();
  await page.waitForURL(`${base}/glossary/${T.short.id}`);
  await context.close();
});

test("d) 누르기(터치) — 누르면 열리고 다시 누르거나 바깥을 누르면 닫힌다 · 한 번에 하나", async () => {
  const { context, page } = await open(articleUrl(), { viewport: { width: 360, height: 740 }, hasTouch: true });
  const pops = (k) => page.locator(`[data-glossary-tip][data-term-id="${T[k].id}"] [data-tip-pop]`);
  const tap = (k) => page.locator(`[data-glossary-tip][data-term-id="${T[k].id}"] [data-tip-trigger]`).tap();
  await tap("long");
  await pops("long").waitFor({ state: "visible" });
  await tap("short");
  await pops("short").waitFor({ state: "visible" });
  assert.equal(await pops("long").isVisible(), false, "다른 풀이는 닫힌다");
  await tap("short");
  await pops("short").waitFor({ state: "hidden" });
  await tap("latin");
  await pops("latin").waitFor({ state: "visible" });
  // 풀이를 연 채로도 360px 가로 스크롤 0 (화면 끝 용어는 상자를 옆으로 옮긴다)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `풀이를 연 채 가로 스크롤 ${overflow}px`);
  const box = await pops("latin").boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 360, `풀이 상자가 화면 안: ${JSON.stringify(box)}`);
  await page.locator("h1").tap();
  await pops("latin").waitFor({ state: "hidden" });
  await context.close();
});

test("d) JS가 꺼져 있어도 풀이 자리는 서버가 그린다 — 평소 숨김, 포커스하면 열린다", async () => {
  const { context, page } = await open(articleUrl(), { javaScriptEnabled: false });
  const root = page.locator(`[data-glossary-tip][data-term-id="${T.short.id}"]`);
  assert.equal(await root.count(), 1);
  assert.equal(await root.locator("[data-tip-pop]").isVisible(), false);
  await root.locator("[data-tip-trigger]").focus();
  await root.locator("[data-tip-pop]").waitFor({ state: "visible" });
  await context.close();
});

test("e) 검색 결과의 용어 링크 = 용어 쪽 · 허브 용어 칩은 용어 쪽 링크 (켜졌을 때만)", async () => {
  const s = await open(`${base}/search?q=${encodeURIComponent(T.short.term)}&tab=glossary`);
  assert.equal(await s.page.locator(`[data-search-hit][data-kind="glossary"][data-ref="${T.short.id}"] h3 a`).getAttribute("href"), `/glossary/${T.short.id}`);
  assert.equal(await s.page.locator(`[data-search-hit][data-ref="${T.hidden.id}"]`).count(), 0, "숨긴 용어는 검색에도 0");
  await s.context.close();
  const h = await open(`${base}/tax`);
  const chips = await h.page.$$eval('[data-part="hub-terms"] li', (lis) => lis.map((li) => [Number(li.getAttribute("data-term-id")), li.querySelector("a")?.getAttribute("href") ?? null]));
  assert.ok(chips.length > 0, "허브 용어 칩");
  for (const [id, href] of chips) assert.equal(href, `/glossary/${id}`);
  assert.ok(!chips.some(([id]) => id === T.hidden.id), "숨긴 용어 칩 0");
  await h.context.close();
});

test("f) 화면 규칙 R1~R3 — 색인·분야 쪽·용어 쪽·풀이가 든 기사, 폭 360·640·1024 (R1은 360×740)", async () => {
  for (const url of [`${base}/glossary`, `${base}/glossary?section=tax`, `${base}/glossary/${T.short.id}`, articleUrl()]) {
    for (const width of [360, 640, 1024]) {
      const r = await measurePage(browser, url, { width, height: 740 });
      console.log(`화면 규칙 ${url.replace(base, "").slice(0, 40)} ${r.viewport} — R1 ${r.r1.chars}자 · R2 ${r.r2.maxPerViewport}개 · R3 ${(r.r3.ratio * 100).toFixed(2)}%`);
      if (width === 360) assert.ok(r.r1.pass, `${url} ${width}px R1 ${r.r1.chars}자 > 150`);
      assert.ok(r.r2.pass, `${url} ${width}px R2 주 버튼 ${r.r2.maxPerViewport}개`);
      assert.ok(r.r3.pass, `${url} ${width}px R3 오렌지 ${r.r3.ratio}`);
    }
  }
});

test("f) 360px — 가로 스크롤 0, 탭·색인·관련 용어·제목 링크 터치 44px", async () => {
  for (const url of [`${base}/glossary`, `${base}/glossary?section=finance`, `${base}/glossary/${T.short.id}`]) {
    const { context, page } = await open(url, { viewport: { width: 360, height: 740 } });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `${url}: 가로 스크롤 ${overflow}px`);
    const targets = await page.$$eval('main [data-ui="tab-nav"] a, main [data-part="glossary-index"] li > *, main [data-part="glossary-related"] li > *, main [data-glossary-term] h3 a, main [data-glossary-part] p > a', (els) =>
      els.filter((e) => e.getClientRects().length > 0).map((e) => ({ t: e.textContent.trim().slice(0, 20), ...e.getBoundingClientRect().toJSON() })),
    );
    assert.ok(targets.length >= 2, `${url}: 잴 요소 ${targets.length}`);
    for (const t of targets) assert.ok(t.height >= 44, `${url} ${t.t}: 높이 ${t.height}`);
    await context.close();
  }
});

test("f) 접근성 95점 이상 — 색인·용어 쪽·풀이가 든 기사", async () => {
  for (const url of [`${base}/glossary`, `${base}/glossary/${T.short.id}`, articleUrl()]) {
    const r = await accessibility(url, port);
    assert.ok(r.score >= A11Y_MIN, `${url} 점수 ${r.score} — 실패 항목: ${r.failing.join(", ")}`);
  }
});

test("g) 기능 키를 다시 끄면 바로 — /glossary 404, 용어사전 링크 0(검색 결과·허브 칩·본문 풀이)", async () => {
  await setFeatures(["search"]);
  assert.equal((await fetch(`${base}/glossary`)).status, 404);
  assert.equal((await fetch(`${base}/glossary/${T.short.id}`)).status, 404);
  for (const p of ["/tax", `/news/${fx.article.slug}`, `/search?q=${encodeURIComponent(T.short.term)}`]) {
    const { context, page } = await open(`${base}${p}`);
    assert.deepEqual(await glossaryLinks(page), [], `${p}: 용어사전 링크 0`);
    await context.close();
  }
  await setFeatures([]);
  assert.doesNotMatch(server.log(), /\[api\] 처리 중 오류|\[public\]|\[db\]/, "시험 동안 예상 못 한 서버 오류 0");
});
