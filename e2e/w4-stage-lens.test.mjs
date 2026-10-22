// 단계별 「지방세로 읽기」 E2E (W4 16단계 — docs/dev/W4_설계.md 1장 16단계 · 2.1 · 2.3 · 4장 `/api/admin/project-lenses` · 5장 · 6장 · 12장 #129~, PRD-01B PR-08 · CORE-01 · TX-01).
// standalone 빌드를 로컬 Supabase에 붙인다. 시험용 지역은 법정동코드에 없는 접두 99 가짜 코드와 '시험용' 이름이다(설계 8장). 문구는 '시험용' 가짜 — 세무 문장·세율·금액 0.
// 시험 세계: 시험용 시·도 1 + 시·군·구 1 · 시험용 사업 유형 1(단계 3 — 관리자 설정 API) · 같은 유형의 공개 프로젝트 P1(기록 2)·P2(기록 1).
//  a) 권한 — 기자·광고 담당 GET·초안 403 + 거부 감사(project.manage.denied) · 편집 책임자·관리자(reviewer 아님)의 서명 403 + 거부 감사(review.tax_review.denied) ·
//     감수위원의 초안 403 · 메뉴 '단계 지방세로 읽기 감수'는 감수위원만(편집 책임자 메뉴 그대로)
//  b) 저장 규칙(API) — 포인트 0줄·4줄 422, 1줄·3줄 저장 · 세액 표현(숫자 + 원)·금지 표현(감면 단정)·링크 0개·계산기 링크·가격 칸 이름 422 · 숫자 + % 저장 + 경고 · 감사 project_lens.edit
//  c) 화면 — 편집 책임자가 프로젝트 화면 단계 줄에서 초안 저장(4번째 줄은 화면이 먼저 막음) → 공개 화면 박스 0('준비 중' 0) → 감수위원이 감수 화면에서 서명 + 감사 →
//     서명된 단계에만 박스(세목·포인트·해설 링크·감수자·기준일) — 같은 유형의 다른 프로젝트에도 같은 박스 · 템플릿 없는 단계 0
//  d) 서명 뒤 고침 — 박스 0(두 프로젝트 모두, 다시 서명할 때까지) · 재감수 필요 상태 · 고치기 전 초안 시각으로 서명 409 · 다시 서명하면 새 문구
//  e) SM 취득세 카드 — sm_calculator 꺼짐 0 · 켜도 주소가 비면 0 · 주소가 있으면 박스 옆 카드(이동 = 저장 주소 그대로·새 창·noopener noreferrer·국세 배지 0) · 입력 요소 0 · 박스 없는 단계 0
//  f) 360·1280px 가로 넘침 0 · 접근성 95
// 만든 계정·지역·프로젝트·단계 기록·스냅샷·템플릿은 끝나면 지우고, 운영 설정(기능 키·사업 유형·단계 목록)·SM 주소는 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-stage-lens-e2e@example.test";
const SITE = "https://e2e.example.test";
const SIDO = { code: "9900000000", name: "시험용 렌즈도", key: "renjeudo" };
const GU = { code: "9901100000", name: "시험용 렌즈구", key: "renjeugu" };
const GOV = "https://gov.example.test/w4sl";
const TYPE = "siheom_sl";
const STAGES = [
  { key: "zone", label: "시험용 구역지정" },
  { key: "plan", label: "시험용 계획인가" },
  { key: "done", label: "시험용 준공" },
];
const ACTOR = "migration:e2e-w4sl";
const SM_URL = "https://sm.example.test/w4sl/acquisition";

let sb, server, staff, db, browser, base, debugPort, smRow0;
const u = {};
const fx = {};
const counts0 = {};

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body ?? r.html?.slice(0, 300)).slice(0, 700);
const decode = (s) => s?.replaceAll("&amp;", "&") ?? null;

async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const lenses = (user, body) => api("POST", "/project-lenses", user, body);
const setSetting = (key, value) => api("PATCH", `/settings/${key}`, u.admin, { value });
/** 기능 키 — 시험 전 값 위에 바꾼다(설정 쓰기 = 공개 데이터 캐시 만료) */
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
  one("select count(*)::int n from public.audit_logs where action = $1 and target like $2 and actor = $3 and at >= $4", [action, target, `user:${actorId}`, staff.startedAt]).then((r) => r.n);
const lensRow = (stage) => one("select review_status, reviewed_by, drafted_at, lens from public.project_stage_lenses where project_type = $1 and stage = $2", [TYPE, stage]);
const draftBody = (stage, over = {}) => ({
  op: "draft",
  project_type: TYPE,
  stage,
  topics: ["시험용 세목"],
  points: [`시험용 ${stage} 포인트`],
  links: [{ kind: "explainer", label: "시험용 해설", url: "/tax" }],
  base_date: "2026-01-01",
  ...over,
});
const errorFields = (r) => [...new Set((r.body.errors ?? []).map((e) => e.split(":")[0].replace(/\[\d+\]$/, "")))].sort();

/** 공개 상세 화면의 단계별 박스 — 단계 키 → { 포인트, 세목, 링크, 감수 줄, SM 카드 } */
function lensBoxes(html) {
  const out = {};
  const main = html.match(/<main[\s\S]*<\/main>/)?.[0] ?? "";
  const parts = main.split(/<div data-stage-lens="/).slice(1);
  for (const part of parts) {
    const key = part.slice(0, part.indexOf('"'));
    const box = part.split(/<li data-stage-state=|<\/ol>/)[0];
    out[key] = {
      points: [...box.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]),
      hrefs: [...box.matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1])),
      meta: box.match(/감수 <!-- -->([^<]*)<!-- --> · 기준일 <!-- -->([^<]*)/)?.slice(1) ?? box.match(/감수 ([^<]*) · 기준일 ([^<]*)/)?.slice(1) ?? null,
      sm: [...box.matchAll(/<a href="([^"]*)" target="([^"]*)" rel="([^"]*)" data-part="go"/g)].map((m) => [decode(m[1]), m[2], m[3]]),
      national: (box.match(/data-tax-kind="national"/g) ?? []).length,
    };
  }
  return out;
}
const detail = async (p) => {
  const r = await get(`/realestate/projects/${p.slug}`);
  assert.equal(r.status, 200, `${p.slug} ${r.status}`);
  return r.html;
};

async function removeFixtureRows(q) {
  await q("delete from public.project_stage_lenses where project_type = $1", [TYPE]);
  const ids = (await q("select id from public.projects where created_by = $1 or slug like 'siheom-sl-%'", [ACTOR])).rows.map((r) => Number(r.id));
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

/** 공개 프로젝트 — 단계 기록(고시 6칸 + 스냅샷) */
async function project(key, name, stages) {
  const p = await one("insert into public.projects (slug, name, region_code, project_type, created_by) values ($1, $2, $3, $4, $5) returning id, slug", [`siheom-sl-${key}-${staff.run}`, name, GU.code, TYPE, ACTOR]);
  for (const [i, stage] of stages.entries()) {
    const url = `${GOV}/${staff.run}/${key}/${stage}`;
    const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e-w4sl', $1, $2, '시험용 고시 원문') returning id", [url, `sha256:w4sl-${key}-${i}-${staff.run}`]);
    await db.query(
      "insert into public.project_events (project_id, kind, stage, notice_no, notice_date, issuer, source_url, snapshot_id, license_type, recorded_by) values ($1, 'stage', $2, $3, $4, '시험용 렌즈구청', $5, $6, 'kogl_1', $7)",
      [p.id, stage, `시험용 고시 제${staff.run}-${i + 1}호`, `2026-0${i + 1}-15`, url, snap.id, ACTOR],
    );
  }
  await db.query("update public.projects set status = 'public', source_name = '시험용 렌즈구청', last_verified_at = now() where id = $1", [p.id]);
  return { id: Number(p.id), slug: p.slug, name };
}

async function login(page, who) {
  await page.goto(`${base}/admin/login`);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "로그인" && !b.disabled));
  await page.fill("#login-email", who.email);
  await page.fill("#login-password", who.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((url) => url.pathname !== "/admin/login");
}
async function staffPage(who, viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await login(page, who);
  return { ctx, page };
}
const menuLabels = (page) => page.$$eval('nav[aria-label="백오피스 메뉴"] a, [data-admin-menu] a', (as) => as.map((a) => a.textContent.trim()));

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
  for (const t of ["regions", "raw_snapshots", "projects", "project_events", "project_stage_lenses"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  const s = Object.fromEntries((await db.query("select key, value from public.settings where key in ('feature_flags', 'project_types', 'project_stage_lists')")).rows.map((r) => [r.key, r.value]));
  assert.equal(s.feature_flags.realestate_projects, false, "시험 전 realestate_projects는 꺼져 있다 (2.4 씨앗)");
  assert.deepEqual([s.project_types, s.project_stage_lists], [{}, {}], "사업 유형·단계 목록 씨앗 = 빈 값 (12장 #10)");
  assert.equal(counts0.project_stage_lenses, 0, "템플릿 씨앗 0 — 문구는 편집국 초안 + 감수");
  smRow0 = await one("select id, url, status from public.official_links where kind = 'sm_calculator' and key = 'acquisition'");
  assert.ok(smRow0, "SM 취득세 계산기 행 (W3 씨앗)");

  u.admin = await staff.createUser({ label: "w4sl-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w4sl-editor", roles: ["editor"], person: { name: "시험용 렌즈 편집자", roles: ["editor"] } });
  u.reviewer = await staff.createUser({ label: "w4sl-reviewer", roles: ["reviewer"], person: { name: "시험용 렌즈 감수위원", roles: ["reviewer"] } });
  u.reporter = await staff.createUser({ label: "w4sl-reporter", roles: ["reporter"], person: { name: "시험용 렌즈 기자", roles: ["reporter"] } });
  u.adOps = await staff.createUser({ label: "w4sl-adops", roles: ["ad_ops"] });

  await db.query("insert into public.regions (code, level, name, slug) values ($1, 'sido', $2, $3)", [SIDO.code, SIDO.name, `${SIDO.key}-${staff.run}`]);
  await db.query("insert into public.regions (code, parent_code, level, name, slug) values ($1, $2, 'sigungu', $3, $4)", [GU.code, SIDO.code, GU.name, `${GU.key}-${staff.run}-gu`]);
  assert.equal((await setSetting("project_types", { [TYPE]: { label: "시험용 정비사업" } })).status, 200);
  assert.equal((await setSetting("project_stage_lists", { [TYPE]: STAGES })).status, 200);
  fx.P1 = await project("p1", "시험용 렌즈구역 정비", ["zone", "plan"]);
  fx.P2 = await project("p2", "시험용 옆렌즈구역 정비", ["zone"]);

  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
  await flags({ realestate_projects: true, sm_calculator: false });
});

after(async () => {
  try {
    await browser?.close();
    if (db) {
      if (smRow0) await db.query("update public.official_links set url = $2, status = $3 where id = $1", [smRow0.id, smRow0.url, smRow0.status]);
      await removeFixtureRows((sql, params) => db.query(sql, params));
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
        const s = Object.fromEntries((await c.query("select key, value from public.settings where key in ('feature_flags', 'project_types', 'project_stage_lists')")).rows.map((r) => [r.key, r.value]));
        assert.deepEqual([s.project_types, s.project_stage_lists, s.feature_flags.realestate_projects], [{}, {}, false], "운영 설정 되돌림");
        if (smRow0) assert.equal((await c.query("select url from public.official_links where id = $1", [smRow0.id])).rows[0].url, smRow0.url, "SM 주소 되돌림");
      } finally {
        await c.end();
      }
    }
  }
});

test("a) 권한 — 기자·광고 담당 403 + 거부 감사 · 편집 책임자·관리자의 서명 403 + 거부 감사 · 감수위원 초안 403 · 메뉴는 감수위원만", async () => {
  for (const who of [u.reporter, u.adOps]) {
    const list = await api("GET", "/project-lenses", who);
    assert.equal(list.status, 403, show(list));
    const draft = await lenses(who, draftBody("zone"));
    assert.equal(draft.status, 403, show(draft));
    assert.equal(await auditCount("project.manage.denied", "project_stage_lenses:%", who.id), 2, "GET·초안 거부 감사");
  }
  for (const who of [u.editor, u.admin]) {
    const sign = await lenses(who, { op: "review", project_type: TYPE, stage: "zone", drafted_at: new Date().toISOString() });
    assert.equal(sign.status, 403, show(sign));
    assert.match(sign.body.error, /세무 감수위원\(reviewer\)만/);
    assert.equal(await auditCount("review.tax_review.denied", `project_stage_lenses:review:${TYPE}:zone`, who.id), 1, "서명 거부 감사");
  }
  const reviewerDraft = await lenses(u.reviewer, draftBody("zone"));
  assert.equal(reviewerDraft.status, 403, show(reviewerDraft));
  assert.equal(await auditCount("project.manage.denied", "project_stage_lenses:%", u.reviewer.id), 1);
  assert.equal((await one("select count(*)::int n from public.project_stage_lenses where project_type = $1", [TYPE])).n, 0, "거부된 쓰기는 행 0");
  // 감수위원·편집 책임자 모두 목록을 본다
  for (const who of [u.reviewer, u.editor]) {
    const r = await api("GET", "/project-lenses", who);
    assert.equal(r.status, 200, show(r));
    assert.deepEqual(
      r.body.types.find((t) => t.key === TYPE).stages.map((s) => [s.key, s.state]),
      STAGES.map((s) => [s.key, "none"]),
    );
  }
  // 메뉴 — 감수위원에게 '단계 지방세로 읽기 감수', 편집 책임자 메뉴에는 없음(프로젝트 화면에서 쓴다)
  const rv = await staffPage(u.reviewer);
  await rv.page.goto(`${base}/admin/projects/lenses`);
  await rv.page.getByTestId("lens-board").waitFor();
  const reviewerMenu = await rv.page.$$eval("nav a", (as) => as.map((a) => [a.textContent.trim(), a.getAttribute("aria-current")]));
  assert.ok(reviewerMenu.some(([l, cur]) => l === "단계 지방세로 읽기 감수" && cur === "page"), JSON.stringify(reviewerMenu));
  assert.ok(!reviewerMenu.some(([l]) => l === "프로젝트"), "감수위원 메뉴에 '프로젝트' 0");
  assert.equal((await rv.page.goto(`${base}/admin/projects/${fx.P1.id}`)).status(), 403, "감수위원 — 프로젝트 한 건 화면 403");
  await rv.ctx.close();
  const ed = await staffPage(u.editor);
  await ed.page.goto(`${base}/admin/projects`);
  const editorMenu = await ed.page.$$eval("nav a", (as) => as.map((a) => a.textContent.trim()));
  assert.ok(editorMenu.includes("프로젝트") && !editorMenu.includes("단계 지방세로 읽기 감수"), JSON.stringify(editorMenu));
  await ed.ctx.close();
  const rp = await staffPage(u.reporter);
  assert.equal((await rp.page.goto(`${base}/admin/projects/lenses`)).status(), 403, "기자 — 감수 화면 403");
  await rp.ctx.close();
});

test("b) 저장 규칙(API) — 포인트 0·4줄 422 · 1·3줄 저장 · 세액·금지 표현·링크 0개·계산기·가격 칸 422 · 숫자 + % 경고", async () => {
  const lines = (n) => Array.from({ length: n }, (_, i) => `시험용 포인트 ${i + 1}`);
  for (const n of [0, 4]) {
    const r = await lenses(u.editor, draftBody("done", { points: lines(n) }));
    assert.equal(r.status, 422, show(r));
    assert.deepEqual(r.body.errors, [`points: 핵심 포인트는 1~3줄입니다 (지금 ${n}줄 — CORE-01)`]);
  }
  const made = await lenses(u.editor, draftBody("done", { points: lines(1) }));
  assert.equal(made.status, 201, show(made));
  assert.equal(made.body.lens.state, "draft");
  const three = await lenses(u.editor, draftBody("done", { points: lines(3) }));
  assert.equal(three.status, 200, show(three));
  assert.deepEqual((await lensRow("done")).lens.points, lines(3));
  for (const [over, field, msg] of [
    [{ points: ["시험용 세액은 300만 원입니다"] }, "points", /세액을 쓰지 않습니다 — ‘300만 원’/],
    [{ points: ["시험용 절세 보장 문장"] }, "points", /금지 표현 ‘절세 보장’ — 감면 해당 여부를 단정하지 않습니다/],
    [{ links: [] }, "links", /링크를 1개 이상/],
    [{ links: [{ kind: "calculator", label: "시험용 계산기", url: "/calc" }] }, "links", /SM 취득세 카드/],
    [{ links: [{ kind: "explainer", label: "시험용", url: SM_URL }] }, "links", /사이트 안 주소/],
    [{ topics: [] }, "topics", /관련 세목을 1개 이상/],
    [{ expected_return: 3 }, "expected_return", /\(PR-05\)/],
  ]) {
    const r = await lenses(u.editor, draftBody("done", over));
    assert.equal(r.status, 422, `${JSON.stringify(over)} ${show(r)}`);
    assert.deepEqual(errorFields(r), [field], show(r));
    assert.match(r.body.errors.join(" "), msg);
  }
  const pct = await lenses(u.editor, draftBody("done", { points: ["시험용 비율 4% 확인"] }));
  assert.equal(pct.status, 200, show(pct));
  assert.deepEqual(pct.body.warnings, ["lens: 숫자와 % 표현이 있습니다 — 저장은 됩니다. 세율·비율은 감수된 기사에서만 씁니다 (PR-05 저장 경고)"]);
  const same = await lenses(u.editor, draftBody("done", { points: ["시험용 비율 4% 확인"] }));
  assert.equal(same.body.unchanged, true, "같은 내용 — 바뀐 것 없음");
  assert.equal(await auditCount("project_lens.edit", `project_stage_lenses:${TYPE}:done`, u.editor.id), 3, "저장 3번(만들기·3줄·%) — 거부·같은 내용은 감사 0");
  const outStage = await lenses(u.editor, draftBody("build"));
  assert.equal(outStage.status, 422);
  assert.deepEqual(errorFields(outStage), ["stage"]);
});

test("c) 화면 — 단계 줄에서 초안(4번째 줄은 화면이 막음) → 공개 박스 0 → 감수 화면 서명 + 감사 → 서명된 단계에만 박스 · 같은 유형의 다른 프로젝트에도", async () => {
  const ed = await staffPage(u.editor);
  await ed.page.goto(`${base}/admin/projects/${fx.P1.id}`);
  const item = ed.page.locator(`[data-testid="project-lenses"] li[data-lens-stage="zone"]`);
  await item.waitFor();
  assert.equal(await item.getAttribute("data-lens-status"), "none");
  await ed.page.waitForFunction(() => [...document.querySelectorAll('[data-form="lens-draft"][data-lens-stage="zone"] button[type="submit"]')].every((b) => !b.disabled));
  const pre = `#lens-${TYPE}-zone`;
  await ed.page.fill(`${pre}-topics`, "시험용 세목 가\n시험용 세목 나");
  await ed.page.fill(`${pre}-points`, "시험용 첫째 포인트\n시험용 둘째 포인트\n시험용 셋째 포인트\n시험용 넷째 포인트");
  assert.match(await ed.page.locator(`${pre}-points-error`).innerText(), /3줄까지입니다 — 4번째 줄은 저장하지 않습니다/);
  assert.equal(await ed.page.locator(`[data-form="lens-draft"][data-lens-stage="zone"] button[type="submit"]`).isDisabled(), true, "4줄 — 저장 단추 잠김");
  await ed.page.fill(`${pre}-points`, "시험용 첫째 포인트\n시험용 둘째 포인트");
  await ed.page.fill(`${pre}-base-date`, "2026-01-01");
  await ed.page.fill(`${pre}-link-explainer-label`, "시험용 해설");
  await ed.page.fill(`${pre}-link-explainer-url`, "/tax");
  await ed.page.locator(`[data-form="lens-draft"][data-lens-stage="zone"]`).getByRole("button", { name: "초안 저장" }).click();
  await ed.page.locator(`[data-testid="project-lenses"] li[data-lens-stage="zone"][data-lens-status="draft"]`).waitFor();
  await ed.ctx.close();
  assert.equal((await lensRow("zone")).review_status, "draft");
  assert.equal(await auditCount("project_lens.edit", `project_stage_lenses:${TYPE}:zone`, u.editor.id), 1);

  // 서명 전 — 공개 화면 박스 0, '준비 중' 0
  let html = await detail(fx.P1);
  assert.deepEqual(Object.keys(lensBoxes(html)), [], "서명 전 박스 0");
  assert.doesNotMatch(html, /tax-lens-box|준비 중/);

  // 감수위원 — 감수 화면에서 서명
  const rv = await staffPage(u.reviewer);
  await rv.page.goto(`${base}/admin/projects/lenses`);
  const form = rv.page.locator(`[data-form="lens-review"][data-lens-stage="zone"]`);
  await form.waitFor();
  assert.equal(await rv.page.locator(`[data-form="lens-draft"]`).count(), 0, "감수위원에게 초안 폼 0");
  await rv.page.waitForFunction(() => [...document.querySelectorAll('[data-form="lens-review"] button[type="submit"]')].every((b) => !b.disabled));
  await form.getByRole("button", { name: "위 문구에 세무 감수 서명" }).click();
  await rv.page.locator(`li[data-lens-type="${TYPE}"][data-lens-stage="zone"][data-lens-status="reviewed"]`).waitFor();
  await rv.ctx.close();
  const signed = await lensRow("zone");
  assert.deepEqual([signed.review_status, signed.reviewed_by], ["reviewed", `user:${u.reviewer.id}`]);
  assert.equal(await auditCount("project_lens.review", `project_stage_lenses:${TYPE}:zone`, u.reviewer.id), 1, "감사 project_lens.review");

  html = await detail(fx.P1);
  const boxes = lensBoxes(html);
  assert.deepEqual(Object.keys(boxes), ["zone"], "서명된 템플릿이 있는 단계에만 박스 (done 초안·plan 없음 → 0)");
  assert.deepEqual(boxes.zone.points, ["시험용 첫째 포인트", "시험용 둘째 포인트"]);
  assert.ok(boxes.zone.hrefs.includes("/tax"), "해설 링크");
  assert.deepEqual(boxes.zone.meta, ["시험용 렌즈 감수위원", "2026-01-01"], "감수자(서명 기록의 공개 인물)·기준일");
  assert.match(html, /시험용 세목 가[\s\S]*시험용 세목 나/);
  assert.deepEqual(boxes.zone.sm, [], "sm_calculator 꺼짐 — SM 카드 0");
  // 같은 사업 유형의 다른 공개 프로젝트에도 같은 박스
  assert.deepEqual(lensBoxes(await detail(fx.P2)).zone?.points, ["시험용 첫째 포인트", "시험용 둘째 포인트"]);
});

test("d) 서명 뒤 고침 — 두 프로젝트 모두 박스 0 · 재감수 필요 · 옛 초안 시각 서명 409 · 다시 서명하면 새 문구", async () => {
  const oldAt = (await api("GET", `/project-lenses?type=${TYPE}`, u.reviewer)).body.types[0].stages.find((s) => s.key === "zone").row.drafted_at;
  const edit = await lenses(u.editor, draftBody("zone", { topics: ["시험용 세목 가"], points: ["시험용 고친 포인트"] }));
  assert.equal(edit.status, 200, show(edit));
  assert.equal(edit.body.lens.state, "rereview_needed");
  assert.equal(edit.body.lens.reviewed_by, null, "고치면 서명 지움");
  for (const p of [fx.P1, fx.P2]) assert.deepEqual(Object.keys(lensBoxes(await detail(p))), [], `${p.slug} — 다시 서명할 때까지 박스 0`);
  // 감수 화면 — 재감수 필요 표시
  const rv = await staffPage(u.reviewer);
  await rv.page.goto(`${base}/admin/projects/lenses`);
  await rv.page.locator(`li[data-lens-stage="zone"][data-lens-status="rereview_needed"]`).waitFor();
  assert.match(await rv.page.locator(`li[data-lens-stage="zone"] [data-lens-state]`).innerText(), /재감수 필요/);
  await rv.ctx.close();
  // 고치기 전 문구를 읽고 서명 → 409 (읽은 문구에만 서명)
  const stale = await lenses(u.reviewer, { op: "review", project_type: TYPE, stage: "zone", drafted_at: oldAt });
  assert.equal(stale.status, 409, show(stale));
  assert.equal((await lensRow("zone")).review_status, "rereview_needed");
  // 화면이 읽는 초안 시각(API 글자 그대로 — 마이크로초까지)
  const fresh = (await api("GET", `/project-lenses?type=${TYPE}`, u.reviewer)).body.types[0].stages.find((s) => s.key === "zone").row.drafted_at;
  assert.notEqual(fresh, oldAt);
  const again = await lenses(u.reviewer, { op: "review", project_type: TYPE, stage: "zone", drafted_at: fresh });
  assert.equal(again.status, 200, show(again));
  assert.equal(again.body.lens.state, "reviewed");
  const twice = await lenses(u.reviewer, { op: "review", project_type: TYPE, stage: "zone", drafted_at: fresh });
  assert.equal(twice.body.unchanged, true);
  for (const p of [fx.P1, fx.P2]) assert.deepEqual(lensBoxes(await detail(p)).zone?.points, ["시험용 고친 포인트"], `${p.slug} — 새 문구`);
  const none = await lenses(u.reviewer, { op: "review", project_type: TYPE, stage: "plan", drafted_at: fresh });
  assert.equal(none.status, 422, "초안 없는 단계 서명 422");
});

test("e) SM 취득세 카드 — 꺼짐 0 · 주소 비면 0 · 주소가 있으면 박스 옆(저장 주소 그대로·새 창·noreferrer·국세 배지 0) · 박스 없는 단계 0 · 입력 요소 0", async () => {
  await flags({ sm_calculator: true });
  assert.deepEqual(lensBoxes(await detail(fx.P1)).zone.sm, [], "키를 켜도 주소가 비면 0 (빈 링크 0)");
  await db.query("update public.official_links set url = $2, status = 'ok' where id = $1", [smRow0.id, SM_URL]);
  await flags({ sm_calculator: true }); // 캐시 만료
  const html = await detail(fx.P1);
  const boxes = lensBoxes(html);
  assert.deepEqual(boxes.zone.sm, [[SM_URL, "_blank", "noopener noreferrer"]], "이동 주소 = 저장 주소 그대로(쿼리·조각 0)");
  assert.equal(boxes.zone.national, 0, "취득세 — 국세 배지 0");
  assert.equal(Object.keys(boxes).length, 1, "박스 없는 단계에는 카드도 0");
  assert.equal((html.match(/data-part="go"/g) ?? []).length, 1, "SM 카드 1장");
  const main = html.match(/<main[\s\S]*<\/main>/)[0];
  assert.doesNotMatch(main, /<input|<select|<textarea|<form/, "공개 화면 입력 요소 0 (계산 입력 0)");
  assert.doesNotMatch(main, /\/calc\//, "자체 계산기 링크 0");
  await db.query("update public.official_links set url = $2, status = $3 where id = $1", [smRow0.id, smRow0.url, smRow0.status]);
  await flags({ sm_calculator: false });
  assert.deepEqual(lensBoxes(await detail(fx.P1)).zone.sm, [], "되돌림 — 카드 0");
});

test("f) 360·1280px 가로 넘침 0 · 접근성 95 (박스·카드가 있는 화면)", async () => {
  await db.query("update public.official_links set url = $2, status = 'ok' where id = $1", [smRow0.id, SM_URL]);
  await flags({ sm_calculator: true });
  try {
    const p = `/realestate/projects/${fx.P1.slug}`;
    for (const width of [360, 1280]) {
      const ctx = await browser.newContext({ viewport: { width, height: 800 } });
      const page = await ctx.newPage();
      assert.equal((await page.goto(`${base}${p}`)).status(), 200);
      await page.locator('[data-stage-lens="zone"] [data-ui="tax-lens-box"]').waitFor();
      assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${width}px 가로 넘침 0`);
      await ctx.close();
    }
    const a = await accessibility(`${base}${p}`, debugPort);
    assert.ok(a.score >= A11Y_MIN, `접근성 ${a.score} (미흡 ${a.failing.join(", ")})`);
  } finally {
    await db.query("update public.official_links set url = $2, status = $3 where id = $1", [smRow0.id, smRow0.url, smRow0.status]);
    await flags({ sm_calculator: false });
  }
});
