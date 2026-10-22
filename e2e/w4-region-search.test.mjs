// 지역 + 주제 검색 E2E (W4 10단계 — docs/dev/W4_설계.md 1장 10단계 증거 · 2.2 search_topics · 2.9 · 2.9.1 · 11.9, PRD-01B REG-08 · REG1-11 · PRD-01A SRCH-01·02).
// standalone 빌드를 띄우고 로컬 Supabase에 붙인다. 시험용 지역은 법정동코드에 없는 접두 99 가짜 코드와 '시험' 이름이다(설계 8장 — 실제 지명 0).
// 2단계(전국 적재) 전이라 2.9 실제 이름 견본(성동구·경주 등)은 순수 분류 시험(search-classify.test.ts)이 보고, 이 시험은 같은 모양의 가짜 지역으로 본다.
//  a) 지역 + 주제 → 지역 허브가 첫 결과(region_hubs 꺼짐 → 글자만, 켜면 허브 주소 200) · 그 지역 태그 주제 기사(별칭 '재건축') · 분류 줄 '지역 ○○ · 주제 ○○' ·
//     지역명만 → 허브 첫 결과 · 초안·권리 미확인 대표 이미지 기사 0
//  b) 사전 밖 낱말('축제') → 지역 1 + 주제 0, 결과 유형은 지역·기사뿐(명소·맛집 0) · 옛 이름 별칭 → 현재 지역 · 동명 → 후보 모두(하나로 단정 0)
//  c) 지역 밖 결과 0건 → 상위 지역·다른 표기·상황 카드 제안 각 1개 이상 · 제안 링크 200 · 지역명 없는 0건은 W2-d 결과 없음 그대로
//  d) /api/search — regionClassified·classification(지역·주제·동명·제안) · 지역 없는 검색은 거짓
//  e) search_submitted.region_classified = 실제 분류 · 속성 4칸 · 검색어·지역 코드 조각 0
//  f) 운영 설정 search_topics — 틀린 값 422(값 그대로)·별칭을 더하면 배포 없이 다음 검색부터 · 편집 책임자 403
//  g) 360·1280px 가로 넘침 0 · 접근성 95
// 만든 계정·기사·상황·지역은 끝나면 지우고, 운영 설정(기능 키·주제 사전)은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-region-search-e2e@example.test";
const SITE = "https://e2e.example.test";
const SIDO = { code: "9900000000", name: "시험용 검색분류도", aliases: ["검색분류도"] };
const GU = { code: "9903100000", name: "시험검색가람구", aliases: [] };
const NURI = { code: "9903200000", name: "시험검색누리시", aliases: ["시험검색누리"] };
const H1 = { code: "9903300000", name: "시험검색고개군", aliases: [] };
const H2 = { code: "9903400000", name: "시험검색고개군", aliases: [] };
const NEW = { code: "9903500000", name: "시험검색새벌구", aliases: ["시험검색옛벌"] };
const KIND_OK = ["region", "situation", "tracker", "glossary", "category", "article", "person", "interpretation"];

let sb, server, staff, db, browser, base, debugPort;
const u = {};
const fx = {};
const counts0 = {};
let topics0;

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const hoursAgo = (n) => new Date(Date.now() - n * 3600_000).toISOString();
const searchPath = (q) => `/search?q=${encodeURIComponent(q)}`;

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
async function getJson(p) {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function open(p, viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const res = await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
  return { page, ctx, status: res.status() };
}
const hitsOf = (page) =>
  page.$$eval("[data-search-hit]", (els) =>
    els.map((e) => ({
      key: `${e.getAttribute("data-kind")}:${e.getAttribute("data-ref")}`,
      kind: e.getAttribute("data-kind"),
      link: e.querySelector("h3 a")?.getAttribute("href") ?? null,
      type: e.querySelector('[data-part="type-label"]')?.textContent ?? null,
    })),
  );
const classifiedOf = (page) =>
  page.$eval('[data-search-part="classified"]', (el) => ({
    regions: el.querySelector('[data-classified="regions"]')?.textContent ?? null,
    topics: el.querySelector('[data-classified="topics"]')?.textContent ?? null,
  }));
const eventsSince = async (since) => (await db.query("select * from public.analytics_events where name = 'search_submitted' and occurred_at >= $1 order by id", [since])).rows;
async function waitEvents(since, n) {
  for (let i = 0; i < 50; i++) {
    const rows = await eventsSince(since);
    if (rows.length >= n) return rows;
    await new Promise((r) => setTimeout(r, 100));
  }
  return eventsSince(since);
}

async function removeFixtureRegions(q) {
  await q("delete from public.region_slug_redirects where region_code like '99%'");
  await q("update public.regions set successor_code = null where code like '99%' and successor_code is not null");
  await q("delete from public.regions where code like '99%' and level = 'sigungu'");
  await q("delete from public.regions where code like '99%'");
}

/** 공개 지역 기사 — 발행일을 넣은 공개 행(이관 모양 — 7·8단계 새 발행 검사 밖, 읽기 시험 재료) */
async function article(key, { title, codes, field = "realestate", status = "published", leadMedia = null }) {
  const row = await one(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, editorial_field, public_question, region_codes, first_published_at, lead_media_id)
     values ($1, $2, '시험용 지역 기사 요약입니다', 'local', 'explainer', $3, $4, $5, '시험용 지역 재정은 어떻게 바뀌나', $6, $7, $8) returning id, slug`,
    [`e2e-w4s-${key}-${staff.run}`, title, status, u.reporter.personId, field, codes, status === "published" ? hoursAgo(1) : null, leadMedia],
  );
  staff.trackArticle(Number(row.id));
  fx[key] = { id: Number(row.id), href: `/news/${row.slug}` };
  return fx[key];
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
  for (const t of ["regions", "articles", "situations", "media"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  topics0 = (await one("select value from public.settings where key = 'search_topics'")).value;
  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  for (const k of ["search", "region_hubs"]) assert.notEqual(flags[k], true, `시험 전 기능 키 ${k}는 꺼져 있어야 한다`);

  u.admin = await staff.createUser({ label: "w4s-admin", email: ADMIN_EMAIL });
  u.reporter = await staff.createUser({ label: "w4s-reporter", roles: ["reporter"], person: { name: "시험용 검색 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "w4s-editor", roles: ["editor"], person: { name: "시험용 검색 편집자", roles: ["editor"] } });
  u.reviewer = await staff.createUser({ label: "w4s-reviewer", roles: ["reviewer"], person: { name: "시험용 검색 감수위원", roles: ["reviewer"] } });

  fx.sidoSlug = `geomsaek-${staff.run}`;
  await db.query("insert into public.regions (code, level, name, slug, aliases) values ($1, 'sido', $2, $3, $4)", [SIDO.code, SIDO.name, fx.sidoSlug, SIDO.aliases]);
  for (const [i, g] of [GU, NURI, H1, H2, NEW].entries()) {
    await db.query("insert into public.regions (code, parent_code, level, name, slug, aliases) values ($1, $2, 'sigungu', $3, $4, $5)", [g.code, SIDO.code, g.name, `g${i}-${staff.run}`, g.aliases]);
  }
  fx.guSlug = `g0-${staff.run}`;

  await article("redev", { title: "시험용 재건축 조합원 세금 정리", codes: [GU.code] });
  await article("draft", { title: "시험용 재건축 초안", codes: [GU.code], status: "draft" });
  const media = await one("insert into public.media (path, kind) values ($1, 'photo') returning id", [`e2e-w4s-${staff.run}.jpg`]);
  staff.trackRow("media", media.id);
  await article("uncleared", { title: "시험용 재개발 대표 이미지 권리 미확인", codes: [GU.code], leadMedia: media.id });
  await article("fest", { title: "시험용 축제 예산의 지방재정 영향", codes: [NURI.code], field: "local_finance" });
  await article("h1", { title: "시험용 재산세 고지 안내 가", codes: [H1.code], field: "local_tax" });
  await article("h2", { title: "시험용 재산세 고지 안내 나", codes: [H2.code], field: "local_tax" });
  await article("renamed", { title: "시험용 재산세 새벌 안내", codes: [NEW.code], field: "local_tax" });
  const sit = await one(
    `insert into public.situations (slug, section, title, subtitle, pictogram, checks, visible, reviewer_id, reviewed_at)
     values ($1, 'local', '시험용 지역 세금 상황', '시험용 상황 한 줄', 'car-sold', $2, true, $3, now()) returning id, slug`,
    [`e2e-w4s-sit-${staff.run}`, JSON.stringify([{ title: "하나" }, { title: "둘" }, { title: "셋" }]), u.reviewer.personId],
  );
  staff.trackRow("situations", sit.id);
  fx.situation = sit.slug;
  await setFlags({ search: true });

  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
});

after(async () => {
  try {
    await browser?.close();
    await staff?.cleanup(); // 기사·상황·이미지·계정·감사 로그·측정 이벤트 지우기 + 운영 설정 되돌리기
  } finally {
    server?.stop();
    if (sb && Object.keys(counts0).length) {
      const c = new pg.Client({ connectionString: sb.dbUrl });
      await c.connect();
      try {
        await removeFixtureRegions((sql, params) => c.query(sql, params));
        for (const t of Object.keys(counts0)) assert.equal((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n, counts0[t], `정리 뒤 ${t} 행 수 = 시험 전`);
        const flags = (await c.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
        for (const k of ["search", "region_hubs"]) assert.notEqual(flags[k], true, `기능 키 ${k} 되돌림`);
        assert.deepEqual((await c.query("select value from public.settings where key = 'search_topics'")).rows[0].value, topics0, "주제 사전 되돌림");
      } finally {
        await c.end();
      }
    }
  }
});

test("a) 지역 + 주제 → 지역 허브가 첫 결과(region_hubs 꺼짐 → 글자만, 켜면 허브 200) · 그 지역 태그 주제 기사 · 분류 줄 · 지역명만 → 허브 첫 결과 · 초안·권리 미확인 0", async () => {
  const q = `${GU.name} 재개발`;
  let { page, ctx, status } = await open(searchPath(q));
  assert.equal(status, 200);
  let hits = await hitsOf(page);
  assert.equal(hits[0].key, `region:${GU.code}`, "지역 허브가 첫 결과");
  assert.equal(hits[0].link, null, "region_hubs 꺼짐 → 제목 글자만(링크 0)");
  assert.equal(hits[0].type, "지역");
  const keys = hits.map((h) => h.key);
  assert.ok(keys.includes(`article:${fx.redev.id}`), "그 지역 태그 + 주제 별칭(재건축) 기사");
  for (const k of ["draft", "uncleared", "fest", "h1"]) assert.ok(!keys.includes(`article:${fx[k].id}`), `${k} 0`);
  assert.deepEqual(await classifiedOf(page), { regions: `지역 ${SIDO.name} ${GU.name}`, topics: "주제 재개발·재건축" });
  await ctx.close();

  await setFlags({ region_hubs: true });
  try {
    ({ page, ctx } = await open(searchPath(q)));
    hits = await hitsOf(page);
    assert.equal(hits[0].link, `/local/${fx.sidoSlug}/${fx.guSlug}`, "켜면 허브 주소");
    await ctx.close();
    assert.equal((await fetch(`${base}${hits[0].link}`, { redirect: "manual" })).status, 200, "허브 주소 200");
  } finally {
    await setFlags({ region_hubs: false });
  }

  ({ page, ctx } = await open(searchPath(GU.name)));
  assert.equal((await hitsOf(page))[0].key, `region:${GU.code}`, "지역명만 → 허브 첫 결과 (REG-08)");
  assert.deepEqual(await classifiedOf(page), { regions: `지역 ${SIDO.name} ${GU.name}`, topics: null });
  await ctx.close();
});

test("b) '축제'(사전 밖) → 지역 1 + 주제 0·결과 유형 지역·기사뿐 · 옛 이름 별칭 → 현재 지역 · 동명 → 후보 모두(하나로 단정 0)", async () => {
  let { page, ctx } = await open(searchPath(`${NURI.aliases[0]} 축제`));
  let hits = await hitsOf(page);
  assert.deepEqual(hits.map((h) => h.key), [`region:${NURI.code}`, `article:${fx.fest.id}`]);
  assert.ok(hits.every((h) => KIND_OK.includes(h.kind)), "명소·맛집 결과 유형 0");
  assert.deepEqual([...new Set(hits.map((h) => h.type ?? "기사 배지"))].sort(), ["기사 배지", "지역"].sort(), "결과 유형 표시 = 지역·기사 배지뿐");
  assert.deepEqual(await classifiedOf(page), { regions: `지역 ${SIDO.name} ${NURI.name}`, topics: null });
  await ctx.close();

  ({ page, ctx } = await open(searchPath(`${NEW.aliases[0]} 재산세`)));
  hits = await hitsOf(page);
  assert.equal(hits[0].key, `region:${NEW.code}`, "옛 이름 → 현재 지역");
  assert.ok(hits.some((h) => h.key === `article:${fx.renamed.id}`));
  await ctx.close();

  ({ page, ctx } = await open(searchPath(`${H1.name} 재산세`)));
  hits = await hitsOf(page);
  assert.deepEqual(hits.filter((h) => h.kind === "region").map((h) => h.key), [`region:${H1.code}`, `region:${H2.code}`], "동명 후보 모두");
  assert.deepEqual(hits.slice(0, 2).map((h) => h.kind), ["region", "region"]);
  for (const k of ["h1", "h2"]) assert.ok(hits.some((h) => h.key === `article:${fx[k].id}`), k);
  const line = await classifiedOf(page);
  assert.match(line.regions, /^지역 후보 2곳 — /);
  assert.match(line.regions, /하나로 정하지 않고 모두 보입니다/);
  assert.equal(line.topics, "주제 재산세");
  await ctx.close();
});

test("c) 지역 밖 결과 0건 → 상위 지역·다른 표기·상황 카드 제안 각 1개 이상 · 제안 링크 200 · 지역명 없는 0건은 W2-d 결과 없음 그대로", async () => {
  const { page, ctx } = await open(searchPath(`${GU.name} 취득세`));
  assert.deepEqual((await hitsOf(page)).map((h) => h.key), [`region:${GU.code}`]);
  const block = page.locator('[data-search-part="region-suggest"]');
  assert.equal(await block.count(), 1);
  const links = async (part) => block.locator(`[data-part="${part}"] a`).evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute("href")]));
  const upper = await links("suggest-upper");
  const spellings = await links("suggest-spellings");
  assert.deepEqual(upper.map(([t]) => t), [`${SIDO.name} 취득세`, "취득세"]);
  assert.deepEqual(spellings.map(([t]) => t), [`${SIDO.aliases[0]} ${GU.name} 취득세`]);
  const situations = await block.locator('[data-part="search-situations"] [data-situation-slug]').evaluateAll((els) => els.map((e) => e.getAttribute("data-situation-slug")));
  assert.ok(situations.includes(fx.situation), `상황 카드: ${situations}`);
  for (const [, href] of [...upper, ...spellings]) assert.equal((await fetch(`${base}${href}`)).status, 200, href);
  assert.equal(await page.locator('[data-search-part="empty"]').count(), 0, "지역 허브가 있으니 결과 없음 화면 0");
  await ctx.close();

  // 지역명 없는 0건 — W2-d 결과 없음 화면, 지역 제안 0
  const none = await open(searchPath(`없는낱말큐엑스${staff.run}`));
  assert.equal(await none.page.locator('[data-search-part="empty"]').count(), 1);
  assert.equal(await none.page.locator('[data-search-part="region-suggest"]').count(), 0);
  assert.equal(await none.page.locator('[data-search-part="classified"]').count(), 0);
  await none.ctx.close();
});

test("d) /api/search — regionClassified·classification(지역·주제·동명·제안), 지역 없는 검색은 거짓", async () => {
  const r = await getJson(`/api/search?q=${encodeURIComponent(`${GU.name} 재개발`)}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.regionClassified, true);
  assert.deepEqual(r.body.classification.regions, [{ code: GU.code, name: GU.name, level: "sigungu", parentName: SIDO.name }]);
  assert.deepEqual(r.body.classification.topics, [{ key: "redevelopment", label: "재개발·재건축" }]);
  assert.equal(r.body.classification.ambiguous, false);
  assert.equal(r.body.items[0].kind, "region");
  const homonym = await getJson(`/api/search?q=${encodeURIComponent(`${H1.name} 재산세`)}&tab=region`);
  assert.equal(homonym.body.classification.ambiguous, true);
  assert.deepEqual(homonym.body.items.map((i) => i.ref), [H1.code, H2.code]);
  // 지역 이름의 일부('검색가람')는 지역 결과로 찾히지만(W2-d 부분 글자) 지역으로 분류하지 않는다 — 대리값(지역 결과가 있는가)이 아니라 실제 분류
  const plain = await getJson(`/api/search?q=${encodeURIComponent("검색가람")}`);
  assert.equal(plain.status, 200);
  assert.ok(plain.body.counts.region >= 1, "지역 결과는 있다");
  assert.equal(plain.body.regionClassified, false);
  assert.deepEqual(plain.body.classification.regions, []);
});

test("e) search_submitted.region_classified = 실제 분류 · 속성 4칸 · 검색어·지역 코드 조각 0", async () => {
  const since = new Date();
  const { page, ctx } = await open(searchPath(`${H1.name} 재산세`));
  let rows = await waitEvents(since, 1);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0].props).sort(), ["query_length", "region_classified", "result_count", "result_type_count"]);
  assert.equal(rows[0].props.region_classified, true, "동명(후보 둘)도 지역 분류 참");
  await page.fill("#search-q", "검색가람");
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => url.searchParams.get("q") === "검색가람");
  rows = await waitEvents(since, 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].props.region_classified, false, "지역 이름의 일부 — 지역 결과가 있어도 분류 거짓");
  assert.ok(rows[1].props.result_type_count >= 1);
  const raw = JSON.stringify(rows);
  for (const piece of [H1.name, H1.code, GU.code, "재산세", "검색가람", "property_tax"]) assert.ok(!raw.includes(piece), `저장된 행에 '${piece}' 0`);
  await ctx.close();
});

test("f) 운영 설정 search_topics — 틀린 값 422(값 그대로), 별칭을 더하면 배포 없이 다음 검색부터 · 편집 책임자 403", async () => {
  const bad = await api("PATCH", "/settings/search_topics", u.admin, { value: { ...topics0, tourism: { label: "축제", aliases: [] } } });
  assert.equal(bad.status, 422, show(bad));
  const dup = await api("PATCH", "/settings/search_topics", u.admin, { value: { ...topics0, property_tax: { label: "재산세", aliases: ["취득 세"] } } });
  assert.equal(dup.status, 422, show(dup));
  assert.deepEqual((await one("select value from public.settings where key = 'search_topics'")).value, topics0, "값 그대로");
  assert.equal((await api("PATCH", "/settings/search_topics", u.editor, { value: topics0 })).status, 403, "편집 책임자는 운영 설정 0");

  const q = `${NURI.aliases[0]} 축제`;
  assert.deepEqual((await getJson(`/api/search?q=${encodeURIComponent(q)}`)).body.classification.topics, []);
  const ok = await api("PATCH", "/settings/search_topics", u.admin, { value: { ...topics0, local_finance: { label: "지방재정", aliases: ["축제"] } } });
  assert.equal(ok.status, 200, show(ok));
  try {
    assert.deepEqual((await getJson(`/api/search?q=${encodeURIComponent(q)}`)).body.classification.topics, [{ key: "local_finance", label: "지방재정" }]);
  } finally {
    assert.equal((await api("PATCH", "/settings/search_topics", u.admin, { value: topics0 })).status, 200);
  }
});

test("g) 360·1280px 가로 넘침 0 · 접근성 95 (분류 줄·제안 묶음이 있는 화면)", async () => {
  for (const q of [`${GU.name} 취득세`, `${H1.name} 재산세`]) {
    for (const viewport of [{ width: 360, height: 740 }, { width: 1280, height: 800 }]) {
      const { page, ctx } = await open(searchPath(q), viewport);
      assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${q} ${viewport.width}px 가로 넘침 0`);
      await ctx.close();
    }
    const r = await accessibility(`${base}${searchPath(q)}`, debugPort);
    assert.ok(r.score >= A11Y_MIN, `${q} 접근성 ${r.score} — ${r.failing.join(", ")}`);
  }
});
