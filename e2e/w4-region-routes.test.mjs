// 지역 주소·옛 주소 301·빈 지역 E2E (W4 3단계 — docs/dev/W4_설계.md 1장 3단계 증거, PRD-01B REG1-01 · REG1-12)
// standalone 빌드를 띄우고 로컬 Supabase에 붙인다. 시험용 지역은 법정동코드에 없는 접두 99 가짜 코드와 '시험용' 이름이다(설계 8장) —
// 시·도 1(9900000000) + 시·군·구 여럿을 DB에 직접 넣고(첫 화면 요청 전에 — 공개 데이터 캐시 30초), 폐지·후속·옛 주소·이름 바꾸기도 그 전에 해 둔다.
//  a) 기능 키 region_hubs 꺼짐 — 지역 주소·옛 주소 모두 404(301 0), 홈·지자체뉴스 허브·지역 태그 기사에 /local/[지역] 링크 0
//  b) 켜짐 — /local/seoul 200 · 없는 slug 404 · 다른 시·도 아래 시·군·구 slug 404 · 예약 이름(/local/events · /local/seoul/weekly 등) 404 · /local·/local?topic= 그대로
//  c) 옛 slug(주소를 바꾼 지역) → 지금 주소로 301 한 번, 쿼리 그대로
//  d) A→B 폐지 뒤 B→C 폐지 — A·B 옛 주소 모두 C로 바로(301 한 번, 연쇄 0) · 옛 주소 표 없는 폐지 지역도 후속으로 301 · 후속 없는 폐지 404
//  e) 이름만 바뀐 지역(slug 그대로) 200 + 새 이름
//  f) 기사 0건 시·군·구 200 + noindex + 상위 시·도 안내(빈 카드·'준비 중' 0) — 블록에는 상위 시·도 기사 + 그 사실(W4 4단계) / 기사 있는 시·군·구·그 시·도(하위 태그 포함) 기사 카드
//  g) BreadcrumbList(홈 > 지자체뉴스 > 시·도 > 시·군·구) = 화면 이동 줄 — compareRendered 불일치 0
//  h) 지역 화면 링크 전수 404 0 · 360·1280px 가로 넘침 0 · 접근성 95
//  i) 공개 데이터를 읽지 못하면 지역 주소 503(있는지 모르므로 404·301 0) — /local 허브는 200 그대로
// 만든 계정·기사·지역·옛 주소는 끝나면 지우고, 운영 설정(기능 키)은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { chromium } from "playwright";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { ROOT, buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";
import { importSource } from "./lib/ts-source.mjs";

const ADMIN_EMAIL = "w4-region-routes-e2e@example.test";
const SITE = "https://e2e.example.test";
const SIDO_CODE = "9900000000";
/** 시험용 시·군·구 — 코드(접두 99 가짜) · 이름 · slug 앞 글자 (PO 결정 2026-10-22: 로마자 + 단위 접미 -gu) */
const GU = {
  full: { code: "9901100000", name: "시험용 가득구", key: "gadeuk" },
  empty: { code: "9902100000", name: "시험용 빈구", key: "bin" },
  renamed: { code: "9903100000", name: "시험용 옛이름구", key: "ireum" },
  moved: { code: "9903200000", name: "시험용 주소바뀐구", key: "sae" },
  a: { code: "9904100000", name: "시험용 첫구", key: "cheot" },
  b: { code: "9905100000", name: "시험용 둘구", key: "dul" },
  c: { code: "9906100000", name: "시험용 셋구", key: "set" },
  d: { code: "9907100000", name: "시험용 넷구", key: "net" },
  e: { code: "9908100000", name: "시험용 없는구", key: "eop" },
};
const RENAMED_TO = "시험용 새이름구";

let sb, server, staff, db, browser, base, debugPort, compareRendered;
const u = {};
const fx = {};
const counts0 = {};

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const kst = (plusDays = 0) => new Date(Date.now() + 9 * 3600_000 + plusDays * 86_400_000).toISOString().slice(0, 10);
const slugOf = (key) => `${key}-${staff.run}-gu`;
const sidoPath = () => `/local/${fx.sidoSlug}`;
const guPath = (key) => `${sidoPath()}/${slugOf(key)}`;

async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function setFlags(patch) {
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  const r = await api("PATCH", "/settings/feature_flags", u.admin, { value: { ...cur, ...patch } });
  assert.equal(r.status, 200, `기능 키 ${JSON.stringify(patch)}: ${JSON.stringify(r.body).slice(0, 300)}`);
}

/** 주소 하나 — 넘김을 따라가지 않는다 */
async function get(p, origin = base) {
  const res = await fetch(`${origin}${p}`, { redirect: "manual" });
  return { status: res.status, location: res.headers.get("location"), headers: res.headers, html: await res.text() };
}

/** 넘김을 하나씩 따라가 [상태…]와 마지막 주소 — 301이 몇 번인지 센다 */
async function hops(p) {
  const seen = [];
  let at = p;
  for (let i = 0; i < 5; i++) {
    const r = await get(at);
    seen.push(r.status);
    if (r.status < 300 || r.status >= 400) return { statuses: seen, finalPath: at, html: r.html };
    const next = new URL(r.location, base);
    at = `${next.pathname}${next.search}`;
  }
  return { statuses: seen, finalPath: at, html: "" };
}

async function open(p, viewport = { width: 1280, height: 800 }) {
  const page = await browser.newPage({ viewport });
  const res = await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
  return { page, status: res.status() };
}

const regionLinks = (list) => list.filter((h) => /^\/local\/[^?#]/.test(h));

async function removeFixtureRegions(q) {
  // 옛 주소 → 후속 고리 풀기 → 시·군·구 → 시·도 (기사가 쓰는 코드는 지울 수 없다 — 기사를 먼저 지운다)
  await q("delete from public.region_slug_redirects where region_code like '99%' or old_path like '/local/gasang-%'");
  await q("update public.regions set successor_code = null where code like '99%' and successor_code is not null");
  await q("delete from public.regions where code like '99%' and level = 'sigungu'");
  await q("delete from public.regions where code like '99%'");
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
  // 지난 실행이 중간에 멈춰 남긴 시험용 지역(접두 99)
  await removeFixtureRegions((sql, params) => db.query(sql, params));
  await staff.snapshotOperations();
  for (const t of ["regions", "region_slug_redirects"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  assert.notEqual(flags.region_hubs, true, "시험 전 기능 키 region_hubs는 꺼져 있어야 한다 (W4 2.4 — 2단계 적재·시범 지역 최소선 전)");

  u.admin = await staff.createUser({ label: "w4r-admin", email: ADMIN_EMAIL });
  u.reporter = await staff.createUser({ label: "w4r-reporter", roles: ["reporter"], person: { name: "시험용 지역 기자", roles: ["reporter"] } });

  // 시험용 시·도 + 시·군·구 (모두 오늘 유효)
  fx.sidoSlug = `gasang-${staff.run}`;
  await db.query("insert into public.regions (code, level, name, slug) values ($1, 'sido', '시험용 가상도', $2)", [SIDO_CODE, fx.sidoSlug]);
  for (const g of Object.values(GU)) {
    await db.query("insert into public.regions (code, parent_code, level, name, slug) values ($1, $2, 'sigungu', $3, $4)", [g.code, SIDO_CODE, g.name, slugOf(g.key)]);
  }

  // 기사 — 가득구 태그 지자체뉴스 해설 1 (가득구·가상도 화면에 나온다)
  const art = await one(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, editorial_field, region_codes, first_published_at)
     values ($1, $2, $3, 'local', 'explainer', 'published', $4, 'local_tax', $5, $6) returning id, slug`,
    [`e2e-w4r-full-${staff.run}`, "시험용 가득구 지방세 해설", "시험용 지역 기사 요약입니다", u.reporter.personId, [GU.full.code], new Date(Date.now() - 3600_000).toISOString()],
  );
  staff.trackArticle(Number(art.id));
  fx.article = { id: Number(art.id), href: `/news/${art.slug}` };

  // 이름만 바뀐 지역 (slug 그대로)
  await db.query("update public.regions set name = $1 where code = $2", [RENAMED_TO, GU.renamed.code]);
  // 주소를 바꾼 지역의 옛 slug → 옛 주소 표 (reason renamed)
  fx.movedOld = `${sidoPath()}/yet-${staff.run}-gu`;
  fx.movedNow = guPath(GU.moved.key);
  await db.query("insert into public.region_slug_redirects (old_path, region_code, reason) values ($1, $2, 'renamed')", [fx.movedOld, GU.moved.code]);

  // 폐지 사슬 — A를 B로 폐지(옛 주소 A → B) 한 뒤 B를 C로 폐지(옛 주소 B → C): DB가 A의 후속·옛 주소 A를 C로 고쳐 쓴다 (migration 39)
  const yesterday = kst(-1);
  await db.query("update public.regions set valid_to = $1, successor_code = $2 where code = $3", [yesterday, GU.b.code, GU.a.code]);
  await db.query("insert into public.region_slug_redirects (old_path, region_code, reason) values ($1, $2, 'retired')", [guPath(GU.a.key), GU.b.code]);
  await db.query("update public.regions set valid_to = $1, successor_code = $2 where code = $3", [yesterday, GU.c.code, GU.b.code]);
  await db.query("insert into public.region_slug_redirects (old_path, region_code, reason) values ($1, $2, 'retired')", [guPath(GU.b.key), GU.c.code]);
  // 옛 주소 표 없이 후속만 있는 폐지(D → C) · 후속 없는 폐지(E)
  await db.query("update public.regions set valid_to = $1, successor_code = $2 where code = $3", [yesterday, GU.c.code, GU.d.code]);
  await db.query("update public.regions set valid_to = $1 where code = $2", [yesterday, GU.e.code]);

  ({ compareRendered } = await importSource(pathToFileURL(path.join(ROOT, "packages", "structured-data", "src", "compare.ts")).href));
  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
});

after(async () => {
  try {
    await browser?.close();
    await staff?.cleanup(); // 기사·계정·감사 로그 지우기 + 운영 설정 되돌리기 (DB 연결을 닫는다)
  } finally {
    server?.stop();
    // 시험용 지역 — 기사를 지운 뒤에 지운다 (기사가 쓰는 코드는 지울 수 없다)
    if (sb && Object.keys(counts0).length) {
      const c = new pg.Client({ connectionString: sb.dbUrl });
      await c.connect();
      try {
        await removeFixtureRegions((sql, params) => c.query(sql, params));
        for (const t of ["regions", "region_slug_redirects"]) {
          const n = (await c.query(`select count(*)::int n from public.${t}`)).rows[0].n;
          assert.equal(n, counts0[t], `정리 뒤 ${t} 행 수 = 시험 전`);
        }
      } finally {
        await c.end();
      }
    }
  }
});

test("a) region_hubs 꺼짐 — 지역 주소·옛 주소 404(301 0), 홈·지자체뉴스 허브·지역 태그 기사에 지역 링크 0", async () => {
  for (const p of ["/local/seoul", sidoPath(), guPath(GU.full.key), guPath(GU.empty.key), guPath(GU.a.key), fx.movedOld, guPath(GU.d.key)]) {
    const r = await get(p);
    assert.equal(r.status, 404, `${p}: 꺼짐 404`);
    assert.equal(r.location, null, `${p}: 넘김 0`);
  }
  for (const p of ["/", "/local", "/local?topic=local_tax", fx.article.href]) {
    const { page, status } = await open(p);
    assert.equal(status, 200, p);
    const links = regionLinks(await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href"))));
    assert.deepEqual(links, [], `${p}: /local/[지역] 링크 0`);
    await page.close();
  }
});

test("b) 켜짐 — /local/seoul 200 · 없는 slug·다른 시·도 아래 slug·예약 이름 404 · /local 허브와 분야 필터 그대로", async () => {
  await setFlags({ region_hubs: true });
  const seoul = await get("/local/seoul");
  assert.equal(seoul.status, 200, "/local/seoul 200");
  assert.match(seoul.html, /<h1[^>]*>서울특별시<\/h1>/, "제목 = 시·도 이름");
  assert.ok(seoul.html.includes('data-ui="region-page"') && seoul.html.includes('data-region="1100000000"'));

  const notFound = [
    `/local/nowhere-${staff.run}`,
    `${sidoPath()}/nothing-${staff.run}-gu`,
    `/local/seoul/${slugOf(GU.full.key)}`, // 다른 시·도 아래의 시·군·구 slug — 404 (301 아님)
    "/local/events",
    "/local/events/2026-gangnam-briefing",
    "/local/seoul/weekly",
    `${sidoPath()}/weekly`,
    "/local/food",
    "/local/reporting",
    "/local/Seoul",
    `/local/${slugOf(GU.full.key)}`, // 시·군·구 slug를 시·도 자리에
  ];
  for (const p of notFound) {
    const r = await get(p);
    assert.equal(r.status, 404, `${p}: 404`);
    assert.equal(r.location, null, `${p}: 넘김 0`);
    assert.match(r.html, /찾는 화면이 없습니다/, `${p}: 쉬운 말 404 안내`);
  }

  // 지자체뉴스 허브·분야 필터는 W2-b 그대로 (지역 경로와 겹치지 않는다)
  for (const p of ["/local", "/local?topic=local_tax"]) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.ok(r.html.includes('data-hub-part="head"') && !r.html.includes('data-ui="region-page"'), `${p}: 분야 허브 골격`);
  }
});

test("c) 옛 slug(주소를 바꾼 지역) → 지금 주소로 301 한 번 · 쿼리 그대로", async () => {
  const r = await get(fx.movedOld);
  assert.equal(r.status, 301, "옛 주소 301");
  assert.equal(new URL(r.location, base).pathname, fx.movedNow, "도착 = 지금 주소");
  const walk = await hops(fx.movedOld);
  assert.deepEqual(walk.statuses, [301, 200], "301 한 번 뒤 200");
  const q = await get(`${fx.movedOld}?topic=local_tax`);
  assert.equal(q.status, 301);
  const to = new URL(q.location, base);
  assert.equal(`${to.pathname}${to.search}`, `${fx.movedNow}?topic=local_tax`, "쿼리 그대로");
});

test("d) A→B 폐지 뒤 B→C 폐지 — A·B 모두 C로 바로(301 한 번) · 옛 주소 표 없는 폐지도 후속으로 · 후속 없는 폐지 404", async () => {
  // DB가 사슬을 접어 둔다 (migration 39 트리거)
  assert.equal((await one("select successor_code from public.regions where code = $1", [GU.a.code])).successor_code, GU.c.code, "A의 후속 = C");
  assert.equal((await one("select region_code from public.region_slug_redirects where old_path = $1", [guPath(GU.a.key)])).region_code, GU.c.code, "옛 주소 A → C");
  for (const key of [GU.a.key, GU.b.key, GU.d.key]) {
    const walk = await hops(guPath(key));
    assert.deepEqual(walk.statuses, [301, 200], `${key}: 301 한 번 뒤 200 (연쇄 0)`);
    assert.equal(walk.finalPath, guPath(GU.c.key), `${key}: 도착 = 후속 C`);
  }
  const gone = await get(guPath(GU.e.key));
  assert.equal(gone.status, 404, "후속 없는 폐지 지역 404");
  assert.equal(gone.location, null);
});

test("e) 이름만 바뀐 지역(slug 그대로) — 200, 제목·이동 줄이 새 이름", async () => {
  const r = await get(guPath(GU.renamed.key));
  assert.equal(r.status, 200);
  assert.match(r.html, new RegExp(`<h1[^>]*>시험용 가상도 ${RENAMED_TO}</h1>`));
  assert.ok(!r.html.includes(GU.renamed.name), "옛 이름 0");
});

test("f) 기사 0건 시·군·구 — 200 + noindex + 상위 시·도 안내 / 기사 있는 시·군·구·시·도에는 기사 카드", async () => {
  const empty = await open(guPath(GU.empty.key));
  assert.equal(empty.status, 200, "빈 시·군·구 200");
  assert.match((await empty.page.getAttribute('meta[name="robots"]', "content")) ?? "", /noindex/);
  assert.equal(await empty.page.locator('meta[name="robots"]').count(), 1);
  assert.equal(await empty.page.getAttribute('[data-ui="region-page"]', "data-region-empty"), "true");
  const guide = empty.page.locator('[data-part="empty-guide"]');
  assert.equal(await guide.locator("p").textContent(), `시험용 가상도 ${GU.empty.name}에는 아직 공개된 기사가 없습니다. 상위 지역 시험용 가상도 소식을 보세요.`);
  assert.deepEqual(await guide.locator("a").evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute("href")])), [
    ["시험용 가상도 소식 보기", sidoPath()],
    ["지자체뉴스 전체 보기", "/local"],
  ]);
  // W4 4단계 — 블록 ②는 상위 시·도 범위 기사(가득구 해설) + 대체 문장, ③⑤는 0건 문장 (빈 카드 0)
  assert.deepEqual(await empty.page.$$eval('[data-hub-block="localTax"] [data-article-id]', (els) => els.map((e) => Number(e.getAttribute("data-article-id")))), [fx.article.id]);
  assert.equal(await empty.page.locator('[data-hub-block="localTax"] [data-part="block-fallback"]').textContent(), `${GU.empty.name} 기사가 없어 시험용 가상도 기사를 보입니다`);
  assert.equal(await empty.page.locator('[data-hub-block="realEstate"] [data-article-id], [data-hub-block="sources"] [data-article-id]').count(), 0, "③⑤ 기사 카드 0");
  assert.equal(await empty.page.locator('[data-part="block-empty"]').count(), 2, "③⑤ 0건 문장");
  assert.equal(await empty.page.getByText("준비 중").count(), 0);
  await empty.page.close();

  const full = await open(guPath(GU.full.key));
  assert.equal(full.status, 200);
  assert.equal(await full.page.getAttribute('[data-ui="region-page"]', "data-region-empty"), "false");
  assert.deepEqual(await full.page.$$eval('[data-hub-block="localTax"] [data-article-id]', (els) => els.map((e) => Number(e.getAttribute("data-article-id")))), [fx.article.id]);
  assert.equal(await full.page.locator('[data-part="block-fallback"]').count(), 0, "자기 기사 — 대체 문장 0");
  assert.equal(await full.page.locator('[data-part="empty-guide"]').count(), 0);
  await full.page.close();

  // 시·도 = 자기 + 하위 시·군·구 태그 (12장 #26)
  const sido = await get(sidoPath());
  assert.equal(sido.status, 200);
  assert.ok(sido.html.includes(`data-article-id="${fx.article.id}"`), "시·도 화면에 하위 시·군·구 기사");
  assert.ok(sido.html.includes('data-region-empty="false"'));
});

test("g) BreadcrumbList(홈 > 지자체뉴스 > 시·도 > 시·군·구) = 화면 이동 줄 — compareRendered 불일치 0", async () => {
  const cases = [
    [guPath(GU.full.key), ["홈", "지자체뉴스", "시험용 가상도", GU.full.name]],
    [guPath(GU.empty.key), ["홈", "지자체뉴스", "시험용 가상도", GU.empty.name]],
    [sidoPath(), ["홈", "지자체뉴스", "시험용 가상도"]],
    ["/local/seoul", ["홈", "지자체뉴스", "서울특별시"]],
  ];
  for (const [p, names] of cases) {
    const { page } = await open(p);
    const shown = await page.$$eval('nav[aria-label="지역 이동"] a', (as) => as.map((a) => ({ name: a.textContent.trim(), href: a.getAttribute("href"), current: a.getAttribute("aria-current") })));
    assert.deepEqual(shown.map((s) => s.name), names, `${p}: 이동 줄 글자`);
    assert.deepEqual(shown.map((s) => s.current), [...names.slice(1).map(() => null), "page"], `${p}: 마지막이 지금 화면`);
    const scripts = await page.$$eval('script[type="application/ld+json"]', (els) => els.map((e) => e.textContent));
    assert.equal(scripts.length, 1, `${p}: JSON-LD 1개`);
    const nodes = JSON.parse(scripts[0]);
    assert.deepEqual(nodes.map((n) => n["@type"]), ["BreadcrumbList"], `${p}: BreadcrumbList만 (주 유형 없음)`);
    const facts = { breadcrumb: shown.map((s) => ({ name: s.name, url: new URL(s.href, SITE).href })) };
    assert.deepEqual(compareRendered(facts, nodes), [], `${p}: 화면 이동 줄 = BreadcrumbList`);
    // 대조가 실제로 잡는지 — 화면 글자 하나를 바꾸면 불일치
    assert.deepEqual(compareRendered({ breadcrumb: facts.breadcrumb.map((c, i) => (i === 0 ? { ...c, name: "첫 화면" } : c)) }, nodes), ["structured-data.breadcrumb"]);
    await page.close();
  }
});

test("h) 지역 화면 링크 전수 404 0 · 360·1280px 가로 넘침 0 · 접근성 95", async () => {
  const pages = ["/local/seoul", sidoPath(), guPath(GU.full.key), guPath(GU.empty.key), guPath(GU.renamed.key)];
  const internal = new Set();
  for (const width of [360, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 } });
    try {
      const p = await ctx.newPage();
      for (const url of pages) {
        const res = await p.goto(`${base}${url}`, { waitUntil: "networkidle" });
        assert.equal(res.status(), 200, url);
        const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(over <= 0, `${url} ${width}px 가로 넘침 ${over}px`);
        for (const h of await p.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")))) if (h.startsWith("/") && !h.startsWith("//")) internal.add(h.split("#")[0] || "/");
      }
    } finally {
      await ctx.close();
    }
  }
  assert.ok([...internal].some((h) => h === sidoPath()), "이동 줄·안내의 시·도 링크");
  for (const h of internal) {
    const r = await get(h);
    assert.equal(r.status, 200, `링크 ${h}: 200 (404·넘김 0)`);
  }
  for (const url of [guPath(GU.full.key), guPath(GU.empty.key)]) {
    const r = await accessibility(`${base}${url}`, debugPort);
    assert.equal(new URL(r.finalUrl).pathname, url, "잰 주소");
    assert.ok(r.score >= A11Y_MIN, `${url} 접근성 ${r.score} — ${r.failing.join(", ")}`);
  }
});

test("i) 공개 데이터를 읽지 못하면 지역 주소 503 — 있는지 모르므로 404·301 0, /local 허브는 200 그대로", async () => {
  const deadPort = await freePort(); // 아무도 듣지 않는 포트
  const dead = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${deadPort}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-not-a-real-key",
    SUPABASE_SERVICE_ROLE_KEY: "e2e-not-a-real-key",
    NEXT_PUBLIC_SITE_URL: SITE,
  });
  try {
    for (const p of ["/local/seoul", sidoPath(), guPath(GU.a.key), `/local/nowhere-${staff.run}`]) {
      const r = await get(p, dead.base);
      assert.equal(r.status, 503, `${p}: 503`);
      assert.equal(r.location, null, `${p}: 넘김 0`);
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.equal(r.headers.get("retry-after"), "30");
      assert.ok(r.html.includes("잠시 뒤 다시 확인해 주세요") && !r.html.includes("찾는 화면이 없습니다"), `${p}: 안내 — 없음 안내 0`);
      assert.doesNotMatch(r.html, /ECONNREFUSED|fetch failed|PGRST|SUPABASE/i, `${p}: 오류 원문 0`);
    }
    const hub = await get("/local", dead.base);
    assert.equal(hub.status, 200, "/local 허브는 닫힌 목록 200");
  } finally {
    dead.stop();
  }
});
