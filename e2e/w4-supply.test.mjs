// 분양 정보 E2E (W4 17단계 — docs/dev/W4_설계.md 1장 17단계 · 2.3 · 2.4 · 4장 `/api/admin/supply` · 5장 · 6장 · 12장 #11·#12·#140~, PRD-01B PR-04 · PR-01 · PR-05).
// standalone 빌드를 로컬 Supabase에 붙인다. 시험용 지역은 법정동코드에 없는 접두 99 가짜 코드와 '시험용' 이름이다(설계 8장).
// 시험 세계: 시험용 시·도 1 + 시·군·구 1 · 시험용 사업 유형 1 · 공개 프로젝트 P · 공개 분양 정보 T(마감 = 오늘 KST·P 연결)·Y(마감 = 어제 KST·P 연결)·F(시·도·마감 열흘 뒤) ·
//   광고·협찬 분양 기사 A(분양 홍보 원고 출처) · 해설 초안 E(분양 홍보 원고 출처).
//  a) 기능 키 supply_notices 꺼짐 — /realestate/supply = 하위 분야 목록(분양 정보 목록 0) · 지역 허브 ③·프로젝트 화면·부동산 허브에 분양 정보 카드·공식 공고 링크 0
//  b) 관리 — 편집 책임자 화면 폼 만들기 + 감사 · 칸별 422 · 가격 칸 이름·가격 글자 422 · 공개 조건 422 → 확인 표시 공개 + 감사 · 내리기·다시 409 ·
//     기자·광고·브랜드 담당 API·화면 403 + 거부 감사 · 메뉴 '분양 정보'는 편집 책임자·관리자만
//  c) 청약 마감 경계(한국 날짜) — 마감 = 오늘(23:59까지) 목록·허브 ③에 있음 · 마감 = 어제(오늘 00:00부터) 목록·허브 0 + 프로젝트 화면 '청약 마감' 기록 · 공식 공고 새 창 · 링크 전수 200
//  d) 가격 요소 0 — 목록·지역 허브·프로젝트·관리 화면의 입력 칸·화면 글자·JSON-LD(BreadcrumbList만 — NewsArticle 0)·관리 API 칸 이름
//  e) 분양 홍보 원고 — 해설로 발행 422(pr04.sponsor-material-sponsored) + DB 거부 · sponsored 기사는 목록 카드·상세·공유 미리보기 '광고' 같은 글자 · 분양 정보는 /news·기사 목록 0
//  f) 360·1280px 가로 넘침 0 · R1~R3 · 접근성 95
// 만든 계정·기사·지역·프로젝트·분양 정보·스냅샷은 끝나면 지우고, 운영 설정(기능 키·사업 유형·단계 목록)은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";
import { priceWordsIn } from "../packages/db/scripts/check-price-fields.mjs";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { measurePage } from "./lib/screen-rules.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-supply-e2e@example.test";
const SITE = "https://e2e.example.test";
const SIDO = { code: "9900000000", name: "시험용 분양도", key: "bunyangdo" };
const GU = { code: "9901100000", name: "시험용 분양구", key: "bunyanggu" };
const GOV = "https://gov.example.test/w4sn";
const TYPE = "siheom_sn";
const ACTOR = "migration:e2e-w4sn";
/** 화면 글자에 없어야 하는 가격 낱말 (2.10 사전의 한글 + PR-05 문장의 낱말) */
const PRICE_TEXT = ["분양가", "분담금", "수익률", "수익", "시세", "프리미엄", "가격", "웃돈"];

let sb, server, staff, db, browser, base, debugPort;
const u = {};
const fx = {};
const counts0 = {};

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const hoursAgo = (n) => new Date(Date.now() - n * 3600_000).toISOString();
const kstDay = (offset) => new Date(Date.now() + 9 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);
const sidoSlug = () => `${SIDO.key}-${staff.run}`;
const guSlug = () => `${GU.key}-${staff.run}-gu`;
const guPath = () => `/local/${sidoSlug()}/${guSlug()}`;
const show = (r) => JSON.stringify(r.body ?? r.html?.slice(0, 300)).slice(0, 700);
const decode = (s) => s?.replaceAll("&amp;", "&") ?? null;
const errorFields = (r) => [...new Set((r.body.errors ?? []).map((e) => e.split(":")[0]))].sort();

async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const supply = (user, body) => api("POST", "/supply", user, body);
const setSetting = (key, value) => api("PATCH", `/settings/${key}`, u.admin, { value });
async function flags(over) {
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  const r = await setSetting("feature_flags", { ...cur, ...over });
  assert.equal(r.status, 200, show(r));
}
async function get(p) {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
}
const auditCount = (action, target, actorId) =>
  one("select count(*)::int n from public.audit_logs where action = $1 and target = $2 and actor = $3 and at >= $4", [action, target, `user:${actorId}`, staff.startedAt]).then((r) => r.n);
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => [JSON.parse(m[1])].flat());
const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1]));
const supplyCards = (html) => [...html.matchAll(/data-supply-card="(\d+)"/g)].map((m) => Number(m[1]));
const keysOf = (v) => (Array.isArray(v) ? v.flatMap(keysOf) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);

async function login(page, who) {
  await page.goto(`${base}/admin/login`);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "로그인" && !b.disabled));
  await page.fill("#login-email", who.email);
  await page.fill("#login-password", who.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((url) => url.pathname !== "/admin/login");
}
const controls = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("main input, main select, main textarea")].map((el) => {
      const label = el.id ? (document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent ?? "") : "";
      return { name: el.getAttribute("name") ?? "", id: el.id, label: label.trim(), placeholder: el.getAttribute("placeholder") ?? "", aria: el.getAttribute("aria-label") ?? "" };
    }),
  );

async function removeFixtureRows(q) {
  await q("delete from public.supply_notices where created_by = $1 or official_notice_url like $2", [ACTOR, `${GOV}/%`]);
  const ids = (await q("select id from public.projects where created_by = $1 or slug like 'siheom-sn-%'", [ACTOR])).rows.map((r) => Number(r.id));
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
async function notice(key, over) {
  const row = await one(
    `insert into public.supply_notices (name, region_code, project_id, supply_scale, apply_start, apply_end, notice_date, notice_issuer, official_notice_url, license_type, status, verified_at, created_by, updated_by)
     values ($1, $2, $3, '총 820세대 중 일반공급 410세대', $4, $5, $6, '시험용 분양구청', $7, 'kogl_1', 'public', $8, $9, $9) returning id`,
    [over.name, over.region ?? GU.code, over.project ?? null, over.start, over.end, over.noticeDate ?? kstDay(-20), `${GOV}/${staff.run}/${key}`, "2026-10-20T03:00:00Z", ACTOR],
  );
  fx[key] = { id: Number(row.id), url: `${GOV}/${staff.run}/${key}`, name: over.name };
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
  await removeFixtureRows((sql, params) => db.query(sql, params));
  await removeRegions((sql, params) => db.query(sql, params));
  await staff.snapshotOperations();
  for (const t of ["regions", "articles", "article_sources", "raw_snapshots", "projects", "project_events", "supply_notices"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  const s = Object.fromEntries((await db.query("select key, value from public.settings where key in ('feature_flags', 'project_types', 'project_stage_lists')")).rows.map((r) => [r.key, r.value]));
  assert.equal(s.feature_flags.supply_notices, false, "시험 전 supply_notices는 꺼져 있다 (2.4 씨앗 — 법률 검토 기록 전)");

  u.admin = await staff.createUser({ label: "w4sn-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w4sn-editor", roles: ["editor"], person: { name: "시험용 분양 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "w4sn-reporter", roles: ["reporter"], person: { name: "시험용 분양 기자", roles: ["reporter"] } });
  u.adOps = await staff.createUser({ label: "w4sn-adops", roles: ["ad_ops"], person: { name: "시험용 광고 담당", roles: ["writer"] } });
  u.brandOps = await staff.createUser({ label: "w4sn-brand", roles: ["brand_ops"] });
  await db.query("insert into public.regions (code, level, name, slug) values ($1, 'sido', $2, $3)", [SIDO.code, SIDO.name, sidoSlug()]);
  await db.query("insert into public.regions (code, parent_code, level, name, slug) values ($1, $2, 'sigungu', $3, $4)", [GU.code, SIDO.code, GU.name, guSlug()]);
  assert.equal((await setSetting("project_types", { [TYPE]: { label: "시험용 정비사업" } })).status, 200);
  assert.equal((await setSetting("project_stage_lists", { [TYPE]: [{ key: "zone", label: "시험용 구역지정" }, { key: "done", label: "시험용 준공" }] })).status, 200);
  const p = await one("insert into public.projects (slug, name, region_code, project_type, created_by) values ($1, '시험용 하늘구역 정비', $2, $3, $4) returning id, slug", [`siheom-sn-p-${staff.run}`, GU.code, TYPE, ACTOR]);
  const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e-w4sn', $1, $2, '시험용 고시 원문') returning id", [`${GOV}/${staff.run}/zone`, `sha256:w4sn-${staff.run}`]);
  await db.query(
    "insert into public.project_events (project_id, kind, stage, notice_no, notice_date, issuer, source_url, snapshot_id, license_type, recorded_by) values ($1, 'stage', 'zone', $2, '2026-01-15', '시험용 분양구청', $3, $4, 'kogl_1', $5)",
    [p.id, `시험용 고시 제${staff.run}-1호`, `${GOV}/${staff.run}/zone`, snap.id, ACTOR],
  );
  await db.query("update public.projects set status = 'public', source_name = '시험용 분양구청', last_verified_at = $2 where id = $1", [p.id, "2026-10-20T03:00:00Z"]);
  fx.P = { id: Number(p.id), slug: p.slug, href: `/realestate/projects/${p.slug}` };
  await notice("T", { name: "시험용 오늘마감 하늘마을", project: p.id, start: kstDay(-2), end: kstDay(0) });
  await notice("Y", { name: "시험용 어제마감 하늘마을", project: p.id, start: kstDay(-4), end: kstDay(-1) });
  await notice("F", { name: "시험용 다음달 바다마을", region: SIDO.code, start: kstDay(8), end: kstDay(10) });

  // 광고·협찬 분양 기사 A (분양 홍보 원고 출처 — 초안에 달고 발행) · 해설 초안 E (같은 출처)
  const a = await one(
    "insert into public.articles (slug, title, summary, section, content_type, label, author_id) values ($1, '시험용 하늘마을 분양 안내', '시험용 분양대행사가 준 원고입니다', 'realestate', 'sponsored', 'ad', $2) returning id, slug",
    [`e2e-w4sn-ad-${staff.run}`, u.reporter.personId],
  );
  staff.trackArticle(Number(a.id));
  await db.query("insert into public.article_sources (article_id, kind, title, source_name) values ($1, 'sponsor_material', '시험용 하늘마을 분양 홍보 원고', '시험용 분양대행사')", [a.id]);
  await db.query("update public.articles set status = 'published', first_published_at = $2 where id = $1", [a.id, hoursAgo(1)]);
  fx.A = { id: Number(a.id), slug: a.slug, href: `/news/${a.slug}` };
  const e = await api("POST", "/articles", u.reporter, { slug: `e2e-w4sn-ex-${staff.run}`, title: `시험용 하늘마을 분양 해설 ${staff.run}`, summary: "시험용 분양 홍보 원고로 쓴 해설입니다", section: "realestate", contentType: "explainer" });
  assert.equal(e.status, 201, show(e));
  fx.E = { id: e.body.article.id, slug: `e2e-w4sn-ex-${staff.run}` };
  staff.trackArticle(fx.E.id);
  const src = await api("POST", `/articles/${fx.E.id}/sources`, u.reporter, { kind: "sponsor_material", title: "시험용 하늘마을 분양 홍보 원고", sourceName: "시험용 분양대행사" });
  assert.equal(src.status, 201, show(src));

  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
  await flags({ region_hubs: true, realestate_projects: true, supply_notices: false });
});

after(async () => {
  try {
    await browser?.close();
    if (db) await removeFixtureRows((sql, params) => db.query(sql, params));
    await staff?.cleanup(); // 기사·출처·계정·감사 로그 지우기 + 운영 설정(기능 키·사업 유형·단계 목록) 되돌리기
  } finally {
    server?.stop();
    if (sb && Object.keys(counts0).length) {
      const c = new pg.Client({ connectionString: sb.dbUrl });
      await c.connect();
      try {
        await removeRegions((sql, params) => c.query(sql, params));
        for (const t of Object.keys(counts0)) assert.equal((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n, counts0[t], `정리 뒤 ${t} 행 수 = 시험 전`);
        const s = (await c.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
        assert.equal(s.supply_notices, false, "supply_notices 되돌림");
      } finally {
        await c.end();
      }
    }
  }
});

test("a) 기능 키 꺼짐 — /realestate/supply = 하위 분야 목록 · 지역 허브 ③·프로젝트 화면·부동산 허브에 분양 정보 카드·공식 공고 링크 0", async () => {
  const list = await get("/realestate/supply");
  assert.equal(list.status, 200);
  assert.ok(list.html.includes('data-ui="category-list"'), "하위 분야 목록으로 보인다");
  assert.ok(!list.html.includes('data-ui="supply-list"'));
  for (const p of ["/realestate/supply", guPath(), `/local/${sidoSlug()}`, fx.P.href, "/realestate"]) {
    const page = await get(p);
    assert.equal(page.status, 200, p);
    assert.deepEqual(supplyCards(page.html), [], `${p}: 분양 정보 카드 0`);
    assert.ok(!page.html.includes('data-ui="presale-info-card"'), `${p}: 분양 정보 카드 0`);
    assert.deepEqual(hrefs(page.html).filter((h) => h.startsWith(GOV) && !h.endsWith("/zone")), [], `${p}: 공식 공고 링크 0`);
    assert.ok(!page.html.includes('data-project-part="supply"'), `${p}: 프로젝트 분양 정보 자리 0`);
  }
});

test("b) 관리 — 화면 폼 만들기 + 감사 · 칸별 422 · 가격 칸 이름·글자 422 · 공개 조건 422 → 공개 + 감사 · 내리기 · 다시 409 · 권한 403 + 거부 감사 · 메뉴", async () => {
  // 권한 — 기자·광고·브랜드 담당은 입력을 보기 전에 403 + 거부 감사 1건씩
  for (const who of [u.reporter, u.adOps, u.brandOps]) {
    const r = await supply(who, { op: "create", name: "x" });
    assert.equal(r.status, 403, show(r));
    assert.equal(await auditCount("supply.manage.denied", "supply_notices:write", who.id), 1, `${who.roles} 거부 감사 1건`);
    assert.equal((await api("GET", "/supply", who)).status, 403);
  }
  assert.equal((await api("GET", "/supply", u.editor)).status, 200);
  const good = {
    op: "create",
    name: "시험용 관리마을 분양",
    region_code: GU.code,
    supply_scale: "총 300세대 중 일반공급 120세대",
    apply_start: kstDay(5),
    apply_end: kstDay(7),
    notice_date: kstDay(-1),
    notice_issuer: "시험용 분양구청",
    official_notice_url: `${GOV}/${staff.run}/admin`,
    license_type: "kogl_1",
  };
  // 칸별 422 — 주소·마감·공공누리 · 가격 칸 이름 · 가격 글자 · 오늘 유효하지 않은 지역
  let r = await supply(u.editor, { ...good, official_notice_url: "ftp://x", apply_end: kstDay(4), license_type: "" });
  assert.equal(r.status, 422, show(r));
  assert.deepEqual(errorFields(r), ["apply_end", "license_type", "official_notice_url"]);
  r = await supply(u.editor, { ...good, supply_price: 1, "분양가": "x", expected_return: 2 });
  assert.equal(r.status, 422, show(r));
  assert.deepEqual(errorFields(r), ["expected_return", "supply_price", "분양가"].sort());
  r = await supply(u.editor, { ...good, name: "시험용 관리마을 분양가 3억", supply_scale: "84㎡ 5억원" });
  assert.equal(r.status, 422, show(r));
  assert.deepEqual(errorFields(r), ["name", "supply_scale"]);
  r = await supply(u.editor, { ...good, region_code: "9909900000" });
  assert.deepEqual([r.status, errorFields(r)], [422, ["region_code"]]);
  assert.equal((await one("select count(*)::int n from public.supply_notices where official_notice_url = $1", [good.official_notice_url])).n, 0, "거부된 요청은 행 0");

  // 화면 폼 — 편집 책임자가 만든다 (초안)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    await login(page, u.editor);
    await page.goto(`${base}/admin/supply`);
    assert.ok((await page.locator("nav a", { hasText: "분양 정보" }).count()) >= 1, "편집 책임자 메뉴 '분양 정보'");
    await page.waitForFunction(() => [...document.querySelectorAll('[data-form="supply-create"] button[type="submit"]')].every((b) => !b.disabled));
    for (const [id, v] of [
      ["sp-new-name", good.name],
      ["sp-new-region", good.region_code],
      ["sp-new-scale", good.supply_scale],
      ["sp-new-project", String(fx.P.id)],
      ["sp-new-start", good.apply_start],
      ["sp-new-end", good.apply_end],
      ["sp-new-notice-date", good.notice_date],
      ["sp-new-issuer", good.notice_issuer],
      ["sp-new-url", good.official_notice_url],
    ]) await page.fill(`#${id}`, v);
    await page.selectOption("#sp-new-license", "kogl_1");
    await page.locator('[data-form="supply-create"] button[type="submit"]').click();
    await page.waitForSelector("text=분양 정보를 만들었습니다");
    const made = await one("select id, status, verified_at, project_id, created_by from public.supply_notices where official_notice_url = $1", [good.official_notice_url]);
    assert.deepEqual([made.status, made.verified_at, Number(made.project_id), made.created_by], ["draft", null, fx.P.id, `user:${u.editor.id}`]);
    fx.M = { id: Number(made.id) };
    assert.equal(await auditCount("supply_notice.edit", `supply_notices:${fx.M.id}`, u.editor.id), 1, "감사 supply_notice.edit 1건");
    // 화면 입력 칸 전수 — 가격 사전 낱말 0 (숨은 칸 포함)
    await page.reload();
    for (const c of await controls(page)) {
      for (const v of [c.name, c.id, c.label, c.placeholder, c.aria]) assert.deepEqual(priceWordsIn(v), [], `관리 화면 입력 칸 ${JSON.stringify(c)}`);
    }
  } finally {
    await ctx.close();
  }
  // 공개 조건 — 확인일 없이 공개 422(verified) → 확인 표시로 공개 + 감사 → 내리기 → 다시 내리기 409
  r = await supply(u.editor, { op: "publish", id: fx.M.id, status: "public" });
  assert.deepEqual([r.status, errorFields(r)], [422, ["verified"]], show(r));
  r = await supply(u.editor, { op: "publish", id: fx.M.id, status: "public", verified: true });
  assert.equal(r.status, 200, show(r));
  assert.equal(r.body.notice.status, "public");
  assert.equal(await auditCount("supply_notice.publish", `supply_notices:${fx.M.id}`, u.editor.id), 1, "감사 supply_notice.publish 1건");
  r = await supply(u.editor, { op: "update", id: fx.M.id, supply_scale: "" });
  assert.deepEqual([r.status, errorFields(r)], [422, ["supply_scale"]], "공개 중 공급 규모 지우기 422");
  r = await supply(u.editor, { op: "update", id: fx.M.id, apply_end: kstDay(8) });
  assert.equal(r.status, 200, show(r));
  assert.equal(await auditCount("supply_notice.edit", `supply_notices:${fx.M.id}`, u.editor.id), 2, "고치기 감사 1건 더");
  assert.equal((await supply(u.editor, { op: "publish", id: fx.M.id, status: "hidden" })).status, 200);
  assert.equal((await supply(u.editor, { op: "publish", id: fx.M.id, status: "hidden" })).status, 409);
  // 관리 API 응답 칸 이름 — 가격 사전 낱말 0
  const list = await api("GET", "/supply", u.editor);
  assert.deepEqual(keysOf(list.body).filter((k) => priceWordsIn(k).length), []);
  // 광고 담당 화면 403 · 메뉴 0
  const ad = await browser.newContext();
  const adPage = await ad.newPage();
  try {
    await login(adPage, u.adOps);
    const res = await adPage.goto(`${base}/admin/supply`);
    assert.equal(res.status(), 403);
    await adPage.goto(`${base}/admin`);
    assert.equal(await adPage.locator('nav a[href="/admin/supply"]').count(), 0, "광고 담당 메뉴 '분양 정보' 0");
  } finally {
    await ad.close();
  }
});

test("c) 청약 마감 경계(KST) — 마감 = 오늘(23:59까지) 목록·허브에 있음 · 마감 = 어제(오늘 00:00부터) 0 + 프로젝트 화면 기록 · 공식 공고 새 창 · 링크 200", async () => {
  await flags({ supply_notices: true });
  const list = await get("/realestate/supply");
  assert.equal(list.status, 200);
  assert.ok(list.html.includes('data-ui="supply-list"') && list.html.includes('data-part="list-mark"'), "분양 정보 목록 · '정보 목록' 표시");
  const cards = supplyCards(list.html);
  assert.ok(cards.includes(fx.T.id), "마감 = 오늘 — 목록에 있다");
  assert.ok(cards.includes(fx.F.id));
  assert.ok(!cards.includes(fx.Y.id), "마감 = 어제 — 목록 0");
  assert.ok(!list.html.includes(fx.Y.name));
  assert.ok(cards.indexOf(fx.T.id) < cards.indexOf(fx.F.id), "마감 이른 순");
  // 카드 칸 — 지역·청약 단계·출처·기준일·확인일 (data-* 와 화면 글자)
  const t = list.html.match(new RegExp(`data-supply-card="${fx.T.id}"[^>]*`))[0];
  for (const attr of [`data-region-code="${GU.code}"`, 'data-phase="open"', `data-apply-end="${kstDay(0)}"`, 'data-source="시험용 분양구청"', `data-base-date="${kstDay(-20)}"`, 'data-verified="2026-10-20"']) assert.ok(t.includes(attr), attr);
  assert.ok(list.html.includes("청약 접수 중") && list.html.includes("청약 예정"));
  const tag = list.html.match(new RegExp(`<a[^>]*href="${fx.T.url}"[^>]*>`))[0];
  assert.ok(tag.includes('target="_blank"') && tag.includes('rel="noopener noreferrer"'), "공식 공고 새 창");
  const gu = await get(`/realestate/supply?region=${GU.code}`);
  assert.deepEqual(supplyCards(gu.html), [fx.T.id], "지역 거르개 — 그 시·군·구 예정만");
  assert.ok(gu.html.includes('name="robots" content="noindex'), "거른 목록 noindex");
  // 지역 허브 ③ — 오늘 마감은 있고 어제 마감은 0
  const hub = await get(guPath());
  assert.ok(hub.html.includes('data-group="supply"'), "③ 묶음 '분양 정보'");
  assert.deepEqual(supplyCards(hub.html), [fx.T.id]);
  const sidoHub = await get(`/local/${sidoSlug()}`);
  assert.deepEqual(supplyCards(sidoHub.html).sort(), [fx.T.id, fx.F.id].sort(), "시·도 허브는 하위 포함");
  // 프로젝트 화면 — 오늘 마감(접수 중) 먼저, 어제 마감은 '청약 마감' 기록으로 남는다
  const pj = await get(fx.P.href);
  assert.ok(pj.html.includes('data-project-part="supply"'));
  assert.deepEqual(supplyCards(pj.html), [fx.T.id, fx.Y.id]);
  assert.match(pj.html, new RegExp(`data-supply-card="${fx.Y.id}"[^>]*data-phase="closed"`));
  assert.ok(pj.html.includes("청약 마감"));
  assert.equal((pj.html.match(/data-project-part="source"/g) ?? []).length, 1, "데이터 출처 줄 1개(화면 끝)");
  // 사이트 안 링크 전수 200 (목록·허브·프로젝트) — 연결 프로젝트·더 보기·지역 칩
  for (const h of new Set([...hrefs(list.html), ...hrefs(hub.html), ...hrefs(pj.html)].filter((x) => x && (x.startsWith("/realestate/") || x.startsWith("/local/"))))) {
    assert.equal((await get(h)).status, 200, `링크 ${h}`);
  }
  assert.ok(hrefs(list.html).includes(fx.P.href), "연결 프로젝트 링크");
});

test("d) 가격 요소 0 — 목록·허브·프로젝트 화면 글자·입력 칸·JSON-LD(BreadcrumbList만, NewsArticle 0)", async () => {
  await flags({ supply_notices: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    for (const p of ["/realestate/supply", guPath(), fx.P.href]) {
      await page.goto(`${base}${p}`);
      assert.ok((await page.locator("[data-supply-card]").count()) > 0, `${p}: 분양 정보 카드가 있다(검사가 비지 않게)`);
      const controls = await page.$$eval("main input, main select, main textarea", (els) => els.map((el) => [el.getAttribute("name") ?? "", el.id].join(" ")));
      assert.deepEqual(controls, [], `${p}: 본문 입력 요소 0`);
      const text = await page.innerText("main");
      for (const w of PRICE_TEXT) assert.ok(!text.includes(w), `${p}: 화면 글자 '${w}' 0`);
      const attrs = await page.$$eval("main [data-supply-card], main [data-ui='supply-list'], main [data-ui='presale-info-card']", (els) => els.flatMap((e) => e.getAttributeNames()));
      assert.deepEqual(attrs.filter((a) => priceWordsIn(a).length > 0), []);
      for (const n of jsonLd(await page.content())) assert.deepEqual(keysOf(n).filter((k) => priceWordsIn(k).length > 0 || /offer/i.test(k)), [], `${p}: JSON-LD 가격 칸 0`);
    }
  } finally {
    await ctx.close();
  }
  const list = await get("/realestate/supply");
  const nodes = jsonLd(list.html);
  assert.deepEqual(nodes.map((n) => n["@type"]), ["BreadcrumbList"], "구조화 데이터 BreadcrumbList만");
  assert.deepEqual(
    nodes[0].itemListElement.map((i) => [i.name, i.item]),
    [
      ["홈", `${SITE}/`],
      ["부동산", `${SITE}/realestate`],
      ["분양 정보", `${SITE}/realestate/supply`],
    ],
  );
  assert.ok(!JSON.stringify(nodes).includes("NewsArticle"));
  assert.ok(!list.html.includes("data-article-id"), "분양 정보 목록에 기사 0");
});

test("e) 분양 홍보 원고 — 해설 발행 422 + DB 거부 · sponsored 기사는 목록·상세·공유 미리보기 '광고' 같은 글자 · 분양 정보는 /news 0", async () => {
  const r = await api("POST", `/articles/${fx.E.id}/publish`, u.editor);
  assert.equal(r.status, 422, show(r));
  assert.ok((r.body.failed ?? []).includes("pr04.sponsor-material-sponsored"), show(r));
  const f = r.body.findings.find((x) => x.id === "pr04.sponsor-material-sponsored");
  assert.equal(f.location.field, "sources");
  await assert.rejects(db.query("update public.articles set status = 'published' where id = $1", [fx.E.id]), /PR-04/, "DB도 거부 (서비스를 건너뛴 쓰기)");
  assert.equal((await one("select status from public.articles where id = $1", [fx.E.id])).status, "draft");
  // sponsored 분양 기사 — 목록 카드·상세 머리·공유 미리보기(og:title) 같은 '광고'
  const hubPage = await get("/realestate");
  const card = hubPage.html.match(new RegExp(`data-article-id="${fx.A.id}"[\\s\\S]*?</li>`))?.[0] ?? "";
  assert.match(card, /data-ui="article-type-badge"[^>]*>광고</, "목록 카드 '광고'");
  const detail = await get(fx.A.href);
  assert.equal(detail.status, 200);
  const head = detail.html.match(/data-article-part="head"[\s\S]*?<\/header>|data-article-part="head"[\s\S]{0,4000}/)[0];
  assert.match(head, /data-ui="article-type-badge"[^>]*>광고</, "상세 머리 '광고'");
  const og = decode(detail.html.match(/<meta property="og:title" content="([^"]*)"/)[1]);
  assert.ok(og.includes("[광고]"), `공유 미리보기 제목: ${og}`);
  // 분양 정보 항목은 기사 목록에 0
  await flags({ supply_notices: true });
  const news = await get("/news");
  for (const n of [fx.T, fx.F, fx.Y]) assert.ok(!news.html.includes(n.name), `/news에 분양 정보 ${n.name} 0`);
  assert.deepEqual(supplyCards(news.html), []);
});

test("f) 360·1280px 가로 넘침 0 · R1~R3 · 접근성 95", async () => {
  await flags({ supply_notices: true });
  const pages = ["/realestate/supply", fx.P.href, guPath()];
  for (const viewport of [
    { width: 360, height: 740 },
    { width: 1280, height: 800 },
  ]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    try {
      for (const p of pages) {
        await page.goto(`${base}${p}`);
        assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${p} ${viewport.width}px 가로 넘침 0`);
      }
      if (viewport.width === 360) {
        await page.goto(`${base}/realestate/supply`);
        const small = await page.$$eval('main nav[aria-label="현재 위치"] a, main [data-part="filter-region"] a, main [data-supply-card] a', (as) =>
          as.map((a) => ({ t: a.textContent, ...a.getBoundingClientRect().toJSON() })).filter((r) => r.width > 0 && r.height > 0 && r.height < 44),
        );
        assert.deepEqual(small, [], "360px 링크 터치 44px");
      }
    } finally {
      await ctx.close();
    }
  }
  for (const width of [360, 640, 1024]) {
    const r = await measurePage(browser, `${base}/realestate/supply`, { width, height: 740 });
    if (width === 360) assert.ok(r.r1.pass, `${width}px R1 ${r.r1.chars}자 > 150`);
    assert.ok(r.r2.pass, `${width}px R2 주 버튼 ${r.r2.maxPerViewport}개`);
    assert.ok(r.r3.pass, `${width}px R3 오렌지 ${r.r3.ratio}`);
  }
  const a = await accessibility(`${base}/realestate/supply`, debugPort);
  assert.ok(a.score >= A11Y_MIN, `/realestate/supply 접근성 ${a.score} — ${a.failing.join(", ")}`);
});
