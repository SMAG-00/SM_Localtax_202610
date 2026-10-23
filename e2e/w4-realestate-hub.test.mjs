// /realestate 허브 확장 E2E (W4 22단계 — docs/dev/W4_설계.md 1장 22단계 · 5장 · 2.4, PRD-01B PR-01).
// standalone 빌드를 로컬 Supabase에 붙인다. 시험용 지역은 법정동코드에 없는 접두 99 가짜 코드와 '시험용' 이름이다(설계 8장).
// 시험 세계: 시험용 시·도 1 + 시·군·구 2(G1: 대표 프로젝트·분양 정보 있음 / G2: 기사·프로젝트 0건) · 공개 대표 프로젝트 L · 공개 분양 정보 S.
//  a) 기능 키 모두 꺼짐 — /realestate 에 지역 칩·대표 프로젝트·분양 정보·링크 카드 요소 0
//  b) 지역 칩 전수 — 시·도 17(+시험용 1) + 시범 지역, 칩마다 주소 /local/…#realestate 를 열면 200이고 그 페이지에 id=realestate 블록이 있다(404 0)
//  c) 카드 전수 — 대표 프로젝트·분양 정보 카드마다 지역(이름·코드)·단계(또는 청약 단계)·출처·기준일 누락 0, 상속·증여 키가 꺼지면 링크 카드 0·켜지면 1
//  d) 기사·프로젝트 0건 지역(G2)의 ③ 블록 — 0건 문장만, 프로젝트·분양 카드 0, 관광 낱말 0
//  e) 지역 허브 꺼짐 — 칩 0 (404 링크 0)
//  f) 360·1280px 가로 넘침 0 · R1~R3 · 접근성 95
// 만든 계정·지역·프로젝트·분양 정보는 끝나면 지우고, 운영 설정(기능 키·시범 지역·사업 유형·단계 목록)은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { measurePage } from "./lib/screen-rules.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-realestate-hub-e2e@example.test";
const SITE = "https://e2e.example.test";
const SIDO = { code: "9900000000", name: "시험용 허브도", key: "hubdo" };
const G1 = { code: "9901100000", name: "시험용 허브구", key: "hubgu" };
const G2 = { code: "9901200000", name: "시험용 빈구", key: "binggu" };
const GOV = "https://gov.example.test/w4reh";
const TYPE = "siheom_reh";
const ACTOR = "migration:e2e-w4reh";

let sb, server, staff, db, browser, base, debugPort;
const fx = {};
const u = {};
const counts0 = {};
const saved = {};

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const kstDay = (offset) => new Date(Date.now() + 9 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);
const sidoSlug = () => `${SIDO.key}-${staff.run}`;
const slugOf = (g) => `${g.key}-${staff.run}`;
const decode = (s) => s?.replaceAll("&amp;", "&") ?? null;
const setSetting = (key, value) => db.query("update public.settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);
/** 공개 데이터 캐시 만료 — 설정 쓰기 API는 캐시를 바로 만료한다 (같은 값을 다시 쓴다). 상속·증여 키는 아직 정식 기능 키가 아니라 SQL로 쓰고 이 호출로 캐시만 비운다 */
async function expireCache() {
  const cur = (await one("select value from public.settings where key = 'pilot_regions'")).value;
  const res = await fetch(`${base}/api/admin/settings/pilot_regions`, { method: "PATCH", headers: { authorization: `Bearer ${u.admin.token}`, "content-type": "application/json" }, body: JSON.stringify({ value: cur }) });
  assert.equal(res.status, 200, await res.text());
}
const flags = async (over) => {
  await setSetting("feature_flags", { ...saved.feature_flags, region_hubs: false, realestate_projects: false, supply_notices: false, dev_methods: false, inheritance_gift: false, ...over });
  await expireCache();
};
async function get(p) {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
}
const chipHrefs = (html) => [...html.matchAll(/data-part="region-chip"[^>]*?href="([^"]*)"|href="([^"]*)"[^>]*?data-part="region-chip"/g)].map((m) => decode(m[1] ?? m[2]));

async function removeFixtureRows(q) {
  const ids = (await q("select id from public.projects where created_by = $1 or slug like 'siheom-reh-%'", [ACTOR])).rows.map((r) => Number(r.id));
  await q("delete from public.supply_notices where created_by = $1 or official_notice_url like $2", [ACTOR, `${GOV}/%`]);
  if (!ids.length) return;
  const snaps = (await q("select snapshot_id from public.project_events where project_id = any($1::bigint[]) and snapshot_id is not null", [ids])).rows.map((r) => Number(r.snapshot_id));
  await q("begin");
  try {
    await q("set local session_replication_role = replica");
    await q("delete from public.supply_notices where project_id = any($1::bigint[])", [ids]);
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
  for (const t of ["regions", "articles", "projects", "project_events", "supply_notices", "raw_snapshots"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  for (const k of ["feature_flags", "pilot_regions", "project_types", "project_stage_lists"]) saved[k] = (await one("select value from public.settings where key = $1", [k])).value;
  assert.equal(saved.feature_flags.dev_methods ?? false, false, "시험 전 dev_methods는 꺼져 있다");

  await db.query("insert into public.regions (code, level, name, slug) values ($1, 'sido', $2, $3)", [SIDO.code, SIDO.name, sidoSlug()]);
  for (const g of [G1, G2]) await db.query("insert into public.regions (code, parent_code, level, name, slug) values ($1, $2, 'sigungu', $3, $4)", [g.code, SIDO.code, g.name, slugOf(g)]);
  await setSetting("project_types", { [TYPE]: { label: "시험용 정비사업" } });
  await setSetting("project_stage_lists", { [TYPE]: [{ key: "zone", label: "시험용 구역지정" }, { key: "done", label: "시험용 준공" }] });
  const p = await one("insert into public.projects (slug, name, region_code, project_type, created_by) values ($1, '시험용 대표구역 정비', $2, $3, $4) returning id", [`siheom-reh-l-${staff.run}`, G1.code, TYPE, ACTOR]);
  const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e-w4reh', $1, $2, '시험용 고시 원문') returning id", [`${GOV}/${staff.run}/zone`, `sha256:w4reh-${staff.run}`]);
  await db.query(
    "insert into public.project_events (project_id, kind, stage, notice_no, notice_date, issuer, source_url, snapshot_id, license_type, recorded_by) values ($1, 'stage', 'zone', $2, '2026-01-15', '시험용 허브구청', $3, $4, 'kogl_1', $5)",
    [p.id, `시험용 고시 제${staff.run}-1호`, `${GOV}/${staff.run}/zone`, snap.id, ACTOR],
  );
  await db.query("update public.projects set status = 'public', landmark = true, source_name = '시험용 허브구청', last_verified_at = $2 where id = $1", [p.id, "2026-10-20T03:00:00Z"]);
  fx.L = { id: Number(p.id) };
  await db.query(
    `insert into public.supply_notices (name, region_code, supply_scale, apply_start, apply_end, notice_date, notice_issuer, official_notice_url, license_type, status, verified_at, created_by, updated_by)
     values ('시험용 허브 분양', $1, '총 820세대 중 일반공급 410세대', $2, $3, $4, '시험용 허브구청', $5, 'kogl_1', 'public', $6, $7, $7)`,
    [G1.code, kstDay(1), kstDay(5), kstDay(-5), `${GOV}/${staff.run}/notice`, "2026-10-20T03:00:00Z", ACTOR],
  );
  await setSetting("pilot_regions", [G1.code]);
  u.admin = await staff.createUser({ label: "w4reh-admin", email: ADMIN_EMAIL });
  await flags({});

  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
});

after(async () => {
  try {
    await browser?.close();
    if (db) await removeFixtureRows((sql, params) => db.query(sql, params));
    if (db && saved.pilot_regions !== undefined) for (const k of ["feature_flags", "pilot_regions", "project_stage_lists", "project_types"]) await setSetting(k, saved[k]); // 단계 목록을 사업 유형보다 먼저 되돌린다 (DB 가드)
    await staff?.cleanup();
  } finally {
    server?.stop();
    if (sb && Object.keys(counts0).length) {
      const c = new pg.Client({ connectionString: sb.dbUrl });
      await c.connect();
      try {
        await removeRegions((sql, params) => c.query(sql, params));
        for (const t of Object.keys(counts0)) assert.equal((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n, counts0[t], `정리 뒤 ${t} 행 수 = 시험 전`);
        const s = (await c.query("select value from public.settings where key = 'pilot_regions'")).rows[0].value;
        assert.deepEqual(s, saved.pilot_regions, "pilot_regions 되돌림");
      } finally {
        await c.end();
      }
    }
  }
});

test("a) 기능 키 모두 꺼짐 — 지역 칩·대표 프로젝트·분양 정보·링크 카드 요소 0", async () => {
  await flags({});
  const r = await get("/realestate");
  assert.equal(r.status, 200);
  for (const part of ["chips", "landmarks", "supply", "links"]) assert.ok(!r.html.includes(`data-hub-part="${part}"`), `${part} 부분 0`);
  assert.ok(!r.html.includes('data-part="region-chip"'), "칩 0");
  assert.ok(!r.html.includes("data-project-card="), "프로젝트 카드 0");
  assert.ok(!r.html.includes("data-supply-card="), "분양 카드 0");
  assert.ok(!r.html.includes("data-link-card="), "링크 카드 0");
});

test("b) 지역 칩 전수 — 시·도 17 이상 + 시범 지역, 모든 칩이 지역 허브 ③ 앵커(200, id=realestate)로 간다", async () => {
  await flags({ region_hubs: true });
  const r = await get("/realestate");
  assert.equal(r.status, 200);
  const hrefs = chipHrefs(r.html);
  const sidoChips = (r.html.match(/data-chip-kind="sido"/g) ?? []).length;
  const pilotChips = (r.html.match(/data-chip-kind="pilot"/g) ?? []).length;
  assert.ok(sidoChips >= 18, `시·도 칩 17 + 시험용 1 이상: ${sidoChips}`);
  assert.equal(pilotChips, 1, "시범 지역 칩 1");
  assert.equal(hrefs.length, sidoChips + pilotChips);
  assert.ok(hrefs.includes(`/local/${sidoSlug()}/${slugOf(G1)}#realestate`), "시범 시·군·구 칩 주소");
  for (const href of hrefs) {
    assert.match(href, /^\/local\/[a-z0-9-]+(\/[a-z0-9-]+)?#realestate$/, href);
    const page = await get(href.split("#")[0]);
    assert.equal(page.status, 200, `${href} 404 0`);
    assert.ok(page.html.includes('id="realestate"'), `${href}: ③ 블록 앵커`);
  }
});

test("c) 카드 전수 — 지역·단계·출처·기준일 누락 0 · 닫힌 기능 링크 카드 0 · 상속·증여 키 켜면 1", async () => {
  await flags({ region_hubs: true, realestate_projects: true, supply_notices: true });
  const r = await get("/realestate");
  const proj = [...r.html.matchAll(/<article[^>]*data-project-card="([^"]+)"([^>]*)>/g)];
  assert.ok(proj.length >= 1, "대표 프로젝트 카드 1 이상");
  for (const m of proj) for (const a of ["data-region-code", "data-stage", "data-source", "data-base-date", "data-verified"]) assert.match(m[0], new RegExp(`${a}="[^"]+"`), `${m[1]} ${a} 누락 0`);
  const sup = [...r.html.matchAll(/<div[^>]*data-supply-card="(\d+)"[^>]*>/g)];
  assert.ok(sup.length >= 1, "분양 정보 카드 1 이상");
  for (const m of sup) for (const a of ["data-region-code", "data-phase", "data-source", "data-base-date", "data-verified"]) assert.match(m[0], new RegExp(`${a}="[^"]+"`), `분양 ${m[1]} ${a} 누락 0`);
  assert.ok(r.html.includes("시험용 대표구역 정비") && r.html.includes("시험용 허브 분양"));
  assert.ok(!r.html.includes("data-link-card="), "닫힌 기능(개발방법·상속·증여) 링크 카드 0");
  await flags({ region_hubs: true, inheritance_gift: true });
  const open = await get("/realestate");
  assert.equal((open.html.match(/data-link-card="/g) ?? []).length, 1);
  assert.ok(open.html.includes('data-link-card="inheritance_gift"'));
  assert.ok(!open.html.includes('data-link-card="dev_methods"'));
  assert.ok(decode(open.html).includes('href="/realestate/inheritance-gift"'));
  assert.ok(!open.html.includes("data-project-card="), "프로젝트 키 꺼짐 → 프로젝트 카드 0");
  // 순서: 칩 → 대표 프로젝트 → 분양 → 링크 → 최신 기사
  await flags({ region_hubs: true, realestate_projects: true, supply_notices: true, inheritance_gift: true });
  const all = await get("/realestate");
  const order = ["chips", "landmarks", "supply", "links"].map((k) => all.html.indexOf(`data-hub-part="${k}"`));
  assert.ok(order.every((i) => i > 0) && [...order].sort((x, y) => x - y).join() === order.join(), `부분 차례 ${order}`);
});

test("d) 기사·프로젝트 0건 지역의 ③ 블록 — 0건 문장만, 카드 0, 관광 낱말 0", async () => {
  await flags({ region_hubs: true, realestate_projects: true, supply_notices: true });
  const page = await get(`/local/${sidoSlug()}/${slugOf(G2)}`);
  assert.equal(page.status, 200);
  const block = page.html.match(/<section[^>]*id="realestate"[\s\S]*?<\/section>/)?.[0];
  assert.ok(block, "③ 블록이 있다");
  assert.ok(block.includes('data-part="block-empty"'), "0건 문장");
  assert.ok(!block.includes("data-project-card=") && !block.includes("data-supply-card="), "빈 카드 0");
  assert.ok(!/관광|맛집|명소|축제/.test(block), "관광 정보 0");
  const full = await get(`/local/${sidoSlug()}/${slugOf(G1)}`);
  const withCards = full.html.match(/<section[^>]*id="realestate"[\s\S]*$/)?.[0] ?? "";
  assert.ok(withCards.includes("data-project-card=") && withCards.includes("data-supply-card="), "자료가 있는 지역은 ③ 에 카드");
});

test("e) 지역 허브 꺼짐 — 칩 0", async () => {
  await flags({});
  const r = await get("/realestate");
  assert.ok(!r.html.includes('data-part="region-chip"'));
  assert.ok(!r.html.includes('data-hub-part="chips"'));
});

test("f) 360·1280px 가로 넘침 0 · R1~R3 · 접근성 95", async () => {
  await flags({ region_hubs: true, realestate_projects: true, supply_notices: true, inheritance_gift: true });
  for (const viewport of [
    { width: 360, height: 740 },
    { width: 1280, height: 800 },
  ]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    try {
      await page.goto(`${base}/realestate`);
      assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `/realestate ${viewport.width}px 가로 넘침 0`);
      if (viewport.width === 360) {
        const small = await page.$$eval('main [data-part="region-chip"], main [data-link-card] a', (as) => as.map((a) => ({ t: a.textContent, ...a.getBoundingClientRect().toJSON() })).filter((r) => r.width > 0 && r.height > 0 && r.height < 44));
        assert.deepEqual(small, [], "360px 칩·링크 카드 터치 44px");
      }
    } finally {
      await ctx.close();
    }
  }
  for (const width of [360, 640, 1024]) {
    const r = await measurePage(browser, `${base}/realestate`, { width, height: 740 });
    assert.ok(r.r2.pass, `${width}px R2 주 버튼 ${r.r2.maxPerViewport}개`);
    assert.ok(r.r3.pass, `${width}px R3 오렌지 ${r.r3.ratio}`);
  }
  const a = await accessibility(`${base}/realestate`, debugPort);
  assert.ok(a.score >= A11Y_MIN, `/realestate 접근성 ${a.score} — ${a.failing.join(", ")}`);
});
