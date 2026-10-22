// 지역 연결 E2E (W4 13단계 — docs/dev/W4_설계.md 1장 13단계 · 2.1 · 4장 `/api/admin/regional-links` · 5장 · 6장 · 12장 100번~, PRD-01B REG1-10 · LG-14).
// standalone 빌드를 로컬 Supabase에 붙인다. 시험용 지역은 법정동코드에 없는 접두 99 가짜 코드와 '시험용' 이름이다(설계 8장).
// 시험 세계: 시험용 시·도 1 + 시·군·구 1 · 출발 기사 FROM · 도착 기사 T1(공개)·T2(초안) · T1의 검수 공식 자료 · 공개 프로젝트 1(시험용 사업 유형 — 설정은 되돌린다).
//  a) 같은 지역 자동 후보 — 편집 책임자 [같은 지역 후보 찾기] → 후보(프로젝트·지역 허브)·다시 0 · 후보는 편집 화면에만(공개 뷰 anon 0행·기사 화면 '확인된 연결' 자리 0)
//  b) 관광 항목 종류(명소·음식점·관광 정보) 422 + PRD-X 문장 · 행사(W6) 422 · 확인 이유 없는 확인 422 · 비공개 목적지(초안 기사) 확인 409 · 같은 쌍 409
//  c) 확인 — 화면 폼으로 후보 확인(이유·관계) → 감사 regional_link.confirm 1건 · 만들며 확인(기사·공식 자료) 201 · 기사 화면에 확인된 연결만, 링크 전수 200·공식 원문 새 창·noreferrer ·
//     프로젝트 도착은 공개 화면(15단계) 전 0 · 지역 허브는 region_hubs 켜짐일 때만
//  d) 목적지가 비공개가 되면 다음 렌더부터 링크 0(404 링크 0) · 되돌리면 다시 · 지우기(이유 필수) → 다음 렌더부터 0 + 감사 regional_link.remove
//  e) 권한 — 기자·광고 담당 API·화면 403 + 거부 감사 · 편집 책임자 판정판·기사 편집 화면에서 지역 연결 화면으로 가는 링크 · 관리 메뉴 항목은 그대로
//  f) 360·1280px 가로 넘침 0(기사 화면·지역 연결 화면) · 접근성 95
// 만든 계정·기사·자료·지역·프로젝트·연결은 끝나면 지우고, 운영 설정(기능 키·사업 유형·단계 목록)은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-regional-links-e2e@example.test";
const SITE = "https://e2e.example.test";
const SIDO = { code: "9900000000", name: "시험용 연결도", key: "yeongyeol" };
const GU = { code: "9901100000", name: "시험용 연결구", key: "yeongyeolgu", parent: SIDO };
const GOV = "https://gov.example.test/w4rl";
const ACTOR_SYSTEM = "migration:e2e-w4rl";

let sb, server, staff, db, browser, base, debugPort;
const u = {};
const fx = {};
const counts0 = {};
const projectIds = [];

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const hoursAgo = (n) => new Date(Date.now() - n * 3600_000).toISOString();
const sidoSlug = () => `${SIDO.key}-${staff.run}`;
const guSlug = () => `${GU.key}-${staff.run}-gu`;
const show = (r) => JSON.stringify(r.body).slice(0, 600);

async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const links = (user, body) => api("POST", "/regional-links", user, body);
async function setSetting(key, value, user = u.admin) {
  return api("PATCH", `/settings/${key}`, user, { value });
}
/** 공개 데이터 캐시 만료 — 기능 키를 같은 값으로 저장(설정 쓰기 = 캐시 만료). DB를 직접 고친 뒤 부른다 */
async function expire() {
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  assert.equal((await setSetting("feature_flags", cur)).status, 200);
}
async function hubs(on) {
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  assert.equal((await setSetting("feature_flags", { ...cur, region_hubs: on })).status, 200);
}
const auditCount = (action, target, actorId) =>
  one("select count(*)::int n from public.audit_logs where action = $1 and target = $2 and actor = $3 and at >= $4", [action, target, `user:${actorId}`, staff.startedAt]).then((r) => r.n);

async function get(p) {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
}
/** 기사 화면의 '확인된 연결' 자리 — 링크 [종류, 주소, target, rel] */
function linkPart(html) {
  const part = html.match(/<section data-article-part="links"[\s\S]*?<\/section>/)?.[0] ?? null;
  if (!part) return null;
  return [...part.matchAll(/<li data-link-kind="([a-z_]+)" data-relation="([a-z_]+)"[\s\S]*?<a ([^>]*)>/g)].map((m) => {
    const attrs = m[3];
    return { kind: m[1], relation: m[2], href: attrs.match(/href="([^"]*)"/)?.[1] ?? null, target: attrs.match(/target="([^"]*)"/)?.[1] ?? null, rel: attrs.match(/rel="([^"]*)"/)?.[1] ?? null };
  });
}
const decode = (s) => s?.replaceAll("&amp;", "&") ?? null;

/** 공개 뷰를 anon 역할로 읽는다 */
async function publicRows(fromId) {
  await db.query("begin");
  try {
    await db.query("set local role anon");
    return (await db.query("select * from public.public_regional_links where from_id = $1 order by id", [String(fromId)])).rows;
  } finally {
    await db.query("rollback");
  }
}

/** 연결·프로젝트 지우기 — 기사·계정은 staff.cleanup이 지운다. 지역은 기사가 태그한 동안 지울 수 없어(CAT-03) removeRegions를 기사 정리 뒤에 부른다 */
async function removeFixtureRows(q) {
  const actors = [ACTOR_SYSTEM, ...[...(staff?.userIds ?? [])].map((id) => `user:${id}`)];
  const articleIds = [...(staff?.articleIds ?? [])].map(String);
  await q(
    `delete from public.regional_links where created_by = any($1::text[]) or (from_type = 'region' and from_id like '99%') or (to_type = 'region' and to_id like '99%')
        or (from_type = 'article' and from_id = any($2::text[])) or (from_type = 'project' and from_id = any($3::text[]))`,
    [actors, articleIds, projectIds.map(String)],
  );
  const leftover = (await q("select id from public.projects where created_by = $1", [ACTOR_SYSTEM])).rows.map((r) => Number(r.id));
  const ids = [...new Set([...projectIds, ...leftover])];
  if (ids.length) {
    // 단계 기록은 추가만(append_only_guard) — 트리거를 끈 거래 안에서 지운다. 단계 기록의 원본 스냅샷도 함께
    const snaps = (await q("select snapshot_id from public.project_events where project_id = any($1::bigint[])", [ids])).rows.map((r) => Number(r.snapshot_id));
    await q("begin");
    try {
      await q("set local session_replication_role = replica");
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

/** 공개 지역 기사 — 발행일을 넣은 공개 행 */
async function reported(key, title, hours, over = {}) {
  const row = await one(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, editorial_field, public_question, region_codes, first_published_at)
     values ($1, $2, '시험용 지역 보도 요약입니다', 'local', 'reported_news', $3, $4, 'local_finance', '시험용 지역 재정은 어떻게 바뀌나', $5, $6) returning id, slug`,
    [`e2e-w4rl-${key}-${staff.run}`, title, over.status ?? "published", u.reporter.personId, [GU.code], over.status === "draft" ? null : hoursAgo(hours)],
  );
  staff.trackArticle(Number(row.id));
  fx[key] = { id: Number(row.id), slug: row.slug, title };
  return fx[key];
}

async function login(page, who) {
  await page.goto(`${base}/admin/login`);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "로그인" && !b.disabled));
  await page.fill("#login-email", who.email);
  await page.fill("#login-password", who.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((url) => url.pathname !== "/admin/login");
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
  for (const t of ["regions", "articles", "article_sources", "raw_snapshots", "projects", "project_events", "regional_links"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  const settings = Object.fromEntries((await db.query("select key, value from public.settings where key in ('feature_flags', 'project_types', 'project_stage_lists')")).rows.map((r) => [r.key, r.value]));
  assert.notEqual(settings.feature_flags.region_hubs, true, "시험 전 region_hubs는 꺼져 있어야 한다 (W4 2.4)");
  assert.deepEqual([settings.project_types, settings.project_stage_lists], [{}, {}], "사업 유형·단계 목록 씨앗 = 빈 값 (12장 #10)");

  u.admin = await staff.createUser({ label: "w4rl-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w4rl-editor", roles: ["editor"], person: { name: "시험용 연결 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "w4rl-reporter", roles: ["reporter"], person: { name: "시험용 연결 기자", roles: ["reporter"] } });
  u.adOps = await staff.createUser({ label: "w4rl-adops", roles: ["ad_ops"] });

  await db.query("insert into public.regions (code, level, name, slug) values ($1, 'sido', $2, $3)", [SIDO.code, SIDO.name, sidoSlug()]);
  await db.query("insert into public.regions (code, parent_code, level, name, slug) values ($1, $2, 'sigungu', $3, $4)", [GU.code, SIDO.code, GU.name, guSlug()]);
  await reported("FROM", "시험용 연결구 지방재정 보도", 1);
  await reported("T1", "시험용 연결구 세수 보도", 2);
  await reported("T2", "시험용 연결구 초안 보도", 3, { status: "draft" });
  const url = `${GOV}/${staff.run}/doc`;
  const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e-w4rl', $1, $2, '시험용 원본') returning id", [url, `sha256:w4rl-${staff.run}`]);
  fx.SRC = await one(
    `insert into public.article_sources (article_id, kind, title, source_url, source_name, last_verified_at, license_status, license_type, source_type, published_on, reference_date, region_unit, collected_at, snapshot_id)
     values ($1, 'official_doc', '시험용 연결구 세입 자료', $2, '시험용 연결구청', $3, '공공누리 제1유형', 'kogl_1', 'local_tax_revenue', '2026-09-01', '2026-08-31', '시·군·구', $4, $5) returning id`,
    [fx.T1.id, url, hoursAgo(30), hoursAgo(40), snap.id],
  );
  fx.SRC.url = url;

  // 시험용 사업 유형·단계 목록(관리자 설정 API) + 공개 프로젝트 1 (DB — 프로젝트 관리 화면은 14단계)
  assert.equal((await setSetting("project_types", { siheom_rl: { label: "시험용 사업" } })).status, 200);
  assert.equal((await setSetting("project_stage_lists", { siheom_rl: [{ key: "zone", label: "시험용 구역지정" }, { key: "done", label: "시험용 준공" }] })).status, 200);
  const p = await one("insert into public.projects (slug, name, region_code, project_type, created_by) values ($1, '시험용 연결 프로젝트', $2, 'siheom_rl', $3) returning id", [`siheom-rl-${staff.run}`, GU.code, ACTOR_SYSTEM]);
  projectIds.push(Number(p.id));
  const psnap = await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e-w4rl', $1, $2, '시험용 고시') returning id", [`${url}/notice`, `sha256:w4rl-p-${staff.run}`]);
  await db.query(
    "insert into public.project_events (project_id, kind, stage, notice_no, notice_date, issuer, source_url, snapshot_id, license_type, recorded_by) values ($1, 'stage', 'zone', '시험용 고시 제1호', '2026-01-15', '시험용 연결구청', $2, $3, 'kogl_1', $4)",
    [p.id, `${url}/notice`, psnap.id, ACTOR_SYSTEM],
  );
  await db.query("update public.projects set status = 'public', source_name = '시험용 연결구청', last_verified_at = now() where id = $1", [p.id]);
  fx.PROJECT = { id: Number(p.id) };

  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
  await expire();
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
        const s = Object.fromEntries((await c.query("select key, value from public.settings where key in ('feature_flags', 'project_types', 'project_stage_lists')")).rows.map((r) => [r.key, r.value]));
        assert.notEqual(s.feature_flags.region_hubs, true, "region_hubs 되돌림");
        assert.deepEqual([s.project_types, s.project_stage_lists], [{}, {}], "사업 유형·단계 목록 되돌림");
      } finally {
        await c.end();
      }
    }
  }
});

test("a) 같은 지역 자동 후보 — 프로젝트·지역 허브 후보 · 다시 0 · 후보는 편집 화면에만(공개 뷰 0행·기사 화면 자리 0)", async () => {
  const r = await links(u.editor, { op: "suggest", fromType: "article", fromId: fx.FROM.id });
  assert.equal(r.status, 200, show(r));
  assert.equal(r.body.created, 2, "같은 지역 공개 프로젝트 1 + 기사 지역 허브 1");
  assert.equal(await auditCount("regional_link.suggest", `regional_links:from:article:${fx.FROM.id}`, u.editor.id), 1, "감사 1건");
  assert.equal((await links(u.editor, { op: "suggest", fromType: "article", fromId: fx.FROM.id })).body.created, 0, "다시 돌려도 0");
  const board = await api("GET", `/regional-links?from=article:${fx.FROM.id}`, u.editor);
  assert.equal(board.status, 200, show(board));
  assert.deepEqual(board.body.candidates.map((l) => [l.to_type, l.to_id, l.origin, l.relation]).sort(), [
    ["project", String(fx.PROJECT.id), "auto_candidate", "same_region"],
    ["region", GU.code, "auto_candidate", "same_region"],
  ]);
  assert.ok(board.body.candidates.every((l) => l.to_public), "후보 도착 = 공개 대상만");
  fx.candRegion = board.body.candidates.find((l) => l.to_type === "region").id;
  fx.candProject = board.body.candidates.find((l) => l.to_type === "project").id;
  assert.equal((await api("GET", "/regional-links?from=attraction:1", u.editor)).status, 422, "모양이 틀린 from 422");
  assert.deepEqual(await publicRows(fx.FROM.id), [], "후보는 anon 공개 뷰 0행");
  const page = await get(`/news/${fx.FROM.slug}`);
  assert.equal(page.status, 200);
  assert.equal(linkPart(page.html), null, "확인된 연결 0 → 기사 화면에 자리 0(빈 자리 0)");
});

test("b) 관광 항목 종류 422(PRD-X) · 행사 422 · 확인 이유 없음 422 · 비공개 목적지 확인 409 · 같은 쌍 409", async () => {
  for (const t of ["attraction", "restaurant", "tour_item"]) {
    const r = await links(u.editor, { op: "create", fromType: "article", fromId: fx.FROM.id, toType: t, toId: "1", relation: "same_region" });
    assert.equal(r.status, 422, show(r));
    assert.ok(r.body.errors.some((e) => e.startsWith(`toType: 관광 항목 종류(${t})는 지역 연결에 저장하지 않습니다`) && e.includes("PRD-X")), show(r));
  }
  const fromTour = await links(u.editor, { op: "create", fromType: "attraction", fromId: "1", toType: "article", toId: fx.T1.id, relation: "same_region" });
  assert.equal(fromTour.status, 422, "출발이 관광 항목이어도 422");
  const event = await links(u.editor, { op: "create", fromType: "article", fromId: fx.FROM.id, toType: "local_event", toId: "1", relation: "related_event" });
  assert.equal(event.status, 422);
  assert.ok(event.body.errors.some((e) => e.includes("W6")), show(event));
  const noReason = await links(u.editor, { op: "create", fromType: "article", fromId: fx.FROM.id, toType: "article", toId: fx.T1.id, relation: "related_tax", confirm: true });
  assert.equal(noReason.status, 422);
  assert.ok(noReason.body.errors.some((e) => e.startsWith("reason: 확인 이유")), show(noReason));
  const confirmNoReason = await links(u.editor, { op: "confirm", linkId: fx.candRegion, reason: " " });
  assert.equal(confirmNoReason.status, 422, "후보 확인도 이유 필수");
  const priv = await links(u.editor, { op: "create", fromType: "article", fromId: fx.FROM.id, toType: "article", toId: fx.T2.id, relation: "related_tax", reason: "시험용 초안 연결", confirm: true });
  assert.equal(priv.status, 409, show(priv));
  assert.match(priv.body.error, /비공개 목적지\(article:\d+\)는 확인하지 않습니다/);
  assert.equal((await one("select count(*)::int n from public.regional_links where from_id = $1 and to_id = $2", [String(fx.FROM.id), String(fx.T2.id)])).n, 0, "거부된 확인은 행 0");
  const missing = await links(u.editor, { op: "create", fromType: "article", fromId: fx.FROM.id, toType: "article", toId: 999999999999, relation: "related_tax" });
  assert.equal(missing.status, 422, show(missing));
  const dup = await links(u.editor, { op: "create", fromType: "article", fromId: fx.FROM.id, toType: "region", toId: GU.code, relation: "same_region" });
  assert.equal(dup.status, 409, "자동 후보와 같은 쌍");
});

test("c) 확인 — 화면 폼으로 후보 확인 + 감사 · 만들며 확인 201 · 기사 화면 = 확인된 연결만·링크 200·원문 새 창 · 프로젝트 0 · 지역 허브는 region_hubs 켜짐일 때만", async () => {
  // 편집 책임자 화면 — 후보(지역 허브)를 폼으로 확인
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await login(page, u.editor);
  await page.goto(`${base}/admin/regions/links?from=article:${fx.FROM.id}`);
  const item = page.locator(`[data-testid="link-candidates"] li[data-link-id="${fx.candRegion}"]`);
  await item.waitFor();
  assert.equal(await page.locator('select option[value="attraction"], select option[value="restaurant"], select option[value="tour_item"]').count(), 0, "고르기 목록에 관광 항목 0");
  await page.waitForFunction(() => [...document.querySelectorAll('[data-form="regional-link-confirm"] button')].every((b) => !b.disabled));
  await item.locator(`#rl-reason-${fx.candRegion}`).fill("시험용 — 기사가 다룬 지역 허브");
  await item.getByRole("button", { name: "연결 확인" }).click();
  await page.locator(`[data-testid="link-confirmed"] li[data-link-id="${fx.candRegion}"]`).waitFor();
  await ctx.close();
  const confirmed = await one("select status, confirmed_by, reason from public.regional_links where id = $1", [fx.candRegion]);
  assert.deepEqual(confirmed, { status: "confirmed", confirmed_by: `user:${u.editor.id}`, reason: "시험용 — 기사가 다룬 지역 허브" });
  assert.equal(await auditCount("regional_link.confirm", `regional_links:${fx.candRegion}`, u.editor.id), 1, "확인 감사 1건");

  // 프로젝트 후보 확인(API) · 기사·공식 자료 만들며 확인
  assert.equal((await links(u.editor, { op: "confirm", linkId: fx.candProject, reason: "시험용 — 같은 구역 프로젝트", relation: "related_project" })).status, 200);
  const art = await links(u.editor, { op: "create", fromType: "article", fromId: fx.FROM.id, toType: "article", toId: fx.T1.id, relation: "related_tax", reason: "시험용 — 같은 세목", confirm: true });
  assert.equal(art.status, 201, show(art));
  fx.linkT1 = art.body.link.id;
  assert.equal(await auditCount("regional_link.confirm", `regional_links:${fx.linkT1}`, u.editor.id), 1);
  const src = await links(u.editor, { op: "create", fromType: "article", fromId: fx.FROM.id, toType: "official_source", toId: fx.SRC.id, relation: "related_policy", reason: "시험용 — 원문 확인", confirm: true });
  assert.equal(src.status, 201, show(src));

  // region_hubs 꺼짐 — 기사·공식 원문만 (지역 허브 0 · 프로젝트는 공개 화면 15단계 전 0)
  let part = linkPart((await get(`/news/${fx.FROM.slug}`)).html);
  assert.deepEqual(part.map((l) => [l.kind, decode(l.href)]), [
    ["article", `/news/${fx.T1.slug}`],
    ["official_source", fx.SRC.url],
  ]);
  assert.deepEqual([part[1].target, part[1].rel], ["_blank", "noopener noreferrer"], "공식 원문 새 창·noreferrer");
  assert.equal((await get(`/news/${fx.T1.slug}`)).status, 200, "기사 링크 200");
  assert.equal(part.filter((l) => l.kind === "project").length, 0, "프로젝트 링크 0");
  assert.deepEqual((await publicRows(fx.FROM.id)).map((r) => r.to_type).sort(), ["article", "official_source", "project"], "공개 뷰 — 지역 끝은 region_hubs 꺼짐이라 0");

  await hubs(true);
  try {
    part = linkPart((await get(`/news/${fx.FROM.slug}`)).html);
    assert.deepEqual(part.map((l) => l.kind), ["article", "official_source", "region"]);
    const hub = part.find((l) => l.kind === "region");
    assert.equal(hub.href, `/local/${sidoSlug()}/${guSlug()}`);
    for (const l of part.filter((x) => !x.target)) assert.equal((await get(decode(l.href))).status, 200, `${l.href} 200 (404 링크 0)`);
  } finally {
    await hubs(false);
  }
  assert.ok(!linkPart((await get(`/news/${fx.FROM.slug}`)).html).some((l) => l.kind === "region"), "꺼지면 다음 요청부터 지역 링크 0");
});

test("d) 목적지가 비공개가 되면 다음 렌더부터 링크 0 · 되돌리면 다시 · 지우기(이유 필수) → 0 + 감사", async () => {
  await db.query("update public.articles set status = 'draft' where id = $1", [fx.T1.id]);
  try {
    await expire();
    const part = linkPart((await get(`/news/${fx.FROM.slug}`)).html);
    assert.equal(part, null, "도착 기사 초안 → 그 기사와 그 기사의 공식 자료 링크 0 → 자리 0");
    const board = await api("GET", `/regional-links?from=article:${fx.FROM.id}`, u.editor);
    const row = board.body.confirmed.find((l) => l.id === fx.linkT1);
    assert.deepEqual([row.status, row.to_public], ["confirmed", false], "편집 화면에는 확인 기록 그대로 + 도착 비공개 표시");
  } finally {
    await db.query("update public.articles set status = 'published' where id = $1", [fx.T1.id]);
    await expire();
  }
  assert.deepEqual(linkPart((await get(`/news/${fx.FROM.slug}`)).html).map((l) => l.kind), ["article", "official_source"], "되돌리면 다음 렌더부터 다시");

  const noReason = await links(u.editor, { op: "remove", linkId: fx.linkT1 });
  assert.equal(noReason.status, 422);
  const removed = await links(u.editor, { op: "remove", linkId: fx.linkT1, reason: "시험용 — 다른 세목" });
  assert.equal(removed.status, 200, show(removed));
  assert.equal(await auditCount("regional_link.remove", `regional_links:${fx.linkT1}`, u.editor.id), 1);
  assert.deepEqual(linkPart((await get(`/news/${fx.FROM.slug}`)).html).map((l) => l.kind), ["official_source"], "지운 연결 → 다음 렌더부터 0");
  const again = await links(u.editor, { op: "confirm", linkId: fx.linkT1, reason: "되살리기" });
  assert.equal(again.status, 409, "지운 연결은 되살리지 않는다");
});

test("e) 권한 — 기자·광고 담당 API·화면 403 + 거부 감사 · 편집 책임자 판정판·기사 편집 화면 링크 · 메뉴 항목 그대로", async () => {
  for (const who of [u.reporter, u.adOps]) {
    const r = await links(who, { op: "create", fromType: "article", fromId: fx.FROM.id, toType: "article", toId: fx.T1.id, relation: "related_tax", reason: "x", confirm: true });
    assert.equal(r.status, 403, show(r));
    assert.equal(await auditCount("regional_link.confirm.denied", "regional_links:write", who.id), 1, "거부 감사 1건");
    assert.equal((await api("GET", "/regional-links", who)).status, 403);
  }
  for (const who of [u.reporter, u.adOps]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, who);
    const res = await page.goto(`${base}/admin/regions/links`);
    assert.equal(res.status(), 403, "화면 403");
    assert.equal(await page.locator('[data-form="regional-link-create"]').count(), 0);
    await ctx.close();
  }
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, u.editor);
  await page.goto(`${base}/admin/regions`);
  assert.equal(await page.locator('[data-testid="regional-links-link"]').getAttribute("href"), "/admin/regions/links");
  await page.goto(`${base}/admin/articles/${fx.FROM.id}`);
  assert.equal(await page.locator('[data-testid="regional-links-link"]').getAttribute("href"), `/admin/regions/links?from=article:${fx.FROM.id}`);
  await page.goto(`${base}/admin/regions/links`);
  assert.ok((await page.locator("nav a").allTextContents()).every((t) => t.trim() !== "지역 연결"), "관리 메뉴 항목은 늘리지 않았다 (판정판·기사 편집 화면에서 연다)");
  await page.goto(`${base}/admin/regions/links?t=article&n=${fx.FROM.id}`);
  assert.equal(await page.locator('[data-testid="link-from"]').getAttribute("data-from"), `article:${fx.FROM.id}`, "JS 없는 '보기' 폼 주소(t·n)도 같은 대상");
  await ctx.close();
});

test("f) 360·1280px 가로 넘침 0 (기사 화면·지역 연결 화면) · 접근성 95", async () => {
  for (const viewport of [
    { width: 360, height: 740 },
    { width: 1280, height: 800 },
  ]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.goto(`${base}/news/${fx.FROM.slug}`);
    assert.equal(await page.locator('[data-article-part="links"]').count(), 1);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `기사 화면 ${viewport.width}px 가로 넘침 0`);
    await login(page, u.editor);
    await page.goto(`${base}/admin/regions/links?from=article:${fx.FROM.id}`);
    await page.locator('[data-testid="link-confirmed"]').waitFor();
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `지역 연결 화면 ${viewport.width}px 가로 넘침 0`);
    await ctx.close();
  }
  const r = await accessibility(`${base}/news/${fx.FROM.slug}`, debugPort);
  assert.ok(r.score >= A11Y_MIN, `기사 화면 접근성 ${r.score} — ${r.failing.join(", ")}`);
});
