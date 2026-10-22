// 프로젝트 관리 화면 E2E (W4 14단계 — docs/dev/W4_설계.md 1장 14단계 · 4장 `/api/admin/projects` · 5장 `/admin/projects` · 6장 · 12장 #110~, PRD-01B PR-02 · PR-03 · PR-05 · REG1-10).
// standalone 빌드를 로컬 Supabase에 붙인다. 시험용 지역은 법정동코드에 없는 접두 99 가짜 코드와 '시험용' 이름이다(설계 8장).
// 사업 유형·단계 목록 씨앗은 빈 값(12장 #10) — 시험이 관리자 설정 API로 시험용 목록을 넣고 끝나면 되돌린다.
//  a) 빈 사업 유형 목록 — 화면 안내('사업 유형 목록이 아직 없습니다')·만들기 폼 0 · API 만들기 422(project_type 칸) · 행 0
//  b) 만들기 — 화면 폼으로 초안 + 감사 project.create 1건 · 칸별 422(주소·이름·지역·유형 / 오늘 유효하지 않은 지역 / 가격 칸 이름) · 같은 주소 409
//  c) 단계 기록 — 고시 6칸 칸별 422(고시 번호·고시일·고시 기관·원문·스냅샷·공공누리)·목록 밖 단계 422 · 화면에서 빠진 칸 옆 오류 → 채워 기록 + 원본 스냅샷(sha256) + 감사 ·
//     앞 순서·같은 단계 422 · 해당 없음(사유) · 메모 숫자 + 원 → 저장 + 경고
//  d) 정정 — 사유 없음 422 · 화면 폼 거두기 + 감사 project.correct_event · 같은 기록 두 번 422 · 현재 단계가 다음 읽기부터 바뀜
//  e) 공개 — 조건 미달 칸별 422(데이터 출처·확인일) + 화면 사유 목록 · 화면 폼으로 공개 → anon 공개 뷰 1행 + 감사 project.publish · 내리기 → 0행 · 다시 내리기 409
//  f) 지역 연결(op=link — 13단계와 같은 작업) — 같은 지역 후보·확인 + 감사 · 다른 대상의 연결 번호 404 · 지역 연결 화면의 프로젝트 끝 = 이 화면 주소
//  g) 권한 — 기자·광고·브랜드 담당 API·화면 403 + 거부 감사 project.manage.denied · 메뉴 '프로젝트'는 편집 책임자·관리자만
//  h) 가격·분담금·수익률 입력 요소 0(설계 2.10 사전으로 두 화면의 입력·고르기·글상자 칸 이름·id·라벨 전수) · API 응답 칸 이름 0 · 360·1280px 가로 넘침 0
// 만든 계정·지역·기사·프로젝트·단계 기록·스냅샷·연결은 끝나면 지우고, 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";
import { PRICE_WORDS, priceWordsIn } from "../packages/db/scripts/check-price-fields.mjs";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-projects-admin-e2e@example.test";
const SITE = "https://e2e.example.test";
const SIDO = { code: "9900000000", name: "시험용 사업도", key: "saeopdo" };
const GU = { code: "9901100000", name: "시험용 사업구", key: "saeopgu" };
const OLD = { code: "9901200000", name: "시험용 폐지구", key: "pyejigu" };
const GOV = "https://gov.example.test/w4pa";
const TYPE = "siheom_pa";
const STAGES = [
  { key: "zone", label: "시험용 구역지정" },
  { key: "plan", label: "시험용 계획인가" },
  { key: "done", label: "시험용 준공" },
];

let sb, server, staff, db, browser, base;
const u = {};
const fx = {};
const counts0 = {};

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body).slice(0, 700);
const errorFields = (r) => [...new Set((r.body.errors ?? []).map((e) => e.split(":")[0]))].sort();

async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const projects = (user, body) => api("POST", "/projects", user, body);
const setSetting = (key, value) => api("PATCH", `/settings/${key}`, u.admin, { value });
const auditCount = (action, target, actorId) =>
  one("select count(*)::int n from public.audit_logs where action = $1 and target = $2 and actor = $3 and at >= $4", [action, target, `user:${actorId}`, staff.startedAt]).then((r) => r.n);
const notice = (over = {}) => ({
  notice_no: `시험용 고시 제${staff.run}-1호`,
  notice_date: "2026-01-15",
  issuer: "시험용 사업구청",
  source_url: `${GOV}/${staff.run}/zone`,
  snapshot_payload: "시험용 고시 원문 — 구역지정",
  license_type: "kogl_1",
  ...over,
});

/** anon 역할로 공개 뷰 읽기 */
async function publicProject(id) {
  await db.query("begin");
  try {
    await db.query("set local role anon");
    return (await db.query("select id, current_stage, source_name from public.public_projects where id = $1", [id])).rows;
  } finally {
    await db.query("rollback");
  }
}

/** 프로젝트·단계 기록·스냅샷·연결 지우기 — 단계 기록은 추가만이라 트리거를 끈 거래 안에서. 운영 설정을 되돌리기(staff.cleanup) 전에 부른다(쓰는 유형은 빼지 못한다) */
async function removeFixtureRows(q) {
  const actors = [...(staff?.userIds ?? [])].map((id) => `user:${id}`);
  const ids = (await q("select id from public.projects where created_by = any($1::text[]) or slug like 'siheom-pa-%'", [actors])).rows.map((r) => Number(r.id));
  await q("delete from public.regional_links where created_by = any($1::text[]) or (from_type = 'project' and from_id = any($2::text[])) or (to_type = 'region' and to_id like '99%')", [actors, ids.map(String)]);
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

async function login(page, who) {
  await page.goto(`${base}/admin/login`);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "로그인" && !b.disabled));
  await page.fill("#login-email", who.email);
  await page.fill("#login-password", who.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((url) => url.pathname !== "/admin/login");
}
async function editorPage(viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await login(page, u.editor);
  return { ctx, page };
}
/** 폼 버튼이 살아날 때까지(하이드레이션) */
const ready = (page, form) => page.waitForFunction((f) => [...document.querySelectorAll(`[data-form="${f}"] button[type="submit"]`)].every((b) => !b.disabled), form);

/** 화면의 입력·고르기·글상자 칸 — 이름·id·라벨·자리표시·aria-label */
const controls = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("main input, main select, main textarea")].map((el) => {
      const label = el.id ? (document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent ?? "") : "";
      return { tag: el.tagName.toLowerCase(), type: el.getAttribute("type") ?? "", name: el.getAttribute("name") ?? "", id: el.id, label: label.trim(), placeholder: el.getAttribute("placeholder") ?? "", aria: el.getAttribute("aria-label") ?? "" };
    }),
  );
/** JSON 칸 이름 전부 (여러 겹) */
const keysOf = (v) => (Array.isArray(v) ? v.flatMap(keysOf) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);

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
  for (const t of ["regions", "articles", "raw_snapshots", "projects", "project_events", "regional_links"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  const s = Object.fromEntries((await db.query("select key, value from public.settings where key in ('project_types', 'project_stage_lists')")).rows.map((r) => [r.key, r.value]));
  assert.deepEqual([s.project_types, s.project_stage_lists], [{}, {}], "사업 유형·단계 목록 씨앗 = 빈 값 (12장 #10)");

  u.admin = await staff.createUser({ label: "w4pa-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w4pa-editor", roles: ["editor"], person: { name: "시험용 프로젝트 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "w4pa-reporter", roles: ["reporter"], person: { name: "시험용 프로젝트 기자", roles: ["reporter"] } });
  u.adOps = await staff.createUser({ label: "w4pa-adops", roles: ["ad_ops"] });
  u.brandOps = await staff.createUser({ label: "w4pa-brandops", roles: ["brand_ops"] });

  await db.query("insert into public.regions (code, level, name, slug) values ($1, 'sido', $2, $3)", [SIDO.code, SIDO.name, `${SIDO.key}-${staff.run}`]);
  await db.query("insert into public.regions (code, parent_code, level, name, slug) values ($1, $2, 'sigungu', $3, $4)", [GU.code, SIDO.code, GU.name, `${GU.key}-${staff.run}`]);
  // 어제 폐지된 시험용 시·군·구 (후속 = GU) — 오늘 유효하지 않은 지역
  await db.query("insert into public.regions (code, parent_code, level, name, slug, valid_to, successor_code) values ($1, $2, 'sigungu', $3, $4, (now() at time zone 'Asia/Seoul')::date - 1, $5)", [
    OLD.code,
    SIDO.code,
    OLD.name,
    `${OLD.key}-${staff.run}`,
    GU.code,
  ]);
  // 같은 지역 자동 후보용 공개 기사 1건
  const a = await one(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, editorial_field, public_question, region_codes, first_published_at)
     values ($1, '시험용 사업구 재개발 보도', '시험용 지역 보도 요약입니다', 'local', 'reported_news', 'published', $2, 'urban_policy', '시험용 사업구 정비는 어떻게 되나', $3, now() - interval '1 hour') returning id`,
    [`e2e-w4pa-${staff.run}`, u.reporter.personId, [GU.code]],
  );
  staff.trackArticle(Number(a.id));
  fx.article = Number(a.id);
  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
    if (db) await removeFixtureRows((sql, params) => db.query(sql, params));
    await staff?.cleanup(); // 기사·계정·감사 로그 지우기 + 운영 설정(사업 유형·단계 목록) 되돌리기
  } finally {
    server?.stop();
    if (sb && Object.keys(counts0).length) {
      const c = new pg.Client({ connectionString: sb.dbUrl });
      await c.connect();
      try {
        await removeRegions((sql, params) => c.query(sql, params));
        for (const t of Object.keys(counts0)) assert.equal((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n, counts0[t], `정리 뒤 ${t} 행 수 = 시험 전`);
        const s = Object.fromEntries((await c.query("select key, value from public.settings where key in ('project_types', 'project_stage_lists')")).rows.map((r) => [r.key, r.value]));
        assert.deepEqual([s.project_types, s.project_stage_lists], [{}, {}], "사업 유형·단계 목록 되돌림");
      } finally {
        await c.end();
      }
    }
  }
});

test("a) 빈 사업 유형 목록 — 화면 안내·만들기 폼 0 · API 만들기 422(project_type 칸) · 행 0", async () => {
  const { ctx, page } = await editorPage();
  const res = await page.goto(`${base}/admin/projects`);
  assert.equal(res.status(), 200);
  await page.getByTestId("project-types-empty").waitFor();
  assert.match(await page.getByTestId("project-types-empty").innerText(), /^사업 유형 목록이 아직 없습니다/);
  assert.equal(await page.locator('[data-form="project-create"]').count(), 0, "만들기 폼 0");
  await ctx.close();
  const r = await projects(u.editor, { op: "create", slug: `siheom-pa-${staff.run}`, name: "시험용 사업 프로젝트", region_code: GU.code, project_type: TYPE });
  assert.equal(r.status, 422, show(r));
  assert.deepEqual(r.body.errors, [
    "project_type: 사업 유형 목록이 아직 없습니다 — 편집국 초안 + 세무·법률 감수 뒤 관리자가 운영 설정 project_types·project_stage_lists에 넣으면 프로젝트를 만들 수 있습니다 (12장 #10)",
  ]);
  assert.equal((await one("select count(*)::int n from public.projects")).n, counts0.projects, "행 0");

  // 시험용 사업 유형·단계 목록 (관리자 설정 API — 끝나면 되돌린다)
  assert.equal((await setSetting("project_types", { [TYPE]: { label: "시험용 사업" } })).status, 200);
  assert.equal((await setSetting("project_stage_lists", { [TYPE]: STAGES })).status, 200);
});

test("b) 만들기 — 화면 폼으로 초안 + 감사 · 칸별 422 · 오늘 유효하지 않은 지역 422 · 가격 칸 이름 422 · 같은 주소 409", async () => {
  const { ctx, page } = await editorPage();
  await page.goto(`${base}/admin/projects`);
  await ready(page, "project-create");
  await page.fill("#pj-name", "시험용 사업구 정비 프로젝트");
  await page.fill("#pj-slug", `siheom-pa-${staff.run}`);
  await page.fill("#pj-region", GU.code);
  await page.selectOption("#pj-type", TYPE);
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await page.waitForURL(/\/admin\/projects\/\d+$/);
  fx.project = Number(new URL(page.url()).pathname.split("/").pop());
  await page.getByTestId("project-detail").waitFor();
  assert.equal(await page.getByTestId("project-detail").getAttribute("data-status"), "draft");
  await ctx.close();
  const row = await one("select slug, status, region_code, project_type, created_by, source_name from public.projects where id = $1", [fx.project]);
  assert.deepEqual(row, { slug: `siheom-pa-${staff.run}`, status: "draft", region_code: GU.code, project_type: TYPE, created_by: `user:${u.editor.id}`, source_name: null });
  assert.equal(await auditCount("project.create", `projects:${fx.project}`, u.editor.id), 1, "감사 project.create 1건");

  const empty = await projects(u.editor, { op: "create" });
  assert.equal(empty.status, 422);
  assert.deepEqual(errorFields(empty), ["name", "project_type", "region_code", "slug"], show(empty));
  const old = await projects(u.editor, { op: "create", slug: `siheom-pa-old-${staff.run}`, name: "시험용 폐지 지역", region_code: OLD.code, project_type: TYPE });
  assert.equal(old.status, 422, show(old));
  assert.deepEqual(old.body.errors, [`region_code: ${OLD.code}는 오늘 유효한 행정구역(regions)이 아닙니다`]);
  const priced = await projects(u.editor, { op: "create", slug: `siheom-pa-p-${staff.run}`, name: "시험용 가격", region_code: GU.code, project_type: TYPE, sale_price: 1, contribution: 2, expected_yield: 3 });
  assert.equal(priced.status, 422, show(priced));
  assert.deepEqual(errorFields(priced), ["contribution", "expected_yield", "sale_price"]);
  assert.ok(priced.body.errors.every((e) => e.includes("(PR-05)")));
  const dup = await projects(u.editor, { op: "create", slug: `siheom-pa-${staff.run}`, name: "시험용 같은 주소", region_code: GU.code, project_type: TYPE });
  assert.equal(dup.status, 409, show(dup));
  assert.equal((await one("select count(*)::int n from public.projects")).n, counts0.projects + 1, "거부된 만들기는 행 0");
});

test("c) 단계 기록 — 고시 6칸 칸별 422 · 화면 칸 옆 오류 → 기록 + 스냅샷 + 감사 · 앞 순서·같은 단계 422 · 해당 없음 · 메모 경고", async () => {
  const bare = await projects(u.editor, { op: "event", project_id: fx.project, stage: "zone" });
  assert.equal(bare.status, 422);
  assert.deepEqual(errorFields(bare), ["issuer", "license_type", "notice_date", "notice_no", "snapshot_payload", "source_url"], show(bare));
  for (const [field, over] of [
    ["notice_no", { notice_no: "" }],
    ["notice_date", { notice_date: "2026-13-01" }],
    ["issuer", { issuer: " " }],
    ["source_url", { source_url: "ftp://gov.example.test/x" }],
    ["snapshot_payload", { snapshot_payload: "" }],
    ["license_type", { license_type: "kogl_9" }],
  ]) {
    const r = await projects(u.editor, { op: "event", project_id: fx.project, stage: "zone", ...notice(over) });
    assert.equal(r.status, 422, `${field} ${show(r)}`);
    assert.deepEqual(errorFields(r), [field], `${field}만 틀리면 그 칸 오류 하나`);
  }
  const outside = await projects(u.editor, { op: "event", project_id: fx.project, stage: "siheom_none", ...notice() });
  assert.equal(outside.status, 422);
  assert.deepEqual(outside.body.errors, ["stage: siheom_none는 이 사업 유형의 단계 목록에 없습니다"]);
  const badSnap = await projects(u.editor, { op: "event", project_id: fx.project, stage: "zone", ...notice({ snapshot_payload: undefined, snapshot_id: 999999999 }) });
  assert.equal(badSnap.status, 422);
  assert.deepEqual(errorFields(badSnap), ["snapshot_id"]);
  assert.equal((await one("select count(*)::int n from public.project_events where project_id = $1", [fx.project])).n, 0, "거부된 기록 행 0");

  // 화면 — 고시 번호를 비우고 보내면 그 칸 옆 오류, 채워 다시 보내면 기록
  const { ctx, page } = await editorPage();
  await page.goto(`${base}/admin/projects/${fx.project}`);
  await ready(page, "project-event");
  const n = notice();
  await page.selectOption("#pe-stage", "zone");
  await page.fill("#pe-notice-date", n.notice_date);
  await page.fill("#pe-issuer", n.issuer);
  await page.fill("#pe-source-url", n.source_url);
  await page.selectOption("#pe-license", n.license_type);
  await page.fill("#pe-snapshot", n.snapshot_payload);
  await page.getByRole("button", { name: "단계 기록", exact: true }).click();
  await page.locator("#pe-notice-no-error").waitFor();
  assert.equal(await page.locator("#pe-notice-no-error").innerText(), "고시 번호가 필요합니다 (PR-03)");
  assert.equal(await page.locator("#pe-notice-no").getAttribute("aria-invalid"), "true");
  assert.equal(await page.locator("#pe-issuer-error").count(), 0, "채운 칸에는 오류 0");
  await page.fill("#pe-notice-no", n.notice_no);
  await page.getByRole("button", { name: "단계 기록", exact: true }).click();
  await page.locator('[data-testid="project-events"] li[data-kind="stage"]').waitFor();
  await ctx.close();
  const zone = await one("select id, stage, notice_no, issuer, source_url, license_type, snapshot_id, recorded_by, public from public.project_events where project_id = $1", [fx.project]);
  const { id: zoneId, snapshot_id: zoneSnap, ...zoneRest } = zone;
  assert.deepEqual(zoneRest, { stage: "zone", notice_no: n.notice_no, issuer: n.issuer, source_url: n.source_url, license_type: "kogl_1", recorded_by: `user:${u.editor.id}`, public: true });
  fx.zone = Number(zoneId);
  const snap = await one("select url, content_hash, payload from public.raw_snapshots where id = $1", [zoneSnap]);
  assert.equal(snap.url, n.source_url);
  assert.equal(snap.payload, n.snapshot_payload);
  assert.match(snap.content_hash, /^sha256:[0-9a-f]{64}$/, "원문 검수와 같은 해시 모양");
  assert.equal(await auditCount("project.record_event", `project_events:${fx.zone}`, u.editor.id), 1, "감사 project.record_event 1건");

  const done = await projects(u.editor, { op: "event", project_id: fx.project, stage: "done", ...notice({ notice_no: `시험용 고시 제${staff.run}-3호`, source_url: `${GOV}/${staff.run}/done`, snapshot_payload: "시험용 고시 원문 — 준공" }) });
  assert.equal(done.status, 201, show(done));
  fx.done = Number(done.body.event.id);
  const back = await projects(u.editor, { op: "event", project_id: fx.project, stage: "plan", ...notice({ source_url: `${GOV}/${staff.run}/plan` }) });
  assert.equal(back.status, 422);
  assert.match(back.body.errors[0], /^stage: 앞 순서 단계로 돌아가는 기록은 거부합니다 \(현재 done → 새 기록 plan\)/);
  const again = await projects(u.editor, { op: "event", project_id: fx.project, stage: "done", ...notice() });
  assert.equal(again.status, 422);
  assert.match(again.body.errors[0], /^stage: 이미 기록된 단계입니다 \(done\)/);
  const skipNoReason = await projects(u.editor, { op: "event", project_id: fx.project, kind: "not_applicable", stage: "plan" });
  assert.deepEqual(skipNoReason.body.errors, ["reason: 이 단계가 없는 사유가 필요합니다"]);
  const skip = await projects(u.editor, { op: "event", project_id: fx.project, kind: "not_applicable", stage: "plan", reason: "시험용 — 계획인가 단계가 없는 사업", note: "시험용 사업비 1,200억원 메모" });
  assert.equal(skip.status, 201, show(skip));
  assert.deepEqual(skip.body.warnings, ["note: 메모에 숫자 + 원·% 표현이 있습니다 — 가격 정보는 편집 승인을 거친 기사로만 씁니다 (PR-05 저장 경고)"], "메모 경고(저장은 된다)");
  assert.equal(skip.body.event.snapshot_id, null, "해당 없음은 증거 칸 0");
});

test("d) 정정 — 사유 없음 422 · 화면 폼 거두기 + 감사 · 같은 기록 두 번 422 · 현재 단계는 다음 읽기부터", async () => {
  const list0 = await api("GET", "/projects", u.editor);
  assert.equal(list0.body.projects.find((p) => p.id === fx.project).current_stage, "done");
  const noReason = await projects(u.editor, { op: "correct", project_id: fx.project, correction_of: fx.done });
  assert.equal(noReason.status, 422);
  assert.deepEqual(noReason.body.errors, ["reason: 정정 사유가 필요합니다"]);

  const { ctx, page } = await editorPage();
  await page.goto(`${base}/admin/projects/${fx.project}`);
  await ready(page, "project-correct");
  await page.selectOption("#pc-target", String(fx.done));
  await page.selectOption("#pc-mode", "withdraw");
  await page.fill("#pc-reason", "시험용 — 준공 고시가 아니라 예고였음");
  await page.getByRole("button", { name: "정정 기록", exact: true }).click();
  await page.locator(`[data-testid="project-events"] li[data-event-id="${fx.done}"][data-corrected="true"]`).waitFor();
  assert.equal(await page.locator('[data-part="current-stage"]').innerText(), "현재 단계: 시험용 구역지정", "거둔 뒤 현재 단계 = 남은 가장 늦은 공개 단계");
  await ctx.close();
  const fix = await one("select id, kind, stage, correction_of, reason from public.project_events where correction_of = $1", [fx.done]);
  assert.deepEqual({ kind: fix.kind, stage: fix.stage, correction_of: Number(fix.correction_of), reason: fix.reason }, { kind: "correction", stage: null, correction_of: fx.done, reason: "시험용 — 준공 고시가 아니라 예고였음" });
  assert.equal(await auditCount("project.correct_event", `project_events:${fix.id}`, u.editor.id), 1, "감사 project.correct_event 1건");
  const twice = await projects(u.editor, { op: "correct", project_id: fx.project, correction_of: fx.done, reason: "다시" });
  assert.equal(twice.status, 422);
  assert.match(twice.body.errors[0], /^correction_of: 이미 정정된 기록\(\d+\)입니다 — 정정은 한 번만/);
});

test("e) 공개 — 조건 미달 칸별 422 + 화면 사유 · 화면 폼으로 공개 → anon 공개 뷰 + 감사 · 내리기 → 0행 · 다시 내리기 409", async () => {
  const early = await projects(u.editor, { op: "publish", project_id: fx.project, status: "public" });
  assert.equal(early.status, 422, show(early));
  assert.deepEqual(errorFields(early), ["last_verified_at", "source_name"]);
  const { ctx, page } = await editorPage();
  await page.goto(`${base}/admin/projects/${fx.project}`);
  await page.getByTestId("publish-blockers").waitFor();
  assert.deepEqual(await page.locator('[data-testid="publish-blockers"] li').evaluateAll((els) => els.map((e) => e.getAttribute("data-field")).sort()), ["last_verified_at", "source_name"]);
  await ready(page, "project-publish");
  await page.fill("#pp-source", "시험용 사업구청 고시");
  await page.getByRole("button", { name: "공개", exact: true }).click();
  await page.locator("#pp-verified-error").waitFor();
  assert.equal(await page.locator("#pp-verified-error").innerText(), "정보 확인일이 있어야 공개합니다 (PR-02 데이터 출처 줄)", "확인일 칸 옆 오류");
  await page.check("#pp-verified");
  await page.getByRole("button", { name: "공개", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="project-detail"]')?.getAttribute("data-status") === "public");
  await ctx.close();
  const shown = (await publicProject(fx.project)).map((r) => ({ ...r, id: Number(r.id) }));
  assert.deepEqual(shown, [{ id: fx.project, current_stage: "zone", source_name: "시험용 사업구청 고시" }], "anon 공개 뷰 1행 — 현재 단계·데이터 출처");
  assert.equal(await auditCount("project.publish", `projects:${fx.project}`, u.editor.id), 1, "감사 project.publish 1건");
  const hide = await projects(u.editor, { op: "publish", project_id: fx.project, status: "hidden" });
  assert.equal(hide.status, 200, show(hide));
  assert.deepEqual(await publicProject(fx.project), [], "내리면 anon 공개 뷰 0행");
  assert.equal((await projects(u.editor, { op: "publish", project_id: fx.project, status: "hidden" })).status, 409, "공개 중이 아니면 내리기 409");
  assert.equal((await projects(u.editor, { op: "publish", project_id: fx.project, status: "draft" })).status, 422, "초안으로 되돌리기 0");
});

test("f) 지역 연결 op=link — 같은 지역 후보·확인 + 감사 · 다른 대상의 연결 404 · 지역 연결 화면의 프로젝트 끝 = 이 화면", async () => {
  const sug = await projects(u.editor, { op: "link", project_id: fx.project, linkOp: "suggest" });
  assert.equal(sug.status, 200, show(sug));
  assert.equal(sug.body.created, 2, "같은 지역 공개 기사 1 + 지역 허브 1");
  assert.equal(await auditCount("regional_link.suggest", `regional_links:from:project:${fx.project}`, u.editor.id), 1);
  const board = await api("GET", `/regional-links?from=project:${fx.project}`, u.editor);
  assert.deepEqual(board.body.candidates.map((l) => [l.to_type, l.to_id]).sort(), [["article", String(fx.article)], ["region", GU.code]]);
  assert.equal(board.body.from.adminHref, `/admin/projects/${fx.project}`, "프로젝트 끝 → 프로젝트 관리 화면");
  const art = board.body.candidates.find((l) => l.to_type === "article");

  const { ctx, page } = await editorPage();
  await page.goto(`${base}/admin/projects/${fx.project}`);
  const item = page.locator(`[data-testid="project-links"] li[data-link-id="${art.id}"]`);
  await item.waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-form="regional-link-confirm"] button')].every((b) => !b.disabled));
  await item.locator(`#rl-reason-${art.id}`).fill("시험용 — 같은 구역 정비 보도");
  await item.getByRole("button", { name: "연결 확인" }).click();
  await page.waitForFunction((id) => !document.querySelector(`[data-form="regional-link-confirm"][data-link-id="${id}"]`), art.id);
  assert.equal(await page.getByTestId("project-links-board").getAttribute("href"), `/admin/regions/links?from=project:${fx.project}`);
  await ctx.close();
  assert.deepEqual(await one("select status, confirmed_by, reason from public.regional_links where id = $1", [art.id]), { status: "confirmed", confirmed_by: `user:${u.editor.id}`, reason: "시험용 — 같은 구역 정비 보도" });
  assert.equal(await auditCount("regional_link.confirm", `regional_links:${art.id}`, u.editor.id), 1);

  const other = await api("POST", "/regional-links", u.editor, { op: "create", fromType: "article", fromId: fx.article, toType: "region", toId: GU.code, relation: "same_region" });
  assert.equal(other.status, 201, show(other));
  const foreign = await projects(u.editor, { op: "link", project_id: fx.project, linkOp: "remove", linkId: other.body.link.id, reason: "시험용" });
  assert.equal(foreign.status, 404, "다른 대상에서 나가는 연결은 이 화면에서 바꾸지 않는다");
  const tour = await projects(u.editor, { op: "link", project_id: fx.project, linkOp: "create", toType: "restaurant", toId: "1", relation: "same_region" });
  assert.equal(tour.status, 422, "관광 항목 422 (13단계 규칙 그대로)");
  assert.equal((await projects(u.editor, { op: "link", project_id: fx.project, linkOp: "publish" })).status, 422);
});

test("g) 권한 — 기자·광고·브랜드 담당 API·화면 403 + 거부 감사 · 메뉴 '프로젝트'는 편집 책임자·관리자만", async () => {
  for (const who of [u.reporter, u.adOps, u.brandOps]) {
    const r = await projects(who, { op: "create", slug: `siheom-pa-x-${staff.run}`, name: "x", region_code: GU.code, project_type: TYPE });
    assert.equal(r.status, 403, show(r));
    assert.match(r.body.error, /PR-02/);
    assert.equal(await auditCount("project.manage.denied", "projects:write", who.id), 1, "거부 감사 1건");
    const pub = await projects(who, { op: "publish", project_id: fx.project, status: "public" });
    assert.equal(pub.status, 403);
    assert.equal(await auditCount("project.manage.denied", `projects:${fx.project}`, who.id), 1, "공개 시도 거부 감사");
    assert.equal((await api("GET", "/projects", who)).status, 403);
  }
  for (const who of [u.reporter, u.adOps, u.brandOps]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, who);
    for (const p of ["/admin/projects", `/admin/projects/${fx.project}`]) assert.equal((await page.goto(`${base}${p}`)).status(), 403, `${who.email} ${p} 403`);
    assert.ok(!(await page.locator('nav[aria-label="편집국 메뉴"] a').allInnerTexts()).includes("프로젝트"), "메뉴 0");
    await ctx.close();
  }
  for (const who of [u.editor, u.admin]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, who);
    await page.goto(`${base}/admin/projects`);
    const menu = page.locator('nav[aria-label="편집국 메뉴"] a', { hasText: "프로젝트" });
    assert.equal(await menu.getAttribute("aria-current"), "page", "지금 보는 메뉴");
    await ctx.close();
  }
  assert.equal(await auditCount("project.manage.denied", "projects:write", u.editor.id), 0);
});

test("h) 가격·분담금·수익률 입력 요소 0 (설계 2.10 사전 — 두 화면 칸 전수) · API 응답 칸 이름 0 · 360·1280px 가로 넘침 0", async () => {
  assert.equal(PRICE_WORDS.length, 16);
  for (const viewport of [
    { width: 360, height: 740 },
    { width: 1280, height: 800 },
  ]) {
    const { ctx, page } = await editorPage(viewport);
    for (const p of ["/admin/projects", `/admin/projects/${fx.project}`]) {
      await page.goto(`${base}${p}`);
      await ready(page, p === "/admin/projects" ? "project-create" : "project-event");
      // 고르기를 바꿔 숨은 칸(해당 없음 사유·거두기)도 본다
      if (p !== "/admin/projects") {
        await page.selectOption("#pe-kind", "not_applicable");
        await page.selectOption("#pc-mode", "withdraw");
      }
      const all = await controls(page);
      if (p !== "/admin/projects") {
        await page.selectOption("#pe-kind", "stage");
        await page.selectOption("#pc-mode", "rewrite");
        all.push(...(await controls(page)));
      }
      assert.ok(all.length >= (p === "/admin/projects" ? 6 : 20), `${p} 입력 칸 ${all.length}개`);
      const hits = all.filter((c) => priceWordsIn([c.name, c.id, c.label, c.placeholder, c.aria].join(" ")).length > 0);
      assert.deepEqual(hits, [], `${p} 가격·분담금·수익률 입력 요소 0`);
      assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${p} ${viewport.width}px 가로 넘침 0`);
    }
    await ctx.close();
  }
  const list = await api("GET", "/projects", u.editor);
  const detail = await api("GET", `/projects?id=${fx.project}`, u.editor);
  assert.equal(detail.status, 200);
  const keys = [...new Set([...keysOf(list.body), ...keysOf(detail.body)])];
  assert.deepEqual(keys.filter((k) => priceWordsIn(k).length > 0), [], "API 응답 칸 이름에 가격 사전 낱말 0");
});
