// 프로젝트 공개 화면 E2E (W4 15단계 — docs/dev/W4_설계.md 1장 15단계 · 2.4 · 4장 `GET /api/projects/{slug}` · 5장 · 12장 #99 · #103 · #120~, PRD-01B PR-01 · PR-02 · PR-03 · PR-05 · REG1-10).
// standalone 빌드를 로컬 Supabase에 붙인다. 시험용 지역은 법정동코드에 없는 접두 99 가짜 코드와 '시험용' 이름이다(설계 8장).
// 시험 세계: 시험용 시·도 1 + 시·군·구 1 · 시험용 사업 유형 1(단계 4 — 관리자 설정 API) · 공개 프로젝트 P1(시·군·구 — 기록 2 + 해당 없음 1)·P2(시·도 — 대표) · 초안 P3 ·
//   공개 기사 N1(프로젝트 → 기사)·N2(기사 → 프로젝트) · 지역 → 프로젝트·프로젝트 → 지역 확인된 연결.
//  a) 기능 키 realestate_projects 꺼짐 — 목록 주소 = 하위 분야 목록 · 상세 404 · API 404 · 지역 허브 ③·기사 화면·부동산 허브·검색에 프로젝트 요소·링크 0
//  b) 목록 — 공개 2(초안 0)·카드 전수 지역·단계·출처·기준일·확인일 · 거르개 칩 링크(JS 없이)·고른 칩 표시 · 이동 줄 = BreadcrumbList · 데이터 출처 줄 1
//  c) 상세 — 전체 단계 4(기록 2·해당 없음·예정) · 원문 연결률 100%(새 창·noopener noreferrer) · 고시 번호·고시일·확인일 고정폭 · 공공누리 · 원문 본문 전재 0 ·
//     원문 검수 중 '검토 중' · 관련 기사 두 방향 · 확인된 연결(지역 허브) · 초안·없는 주소 404 · JSON-LD = 화면
//  d) 가격 요소 0 — 목록·상세·허브 HTML의 입력 칸·글자·JSON-LD·API 칸 이름에 2.10 사전 낱말 0
//  e) API — 200 source·verifiedAt·status·공개 기록만 · 400(주소 모양·모르는 칸) · 404(초안·없음) · 이상한 입력에도 500 0
//  f) 지역 허브 ③ 프로젝트 카드 · 기사 화면 '확인된 연결'의 프로젝트 링크(#103) · 검색 결과 프로젝트(열린 화면 링크) — 링크 전수 200
//  g) 360px 세로 타임라인·360/1280px 가로 넘침 0 · R1~R3 · 접근성 95
// 만든 계정·기사·지역·프로젝트·단계 기록·스냅샷·연결은 끝나면 지우고, 운영 설정(기능 키·사업 유형·단계 목록)은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";
import { PRICE_WORDS, priceWordsIn } from "../packages/db/scripts/check-price-fields.mjs";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { measurePage } from "./lib/screen-rules.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-projects-public-e2e@example.test";
const SITE = "https://e2e.example.test";
const SIDO = { code: "9900000000", name: "시험용 트래커도", key: "teurekeo" };
const GU = { code: "9901100000", name: "시험용 트래커구", key: "teurekeogu" };
const GOV = "https://gov.example.test/w4pp";
const TYPE = "siheom_pp";
const STAGES = [
  { key: "zone", label: "시험용 구역지정" },
  { key: "plan", label: "시험용 계획인가" },
  { key: "build", label: "시험용 착공" },
  { key: "done", label: "시험용 준공" },
];
const ACTOR = "migration:e2e-w4pp";
/** 화면 글자에 없어야 하는 가격 낱말 (2.10 사전의 한글 + PR-05 문장의 낱말) */
const PRICE_TEXT = ["분양가", "분담금", "수익률", "수익", "시세", "프리미엄", "가격", "감정가"];

let sb, server, staff, db, browser, base, debugPort;
const u = {};
const fx = {};
const counts0 = {};

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const hoursAgo = (n) => new Date(Date.now() - n * 3600_000).toISOString();
const sidoSlug = () => `${SIDO.key}-${staff.run}`;
const guSlug = () => `${GU.key}-${staff.run}-gu`;
const guPath = () => `/local/${sidoSlug()}/${guSlug()}`;
const show = (r) => JSON.stringify(r.body ?? r.html?.slice(0, 300)).slice(0, 600);
const decode = (s) => s?.replaceAll("&amp;", "&") ?? null;

async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const setSetting = (key, value) => api("PATCH", `/settings/${key}`, u.admin, { value });
/** 기능 키 — 시험 전 값 위에 바꾼다(설정 쓰기 = 공개 데이터 캐시 만료) */
async function flags(over) {
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  const r = await setSetting("feature_flags", { ...cur, ...over });
  assert.equal(r.status, 200, show(r));
}
async function get(p) {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text(), type: res.headers.get("content-type") ?? "" };
}
async function getJson(p) {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, body: await res.json().catch(() => null), cache: res.headers.get("cache-control") };
}
const keysOf = (v) => (Array.isArray(v) ? v.flatMap(keysOf) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);
/** 구조화 데이터 노드 — 스크립트마다 노드 배열 (toJsonLdScriptContent) */
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => [JSON.parse(m[1])].flat());
const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1]));
const projectHrefs = (html) => hrefs(html).filter((h) => h.startsWith("/realestate/projects/"));
const mainOf = (html) => html.match(/<main[\s\S]*<\/main>/)?.[0] ?? "";

async function removeFixtureRows(q) {
  const articleIds = [...(staff?.articleIds ?? [])].map(String);
  const ids = (await q("select id from public.projects where created_by = $1 or slug like 'siheom-pp-%'", [ACTOR])).rows.map((r) => Number(r.id));
  await q(
    `delete from public.regional_links where created_by = $1 or (from_type = 'region' and from_id like '99%') or (to_type = 'region' and to_id like '99%')
        or (from_type = 'article' and from_id = any($2::text[])) or (from_type = 'project' and from_id = any($3::text[])) or (to_type = 'project' and to_id = any($3::text[]))`,
    [ACTOR, articleIds, ids.map(String)],
  );
  if (!ids.length) return;
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
async function removeRegions(q) {
  await q("delete from public.region_slug_redirects where region_code like '99%'");
  await q("update public.regions set successor_code = null where code like '99%' and successor_code is not null");
  await q("delete from public.regions where code like '99%' and level = 'sigungu'");
  await q("delete from public.regions where code like '99%'");
}

/** 공개 프로젝트 — 단계 기록(고시 6칸 + 스냅샷)·해당 없음 */
async function project(key, { name, summary = null, region, landmark = false, events = [], publish = true }) {
  const p = await one("insert into public.projects (slug, name, summary, region_code, project_type, landmark, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning id, slug", [
    `siheom-pp-${key}-${staff.run}`,
    name,
    summary,
    region,
    TYPE,
    landmark,
    ACTOR,
  ]);
  const out = { id: Number(p.id), slug: p.slug, name, events: [] };
  for (const [i, e] of events.entries()) {
    if (e.na) {
      await db.query("insert into public.project_events (project_id, kind, stage, reason, recorded_by) values ($1, 'not_applicable', $2, '시험용 — 이 사업에 없는 단계', $3)", [p.id, e.stage, ACTOR]);
      continue;
    }
    const url = `${GOV}/${staff.run}/${key}/${e.stage}`;
    const payload = `시험용 고시 원문 본문 ${key}${i} ${staff.run} — 화면에 옮기지 않는 문장`;
    const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload, fetched_at) values ('e2e-w4pp', $1, $2, $3, $4) returning id", [url, `sha256:w4pp-${key}-${i}-${staff.run}`, payload, e.fetched]);
    const row = await one(
      "insert into public.project_events (project_id, kind, stage, notice_no, notice_date, issuer, source_url, snapshot_id, license_type, recorded_by) values ($1, 'stage', $2, $3, $4, '시험용 트래커구청', $5, $6, $7, $8) returning id",
      [p.id, e.stage, `시험용 고시 제${staff.run}-${i + 1}호`, e.date, url, snap.id, e.license ?? "kogl_1", ACTOR],
    );
    out.events.push({ id: Number(row.id), stage: e.stage, url, payload, snapshotId: Number(snap.id), noticeNo: `시험용 고시 제${staff.run}-${i + 1}호`, date: e.date });
  }
  if (publish) await db.query("update public.projects set status = 'public', source_name = '시험용 트래커구청', last_verified_at = $2 where id = $1", [p.id, "2026-10-20T03:00:00Z"]);
  return out;
}
async function article(key, title, hours) {
  const row = await one(
    "insert into public.articles (slug, title, summary, section, content_type, status, author_id, first_published_at) values ($1, $2, '시험용 부동산 보도 요약입니다', 'realestate', 'reported_news', 'published', $3, $4) returning id, slug",
    [`e2e-w4pp-${key}-${staff.run}`, title, u.reporter.personId, hoursAgo(hours)],
  );
  staff.trackArticle(Number(row.id));
  return { id: Number(row.id), slug: row.slug, title };
}
async function link(fromType, fromId, toType, toId, relation, hours) {
  return Number(
    (
      await one(
        "insert into public.regional_links (from_type, from_id, to_type, to_id, relation, reason, origin, status, confirmed_by, confirmed_at, created_by) values ($1, $2, $3, $4, $5, '시험용 연결 이유', 'editor', 'confirmed', $6, $7, $6) returning id",
        [fromType, String(fromId), toType, String(toId), relation, ACTOR, hoursAgo(hours)],
      )
    ).id,
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
  await removeFixtureRows((sql, params) => db.query(sql, params));
  await removeRegions((sql, params) => db.query(sql, params));
  await staff.snapshotOperations();
  for (const t of ["regions", "articles", "raw_snapshots", "projects", "project_events", "regional_links", "source_review_queue"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  const s = Object.fromEntries((await db.query("select key, value from public.settings where key in ('feature_flags', 'project_types', 'project_stage_lists')")).rows.map((r) => [r.key, r.value]));
  assert.equal(s.feature_flags.realestate_projects, false, "시험 전 realestate_projects는 꺼져 있다 (2.4 씨앗)");
  assert.deepEqual([s.project_types, s.project_stage_lists], [{}, {}], "사업 유형·단계 목록 씨앗 = 빈 값 (12장 #10)");

  u.admin = await staff.createUser({ label: "w4pp-admin", email: ADMIN_EMAIL });
  u.reporter = await staff.createUser({ label: "w4pp-reporter", roles: ["reporter"], person: { name: "시험용 트래커 기자", roles: ["reporter"] } });
  await db.query("insert into public.regions (code, level, name, slug) values ($1, 'sido', $2, $3)", [SIDO.code, SIDO.name, sidoSlug()]);
  await db.query("insert into public.regions (code, parent_code, level, name, slug) values ($1, $2, 'sigungu', $3, $4)", [GU.code, SIDO.code, GU.name, guSlug()]);
  assert.equal((await setSetting("project_types", { [TYPE]: { label: "시험용 정비사업" } })).status, 200);
  assert.equal((await setSetting("project_stage_lists", { [TYPE]: STAGES })).status, 200);

  fx.P1 = await project("p1", {
    name: "시험용 하늘구역 정비",
    summary: "시험용 요약 — 편집자가 쓴 한 줄입니다",
    region: GU.code,
    events: [
      { stage: "zone", date: "2026-01-15", fetched: "2026-01-15T16:00:00Z" },
      { stage: "plan", date: "2026-03-02", fetched: "2026-03-02T16:00:00Z", license: "unmarked" },
      { stage: "build", na: true },
    ],
  });
  fx.P2 = await project("p2", { name: "시험용 바다구역 정비", region: SIDO.code, landmark: true, events: [{ stage: "zone", date: "2026-02-01", fetched: "2026-02-01T16:00:00Z" }] });
  fx.P3 = await project("p3", { name: "시험용 초안구역 정비", region: GU.code, events: [{ stage: "zone", date: "2026-02-03", fetched: "2026-02-03T16:00:00Z" }], publish: false });
  fx.N1 = await article("n1", "시험용 하늘구역 정비 첫 보도", 3);
  fx.N2 = await article("n2", "시험용 하늘구역 정비 둘째 보도", 1);
  fx.lFrom = await link("project", fx.P1.id, "article", fx.N1.id, "related_project", 3);
  fx.lTo = await link("article", fx.N2.id, "project", fx.P1.id, "related_project", 1);
  fx.lRegion = await link("region", GU.code, "project", fx.P1.id, "related_project", 2);
  fx.lHub = await link("project", fx.P1.id, "region", GU.code, "same_region", 2);

  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
  await flags({ search: true, region_hubs: true, realestate_projects: false });
});

after(async () => {
  try {
    await browser?.close();
    if (db) await removeFixtureRows((sql, params) => db.query(sql, params));
    await staff?.cleanup(); // 기사·계정·감사 로그 지우기 + 운영 설정(기능 키·사업 유형·단계 목록) 되돌리기
  } finally {
    server?.stop();
    if (sb && Object.keys(counts0).length) {
      const c = new pg.Client({ connectionString: sb.dbUrl });
      await c.connect();
      try {
        await removeRegions((sql, params) => c.query(sql, params));
        for (const t of Object.keys(counts0)) assert.equal((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n, counts0[t], `정리 뒤 ${t} 행 수 = 시험 전`);
        const s = Object.fromEntries((await c.query("select key, value from public.settings where key in ('feature_flags', 'project_types', 'project_stage_lists')")).rows.map((r) => [r.key, r.value]));
        assert.equal(s.feature_flags.realestate_projects, false, "realestate_projects 되돌림");
        assert.deepEqual([s.project_types, s.project_stage_lists], [{}, {}], "사업 유형·단계 목록 되돌림");
      } finally {
        await c.end();
      }
    }
  }
});

test("a) 기능 키 꺼짐 — 목록 주소 = 하위 분야 목록 · 상세·API 404 · 허브 ③·기사 화면·부동산 허브·검색에 프로젝트 요소·링크 0", async () => {
  const list = await get("/realestate/projects");
  assert.equal(list.status, 200);
  assert.ok(list.html.includes('data-ui="category-list"'), "하위 분야 목록으로 보인다");
  assert.ok(!list.html.includes('data-ui="project-list"'));
  for (const p of [`/realestate/projects/${fx.P1.slug}`, `/realestate/projects/${fx.P2.slug}`]) assert.equal((await get(p)).status, 404, p);
  const r = await getJson(`/api/projects/${fx.P1.slug}`);
  assert.equal(r.status, 404, JSON.stringify(r.body));
  assert.equal(r.cache, "no-store");
  for (const p of [guPath(), `/local/${sidoSlug()}`, `/news/${fx.N2.slug}`, "/realestate", "/realestate/projects"]) {
    const page = await get(p);
    assert.equal(page.status, 200, p);
    assert.deepEqual(projectHrefs(page.html), [], `${p}: 프로젝트 링크 0`);
    assert.ok(!page.html.includes("data-project-card"), `${p}: 프로젝트 카드 0`);
  }
  const s = await getJson(`/api/search?q=${encodeURIComponent("시험용 하늘구역")}&tab=tracker`);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.counts.project, 0);
  assert.deepEqual(s.body.items.filter((h) => h.kind === "project"), []);
});

test("b) 목록 — 공개 2(초안 0) · 카드 전수 지역·단계·출처·기준일·확인일 · 거르개 칩 링크(JS 없이) · 이동 줄 = BreadcrumbList · 출처 줄 1", async () => {
  await flags({ realestate_projects: true });
  const r = await get("/realestate/projects");
  assert.equal(r.status, 200);
  assert.ok(r.html.includes('data-ui="project-list"'));
  const cards = [...r.html.matchAll(/<article data-project-card="([^"]+)" data-region-code="([^"]*)" data-stage="([^"]*)" data-source="([^"]*)" data-base-date="([^"]*)" data-verified="([^"]*)"/g)].map((m) => m.slice(1));
  assert.deepEqual(
    cards.map((c) => c[0]),
    [fx.P2.slug, fx.P1.slug],
    "대표 먼저 · 초안 0",
  );
  for (const [slug, code, stage, source, baseDate, verified] of cards) {
    assert.match(code, /^99\d{8}$/, slug);
    assert.ok(stage && source === "시험용 트래커구청", slug);
    assert.match(baseDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(verified, "2026-10-20");
  }
  assert.deepEqual(
    cards.find((c) => c[0] === fx.P1.slug),
    [fx.P1.slug, GU.code, "plan", "시험용 트래커구청", "2026-03-02", "2026-10-20"],
  );
  assert.ok(!r.html.includes(fx.P3.slug), "초안 0");
  assert.equal((r.html.match(/data-ui="source-line"/g) ?? []).length, 1, "데이터 출처 줄 1");
  // 이동 줄 = BreadcrumbList
  const crumbs = [...(r.html.match(/<nav aria-label="현재 위치"[\s\S]*?<\/nav>/)?.[0] ?? "").matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
  assert.deepEqual(crumbs, ["홈", "부동산재테크", "프로젝트 트래커"]);
  const bl = jsonLd(r.html).find((n) => n["@type"] === "BreadcrumbList");
  assert.deepEqual(
    bl.itemListElement.map((i) => i.name),
    crumbs,
  );
  assert.equal(bl.itemListElement.at(-1).item, `${SITE}/realestate/projects`);

  // 거르개 — 브라우저 JS 꺼도 링크로 이동 (지역 → 유형 → 단계)
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}/realestate/projects`);
    await page.locator('[data-part="filter-type"] a', { hasText: "시험용 정비사업" }).click();
    await page.waitForURL(`${base}/realestate/projects?type=${TYPE}`);
    assert.equal(await page.locator('[data-part="filter-type"] a[aria-current="true"]').innerText().then((t) => t.includes("시험용 정비사업")), true);
    await page.locator('[data-part="filter-stage"] a', { hasText: "시험용 계획인가" }).click();
    await page.waitForURL(`${base}/realestate/projects?type=${TYPE}&stage=plan`);
    assert.deepEqual(await page.$$eval("[data-project-card]", (els) => els.map((e) => e.getAttribute("data-project-card"))), [fx.P1.slug]);
    await page.goto(`${base}/realestate/projects?region=${GU.code}`);
    assert.deepEqual(await page.$$eval("[data-project-card]", (els) => els.map((e) => e.getAttribute("data-project-card"))), [fx.P1.slug], "시·군·구 거르개 = 그 지역만");
    await page.goto(`${base}/realestate/projects?region=${SIDO.code}`);
    assert.equal((await page.$$("[data-project-card]")).length, 2, "시·도 거르개 = 자기 + 하위");
    await page.goto(`${base}/realestate/projects?region=bad&type=Bad&stage=x`);
    assert.equal((await page.$$("[data-project-card]")).length, 2, "모양 밖 값 = 전체");
  } finally {
    await ctx.close();
  }
  for (const h of new Set(hrefs(r.html).filter((h) => h.startsWith("/realestate/projects")))) assert.equal((await get(h)).status, 200, `링크 ${h}`);
});

test("c) 상세 — 전체 단계 4 · 원문 연결률 100%(새 창) · 고정폭·공공누리·확인일 · 원문 본문 전재 0 · 검토 중 · 관련 기사 두 방향 · 확인된 연결 · 404", async () => {
  await flags({ realestate_projects: true });
  const p = `/realestate/projects/${fx.P1.slug}`;
  const r = await get(p);
  assert.equal(r.status, 200);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}${p}`);
    const steps = await page.$$eval('[data-ui="project-stage-timeline"] ol > li', (lis) =>
      lis.map((li) => ({
        state: li.getAttribute("data-stage-state"),
        na: li.hasAttribute("data-stage-na"),
        name: li.querySelector("span.text-\\[22px\\]")?.textContent ?? "",
        links: [...li.querySelectorAll("a")].map((a) => ({ href: a.getAttribute("href"), target: a.getAttribute("target"), rel: a.getAttribute("rel"), text: a.textContent })),
        mono: [...li.querySelectorAll("dd.font-mono")].map((d) => d.textContent),
        text: li.textContent,
      })),
    );
    assert.deepEqual(
      steps.map((s) => [s.name, s.state, s.na]),
      [
        ["시험용 구역지정", "past", false],
        ["시험용 계획인가", "current", false],
        ["시험용 착공", "upcoming", true],
        ["시험용 준공", "upcoming", false],
      ],
    );
    // 원문 연결률 100% — 기록 단계마다 원문 링크 1(새 창·noopener noreferrer), 기록 없는 단계 0
    const recorded = steps.filter((s) => s.mono.length > 0);
    assert.equal(recorded.length, 2);
    assert.equal(await page.getAttribute('[data-ui="project-page"]', "data-source-recorded"), "2");
    assert.equal(await page.getAttribute('[data-ui="project-page"]', "data-source-linked"), "2");
    for (const [i, s] of recorded.entries()) {
      assert.deepEqual(
        s.links.map((l) => [l.href, l.target, l.rel]),
        [[fx.P1.events[i].url, "_blank", "noopener noreferrer"]],
      );
      assert.ok(s.links[0].text.includes("원문 보기") && s.links[0].text.includes("(새 창)"));
      assert.deepEqual(s.mono, [fx.P1.events[i].noticeNo, fx.P1.events[i].date, i === 0 ? "2026-01-16" : "2026-03-03"], "고시 번호·고시일·확인일 고정폭(확인일 = 스냅샷 받은 날 KST)");
    }
    assert.ok(steps[0].text.includes("공공누리 제1유형 (출처표시)") && steps[1].text.includes("공공누리 표시 없음"), "공공누리 유형 글자");
    assert.ok(steps[2].text.includes("해당 없음") && !steps[2].text.includes("예정 단계"));
    assert.deepEqual(steps[3].links, []);
    // 같은 내용의 표
    assert.equal(await page.locator('[data-ui="project-stage-timeline"] tbody tr').count(), 4);
    // 관련 기사 — 기사 → 프로젝트(최근) · 프로젝트 → 기사
    assert.deepEqual(await page.$$eval('[data-project-part="articles"] [data-article-id]', (els) => els.map((e) => Number(e.getAttribute("data-article-id")))), [fx.N2.id, fx.N1.id]);
    // 확인된 연결 — 지역 허브(region_hubs 켜짐)
    assert.deepEqual(await page.$$eval('[data-project-part="links"] [data-link-kind]', (els) => els.map((e) => [e.getAttribute("data-link-kind"), e.querySelector("a")?.getAttribute("href")])), [["region", guPath()]]);
    // 지역 칩 = 허브 링크 · 현재 단계 배지
    assert.equal(await page.getAttribute('[data-part="project-chips"] a', "href"), guPath());
    assert.equal((await page.innerText('[data-part="current-stage"]')).trim(), "현재 단계 시험용 계획인가");
  } finally {
    await ctx.close();
  }
  // 원문 본문 전재 0 (링크만 — #19) · 스냅샷 번호 0
  for (const e of fx.P1.events) assert.ok(!r.html.includes(e.payload), "스냅샷 글자 0");
  // JSON-LD = 화면 (BreadcrumbList 이름 = 이동 줄)
  const bl = jsonLd(r.html).find((n) => n["@type"] === "BreadcrumbList");
  assert.deepEqual(
    bl.itemListElement.map((i) => i.name),
    ["홈", "부동산재테크", "프로젝트 트래커", fx.P1.name],
  );
  assert.equal(bl.itemListElement.at(-1).item, `${SITE}${p}`);
  assert.deepEqual(
    jsonLd(r.html).map((n) => n["@type"]),
    ["BreadcrumbList"],
    "구조화 데이터는 이동 줄만 (가격 Offer 등 0)",
  );
  // 원문 다시 받아 해시가 다르면 그 단계 '검토 중' (6단계 큐) — 다음 렌더부터
  const q = await one(
    "insert into public.source_review_queue (target_type, target_id, reason, old_hash, new_hash, new_snapshot_id, opened_by) values ('project_event', $1, 'snapshot_changed', $2, $3, $4, $5) returning id",
    [fx.P1.events[1].id, `sha256:${"b".repeat(64)}`, `sha256:${"a".repeat(64)}`, fx.P1.events[1].snapshotId, ACTOR],
  );
  try {
    await flags({});
    const again = await get(p);
    const li = [...again.html.matchAll(/<li data-stage-state="[a-z]+"[\s\S]*?<\/li>/g)].map((m) => m[0]);
    assert.ok(li[1].includes("검토 중") && !li[0].includes("검토 중"), "그 단계만 검토 중");
    assert.equal((await getJson(`/api/projects/${fx.P1.slug}`)).body.status, "under_review");
  } finally {
    await db.query("delete from public.source_review_queue where id = $1", [q.id]);
    await flags({});
  }
  // 초안·없는 주소·모양 밖 주소 404
  for (const bad of [`/realestate/projects/${fx.P3.slug}`, `/realestate/projects/siheom-pp-none-${staff.run}`, "/realestate/projects/Bad_Slug"]) assert.equal((await get(bad)).status, 404, bad);
});

test("d) 가격·분담금·수익률 요소 0 — 목록·상세·허브의 입력 칸·화면 글자·JSON-LD·API 칸 이름 (PR-05 · 2.10 사전)", async () => {
  await flags({ realestate_projects: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    for (const p of ["/realestate/projects", `/realestate/projects/${fx.P1.slug}`, guPath()]) {
      await page.goto(`${base}${p}`);
      const controls = await page.$$eval("main input, main select, main textarea", (els) => els.map((el) => [el.getAttribute("name") ?? "", el.id, el.getAttribute("placeholder") ?? "", el.getAttribute("aria-label") ?? ""].join(" ")));
      assert.deepEqual(controls, [], `${p}: 본문 입력 요소 0`);
      const text = await page.innerText("main");
      for (const w of PRICE_TEXT) assert.ok(!text.includes(w), `${p}: 화면 글자 '${w}' 0`);
      const attrs = await page.$$eval("main [data-project-card], main [data-ui='project-page'], main [data-ui='project-list']", (els) => els.flatMap((e) => e.getAttributeNames()));
      assert.deepEqual(attrs.filter((a) => priceWordsIn(a).length > 0), []);
      const html = await page.content();
      for (const n of jsonLd(html)) assert.deepEqual(keysOf(n).filter((k) => priceWordsIn(k).length > 0 || /offer/i.test(k)), [], `${p}: JSON-LD 가격 칸 0`);
    }
  } finally {
    await ctx.close();
  }
  const r = await getJson(`/api/projects/${fx.P1.slug}`);
  assert.equal(r.status, 200);
  assert.equal(PRICE_WORDS.length, 16);
  assert.deepEqual(keysOf(r.body).filter((k) => priceWordsIn(k).length > 0), [], "API 칸 이름 가격 사전 0");
  for (const w of PRICE_TEXT) assert.ok(!JSON.stringify(r.body).includes(w), `API 글자 '${w}' 0`);
});

test("e) API — 200 공개 기록만 + source·verifiedAt·status · 400 주소 모양·모르는 칸 · 404 초안·없음 · 이상한 입력에도 500 0", async () => {
  await flags({ realestate_projects: true });
  const r = await getJson(`/api/projects/${fx.P1.slug}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.cache, "no-store");
  assert.deepEqual(
    { source: r.body.source, verifiedAt: r.body.verifiedAt, status: r.body.status },
    { source: "시험용 트래커구청", verifiedAt: "2026-10-20", status: "public" },
  );
  assert.deepEqual(r.body.region, { code: GU.code, name: `${SIDO.name} ${GU.name}` });
  assert.deepEqual(r.body.currentStage, { key: "plan", label: "시험용 계획인가", noticeDate: "2026-03-02" });
  assert.deepEqual(
    r.body.stages.map((s) => [s.key, s.status]),
    [
      ["zone", "recorded"],
      ["plan", "recorded"],
      ["build", "not_applicable"],
      ["done", "none"],
    ],
  );
  assert.deepEqual(r.body.stages[0].record, { noticeNo: fx.P1.events[0].noticeNo, noticeDate: "2026-01-15", issuer: "시험용 트래커구청", sourceUrl: fx.P1.events[0].url, licenseType: "kogl_1", verifiedAt: "2026-01-16", underReview: false });
  assert.ok(!JSON.stringify(r.body).includes(fx.P1.events[0].payload), "스냅샷 글자 0");
  for (const bad of ["Bad_Slug", "a--b", encodeURIComponent("한글주소"), "x".repeat(130)]) {
    const b = await getJson(`/api/projects/${bad}`);
    assert.equal(b.status, 400, `${bad}: ${JSON.stringify(b.body)}`);
    assert.match(b.body.errors[0], /^slug: /);
  }
  const unknown = await getJson(`/api/projects/${fx.P1.slug}?price=1&x=2`);
  assert.equal(unknown.status, 400);
  assert.deepEqual(unknown.body.errors.map((e) => e.split(":")[0]), ["price", "x"]);
  for (const p of [fx.P3.slug, `siheom-pp-none-${staff.run}`]) assert.equal((await getJson(`/api/projects/${p}`)).status, 404, p);
  for (const weird of ["%00", "%E0%A4%A", "..%2F..%2Fetc", "%27%20or%201%3D1", "a%0Ab", "%ZZ"]) {
    const res = await fetch(`${base}/api/projects/${weird}`);
    assert.ok(res.status < 500, `${weird}: ${res.status}`);
  }
  const broken = await getJson("/api/projects/%E0%A4%A");
  assert.equal(broken.status, 400, "깨진 % 표기 → 400 (Next가 매개변수를 풀기 전에)");
  assert.deepEqual(broken.body.errors, ["slug: 주소 글자를 읽을 수 없습니다"]);
});

test("f) 지역 허브 ③ 프로젝트 카드 · 기사 화면 '확인된 연결' 프로젝트 링크(#103) · 검색 결과 프로젝트 — 링크 전수 200", async () => {
  await flags({ realestate_projects: true });
  // 지역 허브 ③ — 그 지역 범위 공개 프로젝트, 지역 출발 확인된 연결 먼저 · 카드 칸 누락 0
  const gu = await get(guPath());
  const block = gu.html.match(/<section data-hub-block="realEstate"[\s\S]*?<\/section>\s*<\/section>|<section data-hub-block="realEstate"[\s\S]*?(?=<section data-hub-block="sources")/)?.[0] ?? "";
  assert.ok(block.includes('data-group="projects"'), "③ 안 묶음 '프로젝트'");
  assert.deepEqual([...block.matchAll(/data-project-card="([^"]+)"/g)].map((m) => m[1]), [fx.P1.slug], "시·군·구 = 그 지역 프로젝트만");
  const sido = await get(`/local/${sidoSlug()}`);
  assert.deepEqual([...sido.html.matchAll(/data-project-card="([^"]+)"/g)].map((m) => m[1]), [fx.P2.slug, fx.P1.slug], "시·도 = 자기 + 하위, 대표 먼저");
  for (const m of sido.html.matchAll(/<article data-project-card="[^"]+" data-region-code="([^"]*)" data-stage="([^"]*)" data-source="([^"]*)" data-base-date="([^"]*)" data-verified="([^"]*)"/g)) {
    assert.ok(m.slice(1).every((v) => v.trim() !== ""), "카드 지역·단계·출처·기준일·확인일 누락 0");
  }
  // ③ 블록 순서는 그대로(②③⑤) — 프로젝트 카드는 ③ 안에만
  assert.deepEqual([...gu.html.matchAll(/data-hub-block="([a-zA-Z]+)"/g)].map((m) => m[1]), ["localTax", "realEstate", "sources"]);
  // 기사 화면 '확인된 연결' — 프로젝트 도착 링크
  const art = await get(`/news/${fx.N2.slug}`);
  const part = art.html.match(/<section data-article-part="links"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.deepEqual(
    [...part.matchAll(/<li data-link-kind="([a-z_]+)"[\s\S]*?<a [^>]*href="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]),
    [["project", `/realestate/projects/${fx.P1.slug}`]],
  );
  // 검색 — 트래커 탭에 프로젝트(열린 화면 링크) · 검색 화면
  const s = await getJson(`/api/search?q=${encodeURIComponent("시험용 하늘구역")}&tab=tracker`);
  assert.equal(s.status, 200);
  assert.equal(s.body.counts.project, 1);
  const hit = s.body.items.find((h) => h.kind === "project");
  assert.deepEqual([hit.href, hit.typeLabel, hit.stageLabel, hit.projectTypeLabel], [`/realestate/projects/${fx.P1.slug}`, "프로젝트", "시험용 계획인가", "시험용 정비사업"]);
  const sp = await get(`/search?q=${encodeURIComponent("시험용 하늘구역")}&tab=tracker`);
  assert.ok(new RegExp(`data-kind="project"[^>]*data-ref="${fx.P1.id}"`).test(sp.html), "검색 화면에 프로젝트 결과");
  assert.ok(projectHrefs(sp.html).includes(`/realestate/projects/${fx.P1.slug}`));
  for (const h of new Set([...projectHrefs(gu.html), ...projectHrefs(sido.html), ...projectHrefs(art.html), ...projectHrefs(sp.html), ...hrefs(gu.html).filter((x) => x.startsWith("/realestate/projects?"))])) {
    assert.equal((await get(h)).status, 200, `링크 ${h}`);
  }
  // 프로젝트를 내리면 다음 렌더부터 허브·기사·검색 링크 0 (404 링크 0)
  await db.query("update public.projects set status = 'hidden' where id = $1", [fx.P1.id]);
  try {
    await flags({});
    for (const p of [guPath(), `/news/${fx.N2.slug}`]) assert.ok(!projectHrefs((await get(p)).html).includes(`/realestate/projects/${fx.P1.slug}`), p);
    assert.equal((await getJson(`/api/search?q=${encodeURIComponent("시험용 하늘구역")}&tab=tracker`)).body.counts.project, 0);
  } finally {
    await db.query("update public.projects set status = 'public' where id = $1", [fx.P1.id]);
    await flags({});
  }
});

test("g) 360px 세로 타임라인 · 360·1280px 가로 넘침 0 · R1~R3 · 접근성 95", async () => {
  await flags({ realestate_projects: true });
  const pages = ["/realestate/projects", `/realestate/projects/${fx.P1.slug}`];
  for (const viewport of [
    { width: 360, height: 740 },
    { width: 1280, height: 800 },
  ]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    try {
      for (const p of [...pages, guPath()]) {
        await page.goto(`${base}${p}`);
        assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${p} ${viewport.width}px 가로 넘침 0`);
      }
      await page.goto(`${base}${pages[1]}`);
      const boxes = await page.$$eval('[data-ui="project-stage-timeline"] ol > li', (lis) => lis.map((li) => li.getBoundingClientRect().toJSON()));
      for (let i = 1; i < boxes.length; i++) {
        assert.ok(boxes[i].top >= boxes[i - 1].bottom - 1, `${viewport.width}px 단계 ${i + 1}이 앞 단계 아래 (세로 타임라인)`);
        assert.ok(Math.abs(boxes[i].left - boxes[0].left) <= 1, "같은 세로줄");
      }
      if (viewport.width === 360) {
        // 카드 제목 링크는 카드 전체가 누르는 자리(::after — 기사 카드와 같은 문법) — 이동 줄·지역 칩·타임라인 원문·연결 링크를 잰다
        const small = await page.$$eval('main nav[aria-label="현재 위치"] a, main [data-part="project-chips"] a, main [data-ui="project-stage-timeline"] a, main [data-project-part="links"] a', (as) =>
          as.map((a) => ({ t: a.textContent, ...a.getBoundingClientRect().toJSON() })).filter((r) => r.width > 0 && r.height > 0 && r.height < 44),
        );
        assert.deepEqual(small, [], "360px 링크 터치 44px");
        const cardBox = await page.$eval('[data-project-part="articles"] [data-article-id]', (el) => el.getBoundingClientRect().height);
        assert.ok(cardBox >= 44, "관련 기사 카드(누르는 자리) 44px 이상");
      }
    } finally {
      await ctx.close();
    }
  }
  for (const p of pages) {
    for (const width of [360, 640, 1024]) {
      const r = await measurePage(browser, `${base}${p}`, { width, height: 740 });
      if (width === 360) assert.ok(r.r1.pass, `${p} ${width}px R1 ${r.r1.chars}자 > 150`);
      assert.ok(r.r2.pass, `${p} ${width}px R2 주 버튼 ${r.r2.maxPerViewport}개`);
      assert.ok(r.r3.pass, `${p} ${width}px R3 오렌지 ${r.r3.ratio}`);
    }
    const a = await accessibility(`${base}${p}`, debugPort);
    assert.ok(a.score >= A11Y_MIN, `${p} 접근성 ${a.score} — ${a.failing.join(", ")}`);
  }
});
