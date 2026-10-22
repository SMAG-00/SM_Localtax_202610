// 지자체 허브 골격 E2E (W4 4단계 — docs/dev/W4_설계.md 1장 4단계 증거 · 2.8, PRD-01B LG-08 · REG1-02 · REG-06 · REG-10 · CORE-02)
// standalone 빌드를 띄우고 로컬 Supabase에 붙인다. 시험용 지역은 법정동코드에 없는 접두 99 가짜 코드와 '시험용' 이름이다(설계 8장) —
// 시·도 1(9900000000) + 시·군·구 2(가득구·빈구)와 지자체뉴스 기사 4건을 첫 화면 요청 전에 DB에 넣는다(공개 데이터 캐시 30초 — 설정 쓰기 API가 바로 만료한다).
//  a) 블록 순서 — 시·도·시·군·구 허브 360×740·1280×800 DOM 순서 = 화면 위치 = ② 지방세·지방재정 → ③ 부동산·개발 → ⑤ 공식 자료/해설, 블록 이름 글자 · /local은 W2-b 그대로(②③)
//  b) ① 금주 핫뉴스·④ 행사안내 — 기능 키 꺼짐 요소 0, 켜도 W4는 0 (W6가 데이터·화면과 함께)
//  c) 블록 내용 — ② = 지방세·지방재정 기사만, ③ = 부동산·도시정책 기사만(대응 밖 0) · 카드마다 기자·발행일 · 대응 설정을 바꾸면 다음 요청부터 · 잘못된 대응 422 · 광고 담당 403 + 감사
//  d) 분야 필터 ?topic= — 고른 분야만(다른 블록 0)·목록 밖 값은 전체·JS 꺼도 링크·고른 분야 0건은 noindex
//  e) 대체 표시 — 시·군·구 0건 → 상위 시·도 기사 + "○○ 기사가 없어 ○○ 기사를 보입니다", 상위도 0 → 0건 문장(빈 카드·'준비 중' 0)
//  f) 데이터 출처 줄 1개 — "출처 편집국 · 최신 발행일 ○○" (블록 기사의 최신 발행일)
//  g) 360px 가로 넘침 0 · 최신 기사까지 탭 1번 · R1~R3 · 링크 전수 200 · 접근성 95
//  h) 지방세 포인트 — 초안(서명 전) 0, 세무 감수위원 서명 뒤 시·도·시·군·구 허브와 /local 머리에 1개
// 만든 계정·기사·지역은 끝나면 지우고, 운영 설정(기능 키·블록 대응·지방세 포인트)은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { measurePage } from "./lib/screen-rules.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-local-hub-e2e@example.test";
const SITE = "https://e2e.example.test";
const SIDO = { code: "9900000000", name: "시험용 가상도" };
const GU = {
  full: { code: "9901100000", name: "시험용 가득구", key: "gadeuk" },
  empty: { code: "9902100000", name: "시험용 빈구", key: "bin" },
};
const BLOCK_TITLES = ["지방세·지방재정", "부동산·개발", "공식 자료/해설"];
const SEED_FIELDS = { local_tax: ["local_tax", "local_finance"], realestate: ["realestate", "urban_policy"] };

let sb, server, staff, db, browser, base, debugPort;
const u = {};
const fx = {};
const counts0 = {};

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const kstDate = (iso) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);
const slugOf = (key) => `${key}-${staff.run}-gu`;
const sidoPath = () => `/local/${fx.sidoSlug}`;
const guPath = (key) => `${sidoPath()}/${slugOf(key)}`;

async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const show = (r) => JSON.stringify(r.body).slice(0, 400);

async function setFlags(patch) {
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  const r = await api("PATCH", "/settings/feature_flags", u.admin, { value: { ...cur, ...patch } });
  assert.equal(r.status, 200, `기능 키 ${JSON.stringify(patch)}: ${show(r)}`);
}
const setBlockFields = (user, value) => api("PATCH", "/settings/local_block_fields", user, { value });

async function get(p) {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
}

async function open(p, viewport = { width: 1280, height: 800 }, opts = {}) {
  const ctx = await browser.newContext({ viewport, ...opts });
  const page = await ctx.newPage();
  const res = await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
  return { page, ctx, status: res.status() };
}

/** 블록 — 차례대로 [키, 제목, 화면 위 y, 기사 번호들, 대체 문장, 0건 문장] */
const blocksOf = (page) =>
  page.$$eval("[data-hub-block]", (els) =>
    els.map((el) => ({
      key: el.getAttribute("data-hub-block"),
      title: el.querySelector("h2")?.textContent ?? null,
      y: el.getBoundingClientRect().top + window.scrollY,
      ids: [...el.querySelectorAll("[data-article-id]")].map((a) => Number(a.getAttribute("data-article-id"))),
      fallback: el.querySelector('[data-part="block-fallback"]')?.textContent ?? null,
      empty: el.querySelector('[data-part="block-empty"]')?.textContent ?? null,
    })),
  );

async function removeFixtureRegions(q) {
  await q("delete from public.region_slug_redirects where region_code like '99%'");
  await q("update public.regions set successor_code = null where code like '99%' and successor_code is not null");
  await q("delete from public.regions where code like '99%' and level = 'sigungu'");
  await q("delete from public.regions where code like '99%'");
}

async function article(key, { title, field, codes, hoursAgo }) {
  const at = new Date(Date.now() - hoursAgo * 3600_000).toISOString();
  const row = await one(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, editorial_field, region_codes, first_published_at)
     values ($1, $2, '시험용 지역 기사 요약입니다', 'local', 'explainer', 'published', $3, $4, $5, $6) returning id, slug`,
    [`e2e-w4h-${key}-${staff.run}`, title, u.reporter.personId, field, codes, at],
  );
  staff.trackArticle(Number(row.id));
  fx[key] = { id: Number(row.id), href: `/news/${row.slug}`, publishedOn: kstDate(at) };
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
  await removeFixtureRegions((sql, params) => db.query(sql, params));
  await staff.snapshotOperations();
  for (const t of ["regions", "articles"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  for (const k of ["region_hubs", "weekly_digest", "local_events"]) assert.notEqual(flags[k], true, `시험 전 기능 키 ${k}는 꺼져 있어야 한다 (W4 2.4)`);
  assert.deepEqual((await one("select value from public.settings where key = 'local_block_fields'")).value, SEED_FIELDS, "시험 전 블록 대응 = 씨앗(REG1-02 초기값)");

  u.admin = await staff.createUser({ label: "w4h-admin", email: ADMIN_EMAIL });
  u.reporter = await staff.createUser({ label: "w4h-reporter", roles: ["reporter"], person: { name: "시험용 지역 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "w4h-editor", roles: ["editor"], person: { name: "시험용 지역 편집자", roles: ["editor"] } });
  u.reviewer = await staff.createUser({ label: "w4h-reviewer", roles: ["reviewer"], person: { name: "시험용 세무 감수위원", roles: ["reviewer"] } });
  u.ads = await staff.createUser({ label: "w4h-ads", roles: ["ad_ops"] });

  fx.sidoSlug = `gasang-${staff.run}`;
  await db.query("insert into public.regions (code, level, name, slug) values ($1, 'sido', $2, $3)", [SIDO.code, SIDO.name, fx.sidoSlug]);
  for (const g of Object.values(GU)) await db.query("insert into public.regions (code, parent_code, level, name, slug) values ($1, $2, 'sigungu', $3, $4)", [g.code, SIDO.code, g.name, slugOf(g.key)]);

  // 기사 — 가득구 지방세(1시간 전)·지방재정(2시간 전)·부동산(4시간 전), 가상도 자기 태그 지방세(3시간 전). 도시정책 기사는 0 (상위도 0건 시험)
  await article("tax", { title: "시험용 가득구 지방세 해설", field: "local_tax", codes: [GU.full.code], hoursAgo: 1 });
  await article("finance", { title: "시험용 가득구 지방재정 해설", field: "local_finance", codes: [GU.full.code], hoursAgo: 2 });
  await article("sidoTax", { title: "시험용 가상도 지방세 해설", field: "local_tax", codes: [SIDO.code], hoursAgo: 3 });
  await article("estate", { title: "시험용 가득구 부동산 해설", field: "realestate", codes: [GU.full.code], hoursAgo: 4 });

  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
  await setFlags({ region_hubs: true }); // 설정 쓰기 = 공개 데이터 캐시 만료 (위에서 넣은 지역·기사가 첫 요청부터 보인다)
});

after(async () => {
  try {
    await browser?.close();
    await staff?.cleanup(); // 기사·계정·감사 로그 지우기 + 운영 설정(기능 키·블록 대응·지방세 포인트) 되돌리기
  } finally {
    server?.stop();
    if (sb && Object.keys(counts0).length) {
      const c = new pg.Client({ connectionString: sb.dbUrl });
      await c.connect();
      try {
        await removeFixtureRegions((sql, params) => c.query(sql, params));
        for (const t of ["regions", "articles"]) assert.equal((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n, counts0[t], `정리 뒤 ${t} 행 수 = 시험 전`);
        assert.deepEqual((await c.query("select value from public.settings where key = 'local_block_fields'")).rows[0].value, SEED_FIELDS, "블록 대응 되돌림");
        const flags = (await c.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
        for (const k of ["region_hubs", "weekly_digest", "local_events"]) assert.notEqual(flags[k], true, `기능 키 ${k} 되돌림`);
      } finally {
        await c.end();
      }
    }
  }
});

test("a) 블록 순서 — 360×740·1280×800 DOM 순서 = 화면 위치 = ②③⑤, 블록 이름 글자, 순서를 바꾸는 설정 0 · /local은 ②③ 그대로", async () => {
  for (const viewport of [
    { width: 360, height: 740 },
    { width: 1280, height: 800 },
  ]) {
    for (const p of [sidoPath(), guPath(GU.full.key), guPath(GU.empty.key)]) {
      const { page, ctx, status } = await open(p, viewport);
      assert.equal(status, 200, p);
      const blocks = await blocksOf(page);
      assert.deepEqual(blocks.map((b) => b.key), ["localTax", "realEstate", "sources"], `${p} ${viewport.width}px DOM 순서`);
      assert.deepEqual(blocks.map((b) => b.title), BLOCK_TITLES, `${p}: 블록 이름이 글자로`);
      for (let i = 1; i < blocks.length; i++) assert.ok(blocks[i].y > blocks[i - 1].y, `${p} ${viewport.width}px 화면 위치 ${blocks[i - 1].key} < ${blocks[i].key}`);
      const text = await page.locator("main").innerText();
      assert.doesNotMatch(text, /명소|맛집|준비 중/, `${p}: 명소·맛집·'준비 중' 0`);
      assert.equal(await page.locator('[data-ui="map"], iframe').count(), 0, `${p}: 지도 0`);
      await ctx.close();
    }
  }
  // 지자체뉴스 허브(/local — W2-b)는 데이터가 있는 블록만 — 이 시험 자료에는 검수 공식 자료·감수 해설이 없어 ②③ (⑤가 채워진 화면은 9단계 w4-local-blocks가 본다)
  const { page, ctx } = await open("/local");
  assert.deepEqual((await blocksOf(page)).map((b) => b.key), ["localTax", "realEstate"]);
  await ctx.close();
  // 설정에 순서 키를 넣을 수 없다 (LG-08 코드 고정)
  const r = await setBlockFields(u.admin, { ...SEED_FIELDS, order: ["realestate", "local_tax"] });
  assert.equal(r.status, 422, show(r));
});

test("b) ① 금주 핫뉴스·④ 행사안내 — 기능 키 꺼짐 요소 0, 켜도 W4는 요소 0 (빈 블록 0)", async () => {
  const check = async (label) => {
    for (const p of ["/local", sidoPath(), guPath(GU.full.key)]) {
      const { html } = await get(p);
      assert.ok(!html.includes('data-hub-block="weekly"') && !html.includes('data-hub-block="events"'), `${label} ${p}: ①④ 요소 0`);
      assert.ok(!/>금주 핫뉴스<|>행사안내</.test(html), `${label} ${p}: ①④ 블록 이름 0`);
      assert.ok(!html.includes("현재 확인된 일정 없음"), `${label} ${p}`);
    }
  };
  await check("꺼짐");
  await setFlags({ weekly_digest: true, local_events: true });
  try {
    await check("켜짐(W4)");
    const { page, ctx } = await open(guPath(GU.full.key));
    assert.deepEqual((await blocksOf(page)).map((b) => b.key), ["localTax", "realEstate", "sources"], "나머지 순서 그대로");
    await ctx.close();
  } finally {
    await setFlags({ weekly_digest: false, local_events: false });
  }
});

test("c) 블록 내용 — ②·③은 대응 편집 분야 기사만, 카드마다 기자·발행일 · 대응을 바꾸면 다음 요청부터 · 잘못된 대응 422 · 광고 담당 403 + 감사", async () => {
  const { page, ctx } = await open(guPath(GU.full.key));
  const [tax, estate, sources] = await blocksOf(page);
  assert.deepEqual(tax.ids, [fx.tax.id, fx.finance.id], "② = 그 시·군·구의 지방세·지방재정 기사, 최신 순 (다른 시·군·구·상위 태그 0)");
  assert.deepEqual(estate.ids, [fx.estate.id], "③ = 부동산 기사만");
  assert.deepEqual(sources.ids, [], "⑤ — 이 시험 자료에는 감수 해설 0 (채워진 ⑤는 9단계 w4-local-blocks)");
  assert.equal(sources.empty, "아직 확인된 공식 자료·감수 해설이 없습니다.");
  assert.deepEqual([tax.fallback, estate.fallback], [null, null], "자기 기사 — 대체 문장 0");
  const cards = await page.$$eval("[data-hub-block] [data-article-id]", (els) =>
    els.map((el) => ({ byline: el.querySelector('[data-part="byline"]')?.textContent ?? "", date: el.querySelector("time")?.getAttribute("datetime") ?? "", field: !!el.querySelector('[data-ui="editorial-field-badge"]') })),
  );
  assert.equal(cards.length, 3);
  for (const c of cards) {
    assert.equal(c.byline, "시험용 지역 기자", "카드마다 기자");
    assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/, "카드마다 발행일");
    assert.ok(c.field, "카드마다 편집 분야 배지");
  }
  await ctx.close();

  // 시·도 허브 = 자기 + 하위 시·군·구 태그 (12장 #26)
  const sido = await open(sidoPath());
  const [sTax, sEstate] = await blocksOf(sido.page);
  assert.deepEqual(sTax.ids, [fx.tax.id, fx.finance.id, fx.sidoTax.id]);
  assert.deepEqual(sEstate.ids, [fx.estate.id]);
  await sido.ctx.close();

  // 대응 설정 — 잘못된 모양 422(칸별 문장), 광고 담당 403 + 감사 1건, 관리자가 지방재정을 ③으로 옮기면 다음 요청부터
  const bad = await setBlockFields(u.admin, { local_tax: ["local_tax", "urban_policy"], realestate: ["realestate", "urban_policy"] });
  assert.equal(bad.status, 422, show(bad));
  assert.match(bad.body.errors.join("\n"), /한 블록에 한 번만/);
  const denied = await setBlockFields(u.ads, { local_tax: ["local_tax"], realestate: ["realestate", "urban_policy", "local_finance"] });
  assert.equal(denied.status, 403, show(denied));
  assert.equal((await one("select count(*)::int n from public.audit_logs where action = 'settings.edit.denied' and target = 'settings:local_block_fields'")).n, 1, "거부 감사 1건");
  const moved = await setBlockFields(u.admin, { local_tax: ["local_tax"], realestate: ["realestate", "urban_policy", "local_finance"] });
  assert.equal(moved.status, 200, show(moved));
  try {
    const after = await open(guPath(GU.full.key));
    const [t2, e2] = await blocksOf(after.page);
    assert.deepEqual(t2.ids, [fx.tax.id], "② 지방재정 빠짐");
    assert.deepEqual(e2.ids, [fx.finance.id, fx.estate.id], "③ 지방재정 들어옴");
    await after.ctx.close();
    const hub = await open("/local");
    const [h2] = await blocksOf(hub.page);
    assert.ok(!h2.ids.includes(fx.finance.id), "/local ②도 같은 설정");
    await hub.ctx.close();
  } finally {
    assert.equal((await setBlockFields(u.admin, SEED_FIELDS)).status, 200);
  }
});

test("d) 분야 필터 ?topic= — 고른 분야만(다른 블록 0) · 목록 밖 값은 전체 · JS 꺼도 링크 · 고른 분야 0건 noindex", async () => {
  const tax = await open(`${guPath(GU.full.key)}?topic=local_tax`);
  const blocks = await blocksOf(tax.page);
  assert.deepEqual(blocks.map((b) => b.key), ["localTax", "sources"], "지방세를 담지 않는 ③ 블록 0");
  assert.deepEqual(blocks[0].ids, [fx.tax.id], "지방재정 기사 0");
  assert.equal(await tax.page.locator('[data-ui="topic-filter"] a[aria-current="page"]').textContent(), "지방세");
  // 운영 전환 전에는 루트가 모든 화면을 noindex로 두므로(SITE_INDEXING), 이 주소 자체의 판정은 화면 값으로 본다.
  // 기사 있는 분야 — 이 주소의 제외 사유는 '고른 분야 0건'이 아니다. 이 시험 자료는 공식 자료가 0이라 지역 전체가 최소선 미달(W4 11단계 — 색인 판정은 e2e/w4-region-index)
  assert.equal(await tax.page.getAttribute('[data-ui="region-page"]', "data-region-noindex-reason"), "below_minimum", "기사 있는 분야 — 사유는 최소선 미달뿐(고른 분야 0건 아님)");
  const filter = await tax.page.$$eval('[data-ui="topic-filter"] a', (as) => as.map((a) => [a.textContent, a.getAttribute("href")]));
  const gu = guPath(GU.full.key);
  assert.deepEqual(filter, [
    ["전체", gu],
    ["지방세", `${gu}?topic=local_tax`],
    ["지방재정", `${gu}?topic=local_finance`],
    ["부동산·정비", `${gu}?topic=realestate`],
    ["도시정책", `${gu}?topic=urban_policy`],
  ]);
  await tax.ctx.close();

  const bogus = await open(`${gu}?topic=tourism`);
  assert.deepEqual((await blocksOf(bogus.page)).map((b) => b.key), ["localTax", "realEstate", "sources"], "목록 밖 값 = 전체");
  assert.equal(await bogus.page.getAttribute('[data-ui="region-page"]', "data-region-topic"), "all");
  await bogus.ctx.close();

  // JS 꺼도 링크로 동작 (서버가 그린 링크 탭)
  const nojs = await open(gu, { width: 360, height: 740 }, { javaScriptEnabled: false });
  await Promise.all([nojs.page.waitForURL(/topic=local_finance/), nojs.page.locator('[data-ui="topic-filter"] a', { hasText: "지방재정" }).click()]);
  const [fin] = await blocksOf(nojs.page);
  assert.deepEqual(fin.ids, [fx.finance.id], "JS 없이 지방재정 기사만");
  await nojs.ctx.close();

  // 고른 분야에 그 지역 기사 0 → noindex (빈 목록 색인 0)
  const none = await get(`${gu}?topic=urban_policy`);
  assert.equal(none.status, 200);
  assert.match(none.html, /<meta name="robots" content="noindex, ?nofollow"/);
  assert.ok(none.html.includes('data-region-noindex="true"'), "고른 분야 0건 — 이 주소 noindex");
  assert.ok(none.html.includes('data-region-noindex-reason="topic_empty"'), "사유 = 고른 분야 0건");
  assert.ok((await get(gu)).html.includes('data-region-noindex-reason="below_minimum"'), "전체 보기 — 빈 목록 사유 0, 최소선 판정만(공식 자료 0 — 11단계)");
});

test("e) 대체 표시 — 시·군·구 0건 → 상위 시·도 기사 + '○○ 기사가 없어 ○○ 기사를 보입니다' · 상위도 0 → 0건 문장", async () => {
  const empty = await open(guPath(GU.empty.key));
  assert.match((await empty.page.getAttribute('meta[name="robots"]', "content")) ?? "", /noindex/, "그 지역 기사 0 — noindex (REG1-01)");
  const [tax, estate, sources] = await blocksOf(empty.page);
  const notice = `${GU.empty.name} 기사가 없어 ${SIDO.name} 기사를 보입니다`;
  assert.deepEqual(tax.ids, [fx.tax.id, fx.finance.id, fx.sidoTax.id], "② 상위 시·도 범위 기사");
  assert.equal(tax.fallback, notice);
  assert.deepEqual(estate.ids, [fx.estate.id], "③ 상위 시·도 범위 기사");
  assert.equal(estate.fallback, notice);
  assert.equal(tax.empty, null);
  assert.equal(sources.empty, "아직 확인된 공식 자료·감수 해설이 없습니다.");
  assert.equal(await empty.page.getByText("준비 중").count(), 0);
  await empty.ctx.close();

  // 상위 시·도에도 도시정책 기사가 없다 → 0건 문장만 (빈 카드·대체 문장 0)
  const none = await open(`${guPath(GU.empty.key)}?topic=urban_policy`);
  const blocks = await blocksOf(none.page);
  assert.deepEqual(blocks.map((b) => [b.key, b.ids.length, b.fallback, b.empty]), [
    ["realEstate", 0, null, "아직 공개된 도시정책 기사가 없습니다."],
    ["sources", 0, null, "아직 확인된 공식 자료·감수 해설이 없습니다."],
  ]);
  assert.equal(await none.page.locator("[data-hub-block] ul").count(), 0, "빈 목록 껍데기 0");
  assert.equal(await none.page.getByText("준비 중").count(), 0);
  await none.ctx.close();

  // 시·도 허브에는 대체 표시가 없다
  const sido = await get(sidoPath());
  assert.ok(!sido.html.includes('data-part="block-fallback"'));
});

test("f) 데이터 출처 줄 1개 — '출처 편집국 · 최신 발행일 ○○' (블록 기사의 최신 발행일)", async () => {
  const cases = [
    [guPath(GU.full.key), fx.tax.publishedOn],
    [guPath(GU.empty.key), fx.tax.publishedOn],
    [sidoPath(), fx.tax.publishedOn],
    [`${guPath(GU.full.key)}?topic=realestate`, fx.estate.publishedOn],
  ];
  for (const [p, date] of cases) {
    const { page, ctx } = await open(p);
    const lines = await page.$$eval('[data-ui="source-line"]', (els) => els.map((e) => e.textContent));
    assert.deepEqual(lines, [`출처 편집국 · 최신 발행일 ${date}`], p);
    await ctx.close();
  }
});

test("g) 360px 가로 넘침 0 · 최신 기사까지 탭 1번 · R1~R3 · 링크 전수 200 · 접근성 95", async () => {
  const pages = [sidoPath(), guPath(GU.full.key), guPath(GU.empty.key), `${guPath(GU.empty.key)}?topic=urban_policy`];
  const internal = new Set();
  for (const p of pages) {
    const { page, ctx } = await open(p, { width: 360, height: 740 });
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${p}: 360px 가로 넘침`);
    const small = await page.$$eval('main [data-ui="topic-filter"] a, main [data-part="empty-guide"] a', (as) => as.map((a) => ({ t: a.textContent, ...a.getBoundingClientRect().toJSON() })).filter((r) => r.height < 44 || r.width < 44));
    assert.deepEqual(small, [], `${p}: 분야 필터·안내 링크 터치 44px`);
    for (const h of await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")))) if (h.startsWith("/") && !h.startsWith("//")) internal.add(h.split("#")[0] || "/");
    await ctx.close();
  }
  // 지역 허브에서 가장 최신 전문 기사까지 — 블록의 첫 카드를 한 번 누르면 기사 (REG1-02 '탭 2번 이하')
  const { page, ctx } = await open(guPath(GU.full.key), { width: 360, height: 740 });
  await Promise.all([page.waitForURL(`${base}${fx.tax.href}`), page.locator(`[data-hub-block="localTax"] [data-article-id="${fx.tax.id}"] a`).click()]);
  await ctx.close();

  for (const p of [guPath(GU.full.key), guPath(GU.empty.key)]) {
    for (const width of [360, 640, 1024]) {
      const r = await measurePage(browser, `${base}${p}`, { width, height: 740 });
      if (width === 360) assert.ok(r.r1.pass, `${p} ${width}px R1 ${r.r1.chars}자 > 150`);
      assert.ok(r.r2.pass, `${p} ${width}px R2 주 버튼 ${r.r2.maxPerViewport}개`);
      assert.ok(r.r3.pass, `${p} ${width}px R3 오렌지 ${r.r3.ratio}`);
    }
  }
  for (const h of internal) {
    const r = await get(h);
    assert.equal(r.status, 200, `링크 ${h}: 200 (404·넘김 0)`);
  }
  for (const p of [guPath(GU.full.key), guPath(GU.empty.key)]) {
    const r = await accessibility(`${base}${p}`, debugPort);
    assert.ok(r.score >= A11Y_MIN, `${p} 접근성 ${r.score} — ${r.failing.join(", ")}`);
  }
});

test("h) 지방세 포인트 — 초안(서명 전) 0, 세무 감수위원 서명 뒤 시·도·시·군·구 허브와 /local 머리에 1개", async () => {
  const LINES = ["시험용 지자체 포인트 첫째 줄", "시험용 지자체 포인트 둘째 줄"];
  const drafted = await api("POST", "/hub-points", u.editor, { op: "draft", section: "local", lines: LINES, baseDate: "2026-10-01", links: [{ label: "시험용 지방세 해설 보기", href: "/tax" }] });
  assert.equal(drafted.status, 200, show(drafted));
  for (const p of [sidoPath(), guPath(GU.full.key), "/local"]) {
    const { html } = await get(p);
    assert.ok(!html.includes('data-ui="field-tax-point"'), `${p}: 서명 전 포인트 0`);
    assert.ok(!html.includes(LINES[0]), p);
  }
  const signed = await api("POST", "/hub-points", u.reviewer, { op: "review", section: "local" });
  assert.equal(signed.status, 200, show(signed));
  for (const p of [sidoPath(), guPath(GU.full.key), "/local"]) {
    const { page, ctx } = await open(p);
    assert.equal(await page.locator('[data-ui="field-tax-point"]').count(), 1, `${p}: 서명 뒤 포인트 1개`);
    assert.deepEqual(await page.$$eval('[data-ui="field-tax-point"] li', (els) => els.map((e) => e.textContent)), LINES, p);
    if (p !== "/local") {
      // 지역 허브에서는 머리 아래·분야 필터 위 (5장 순서)
      const order = await page.evaluate(() => {
        const y = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? -1;
        return [y("h1"), y('[data-ui="field-tax-point"]'), y('[data-ui="topic-filter"]'), y("[data-hub-block]")];
      });
      for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `${p}: 머리 → 포인트 → 분야 필터 → 블록 ${order}`);
    }
    await ctx.close();
  }
});
