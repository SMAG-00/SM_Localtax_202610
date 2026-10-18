// 검색어 집계 E2E (W2-d 4단계 — SRCH-03, docs/dev/W2-d_설계.md 1장 4단계 증거 · 2.7 · 2.8 · 8.3)
// standalone 빌드를 로컬 Supabase에 붙인다. 공개 검색(화면 /search · API /api/search)을 사람 브라우저 User-Agent로 부르고 query_terms를 DB에서 본다.
//  a) 가림 — 전화번호(010·+82·지역 번호)·이메일·주민등록번호·카드 번호가 든 검색어 → 저장된 행은 가린 값·정규형뿐, 원문 조각은 DB·서버 기록 어디에도 0.
//     닮은꼴(날짜 2026-10-19 · 60일 · 제111조)은 그대로
//  b) 합산 — 띄어쓰기·기호만 다른 검색어(화면·API 섞어서)는 오늘(한국 날짜) 한 행으로 더한다 · 같은 방문자가 30분 안에 다시 찾으면 한 번 · 낱말 차례가 다르면 다른 행
//  c) 세지 않는다 — 봇 User-Agent(구글봇·자동화 브라우저·스크립트) · 편집국(Bearer·로그인 쿠키) · 측정 거부 쿠키 · GPC · 2쪽 · 미리 받기 · 같은 검색 안 이동(Referer)
//  d) 실제 브라우저 — 결과 화면을 열면 1, 탭을 바꾸면 그대로, 새 검색어를 보내면 그 검색어 1, 새로 고침 0 · search_submitted 등 측정 이벤트에 검색어 원문 0
//  e) 편집국 화면 /admin/query-terms — 편집 책임자·관리자 200(가린 값·정규형·횟수, 최소 횟수 아래는 수만, 원문 0, 동의어 더하기 → 낱말 채운 사전 폼),
//     나머지 역할 6종 403 · 메뉴 0, 로그인 안 하면 로그인 화면 · 기간 단추·틀린 기간 안내 · 360px 가로 스크롤 0
//  f) 보존 기한 — 보존 일수(설정) + 1일 전 날 행은 매일 정리 배치(analytics-retention)가 지우고, 보존 일수일 전은 남는다
// 만든 계정·기사·검색어 행·측정 이벤트·실행 기록은 끝나면 지우고, 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "search-terms-e2e@example.test";
const SITE = "https://e2e.example.test";
const SECRET = crypto.randomBytes(24).toString("hex");
const HUMAN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const HEADLESS_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36";
/** 이 실행만의 낱말 — 영문 소문자(정규형에 그대로 남고 숫자 줄을 만들지 않는다) */
const RUN = Array.from(crypto.randomBytes(8), (b) => String.fromCharCode(97 + (b % 26))).join("");
const kstToday = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
const kstDay = (n) => new Date(Date.now() + 9 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 시험 검색어 속 개인정보 원문 — 저장된 행·편집국 화면 글자·서버 기록·측정 이벤트 어디에도 없어야 한다 */
const RAW_QUERIES = ["010-1234-5678", "01012345678", "010-9999-8888", "10-9876-5432", "hong.gildong@example.com", "hong.gildong", "900101-1234567", "1234-5678-9012-3456", "010-2222-3333"];
/** 원문 숫자·글 조각 — 저장된 가린 값·정규형과 측정 이벤트 속성에도 0 (화면·기록에는 포트·시각 같은 다른 숫자가 있어 이 목록은 DB만 본다) */
const RAW_PIECES = [...RAW_QUERIES, "1234-5678", "9999", "8888", "9876", "5432", "hong", "gildong", "example", "900101", "1234567", "9012", "3456", "2222", "3333"];

let sb, server, staff, db, browser, base;
const u = {};
const fx = {};
let ipSeq = 0;
let before0;
let eventMark;
const nextIp = () => `10.77.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body).slice(0, 600);

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

/** 공개 검색 — API 또는 화면. 사람 브라우저 User-Agent · 요청마다 다른 IP(방문자 쿠키가 없으면 IP 해시가 30분 안 다시 찾기 열쇠) */
async function search(q, { via = "api", ua = HUMAN_UA, ip = nextIp(), headers = {}, extra = "" } = {}) {
  const url = via === "api" ? `${base}/api/search?q=${encodeURIComponent(q)}${extra}` : `${base}/search?q=${encodeURIComponent(q)}${extra}`;
  const res = await fetch(url, { headers: { "user-agent": ua, "x-real-ip": ip, ...headers } });
  await res.arrayBuffer();
  assert.equal(res.status, 200, `${via} ${q} ${extra}`);
  return res;
}
/** 오늘 행 (정규형) */
const rowOf = async (normalized) => one("select term_masked, normalized, period::text p, count from public.query_terms where source = 'site_search' and normalized = $1 and period = $2", [normalized, kstToday()]);
/** 응답 뒤에 더하므로 기다린다 */
async function waitCount(normalized, count) {
  let row;
  for (let i = 0; i < 100; i++) {
    row = await rowOf(normalized);
    if (row && row.count >= count) return row;
    await sleep(100);
  }
  return row;
}
/** 세지 않은 요청 뒤에 센 요청(대조군)이 저장된 것을 본 다음 — 앞 요청이 더했다면 이미 보였다 */
async function control(label) {
  const q = `대조군 ${label} ${RUN}`;
  await search(q);
  const row = await waitCount(`대조군 ${label} ${RUN}`, 1);
  assert.equal(row?.count, 1, `대조군 ${label}이 저장됐다`);
}

const cookieJar = new Map();
async function sessionCookie(user) {
  if (!cookieJar.has(user.email)) {
    const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ email: user.email, password: user.password }) });
    assert.equal(res.status, 200, `로그인 ${user.email}`);
    const pairs = res.headers.getSetCookie().map((l) => l.split(";")[0]).filter((p) => p.startsWith("sb-"));
    cookieJar.set(user.email, pairs.join("; "));
  }
  return cookieJar.get(user.email);
}
async function pageAs(user, p) {
  const res = await fetch(`${base}${p}`, { headers: user ? { cookie: await sessionCookie(user) } : {}, redirect: "manual" });
  return { status: res.status, location: res.headers.get("location") ?? "", html: await res.text() };
}
const menuHrefs = (html) => [...(html.match(/aria-label="편집국 메뉴"[\s\S]*?<\/nav>/)?.[0] ?? "").matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const htmlText = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
    CRON_SECRET: SECRET,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  before0 = Number((await one("select count(*)::int n from public.query_terms")).n);
  eventMark = Number((await one("select coalesce(max(id), 0) m from public.analytics_events")).m);
  u.admin = await staff.createUser({ label: "qt-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "qt-editor", roles: ["editor"], person: { name: "검색어 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "qt-reporter", roles: ["reporter"], person: { name: "검색어 시험 기자", roles: ["reporter"] } });
  u.reviewer = await staff.createUser({ label: "qt-reviewer", roles: ["reviewer"] });
  u.adOps = await staff.createUser({ label: "qt-ad", roles: ["ad_ops"] });
  u.storeOps = await staff.createUser({ label: "qt-store", roles: ["store_ops"] });
  u.brandOps = await staff.createUser({ label: "qt-brand", roles: ["brand_ops"] });
  u.expertOps = await staff.createUser({ label: "qt-expert", roles: ["expert_ops"] });
  // 탭이 보이게 결과가 있는 기사 하나 (브라우저 흐름 d)
  const { rows } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, body, first_published_at)
     values ($1, $2, '무엇이 바뀌었는지 정리했습니다', 'tax', 'explainer', 'published', $3, $4, now() - interval '1 day') returning id`,
    [`e2e-qt-${RUN}`, `세무조사 안내 ${RUN}`, u.reporter.personId, JSON.stringify({ blocks: [{ type: "paragraph", text: "본문 문장입니다." }], claims: [] })],
  );
  fx.article = Number(rows[0].id);
  staff.trackArticle(fx.article);
  browser = await chromium.launch();
  await setFeatures(["search"]);
});

after(async () => {
  try {
    await browser?.close();
    await db.query("delete from public.query_terms where normalized like $1", [`%${RUN}%`]);
    await db.query("delete from public.analytics_events where id > $1", [eventMark]);
    await db.query("delete from public.agent_runs where job = 'analytics-retention' and started_at >= $1", [staff.startedAt]);
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

test("a) 가림 — 전화·이메일·주민등록번호·카드 번호가 든 검색어는 가린 값·정규형으로만 저장, 닮은꼴(날짜·기간·조문)은 그대로", async () => {
  const cases = [
    [`상담 010-1234-5678 ${RUN}`, `상담 [전화번호] ${RUN}`, `상담 ${RUN}`, "api"],
    [`+82 10-9876-5432 취득세 ${RUN}`, `[전화번호] 취득세 ${RUN}`, `취득세 ${RUN}`, "page"],
    [`hong.gildong@example.com 재산세 ${RUN}`, `[이메일] 재산세 ${RUN}`, `재산세 ${RUN}`, "api"],
    [`900101-1234567 상속세 ${RUN}`, `[주민등록번호] 상속세 ${RUN}`, `상속세 ${RUN}`, "page"],
    [`1234-5678-9012-3456 자동차세 ${RUN}`, `[번호] 자동차세 ${RUN}`, `자동차세 ${RUN}`, "api"],
    [`2026-10-19 개편안 ${RUN}`, `2026-10-19 개편안 ${RUN}`, `2026 10 19 개편안 ${RUN}`, "api"],
    [`60일 안에 신고 ${RUN}`, `60일 안에 신고 ${RUN}`, `60일 안에 신고 ${RUN}`, "page"],
    [`지방세법 제111조 ${RUN}`, `지방세법 제111조 ${RUN}`, `지방세법 제111조 ${RUN}`, "api"],
  ];
  for (const [q, , , via] of cases) await search(q, { via });
  for (const [q, masked, normalized] of cases) {
    const row = await waitCount(normalized, 1);
    assert.deepEqual(row, { term_masked: masked, normalized, p: kstToday(), count: 1 }, q);
  }
  // 정규형만 남는 검색어(번호뿐) — 저장 0
  await search("010-1234-5678");
  await control("가림");
  assert.equal(await one("select count(*)::int n from public.query_terms where normalized = '' or term_masked = '[전화번호]'").then((r) => r.n), 0);
  // 원문 조각 0 — 이 시험이 만든 모든 행
  const all = (await db.query("select term_masked || ' ' || normalized t from public.query_terms where id > $1", [staff.queryTermsMark])).rows.map((r) => r.t).join("\n");
  for (const piece of RAW_PIECES) assert.ok(!all.includes(piece), `DB에 원문 조각 '${piece}'`);
});

test("b) 합산 — 띄어쓰기·기호만 다른 검색어는 화면·API 어디서 찾아도 오늘 한 행으로 더한다, 같은 방문자 30분 안 다시 찾기는 한 번, 낱말 차례가 다르면 다른 행", async () => {
  const key = `취득세 감면 ${RUN}`;
  await search(`취득세 감면 ${RUN}`);
  await search(`「취득세」 감면 ${RUN}`, { via: "page" });
  await search(`취득세,  감면!! ${RUN}`);
  await search(`ＰＦ 대출 ${RUN}`);
  const ip = nextIp();
  await search(`취득세·감면 ${RUN}`, { ip });
  await search(`취득세 감면 ${RUN}`, { ip }); // 같은 IP(방문자 쿠키 없음)가 30분 안에 다시
  await search(`취득세 감면 ${RUN}`, { ip, via: "page" });
  await search(`감면 취득세 ${RUN}`);
  // 두 번 센 가린 값 — 번호만 다른 같은 질문
  await search(`상담 010-9999-8888 ${RUN}`);
  await control("합산");
  assert.equal((await waitCount(key, 4)).count, 4, "다른 사람 4번(같은 사람의 다시 찾기 2번은 0)");
  assert.equal((await rowOf(key)).term_masked, `취득세 감면 ${RUN}`, "가린 값은 첫 값");
  assert.equal((await rowOf(`감면 취득세 ${RUN}`)).count, 1, "낱말 차례가 다르면 다른 행");
  assert.deepEqual(await rowOf(`pf 대출 ${RUN}`), { term_masked: `PF 대출 ${RUN}`, normalized: `pf 대출 ${RUN}`, p: kstToday(), count: 1 });
  assert.deepEqual(await rowOf(`상담 ${RUN}`), { term_masked: `상담 [전화번호] ${RUN}`, normalized: `상담 ${RUN}`, p: kstToday(), count: 2 });
  const rows = await db.query("select count(*)::int n from public.query_terms where normalized = $1", [key]);
  assert.equal(rows.rows[0].n, 1, "(정규형, 출처, 기간) 한 행");
});

test("c) 세지 않는다 — 봇 User-Agent·편집국(Bearer·로그인 쿠키)·측정 거부·GPC·2쪽·미리 받기·같은 검색 안 이동", async () => {
  const skip = async (label, opts) => {
    const q = `제외 ${label} ${RUN}`;
    await search(q, opts);
    return `제외 ${label} ${RUN}`;
  };
  const keys = [
    await skip("구글봇", { ua: GOOGLEBOT_UA }),
    await skip("구글봇화면", { ua: GOOGLEBOT_UA, via: "page" }),
    await skip("자동화", { ua: HEADLESS_UA, via: "page" }),
    await skip("스크립트", { ua: "node" }),
    await skip("편집자", { headers: { authorization: `Bearer ${u.editor.token}` } }),
    await skip("기자", { headers: { authorization: `Bearer ${u.reporter.token}` } }),
    await skip("관리자쿠키", { via: "page", headers: { cookie: await sessionCookie(u.admin) } }),
    await skip("거부", { headers: { cookie: "ltr_optout=1" } }),
    await skip("지피시", { via: "page", headers: { "sec-gpc": "1" } }),
    await skip("둘째쪽", { extra: "&tab=article&page=2" }),
    // 브라우저 추측 미리 받기(Sec-Purpose). Next 화면 전환 미리 받기 머리글(next-router-prefetch)은 Next가 화면 코드에서 숨긴다(공개 링크는 미리 받기를 끈다) — API에서 본다
    await skip("미리받기", { via: "page", headers: { "sec-purpose": "prefetch" } }),
    await skip("미리받기api", { headers: { "next-router-prefetch": "1" } }),
    await skip("같은검색", { via: "page", headers: { referer: `${base}/search?q=${encodeURIComponent(`제외 같은검색 ${RUN}`)}` } }),
  ];
  // 대조군 — 같은 Referer라도 검색어가 다르면 새 검색, 다른 사이트 Referer도 새 검색
  await search(`새검색 ${RUN}`, { via: "page", headers: { referer: `${base}/search?q=${encodeURIComponent(`제외 같은검색 ${RUN}`)}` } });
  await search(`밖에서 ${RUN}`, { via: "page", headers: { referer: "https://www.google.com/" } });
  await control("제외");
  for (const k of keys) assert.equal(await rowOf(k), undefined, `${k}: 저장 0`);
  assert.equal((await waitCount(`새검색 ${RUN}`, 1)).count, 1);
  assert.equal((await waitCount(`밖에서 ${RUN}`, 1)).count, 1);
});

test("d) 실제 브라우저 — 결과 화면 1, 탭을 바꿔도 그대로, 새 검색어를 보내면 그 검색어 1, 새로 고침 0 · 측정 이벤트에 검색어 원문 0", async () => {
  const context = await browser.newContext({ userAgent: HUMAN_UA, extraHTTPHeaders: { "x-real-ip": nextIp() }, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const first = `세무조사 ${RUN}`;
  await page.goto(`${base}/search?q=${encodeURIComponent(first)}`, { waitUntil: "networkidle" });
  assert.equal((await waitCount(first, 1)).count, 1, "결과 화면을 열면 1");
  await page.locator('[data-ui="tab-nav"] a', { hasText: "기사" }).click();
  await page.waitForURL((url) => url.searchParams.get("tab") === "article");
  await page.waitForLoadState("networkidle");
  const second = `세무조사 기간 010-2222-3333 ${RUN}`;
  await page.fill("#search-q", second);
  await page.press("#search-q", "Enter");
  await page.waitForURL((url) => url.searchParams.get("q") === second);
  await page.waitForLoadState("networkidle");
  assert.deepEqual(await waitCount(`세무조사 기간 ${RUN}`, 1), { term_masked: `세무조사 기간 [전화번호] ${RUN}`, normalized: `세무조사 기간 ${RUN}`, p: kstToday(), count: 1 }, "새 검색어 1(가린 값)");
  await page.reload({ waitUntil: "networkidle" });
  await control("브라우저");
  assert.equal((await rowOf(first)).count, 1, "탭을 바꿔도 그대로");
  assert.equal((await rowOf(`세무조사 기간 ${RUN}`)).count, 1, "새로 고침 0");
  await context.close();
  const events = (await db.query("select name, props::text p from public.analytics_events where id > $1", [eventMark])).rows;
  assert.ok(events.some((e) => e.name === "search_submitted"), "사람 브라우저 — search_submitted는 저장된다");
  const text = events.map((e) => e.p).join("\n");
  for (const piece of [RUN, "세무조사", ...RAW_PIECES]) assert.ok(!text.includes(piece), `측정 이벤트에 검색어 조각 '${piece}'`);
  const submitted = events.filter((e) => e.name === "search_submitted").map((e) => Object.keys(JSON.parse(e.p)).sort().join());
  assert.ok(submitted.every((k) => k === "query_length,region_classified,result_count,result_type_count"), `search_submitted 속성 4칸뿐: ${submitted}`);
});

test("e) 편집국 화면 /admin/query-terms — 편집 책임자·관리자는 가린 값·정규형·횟수(최소 횟수 아래는 수만, 원문 0)·동의어 더하기, 나머지 역할 6종 403·메뉴 0, 로그인 안 함 → 로그인 화면", async () => {
  const minCount = (await one("select value from public.settings where key = 'query_terms'")).value.display_min_count;
  assert.equal(minCount, 2, "씨앗 최소 횟수 2");
  for (const user of [u.editor, u.admin]) {
    const r = await pageAs(user, "/admin/query-terms");
    assert.equal(r.status, 200);
    const text = htmlText(r.html);
    assert.ok(text.includes(`취득세 감면 ${RUN}`) && text.includes(`상담 [전화번호] ${RUN}`), "2번 이상 찾은 검색어 — 가린 값");
    assert.match(r.html, new RegExp(`data-normalized="취득세 감면 ${RUN}" data-count="4"`));
    assert.match(r.html, new RegExp(`data-normalized="상담 ${RUN}" data-count="2"`));
    for (const once of [`재산세 ${RUN}`, `감면 취득세 ${RUN}`, `지방세법 제111조 ${RUN}`]) assert.ok(!r.html.includes(`data-normalized="${once}"`), `1번 찾은 '${once}'은 목록 0`);
    assert.match(text, /2회보다 적게 찾은 검색어 \d+개는 목록에 보이지 않습니다/);
    for (const piece of RAW_QUERIES) assert.ok(!text.includes(piece) && !r.html.includes(piece), `화면에 원문 '${piece}'`);
    assert.ok(menuHrefs(r.html).includes("/admin/query-terms"), "메뉴 '검색어'");
  }
  // 동의어 더하기 → 사전 화면이 낱말을 채운 폼을 펼쳐 연다
  const list = await pageAs(u.editor, "/admin/query-terms");
  const row = list.html.match(new RegExp(`<tr[^>]*data-normalized="취득세 감면 ${RUN}"[\\s\\S]*?</tr>`))?.[0] ?? "";
  const link = row.match(/<a [^>]*data-part="synonym-add"[^>]*>/)?.[0] ?? "";
  const href = link.match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
  assert.ok(href?.startsWith("/admin/dictionaries?tab=synonyms&term="), `동의어 더하기 주소 ${href}`);
  const dict = await pageAs(u.editor, href);
  assert.equal(dict.status, 200);
  assert.match(dict.html, new RegExp(`<details open=""[^>]*>[\\s\\S]*?value="취득세 감면 ${RUN}"`), "낱말 칸을 채운 더하기 폼");
  // 기간 — 단추와 틀린 기간 안내
  const p30 = await pageAs(u.editor, "/admin/query-terms?days=30");
  assert.match(htmlText(p30.html), new RegExp(`${kstDay(-29)} ~ ${kstToday()} \\(30일\\)`));
  const bad = await pageAs(u.editor, `/admin/query-terms?from=${kstToday()}&to=${kstDay(-3)}`);
  assert.match(htmlText(bad.html), /시작일이 끝날보다 늦습니다 — 최근 7일을 보입니다/);
  // 권한 — 나머지 역할 6종 403 · 메뉴 0, 로그인 안 함 → 로그인 화면
  for (const [role, user] of [["reporter", u.reporter], ["reviewer", u.reviewer], ["ad_ops", u.adOps], ["store_ops", u.storeOps], ["brand_ops", u.brandOps], ["expert_ops", u.expertOps]]) {
    const r = await pageAs(user, "/admin/query-terms");
    assert.equal(r.status, 403, role);
    assert.ok(r.html.includes("이 화면을 쓸 권한이 없습니다") && !r.html.includes('data-part="query-term"'), `${role}: 403 화면에 검색어 0`);
    assert.ok(!menuHrefs((await pageAs(user, "/admin")).html).includes("/admin/query-terms"), `${role}: 메뉴 0`);
  }
  const anon = await pageAs(null, "/admin/query-terms");
  assert.ok([302, 303, 307].includes(anon.status) && /\/admin\/login/.test(anon.location), `로그인 안 함: ${anon.status}`);
});

test("e2) 360px — 편집국 검색어 화면 가로 스크롤 0 (표만 가로로)", async () => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const cookies = (await sessionCookie(u.editor)).split("; ").map((p) => ({ name: p.slice(0, p.indexOf("=")), value: p.slice(p.indexOf("=") + 1), url: base }));
  await context.addCookies(cookies);
  const page = await context.newPage();
  const res = await page.goto(`${base}/admin/query-terms?days=30`, { waitUntil: "networkidle" });
  assert.equal(res.status(), 200);
  assert.ok((await page.locator('[data-part="query-term"]').count()) >= 2);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, "360px 가로 스크롤 0");
  await context.close();
});

test("f) 보존 기한 — 보존 일수 + 1일 전 날 행은 매일 정리 배치가 지우고, 보존 일수일 전은 남는다", async () => {
  const days = (await one("select value from public.settings where key = 'query_terms'")).value.retention_days;
  const old = kstDay(-(days + 1));
  const edge = kstDay(-days);
  for (const [p, n] of [[old, `오래된 ${RUN}`], [edge, `경계 ${RUN}`]]) await db.query("select public.query_terms_add('site_search', $1, $1, $2, $3)", [n, p, `${p}T12:00:00+09:00`]);
  const res = await fetch(`${base}/api/jobs/analytics-retention`, { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "x-job-trigger": "scheduler" } });
  const body = await res.json();
  assert.equal(res.status, 200);
  const run = await one("select status, detail from public.agent_runs where id = $1", [body.runId]);
  assert.equal(run.status, "succeeded");
  assert.deepEqual([run.detail.queryTerms.retentionDays, run.detail.queryTerms.before, run.detail.queryTerms.done], [days, edge, true], JSON.stringify(run.detail));
  assert.ok(run.detail.queryTerms.removed >= 1);
  assert.equal((await db.query("select count(*)::int n from public.query_terms where normalized = $1", [`오래된 ${RUN}`])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from public.query_terms where normalized = $1", [`경계 ${RUN}`])).rows[0].n, 1);
  assert.equal(run.detail.retentionDays, 395, "측정 원본 정리는 그대로 같은 실행에서");
});

test("서버 기록 — 검색어 원문·시험 낱말 0, 검색·집계 오류 기록 0", () => {
  const log = server.log();
  for (const piece of [RUN, ...RAW_QUERIES]) assert.ok(!log.includes(piece), `서버 기록에 '${piece}'`);
  assert.ok(!/\[search\]/.test(log), `검색·집계 오류 기록 0: ${log.slice(-1500)}`);
});

test("정리 — 이 시험의 검색어 행·측정 이벤트를 지우면 query_terms 행 수가 시험 전과 같다", async () => {
  await db.query("delete from public.query_terms where normalized like $1", [`%${RUN}%`]);
  await db.query("delete from public.query_terms where id > $1", [staff.queryTermsMark]);
  assert.equal(Number((await one("select count(*)::int n from public.query_terms")).n), before0);
  await db.query("delete from public.analytics_events where id > $1", [eventMark]);
});
