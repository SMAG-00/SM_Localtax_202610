// 지역 측정 이벤트 E2E (W4 24단계 — docs/dev/W4_설계.md 1장 24단계 · 2.5 · 6장, W2-c 설계 2.2~2.3, PRD-01B REG1-15).
// standalone 빌드를 로컬 Supabase에 붙이고 실제 브라우저로 누른다. 시험용 지역은 접두 99 가짜 코드 + '시험용' 이름(설계 8장).
//  a) 지역 허브(시·군·구·시·도)를 열면 region_viewed 정확히 1건(지역 코드·단계 level) · 키 꺼짐 개발방법 상세 404는 이벤트 0
//  b) 지역 세금 연결 블록 — 감수 해설·공식 원문 링크 1번 = region_to_tax_clicked 1건(target) · SM 취득세 카드는 calculator_card_clicked(region_hub) 1건 뿐(세금 이동 0)
//  c) 허브 ⑤ 공식 자료 원문 [원문 보기] 1번 = regional_source_opened 1건(자료 종류, 원문 주소 0)
//  d) 허브 기사 카드 1번 = regional_news_opened 1건(편집 분야) · ③ 프로젝트 카드·분양 카드·더 보기 = region_to_realestate_clicked 각 1건(target)
//  e) 보낸 본문·저장 행에 주소·제목·검색어·외부 주소 0 — 칸은 지역 코드·종류 키뿐 / 수집 API는 상세 주소·좌표·검색어 칸·잘못된 코드·목록 밖 target을 400
//  f) 프로젝트 상세 = project_viewed 1건(지역 코드·사업 유형·현재 단계) · 개발방법 상세 = dev_method_viewed 1건(방법 키)
//  g) 측정 거부 쿠키·GPC 브라우저는 열기·누르기를 다 해도 전송 0·저장 0 · 자동화 브라우저는 is_bot=true로 저장(집계 제외 표시)
// 만든 계정·기사·프로젝트·분양·지역·측정 이벤트는 끝나면 지우고, 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";
import { buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-region-measure-e2e@example.test";
const SITE = "https://e2e.example.test";
const SIDO = { code: "9900000000", name: "시험용 측정도" };
const GU = { code: "9901100000", name: "시험용 측정구", key: "cheukjeong" };
const GOV = "https://gov.example.test/w4rm";
const SM_URL = "https://sm.example.test/calc/acquisition-w4rm";
const TYPE = "siheom_rm";
const STAGES = [
  { key: "zone", label: "시험용 구역지정" },
  { key: "plan", label: "시험용 계획인가" },
];
const ACTOR = "migration:e2e-w4rm";
const HEADLESS_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36";
const MEASURED = ["region_viewed", "regional_news_opened", "regional_source_opened", "region_to_tax_clicked", "region_to_realestate_clicked", "project_viewed", "dev_method_viewed", "calculator_card_clicked"];
const ALLOWED_PROPS = new Set(["region_code", "level", "field", "source_type", "target", "project_type", "stage", "method", "card", "screen", "rank"]);

let sb, server, staff, db, browser, base, debugPort, since;
const u = {};
const fx = {};
const counts0 = {};
let smRow0, dmRow0;

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hoursAgo = (n) => new Date(Date.now() - n * 3600_000).toISOString();
const kstDay = (offset) => new Date(Date.now() + 9 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);
const sidoSlug = () => `cheukjeong-${staff.run}`;
const guSlug = () => `${GU.key}-${staff.run}-gu`;
const guPath = () => `/local/${sidoSlug()}/${guSlug()}`;
const docUrl = (k) => `${GOV}/${staff.run}/${k}`;

async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const show = (r) => JSON.stringify(r.body).slice(0, 400);
const setSetting = (key, value) => api("PATCH", `/settings/${key}`, u.admin, { value });
async function flags(over) {
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  const r = await setSetting("feature_flags", { ...cur, ...over });
  assert.equal(r.status, 200, show(r));
}
async function expireCache() {
  const cur = (await one("select value from public.settings where key = 'pilot_regions'")).value;
  assert.equal((await setSetting("pilot_regions", cur)).status, 200);
}
async function get(p) {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
}

async function removeFixtureRows(q) {
  const articleIds = [...(staff?.articleIds ?? [])].map(String);
  const ids = (await q("select id from public.projects where created_by = $1", [ACTOR])).rows.map((r) => Number(r.id));
  await q("delete from public.supply_notices where created_by = $1 or official_notice_url like $2", [ACTOR, `${GOV}/%`]);
  await q("delete from public.regional_links where created_by = $1 or (from_type = 'article' and from_id = any($2::text[]))", [ACTOR, articleIds]);
  if (ids.length) {
    const snaps = (await q("select snapshot_id from public.project_events where project_id = any($1::bigint[]) and snapshot_id is not null", [ids])).rows.map((r) => Number(r.snapshot_id));
    await q("begin");
    try {
      await q("set local session_replication_role = replica");
      await q("delete from public.source_review_queue where target_type = 'project_event' and target_id in (select id from public.project_events where project_id = any($1::bigint[]))", [ids]);
      await q("delete from public.project_events where project_id = any($1::bigint[])", [ids]);
      await q("delete from public.projects where id = any($1::bigint[])", [ids]);
      if (snaps.length) await q("delete from public.raw_snapshots where id = any($1::bigint[])", [snaps]);
      await q("commit");
    } catch (err) {
      await q("rollback");
      throw err;
    }
  }
}
async function removeRegions(q) {
  await q("delete from public.region_slug_redirects where region_code like '99%'");
  await q("update public.regions set successor_code = null where code like '99%' and successor_code is not null");
  await q("delete from public.regions where code like '99%' and level = 'sigungu'");
  await q("delete from public.regions where code like '99%'");
}

async function article(key, { title, field, type = "explainer", section = "local", hours = 1 }) {
  const row = await one(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, editorial_field, public_question, region_codes, first_published_at)
     values ($1, $2, '시험용 지역 기사 요약입니다', $3, $4, 'published', $5, $6, $7, $8, $9) returning id, slug`,
    [`e2e-w4rm-${key}-${staff.run}`, title, section, type, u.reporter.personId, field, field ? "시험용 지역 질문은 무엇인가" : null, [GU.code], hoursAgo(hours)],
  );
  staff.trackArticle(Number(row.id));
  fx[key] = { id: Number(row.id), slug: row.slug, href: `/news/${row.slug}`, title };
  return fx[key];
}
async function source(articleKey, key, sourceType = "local_tax_revenue") {
  const url = docUrl(key);
  const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e-w4rm', $1, $2, '시험용 스냅샷') returning id", [url, `sha256:w4rm-${key}-${staff.run}`]);
  await db.query(
    `insert into public.article_sources (article_id, kind, title, source_url, source_name, last_verified_at, license_status, license_type, source_type, published_on, reference_date, region_unit, collected_at, snapshot_id)
     values ($1, 'official_doc', $2, $3, '시험용 측정도청', $4, '공공누리 제1유형', 'kogl_1', $5, '2026-09-01', '2026-08-31', '시·군·구', $6, $7)`,
    [fx[articleKey].id, `시험용 공식 자료 ${key}`, url, hoursAgo(20), sourceType, hoursAgo(40), snap.id],
  );
}
async function project(key, name) {
  const p = await one("insert into public.projects (slug, name, summary, region_code, project_type, landmark, created_by) values ($1, $2, null, $3, $4, false, $5) returning id, slug", [`siheom-rm-${key}-${staff.run}`, name, GU.code, TYPE, ACTOR]);
  for (const [i, stage] of ["zone", "plan"].entries()) {
    const url = `${GOV}/${staff.run}/${key}/${stage}`;
    const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload, fetched_at) values ('e2e-w4rm', $1, $2, '시험용 고시 원문', $3) returning id", [url, `sha256:w4rm-p-${key}-${i}-${staff.run}`, `2026-0${i + 1}-15T16:00:00Z`]);
    await db.query(
      "insert into public.project_events (project_id, kind, stage, notice_no, notice_date, issuer, source_url, snapshot_id, license_type, recorded_by) values ($1, 'stage', $2, $3, $4, '시험용 측정구청', $5, $6, 'kogl_1', $7)",
      [p.id, stage, `시험용 고시 제${staff.run}-${i + 1}호`, `2026-0${i + 1}-15`, url, snap.id, ACTOR],
    );
  }
  await db.query("update public.projects set status = 'public', source_name = '시험용 측정구청', last_verified_at = $2 where id = $1", [p.id, "2026-10-20T03:00:00Z"]);
  fx[key] = { id: Number(p.id), slug: p.slug, name };
  return fx[key];
}

/** 방문 하나 — /api/events 요청 본문(sent)과 응답 코드(answered)를 모은다. 눌러도 이동하지 않게 기본 동작을 막는다(측정 듣기는 그 앞에서 끝난다) */
async function visitor(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
  const page = await context.newPage();
  const sent = [];
  const answered = [];
  context.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/events") sent.push(JSON.parse(r.postData() ?? "{}"));
  });
  context.on("response", (r) => {
    if (new URL(r.url()).pathname === "/api/events") answered.push(r.status());
  });
  const settle = async (n) => {
    const end = Date.now() + 8000;
    while (answered.length < n && Date.now() < end) await sleep(50);
    await sleep(400); // 더 보내는 것이 없는지 잠깐 지켜본다
  };
  const names = () => sent.map((s) => s.name);
  return { context, page, sent, answered, settle, names };
}
async function open(v, p) {
  await v.page.goto(`${base}${p}`, { waitUntil: "networkidle" });
  await v.page.evaluate(() => document.addEventListener("click", (e) => e.preventDefault(), true));
}
const dbEvents = async (name, filter = "true") => (await db.query(`select * from public.analytics_events where name = $1 and occurred_at >= $2 and ${filter} order by id`, [name, since])).rows;

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
  await removeFixtureRows((sql, params) => db.query(sql, params));
  await removeRegions((sql, params) => db.query(sql, params));
  await staff.snapshotOperations();
  since = new Date();
  for (const t of ["regions", "articles", "article_sources", "raw_snapshots", "projects", "project_events", "supply_notices", "regional_links", "source_review_queue", "editorial_reviews"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  smRow0 = await one("select id, url, status from public.official_links where kind = 'sm_calculator' and key = 'acquisition'");
  assert.ok(smRow0, "SM 취득세 계산기 행 (W3 씨앗)");
  dmRow0 = await one("select to_jsonb(d) j from public.dev_methods d where slug = 'redevelopment'");
  assert.equal((await one("select count(*)::int n from public.dev_method_compare where method_id = $1", [dmRow0.j.id])).n, 0, "시험 전 비교 항목 행 0 (18단계 씨앗)");

  u.admin = await staff.createUser({ label: "w4rm-admin", email: ADMIN_EMAIL });
  u.reporter = await staff.createUser({ label: "w4rm-reporter", roles: ["reporter"], person: { name: "시험용 측정 기자", roles: ["reporter"] } });
  u.reviewer = await staff.createUser({ label: "w4rm-reviewer", roles: ["reviewer"], person: { name: "시험용 측정 감수위원", roles: ["reviewer"] } });
  await db.query("insert into public.regions (code, level, name, slug) values ($1, 'sido', $2, $3)", [SIDO.code, SIDO.name, sidoSlug()]);
  await db.query("insert into public.regions (code, parent_code, level, name, slug) values ($1, $2, 'sigungu', $3, $4)", [GU.code, SIDO.code, GU.name, guSlug()]);
  assert.equal((await setSetting("project_types", { [TYPE]: { label: "시험용 정비사업" } })).status, 200);
  assert.equal((await setSetting("project_stage_lists", { [TYPE]: STAGES })).status, 200);

  await article("A1", { title: "시험용 측정구 지방세 세수 해설", field: "local_tax", hours: 2 });
  await article("A2", { title: "시험용 측정구 부동산 보도", field: "realestate", type: "reported_news", hours: 3 });
  await article("E1", { title: "시험용 측정구 지방세 감수 해설", field: "local_tax", section: "tax", hours: 4 });
  await db.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision) values ($1, 'tax_review', $2, 'approve')", [fx.E1.id, u.reviewer.personId]);
  await source("A1", "S1");
  // 허브 ③ 카드는 4장까지라 '더 보기' 링크가 나오려면 5건씩 필요하다
  for (const k of ["p1", "p2", "p3", "p4", "p5"]) await project(k, `시험용 측정구역 정비 ${k}`);
  for (const k of [1, 2, 3, 4, 5]) {
    await db.query(
      `insert into public.supply_notices (name, region_code, supply_scale, apply_start, apply_end, notice_date, notice_issuer, official_notice_url, license_type, status, verified_at, created_by, updated_by)
       values ($8, $1, '총 100세대 중 일반공급 50세대', $2, $3, $4, '시험용 분양구청', $5, 'kogl_1', 'public', $6, $7, $7)`,
      [GU.code, kstDay(-3), kstDay(10 + k), kstDay(-5), docUrl(`supply${k}`), "2026-10-20T03:00:00Z", ACTOR, `시험용 측정 분양 ${k}`],
    );
  }
  await db.query("update public.official_links set url = $2 where id = $1", [smRow0.id, SM_URL]);

  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
  await flags({ region_hubs: true, realestate_projects: true, supply_notices: true, sm_calculator: true, dev_methods: false });
});

after(async () => {
  try {
    await browser?.close();
    if (db) {
      await db.query("delete from public.analytics_events where occurred_at >= $1 and name = any($2::text[])", [since, MEASURED]);
      if (dmRow0) {
        await db.query("begin");
        await db.query("set local session_replication_role = replica");
        await db.query("update public.dev_methods d set (summary, steps, legal_basis_name, lens, review_status, reviewed_by, reviewed_at, drafted_by, drafted_at) = (select summary, steps, legal_basis_name, lens, review_status, reviewed_by, reviewed_at, drafted_by, drafted_at from jsonb_populate_record(null::public.dev_methods, $1::jsonb)) where d.slug = 'redevelopment'", [dmRow0.j]);
        await db.query("commit");
      }
      if (dmRow0) {
        await db.query("begin");
        await db.query("set local session_replication_role = replica");
        await db.query("delete from public.dev_method_compare where method_id = $1", [dmRow0.j.id]);
        await db.query("commit");
      }
      await removeFixtureRows((sql, params) => db.query(sql, params));
      if (smRow0) await db.query("update public.official_links set url = $2, status = $3 where id = $1", [smRow0.id, smRow0.url, smRow0.status]);
    }
    await staff?.cleanup();
  } finally {
    server?.stop();
    if (sb && Object.keys(counts0).length) {
      const c = new pg.Client({ connectionString: sb.dbUrl });
      await c.connect();
      try {
        await removeRegions((sql, params) => c.query(sql, params));
        for (const t of Object.keys(counts0)) assert.equal((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n, counts0[t], `정리 뒤 ${t} 행 수 = 시험 전`);
        const left = (await c.query("select count(*)::int n from public.analytics_events where occurred_at >= $1 and name = any($2::text[])", [since, MEASURED])).rows[0].n;
        assert.equal(left, 0, "시험 이벤트 정리");
        const s = Object.fromEntries((await c.query("select key, value from public.settings where key in ('feature_flags', 'project_types', 'project_stage_lists')")).rows.map((r) => [r.key, r.value]));
        assert.equal(s.feature_flags.dev_methods, false, "dev_methods 되돌림");
        assert.equal(s.feature_flags.realestate_projects, false, "realestate_projects 되돌림");
      } finally {
        await c.end();
      }
    }
  }
});

test("a) 지역 허브를 열면 region_viewed 정확히 1건(시·군·구 level·시·도 level) · 지역 코드 외 칸 없음 · 키 꺼짐 개발방법 상세는 404이고 이벤트 0", async () => {
  const v = await visitor();
  await open(v, guPath());
  await v.settle(1);
  assert.deepEqual(v.names(), ["region_viewed"], "열자마자 1건뿐");
  assert.deepEqual(v.sent[0], { name: "region_viewed", section: "local", props: { region_code: GU.code, level: "sigungu" }, ...(v.sent[0].mode ? { mode: v.sent[0].mode } : {}), ...(v.sent[0].referrer ? { referrer: v.sent[0].referrer } : {}), ...(v.sent[0].entry ? { entry: v.sent[0].entry } : {}) });
  assert.deepEqual(v.answered, [202]);
  await v.context.close();

  const s = await visitor();
  await open(s, `/local/${sidoSlug()}`);
  await s.settle(1);
  assert.deepEqual(s.names(), ["region_viewed"]);
  assert.deepEqual(s.sent[0].props, { region_code: SIDO.code, level: "sido" });
  await s.context.close();

  const rows = await dbEvents("region_viewed", `props->>'region_code' like '99%'`);
  assert.deepEqual(rows.map((r) => [r.section, r.props]).sort((a, b) => a[1].level.localeCompare(b[1].level)), [
    ["local", { region_code: SIDO.code, level: "sido" }],
    ["local", { region_code: GU.code, level: "sigungu" }],
  ]);

  assert.equal((await get("/realestate/development-methods/redevelopment")).status, 404, "dev_methods 꺼짐 — 상세 404");
  assert.equal((await dbEvents("dev_method_viewed")).length, 0, "꺼짐 상세는 이벤트 0");
});

test("b) 지역 세금 연결 블록 — 감수 해설·공식 원문 링크 1번 = region_to_tax_clicked 1건(target) · SM 취득세 카드 1번은 calculator_card_clicked(region_hub) 1건이고 세금 이동 0", async () => {
  const v = await visitor();
  await open(v, guPath());
  await v.settle(1);
  const block = v.page.locator('[data-ui="region-tax-links"]');
  const rows = await block.locator("[data-tax-links-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-tax-links-row")));
  assert.ok(rows.includes("explainers") && rows.includes("originals") && rows.includes("sm-calculator"), `줄 ${rows}`);

  const clicks = async (locator, n) => {
    const before = v.sent.length;
    await locator.first().click();
    await v.settle(v.answered.length + n);
    return v.sent.slice(before);
  };
  const ex = await clicks(block.locator('[data-tax-links-row="explainers"] a[href^="/news/"]'), 1);
  assert.deepEqual(ex.map((e) => [e.name, e.props]), [["region_to_tax_clicked", { region_code: GU.code, target: "explainer" }]]);
  const orig = await clicks(block.locator('[data-tax-links-row="originals"] a'), 1);
  assert.deepEqual(orig.map((e) => [e.name, e.props]), [["region_to_tax_clicked", { region_code: GU.code, target: "official_source" }]]);
  for (const row of rows.filter((r) => r === "situations")) {
    const sit = await clicks(block.locator(`[data-tax-links-row="${row}"] a`), 1);
    assert.deepEqual(sit.map((e) => [e.name, e.props]), [["region_to_tax_clicked", { region_code: GU.code, target: "situation" }]]);
  }
  const sm = await clicks(block.locator('[data-tax-links-row="sm-calculator"] [data-part="go"]'), 1);
  assert.deepEqual(
    sm.map((e) => [e.name, e.props.screen, e.props.card]),
    [["calculator_card_clicked", "region_hub", "acquisition"]],
    "SM 카드 = 계산기 카드 이벤트 1건뿐 (세금 이동 이벤트 0)",
  );
  await v.context.close();
});

test("c) ⑤ 공식 자료 원문 [원문 보기] 1번 = regional_source_opened 1건(자료 종류) · 원문 주소·제목 0 · 같은 카드의 다른 곳 누름은 0", async () => {
  const v = await visitor();
  await open(v, guPath());
  await v.settle(1);
  const card = v.page.locator('[data-hub-block="sources"] [data-part="official-source-card"]').first();
  assert.equal(await card.getAttribute("data-source-type"), "local_tax_revenue");
  const before = v.sent.length;
  await card.locator('[data-part="official-source-open"]').click();
  await v.settle(2);
  const got = v.sent.slice(before);
  assert.deepEqual(got.map((e) => [e.name, e.props]), [["regional_source_opened", { region_code: GU.code, source_type: "local_tax_revenue" }]]);
  const n = v.sent.length;
  await card.locator("dl").click({ force: true });
  await sleep(500);
  assert.equal(v.sent.length, n, "카드 안 글자 누름은 0");
  await v.context.close();
});

test("d) 허브 기사 카드 = regional_news_opened 1건(편집 분야) · ③ 프로젝트 카드·분양 카드·더 보기 = region_to_realestate_clicked 각 1건(target)", async () => {
  const v = await visitor();
  await open(v, guPath());
  await v.settle(1);
  const click = async (locator, expectName, expectProps) => {
    const before = v.sent.length;
    const answered = v.answered.length;
    await locator.first().click();
    await v.settle(answered + 1);
    const got = v.sent.slice(before);
    assert.deepEqual(got.map((e) => [e.name, e.props]), [[expectName, { region_code: GU.code, ...expectProps }]], expectName);
  };
  await click(v.page.locator(`[data-hub-block="localTax"] [data-article-id="${fx.A1.id}"] a[href^="/news/"]`), "regional_news_opened", { field: "local_tax" });
  await click(v.page.locator(`[data-hub-block="realEstate"] [data-article-id="${fx.A2.id}"] a[href^="/news/"]`), "regional_news_opened", { field: "realestate" });
  await click(v.page.locator(`[data-hub-block="realEstate"] [data-project-card] a`), "region_to_realestate_clicked", { target: "project" });
  await click(v.page.locator('[data-hub-block="realEstate"] [data-supply-card] a'), "region_to_realestate_clicked", { target: "supply" });
  const mores = await v.page.locator('[data-hub-block="realEstate"] [data-part="group-more"] a').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  assert.equal(mores.length, 2, `더 보기 2개 ${mores}`);
  await click(v.page.locator(`[data-hub-block="realEstate"] [data-part="group-more"] a[href="${mores[0]}"]`), "region_to_realestate_clicked", { target: "project_list" });
  await click(v.page.locator(`[data-hub-block="realEstate"] [data-part="group-more"] a[href="${mores[1]}"]`), "region_to_realestate_clicked", { target: "supply_list" });
  await v.context.close();
});

test("e) 보낸 본문·저장 행에는 지역 코드·종류 키뿐(주소·제목·외부 주소 0) · 수집 API는 상세 주소·좌표·검색어 칸·잘못된 코드·목록 밖 target을 400", async () => {
  const rows = (await db.query("select name, section, props from public.analytics_events where occurred_at >= $1 and name = any($2::text[])", [since, MEASURED])).rows;
  assert.ok(rows.length >= 10, `앞 시험이 남긴 행 ${rows.length}`);
  const texts = [fx.A1.title, fx.A1.slug, fx.p1.slug, SM_URL, GOV, "example.test", "http"];
  for (const r of rows) {
    for (const [k, val] of Object.entries(r.props)) {
      assert.ok(ALLOWED_PROPS.has(k), `${r.name}: 허용 밖 칸 ${k}`);
      for (const t of texts) assert.ok(!String(val).includes(t), `${r.name}.${k}에 ${t}`);
    }
  }
  const post = async (body) => {
    const res = await fetch(`${base}/api/events`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) });
    return res.status;
  };
  const good = { name: "region_to_tax_clicked", section: "local", props: { region_code: GU.code, target: "situation" } };
  const bads = [
    { ...good, props: { ...good.props, address: "서울시 중구 세종대로 110" } },
    { ...good, props: { ...good.props, lat: 37.5, lng: 127 } },
    { ...good, props: { ...good.props, query: "취득세 계산" } },
    { ...good, props: { ...good.props, url: "https://x.example.test/a?b=1" } },
    { ...good, props: { region_code: "99011", target: "situation" } },
    { ...good, props: { region_code: GU.code, target: "project" } },
    { ...good, props: { region_code: GU.code } },
    { name: "region_viewed", section: "local", props: { region_code: GU.code, level: "dong" } },
    { name: "dev_method_viewed", section: "realestate", props: { method: "nope" } },
    { name: "calculator_card_clicked", props: { card: "acquisition", screen: "article", rank: 1 } },
  ];
  for (const b of bads) assert.equal(await post(b), 400, JSON.stringify(b));
  const stored = (await dbEvents("region_to_tax_clicked", `props->>'region_code' = '${GU.code}'`)).length;
  assert.equal(await post(good), 202, "정상 본문은 저장");
  assert.equal((await dbEvents("region_to_tax_clicked", `props->>'region_code' = '${GU.code}'`)).length, stored + 1, "400이었던 것은 저장 0, 정상은 +1");
});

test("f) 프로젝트 상세 = project_viewed 1건(지역 코드·사업 유형·현재 단계) · 개발방법 상세 = dev_method_viewed 1건(방법 키)", async () => {
  const v = await visitor();
  await open(v, `/realestate/projects/${fx.p1.slug}`);
  await v.settle(1);
  assert.deepEqual(v.names(), ["project_viewed"]);
  const stage = await v.page.locator('[data-ui="project-page"]').getAttribute("data-project-stage");
  assert.equal(stage, "plan");
  assert.deepEqual(v.sent[0].props, { region_code: GU.code, project_type: TYPE, stage });
  assert.equal(v.sent[0].section, "realestate");
  await v.context.close();

  // 개발방법 켜기 — 7개 방법의 서명 조건은 시험 재료를 직접 맞춘다(되돌림은 after). 트리거는 시험 거래 안에서만 끈다
  await db.query("begin");
  await db.query("set local session_replication_role = replica");
  await db.query("update public.dev_methods set summary = '시험용 재개발 설명', steps = $2::jsonb, review_status = 'reviewed', reviewed_by = $1, reviewed_at = now(), drafted_by = $1, drafted_at = now() where slug = 'redevelopment'", [`user:${u.reviewer.id}`, JSON.stringify(["시험용 단계 하나", "시험용 단계 둘"])]);
  for (const item of ["legal_basis", "actor", "target", "procedure", "numeric_requirements", "tax_issues"]) {
    await db.query("insert into public.dev_method_compare (method_id, item, body, drafted_by, reviewed_by, reviewed_at, review_status) values ($1, $2, '시험용 비교 칸', $3, $3, now(), 'reviewed')", [dmRow0.j.id, item, `user:${u.reviewer.id}`]);
  }
  await db.query("update public.settings set value = value || '{\"dev_methods\": true}'::jsonb where key = 'feature_flags'");
  await db.query("commit");
  await expireCache();
  const m = await visitor();
  await open(m, "/realestate/development-methods/redevelopment");
  await m.settle(1);
  assert.deepEqual(m.names(), ["dev_method_viewed"]);
  assert.deepEqual(m.sent[0].props, { method: "redevelopment" });
  assert.equal(m.sent[0].section, "realestate");
  await m.context.close();
  await db.query("update public.settings set value = value || '{\"dev_methods\": false}'::jsonb where key = 'feature_flags'");
  await expireCache();
});

test("g) 측정 거부 쿠키·GPC 브라우저는 열기·누르기를 다 해도 전송 0·저장 0 · 자동화 브라우저는 is_bot=true로 저장", async () => {
  const mark = new Date();
  const host = new URL(base).hostname;
  const R = await visitor();
  await R.context.addCookies([{ name: "ltr_optout", value: "1", domain: host, path: "/" }]);
  const G = await visitor({ extraHTTPHeaders: { "Sec-GPC": "1" } });
  await G.context.addInitScript(() => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }));
  for (const v of [R, G]) {
    await open(v, guPath());
    await v.page.locator(`[data-hub-block="localTax"] [data-article-id="${fx.A1.id}"] a[href^="/news/"]`).first().click();
    await v.page.locator('[data-ui="region-tax-links"] a').first().click();
    await sleep(800);
    assert.equal(v.sent.length, 0, "전송 0");
    await v.context.close();
  }
  const refused = (await db.query("select count(*)::int n from public.analytics_events where occurred_at >= $1 and name = any($2::text[]) and props->>'region_code' like '99%'", [mark, MEASURED])).rows[0].n;
  assert.equal(refused, 0, "저장 0");

  const B = await visitor({ userAgent: HEADLESS_UA });
  await open(B, guPath());
  await B.settle(1);
  assert.deepEqual(B.names(), ["region_viewed"]);
  const row = (await db.query("select is_bot from public.analytics_events where occurred_at >= $1 and name = 'region_viewed' order by id desc limit 1", [mark])).rows[0];
  assert.equal(row.is_bot, true, "자동화 브라우저 = is_bot 표시(집계 제외)");
  await B.context.close();
});
