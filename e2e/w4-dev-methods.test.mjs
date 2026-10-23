// 개발방법 비교 화면 E2E (W4 19단계 — docs/dev/W4_설계.md 1장 19단계 · 2.4 · 2.12 · 5장 · 6장 · 12장 #163~, PRD-01B PR-09 · PR-10 · PR-11).
// standalone 빌드를 로컬 Supabase에 붙인다. 방법 7행은 마이그레이션 씨앗(이름·slug·종류·순서만)이고, 시험이 넣는 글·숫자 요건 값은 모두 '시험용' 가짜다(실제 요건 값·법령 조건 0).
//  a) 기능 키 dev_methods 꺼짐 — 목록 = 하위 분야 목록(비교표 0) · 방법 상세 404 · 부동산 허브에 방법 상세 링크 0
//  b) 관리 화면 — 편집 책임자 메뉴 '개발방법 비교' · 폼으로 방법 내용·숫자 요건 첫 판 저장 + 감사 · 감수위원 화면 버튼으로 서명 + 감사 · 준비 현황 · 기자 403 · 나머지 방법은 API로 채우고 서명 → 키 켜기
//  c) 공개 비교표 — 7개 고정 편집 순서 · 신속통합기획 '계획 지원 절차' 칩 · 강조 문단 '추천하거나 판정하지 않습니다' · 입력 폼·점수·순위·추천 배지·정렬 요소 0 · 숫자 요건 값 옆 기준일·감수자(고정폭) ·
//     화면 숫자는 전부 서명된 DB 값(고정 문구 숫자 0) · 구조화 데이터 BreadcrumbList만
//  d) 방법 상세 — 절차 단계 순서 · 박스 없으면 자리 0 · 관련 프로젝트 링크(사업 유형이 같은 공개 프로젝트, 없으면 줄째 0 · 신속통합기획 0) · 관련 기사 없으면 줄째 0 · 칸 하나 고치면 그 방법만 빠짐
//  e) 360·1280px 가로 넘침 0 · 360px 방법별 탭 · R1~R3 · 접근성 95 · 키를 끄면 다시 하위 분야 목록
// 만든 계정·프로젝트·지역·방법 내용은 끝나면 지우고 방법 7행은 씨앗 상태로, 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { measurePage } from "./lib/screen-rules.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-dev-methods-ui-e2e@example.test";
const SITE = "https://e2e.example.test";
const SLUGS = ["redevelopment", "reconstruction", "small-scale", "public", "trust", "renewal", "rapid-planning"];
const NAMES = ["재개발", "재건축", "소규모정비", "공공 방식", "신탁방식", "재정비", "신속통합기획"];
const ITEMS = ["legal_basis", "actor", "target", "procedure", "numeric_requirements", "tax_issues"];
const ITEM_LABELS = ["근거 법령", "사업 주체", "대상", "주요 절차", "숫자 요건", "지방세 쟁점"];
const GOV = "https://gov.example.test/w4dmui";
const SIDO = { code: "9900000000", name: "시험용 방법도", key: "bangbeopdo" };
const GU = { code: "9901100000", name: "시험용 방법구", key: "bangbeopgu" };
const ACTOR = "migration:e2e-w4dmui";
const FACT_VALUE = "99";
const FACT_DATE = "2026-10-01";

let sb, server, staff, db, browser, base, debugPort;
const u = {};
const fx = {};
const counts0 = {};

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body ?? r.html?.slice(0, 300)).slice(0, 700);
async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const post = (user, body) => api("POST", "/dev-methods", user, body);
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
const auditCount = (action, targetLike, actorId) =>
  one("select count(*)::int n from public.audit_logs where action = $1 and target like $2 and actor = $3 and at >= $4", [action, targetLike, `user:${actorId}`, staff.startedAt]).then((r) => r.n);
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => [JSON.parse(m[1])].flat());
const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
const sidoSlug = () => `${SIDO.key}-${staff.run}`;
const guSlug = () => `${GU.key}-${staff.run}-gu`;

/** 서명 뒤 화면이 새로 그려지며 버튼이 사라지므로 메시지 대신 DB 값을 기다린다 */
async function until(sql) {
  for (let i = 0; i < 50; i++) {
    if ((await db.query(sql)).rowCount > 0) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.fail(`기다린 조건이 되지 않았습니다: ${sql}`);
}

async function login(page, who) {
  await page.goto(`${base}/admin/login`);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "로그인" && !b.disabled));
  await page.fill("#login-email", who.email);
  await page.fill("#login-password", who.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((url) => url.pathname !== "/admin/login");
}

async function resetDevMethods(q) {
  const snaps = (await q("select snapshot_id from public.dev_method_facts")).rows.map((r) => Number(r.snapshot_id));
  await q("begin");
  try {
    await q("set local session_replication_role = replica");
    await q("delete from public.source_review_queue where target_type = 'dev_method_fact'");
    await q("delete from public.dev_method_facts");
    await q("delete from public.dev_method_compare");
    await q("update public.dev_methods set legal_basis_name = null, summary = null, steps = null, lens = null, drafted_by = null, drafted_at = null, reviewed_by = null, reviewed_at = null, review_status = 'draft'");
    if (snaps.length) await q("delete from public.raw_snapshots where id = any($1::bigint[])", [snaps]);
    await q("commit");
  } catch (err) {
    await q("rollback");
    throw err;
  }
}
async function removeProjects(q) {
  const ids = (await q("select id from public.projects where created_by = $1", [ACTOR])).rows.map((r) => Number(r.id));
  if (!ids.length) return;
  const snaps = (await q("select snapshot_id from public.project_events where project_id = any($1::bigint[]) and snapshot_id is not null", [ids])).rows.map((r) => Number(r.snapshot_id));
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
  await removeProjects((sql, params) => db.query(sql, params));
  await removeRegions((sql, params) => db.query(sql, params));
  await staff.snapshotOperations();
  for (const t of ["dev_method_compare", "dev_method_facts", "raw_snapshots", "source_review_queue", "projects", "project_events", "regions"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  assert.equal(counts0.dev_method_compare + counts0.dev_method_facts, 0, "시험 전 비교 항목·사실 행 0 — 내용은 편집국이 적는다 (12장 #15)");
  const s = (await one("select value from public.settings where key = 'feature_flags'")).value;
  assert.equal(s.dev_methods, false, "시험 전 dev_methods 꺼짐 (2.4 씨앗)");

  u.admin = await staff.createUser({ label: "w4dmui-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w4dmui-editor", roles: ["editor"], person: { name: "시험용 방법 편집자", roles: ["editor"] } });
  u.reviewer = await staff.createUser({ label: "w4dmui-reviewer", roles: ["reviewer"], person: { name: "시험용 방법 감수위원", roles: ["reviewer"] } });
  u.reporter = await staff.createUser({ label: "w4dmui-reporter", roles: ["reporter"], person: { name: "시험용 방법 기자", roles: ["reporter"] } });

  // 시험용 지역 + 신탁 사업 유형의 공개 프로젝트 1건 (관련 프로젝트 링크 시험)
  await db.query("insert into public.regions (code, level, name, slug) values ($1, 'sido', $2, $3)", [SIDO.code, SIDO.name, sidoSlug()]);
  await db.query("insert into public.regions (code, parent_code, level, name, slug) values ($1, $2, 'sigungu', $3, $4)", [GU.code, SIDO.code, GU.name, guSlug()]);
  assert.equal((await setSetting("project_types", { trust: { label: "시험용 신탁 정비" } })).status, 200);
  assert.equal((await setSetting("project_stage_lists", { trust: [{ key: "zone", label: "시험용 구역지정" }, { key: "done", label: "시험용 준공" }] })).status, 200);
  const p = await one("insert into public.projects (slug, name, region_code, project_type, created_by) values ($1, '시험용 신탁 하늘구역', $2, 'trust', $3) returning id, slug", [`siheom-dm-p-${staff.run}`, GU.code, ACTOR]);
  const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e-w4dmui', $1, $2, '시험용 고시 원문') returning id", [`${GOV}/${staff.run}/zone`, `sha256:w4dmui-${staff.run}`]);
  await db.query(
    "insert into public.project_events (project_id, kind, stage, notice_no, notice_date, issuer, source_url, snapshot_id, license_type, recorded_by) values ($1, 'stage', 'zone', $2, '2026-01-15', '시험용 방법구청', $3, $4, 'kogl_1', $5)",
    [p.id, `시험용 고시 제${staff.run}-1호`, `${GOV}/${staff.run}/zone`, snap.id, ACTOR],
  );
  await db.query("update public.projects set status = 'public', source_name = '시험용 방법구청', last_verified_at = $2 where id = $1", [p.id, "2026-10-20T03:00:00Z"]);
  fx.P = { id: Number(p.id), href: `/realestate/projects/${p.slug}` };

  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
  await flags({ realestate_projects: true });
});

after(async () => {
  try {
    await browser?.close();
    if (db) {
      await resetDevMethods((sql, params) => db.query(sql, params));
      await removeProjects((sql, params) => db.query(sql, params));
    }
    await staff?.cleanup(); // 계정·감사 로그 지우기 + 운영 설정(기능 키·사업 유형·단계 목록) 되돌리기
  } finally {
    server?.stop();
    if (sb && Object.keys(counts0).length) {
      const c = new pg.Client({ connectionString: sb.dbUrl });
      await c.connect();
      try {
        await removeRegions((sql, params) => c.query(sql, params));
        for (const t of Object.keys(counts0)) assert.equal((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n, counts0[t], `정리 뒤 ${t} 행 수 = 시험 전`);
        const s = (await c.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
        assert.equal(s.dev_methods, false, "dev_methods 되돌림");
        const left = (await c.query("select count(*)::int n from public.dev_methods where summary is not null or reviewed_by is not null or review_status <> 'draft'")).rows[0].n;
        assert.equal(left, 0, "방법 7행 씨앗 상태");
      } finally {
        await c.end();
      }
    }
  }
});

test("a) 기능 키 꺼짐 — 목록 = 하위 분야 목록(비교표 0) · 방법 상세 404 · 부동산 허브에 방법 상세 링크 0", async () => {
  const list = await get("/realestate/development-methods");
  assert.equal(list.status, 200);
  assert.ok(list.html.includes('data-ui="category-list"'), "하위 분야 목록으로 보인다");
  assert.ok(!list.html.includes('data-ui="dev-method-comparison"') && !list.html.includes('data-ui="dev-methods-list"'));
  for (const slug of SLUGS) assert.equal((await get(`/realestate/development-methods/${slug}`)).status, 404, `${slug} 상세 404`);
  assert.equal((await get("/realestate/development-methods/not-a-method")).status, 404);
  for (const p of ["/realestate", "/realestate/development-methods", fx.P.href]) {
    const page = await get(p);
    assert.deepEqual(hrefs(page.html).filter((h) => h.startsWith("/realestate/development-methods/")), [], `${p}: 방법 상세 링크 0`);
  }
});

test("b) 관리 화면 — 메뉴 · 폼으로 방법 내용·숫자 요건 첫 판 + 감사 · 감수위원 서명 + 감사 · 준비 현황 · 기자 403 · 나머지는 API로 채우고 서명 → 키 켜기", async () => {
  const denied = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dp = await denied.newPage();
  try {
    await login(dp, u.reporter);
    const res = await dp.goto(`${base}/admin/dev-methods`);
    assert.equal(res.status(), 403, "기자는 화면 403");
  } finally {
    await denied.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    await login(page, u.editor);
    await page.goto(`${base}/admin/dev-methods`);
    assert.ok((await page.locator("nav a", { hasText: "개발방법 비교" }).count()) >= 1, "편집 책임자 메뉴 '개발방법 비교'");
    assert.equal(await page.locator('[data-testid="dev-readiness"] li').count(), 7, "준비 현황 7줄");
    assert.deepEqual(await page.$$eval('[data-testid="dev-readiness"] li', (l) => l.map((x) => x.getAttribute("data-method"))), SLUGS, "고정 순서");
    assert.deepEqual(await page.$$eval('[data-testid="dev-readiness"] li', (l) => l.map((x) => x.getAttribute("data-ready"))), SLUGS.map(() => "false"), "씨앗은 모두 준비 전");
    // 점수·순위·추천 입력 요소 0
    const inputs = await page.evaluate(() => [...document.querySelectorAll("main input, main select, main textarea")].map((el) => `${el.id} ${el.getAttribute("name") ?? ""} ${el.labels?.[0]?.textContent ?? ""}`));
    assert.ok(inputs.length > 0);
    assert.deepEqual(inputs.filter((t) => /score|rank|rating|grade|recommend|best|점수|순위|등급|추천|유리/i.test(t)), [], "점수·순위·추천 입력 요소 0");

    // 방법 내용 — 재개발 (폼)
    await page.locator('#dev-method-redevelopment summary', { hasText: "내용 적기·고치기" }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-form="dev-method"] button[type="submit"]')].every((b) => !b.disabled));
    await page.fill("#dm-redevelopment-legal", "시험용 재개발 근거 법령");
    await page.fill("#dm-redevelopment-summary", "시험용 재개발 한 줄 설명");
    await page.fill("#dm-redevelopment-steps", "시험용 구역 지정\n시험용 조합 설립\n시험용 준공");
    await page.locator('#dev-method-redevelopment [data-form="dev-method"] button[type="submit"]').click();
    await page.waitForSelector("text=방법 내용을 저장했습니다");
    const m = await one("select summary, steps, review_status, drafted_by from public.dev_methods where slug = 'redevelopment'");
    assert.deepEqual([m.summary, m.steps, m.review_status, m.drafted_by], ["시험용 재개발 한 줄 설명", ["시험용 구역 지정", "시험용 조합 설립", "시험용 준공"], "draft", `user:${u.editor.id}`]);
    assert.equal(await auditCount("dev_method.edit", "dev_methods:redevelopment%", u.editor.id), 1, "감사 dev_method.edit 1건");

    // 금지 표현은 칸 옆 오류 (서버 422)
    await page.fill("#dm-redevelopment-summary", "시험용 방식이 유리합니다");
    await page.locator('#dev-method-redevelopment [data-form="dev-method"] button[type="submit"]').click();
    await page.waitForSelector("text=summary");
    assert.equal((await one("select summary from public.dev_methods where slug = 'redevelopment'")).summary, "시험용 재개발 한 줄 설명", "거부된 저장은 값을 바꾸지 않는다");

    // 숫자 요건 첫 판 — 신탁 (폼) : 기준일·근거 조문·원문 필수
    await page.locator('#dev-method-trust summary', { hasText: "숫자 요건 첫 판 적기" }).click();
    for (const [id, v] of [
      ["df-trust-new-key", "siheom_req"],
      ["df-trust-new-label", "시험용 요건"],
      ["df-trust-new-value", FACT_VALUE],
      ["df-trust-new-unit", "시험단위"],
      ["df-trust-new-law", "시험용 조문 제가조"],
      ["df-trust-new-date", FACT_DATE],
      ["df-trust-new-url", `${GOV}/${staff.run}/law`],
      ["df-trust-new-payload", `시험용 근거 원문 ${staff.run}`],
    ]) await page.fill(`#${id}`, v);
    await page.locator('#dev-method-trust [data-form="dev-fact-new"] button[type="submit"]').click();
    await page.waitForSelector("text=첫 판을 저장했습니다");
    const f = await one("select id, version, reviewed_by, reference_date::text rd from public.dev_method_facts where fact_key = 'siheom_req'");
    assert.deepEqual([f.version, f.reviewed_by, f.rd], [1, null, FACT_DATE]);
    fx.factId = Number(f.id);
    assert.equal(await auditCount("dev_method_fact.edit", `dev_method_facts:${fx.factId}`, u.editor.id), 1, "감사 dev_method_fact.edit 1건");
    // 편집 책임자 화면에는 서명 버튼 0
    await page.reload();
    assert.equal(await page.locator('[data-form="dev-sign"]').count(), 0, "편집 책임자 화면에 서명 버튼 0");
  } finally {
    await ctx.close();
  }

  // 나머지 비교 항목은 API로 (편집 책임자) — 재개발 6칸 + 나머지 6개 방법의 내용·6칸
  for (const slug of SLUGS) {
    if (slug !== "redevelopment") {
      const r = await post(u.editor, { op: "method", slug, legal_basis_name: `시험용 ${slug} 근거 법령`, summary: `시험용 ${slug} 한 줄 설명`, steps: ["시험용 첫 단계", "시험용 둘째 단계"] });
      assert.equal(r.status, 200, show(r));
    }
    for (const item of ITEMS) {
      const c = await post(u.editor, { op: "compare", slug, item, body: `시험용 ${slug} ${item} 글` });
      assert.ok([200, 201].includes(c.status), show(c));
    }
  }

  // 숫자 요건이 비는 방법은 비교표에서 열째 빠진다(PR-10) — 나머지 방법에도 시험용 사실 행을 하나씩
  for (const slug of SLUGS.filter((x) => x !== "trust")) {
    const r = await post(u.editor, {
      op: "fact", slug, fact_key: "siheom_req", label: `시험용 ${slug} 요건`, value: FACT_VALUE, unit: "시험단위", law_ref: `시험용 ${slug} 조문`,
      reference_date: FACT_DATE, source_url: `${GOV}/${staff.run}/law-${slug}`, snapshot_payload: `시험용 ${slug} 근거 원문 ${staff.run}`,
    });
    assert.equal(r.status, 201, show(r));
  }

  // 감수위원 화면 — 재개발 방법 내용·숫자 요건 서명 버튼 (화면 클릭)
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const rp = await rctx.newPage();
  try {
    await login(rp, u.reviewer);
    await rp.goto(`${base}/admin/dev-methods`);
    assert.ok((await rp.locator("nav a", { hasText: "개발방법 비교" }).count()) >= 1, "감수위원 메뉴 '개발방법 비교'");
    assert.equal(await rp.locator('[data-form="dev-method"]').count(), 0, "감수위원 화면에 초안 폼 0");
    await rp.waitForFunction(() => [...document.querySelectorAll('[data-form="dev-sign"] button')].every((b) => !b.disabled));
    await rp.getByRole("button", { name: "재개발 방법 내용 서명" }).click();
    await until("select review_status from public.dev_methods where slug = 'redevelopment' and review_status = 'reviewed'");
    assert.equal((await one("select review_status from public.dev_methods where slug = 'redevelopment'")).review_status, "reviewed");
    assert.equal(await auditCount("dev_method.review", "dev_methods:redevelopment%", u.reviewer.id), 1, "감사 dev_method.review 1건");
    await rp.reload();
    await rp.waitForFunction(() => [...document.querySelectorAll('[data-form="dev-sign"] button')].every((b) => !b.disabled));
    await rp.getByRole("button", { name: "시험용 요건 서명" }).click();
    await until(`select 1 from public.dev_method_facts where id = ${fx.factId} and reviewed_by is not null`);
    assert.notEqual((await one("select reviewed_by from public.dev_method_facts where id = $1", [fx.factId])).reviewed_by, null);
  } finally {
    await rctx.close();
  }
  // 나머지 서명 (API — 감수위원)
  const board = (await api("GET", "/dev-methods", u.reviewer)).body;
  for (const m of board.methods) {
    for (const c of m.compare) if (c.row && c.row.review_status !== "reviewed") assert.equal((await post(u.reviewer, { op: "review", target: "compare", slug: m.slug, item: c.item, drafted_at: c.row.drafted_at })).status, 200);
    if (m.review_status !== "reviewed") assert.equal((await post(u.reviewer, { op: "review", target: "method", slug: m.slug, drafted_at: m.drafted_at })).status, 200);
  }
  for (const m of (await api("GET", "/dev-methods", u.reviewer)).body.methods) {
    for (const g of m.facts) if (!g.latest.reviewed_by) assert.equal((await post(u.reviewer, { op: "review", target: "fact", slug: m.slug, fact_id: g.latest.id })).status, 200);
  }
  await flags({ dev_methods: true, realestate_projects: true });
  assert.ok((await api("GET", "/dev-methods", u.editor)).body.methods.every((m) => m.readiness.ready), "7개 모두 공개 준비");
});

test("c) 공개 비교표 — 7개 고정 순서·칩·강조 문단 · 폼·점수·순위·추천·정렬 요소 0 · 숫자 요건 옆 기준일·감수자 · 화면 숫자는 서명된 DB 값뿐 · BreadcrumbList만", async () => {
  const page0 = await get("/realestate/development-methods");
  assert.equal(page0.status, 200);
  assert.ok(page0.html.includes('data-ui="dev-methods-list"') && !page0.html.includes('data-ui="category-list"'));
  assert.deepEqual(jsonLd(page0.html).map((j) => j["@type"]), ["BreadcrumbList"], "BreadcrumbList만");

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}/realestate/development-methods`);
    const cmp = page.locator('[data-ui="dev-method-comparison"]');
    assert.deepEqual(await cmp.locator("table thead th").allTextContents(), ["비교 항목", ...NAMES.map((n, i) => (i === 6 ? `${n}계획 지원 절차` : n))], "7개 고정 편집 순서 + 칩");
    assert.deepEqual(await cmp.locator("table tbody th").allTextContents(), ITEM_LABELS, "비교 항목 6행");
    assert.ok((await cmp.locator('[data-ui="callout"]').first().textContent()).includes("추천하거나 판정하지 않습니다"));
    assert.equal(await cmp.locator("form, input, select, textarea, meter, progress, [aria-sort], th button, th a[href*='sort']").count(), 0, "입력·점수·정렬 요소 0");
    const notCallout = (await cmp.evaluate((el) => { const c = el.cloneNode(true); c.querySelectorAll('[data-ui="callout"]').forEach((x) => x.remove()); return c.textContent; }));
    assert.doesNotMatch(notCallout, /추천|점수|순위|적합|유리|맞는 방법/, "추천·점수·순위 낱말 0");
    // 숫자 요건 — 값·단위 + 근거 조문·기준일·감수자 고정폭
    assert.equal(await cmp.locator("table td span.font-mono", { hasText: "기준일" }).count(), 7, "방법마다 숫자 요건 옆 기준일·감수자");
    const meta = cmp.locator("table td span.font-mono", { hasText: "시험용 조문 제가조" });
    assert.equal(await meta.count(), 1);
    assert.equal(await meta.textContent(), `시험용 조문 제가조 · 기준일 ${FACT_DATE} · 감수 시험용 방법 감수위원`);
    assert.ok((await cmp.locator("table td", { hasText: `${FACT_VALUE}시험단위` }).count()) >= 1);
    // 상세 링크 7개 (고정 순서)
    assert.deepEqual(
      await cmp.locator("table thead th a").evaluateAll((as) => as.map((a) => a.getAttribute("href"))),
      SLUGS.map((s) => `/realestate/development-methods/${s}`),
    );
    // 화면 숫자는 전부 서명된 DB 값 — 날짜·요건 값을 빼면 숫자가 남지 않는다
    const text = await page.locator('[data-ui="dev-methods-list"]').evaluate((el) => { const c = el.cloneNode(true); c.querySelectorAll("script").forEach((x) => x.remove()); return c.textContent; });
    const rest = text.replaceAll(FACT_DATE, "").replaceAll(FACT_VALUE, "").replace(/\d{4}-\d{2}-\d{2}/g, "");
    assert.doesNotMatch(rest, /\d/, `고정 문구 숫자 0 — ${rest.match(/.{0,12}\d.{0,12}/)?.[0]}`);
    const rv = await page.locator('[data-part="review-line"]').textContent();
    assert.match(rv, /^감수 시험용 방법 감수위원 · 감수일 \d{4}-\d{2}-\d{2}$/);
  } finally {
    await ctx.close();
  }
});

test("d) 방법 상세 — 절차 순서 · 박스 없으면 0 · 관련 프로젝트(신탁만) · 기사 없으면 줄째 0 · 신속통합기획 칩 · 칸 하나 고치면 그 방법만 빠짐", async () => {
  const redev = await get("/realestate/development-methods/redevelopment");
  assert.equal(redev.status, 200);
  const steps = [...redev.html.matchAll(/<li[^>]*><span[^>]*>(\d+)<\/span><span[^>]*>([^<]+)<\/span><\/li>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(steps, [["1", "시험용 구역 지정"], ["2", "시험용 조합 설립"], ["3", "시험용 준공"]], "절차 단계 순서");
  assert.ok(redev.html.includes("시험용 재개발 한 줄 설명") && redev.html.includes("시험용 재개발 근거 법령"));
  assert.ok(!redev.html.includes("data-method-lens"), "박스(서명본)가 없으면 요소 0");
  assert.ok(!redev.html.includes('data-dev-method-part="projects"') && !redev.html.includes('data-dev-method-part="articles"'), "관련 프로젝트·기사 없으면 줄째 0");
  assert.deepEqual(jsonLd(redev.html).map((j) => j["@type"]), ["BreadcrumbList"]);
  assert.equal([...redev.html.matchAll(/<nav aria-label="다른 개발방법">[\s\S]*?<\/nav>/g)].length, 1);
  assert.deepEqual(
    [...(redev.html.match(/<nav aria-label="다른 개발방법">[\s\S]*?<\/nav>/)?.[0] ?? "").matchAll(/href="([^"]+)"/g)].map((m) => m[1]),
    SLUGS.filter((s) => s !== "redevelopment").map((s) => `/realestate/development-methods/${s}`),
    "다른 방법 링크는 고정 순서",
  );

  const trust = await get("/realestate/development-methods/trust");
  assert.equal(trust.status, 200);
  assert.ok(trust.html.includes('data-dev-method-part="projects"'), "신탁방식 — 사업 유형이 같은 공개 프로젝트");
  assert.ok(hrefs(trust.html).includes(fx.P.href), "관련 프로젝트 링크");
  assert.ok(!trust.html.includes('data-dev-method-part="articles"'), "연결된 기사가 없으면 줄째 0");

  const rapid = await get("/realestate/development-methods/rapid-planning");
  assert.equal(rapid.status, 200);
  assert.ok(rapid.html.includes("계획 지원 절차"), "신속통합기획 칩");
  assert.ok(!rapid.html.includes('data-dev-method-part="projects"'), "신속통합기획은 사업 유형이 아니라 관련 프로젝트 0");

  // 칸 하나 고치면 서명이 지워져 그 방법만 공개에서 빠진다 (키는 켜진 채)
  assert.equal((await post(u.editor, { op: "compare", slug: "renewal", item: "procedure", body: "시험용 고친 절차 글" })).status, 200);
  assert.equal((await get("/realestate/development-methods/renewal")).status, 404);
  const list = await get("/realestate/development-methods");
  assert.ok(!list.html.includes("/realestate/development-methods/renewal"));
  assert.equal((list.html.match(/data-method-count="(\d+)"/) ?? [])[1], "6");
  assert.equal((await get("/realestate/development-methods/trust")).status, 200);
  // 다시 서명하면 돌아온다
  const row = (await api("GET", "/dev-methods", u.reviewer)).body.methods.find((m) => m.slug === "renewal").compare.find((c) => c.item === "procedure").row;
  assert.equal((await post(u.reviewer, { op: "review", target: "compare", slug: "renewal", item: "procedure", drafted_at: row.drafted_at })).status, 200);
  assert.equal((await get("/realestate/development-methods/renewal")).status, 200);
});

test("e) 360·1280px 가로 넘침 0 · 360px 방법별 탭 · R1~R3 · 접근성 95 · 키를 끄면 다시 하위 분야 목록", async () => {
  const pages = ["/realestate/development-methods", "/realestate/development-methods/trust", "/realestate/development-methods/rapid-planning"];
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
      await page.goto(`${base}/realestate/development-methods`);
      if (viewport.width === 360) {
        assert.equal(await page.locator("[data-dev-method-tabs]").isVisible(), true, "360px 방법별 탭");
        assert.equal(await page.locator("table").first().isVisible(), false, "360px 표 숨김");
        assert.deepEqual(await page.getByRole("tab").allTextContents(), NAMES, "탭도 고정 순서");
        await page.getByRole("tab", { name: "신탁방식" }).click();
        const panel = page.getByRole("tabpanel");
        assert.ok((await panel.textContent()).includes("시험용 trust legal_basis 글"));
        assert.ok(!(await panel.textContent()).includes("시험용 public legal_basis 글"));
        assert.ok((await panel.textContent()).includes(`기준일 ${FACT_DATE} · 감수 시험용 방법 감수위원`));
        const small = await page.$$eval('main nav[aria-label="현재 위치"] a, main [role="tab"]', (as) => as.map((a) => ({ t: a.textContent, ...a.getBoundingClientRect().toJSON() })).filter((r) => r.width > 0 && r.height > 0 && r.height < 44));
        assert.deepEqual(small, [], "360px 터치 44px");
      } else {
        assert.equal(await page.locator("table").first().isVisible(), true, "1280px 비교표");
        assert.equal(await page.locator("[data-dev-method-tabs]").isVisible(), false);
      }
    } finally {
      await ctx.close();
    }
  }
  for (const p of pages.slice(0, 2)) {
    for (const width of [360, 640, 1024]) {
      const r = await measurePage(browser, `${base}${p}`, { width, height: 740 });
      if (width === 360) assert.ok(r.r1.pass, `${p} ${width}px R1 ${r.r1.chars}자 > 150`);
      assert.ok(r.r2.pass, `${p} ${width}px R2 주 버튼 ${r.r2.maxPerViewport}개`);
      assert.ok(r.r3.pass, `${p} ${width}px R3 오렌지 ${r.r3.ratio}`);
    }
    const a = await accessibility(`${base}${p}`, debugPort);
    assert.ok(a.score >= A11Y_MIN, `${p} 접근성 ${a.score} — ${a.failing.join(", ")}`);
  }
  // 관리 화면 접근성
  const actx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ap = await actx.newPage();
  try {
    await login(ap, u.editor);
    await ap.goto(`${base}/admin/dev-methods`);
    assert.equal(await ap.locator('[data-testid="dev-readiness"] li[data-ready="true"]').count(), 7);
    assert.ok((await ap.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, "관리 화면 1280px 가로 넘침 0");
  } finally {
    await actx.close();
  }
  await flags({ dev_methods: false });
  const off = await get("/realestate/development-methods");
  assert.ok(off.html.includes('data-ui="category-list"') && !off.html.includes('data-ui="dev-method-comparison"'), "키를 끄면 하위 분야 목록");
  assert.equal((await get("/realestate/development-methods/trust")).status, 404);
});
