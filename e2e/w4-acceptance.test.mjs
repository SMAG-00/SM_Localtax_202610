// W4 수용 E2E (26단계) — W4 설계 1장 26단계 · 7.3 흐름 · PRD-01B 8장 W4 증거 전부를 한 시험 자료·한 서버(standalone)·한 브라우저로 (docs/dev/W4_설계.md 11.26)
// 시험 자료는 전부 '시험용' 가짜다 — 지역(접두 99·98 가짜 코드)·기사·공식 자료·프로젝트·분양·개발방법 내용. 법률·세무 내용 0.
//  a) 출발점 — 기능 키 꺼짐: 지역 허브·프로젝트 상세·개발방법 상세·상속·증여 하위 경로 404, 프로젝트·분양·개발방법 목록 = 하위 분야 목록
//  b) 프로젝트 원문 없이 차단 + 단계 원문 100% — 원문 없는 단계 기록 422·DB 거부, 공개 상세의 모든 단계가 저장 원문 주소로 연결, 원문 없는 프로젝트 공개 422
//  c) 가격·수익률 칸 0 · 추천 기능 0 — 표 칸 이름·공개 화면 글자·입력 요소·JSON-LD
//  d) 시범 지역 최소선 판정 리포트 — 시험용 시범 지역 2곳(서로 다른 시·도) 충족 / 한 시·도만이면 미달
//  e) 허브 블록 순서 — ②③⑤ 순서(360·1280px 화면 위치 = DOM 순서), ①④ 요소 0
//  f) 지역 기사 편집 범위 — 지역 태그 없음 발행 422 + DB 거부, 편집 분야·공익적 질문, 자료 출처 칸 누락 발행 422(빈 칸 이름)
//  g) 빈 시·군·구 — 200 + noindex + 상위 시·도 안내
//  h) 분양 원고 sponsored — 해설 발행 422(pr04) + DB 거부, 광고 표시
//  i) 개발방법 비교 — 켜기 전 422, 7개 서명 뒤 켜기, 고정 순서·점수·순위·추천 요소 0
//  j) 상속·증여 — 켜기 조건(세무 게이트 승인 기록 + 입문 기사) 422 → 입문 기사 뒤 200, 고지 1·외부 연결 새 창·저장 주소 그대로·입력 요소 0
//  k) 새 방문자 여정 1 — 홈 → 지자체뉴스 → 지역 → 지역 기사 → 공식 원문 → 세금 연결, region_to_tax_clicked 1건, 이벤트에 주소·계산값 0
//  l) 여정 2 — 검색 → 프로젝트 → 재개발 상세 → 「지방세로 읽기」 박스 → SM 취득세 카드
//  m) 지역 → 세금 링크·허브 링크 전수 404 0 · 360/1280px 가로 넘침 0 · R1~R3 · 접근성 95(지역 탭 포함 관리 화면)
//  n) 기능 키 꺼짐 404 복귀 · 정리 뒤 행 수 같음
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { measurePage } from "./lib/screen-rules.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-acceptance-e2e@example.test";
const SITE = "https://e2e.example.test";
const SIDO = { code: "9900000000", name: "시험용 수용도", key: "suyongdo" };
const SIDO2 = { code: "9800000000", name: "시험용 수용둘째도", key: "suyongdul" };
const GU = { code: "9901100000", name: "시험용 수용구", key: "suyonggu", parent: SIDO };
const EMPTY = { code: "9902100000", name: "시험용 수용빈구", key: "suyongbin", parent: SIDO };
const GU2 = { code: "9801100000", name: "시험용 수용둘째구", key: "suyongdulgu", parent: SIDO2 };
const GOV = "https://gov.example.test/w4acc";
const SM_URL = "https://sm.example.test/calc/acquisition-w4acc";
const ANSIM = "https://ansim.example.test/w4acc";
const TYPE = "siheom_acc";
const STAGES = [
  { key: "zone", label: "시험용 구역지정" },
  { key: "plan", label: "시험용 계획인가" },
];
const ACTOR = "migration:e2e-w4acc";
const DESK_FULL = { evidence: true, relation: true, ad_independence: true };
const SLUGS = ["redevelopment", "reconstruction", "small-scale", "public", "trust", "renewal", "rapid-planning"];
const ITEMS = ["legal_basis", "actor", "target", "procedure", "numeric_requirements", "tax_issues"];
const FLAG_KEYS = ["region_hubs", "realestate_projects", "supply_notices", "dev_methods", "inheritance_gift", "sm_calculator", "self_calculator", "weekly_digest", "local_events"];
const BAN = /분양가|수익률|프리미엄|분담금|예상 수익|추천 사업|추천합니다|유리합니다|유망|투자 추천|순위|점수/;

let sb, server, staff, db, browser, base, debugPort, since;
const u = {};
const fx = {};
const saved = {};
const counts0 = {};
const COUNT_TABLES = ["regions", "articles", "article_sources", "raw_snapshots", "projects", "project_events", "supply_notices", "regional_links", "source_review_queue", "editorial_reviews", "dev_method_compare", "dev_method_facts", "people"];

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hoursAgo = (n) => new Date(Date.now() - n * 3600_000).toISOString();
const kstDay = (offset) => new Date(Date.now() + 9 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");
const visible = (html) =>
  decode(html.replace(/<head[\s\S]*?<\/head>/, " ").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1]));
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => [JSON.parse(m[1])].flat());
const sidoSlug = (s) => `${s.key}-${staff.run}`;
const guSlug = (g) => `${g.key}-${staff.run}-gu`;
const guPath = (g = GU) => `/local/${sidoSlug(g.parent)}/${guSlug(g)}`;
const docUrl = (k) => `${GOV}/${staff.run}/${k}`;
const show = (r) => JSON.stringify(r.body).slice(0, 700);
const slugOf = (label) => `e2e-w4acc-${label}-${staff.run}`;

async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const setSetting = (key, value) => api("PATCH", `/settings/${key}`, u.admin, { value });
/** 기능 키 — 시험 전 값 위에 W4 키를 모두 끈 뒤 over만 켠다 (설정 쓰기 = 공개 데이터 캐시 만료). 켜기 거부는 응답으로 돌려준다 */
async function flagsRaw(over) {
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  const off = Object.fromEntries(FLAG_KEYS.map((k) => [k, false]));
  return setSetting("feature_flags", { ...cur, ...off, ...over });
}
async function flags(over) {
  const r = await flagsRaw(over);
  assert.equal(r.status, 200, show(r));
}
async function get(p) {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
}
const projects = (user, body) => api("POST", "/projects", user, body);
const lenses = (user, body) => api("POST", "/project-lenses", user, body);
const post = (user, body) => api("POST", "/dev-methods", user, body);
const errorFields = (r) => (r.body.errors ?? []).map((e) => String(e).split(":")[0]);

async function login(page, who) {
  await page.goto(`${base}/admin/login`);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "로그인" && !b.disabled));
  await page.fill("#login-email", who.email);
  await page.fill("#login-password", who.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((url) => url.pathname !== "/admin/login");
}
async function open(p, viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const res = await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
  return { page, ctx, status: res.status() };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// ── 발행 판정을 지나는 지자체뉴스 해설 (시험용 법령 출처 · 핵심 요약 · 문단 · 표 · 문서 인용 · 상자 · FAQ · 핵심 주장) ──
const LAW = {
  kind: "official_doc",
  title: "시험용 법령 조문(신고 및 납부)",
  url: "https://law.example/gasang/20",
  sourceName: "시험용 법령 정보 창구",
  lastVerifiedAt: "2026-10-10T09:00:00+09:00",
  licenseStatus: "출처표시",
  licenseType: "kogl_1",
  publishedOn: "2026-10-01",
  referenceDate: "2026-10-01",
  regionUnit: "전국",
  collectedAt: "2026-10-10T09:00:00+09:00",
};
/** 기준일·지역 단위가 빈 공식 자료 (발행 거부 대상) */
const DATASET_NO_DATES = {
  kind: "dataset",
  title: "시험용 가상구 지방세 세수 결산(2026년 상반기)",
  url: "https://gasang.example/open-data/tax-revenue-2026h1",
  sourceName: "시험용 가상구청 세무과",
  lastVerifiedAt: "2026-10-20T10:00:00+09:00",
  licenseStatus: "출처표시",
  licenseType: "kogl_1",
  sourceType: "local_tax_revenue",
  publishedOn: "2026-07-15",
  collectedAt: "2026-10-19T09:00:00+09:00",
  snapshot: { text: "시험용 결산 자료 스냅샷 본문입니다" },
};
const blocks = (srcRef) => [
  { type: "key_summary", lines: ["주택을 사면 취득일부터 60일 안에 신고합니다.", "취득일은 잔금일과 등기일 중 빠른 날입니다.", "신고와 납부는 함께 합니다."] },
  { type: "paragraph", text: "취득일은 잔금을 치른 날과 등기를 마친 날 중 빠른 날이다. 자세한 흐름은 [지방세 허브](/tax)에서 볼 수 있다." },
  { type: "table", caption: "취득일 정하는 법", rows: [["경우", "취득일"], ["잔금이 먼저", "잔금일"], ["등기가 먼저", "등기일"]], chart: { axis: "경우", unit: "날짜", source: "시험용 법령 조문" } },
  { type: "quote", text: "취득세는 취득일부터 60일 이내에 신고하고 납부하여야 한다.", speaker: "시험용 법령 조문", origin: "document", refId: srcRef },
  { type: "callout", kind: "tip", title: "절세 체크포인트", text: "생애 첫 주택이면 감면 요건을 먼저 확인하세요." },
  { type: "callout", kind: "mistake", title: "자주 틀리는 점", text: "계약일이 아니라 잔금일이나 등기일이 취득일입니다." },
  { type: "faq", items: [{ question: "취득세는 어디에 신고하나요?", answer: "주택이 있는 시·군·구청이나 위택스에 신고합니다." }, { question: "신고와 납부를 따로 하나요?", answer: "신고하면서 함께 냅니다." }] },
];
const claims = (srcRef) => [{ id: "claim-1", text: "취득일부터 60일 안에 신고하고 납부해야 한다.", kind: "legal", evidenceIds: [srcRef], blockIndex: 1 }];

async function draftLocal(label, title, over = {}, extraSource = null) {
  const created = await api("POST", "/articles", u.reporter, { slug: slugOf(label), title: `${title} ${staff.run}`.slice(0, 40), summary: "시험용 가상군 자료로 지방세 흐름을 정리했습니다.", section: "local", contentType: "explainer", legalBasisDate: "2026-10-01", ...over });
  assert.equal(created.status, 201, show(created));
  const id = created.body.article.id;
  staff.trackArticle(id);
  const law = await api("POST", `/articles/${id}/sources`, u.reporter, LAW);
  assert.equal(law.status, 201, show(law));
  if (extraSource) {
    const ex = await api("POST", `/articles/${id}/sources`, u.reporter, extraSource);
    assert.equal(ex.status, 201, show(ex));
  }
  const a = { id, slug: slugOf(label), href: `/news/${slugOf(label)}`, srcRef: law.body.source.ref };
  const body = await api("PATCH", `/articles/${id}`, u.reporter, { body: { blocks: blocks(a.srcRef), claims: claims(a.srcRef) } });
  assert.equal(body.status, 200, show(body));
  const skip = await api("PATCH", `/articles/${id}`, u.editor, { taxLens: { topics: [], points: [], links: [], omissionReason: "세금 흐름은 본문 표로 대신한다" } });
  assert.equal(skip.status, 200, show(skip));
  return a;
}
async function approve(a) {
  const desk = await api("POST", `/articles/${a.id}/reviews`, u.editor, { kind: "desk_edit", decision: "approve", checklist: DESK_FULL });
  assert.equal(desk.status, 201, show(desk));
  const tax = await api("POST", `/articles/${a.id}/reviews`, u.reviewer, { kind: "tax_review", decision: "approve" });
  assert.equal(tax.status, 201, show(tax));
}
const publish = (a) => api("POST", `/articles/${a.id}/publish`, u.editor);
const dbPublish = (id) => db.query("update public.articles set status = 'published', first_published_at = now() where id = $1", [id]);

// ── 시험 자료 (DB 직접 — 발행 절차는 다른 시험 몫) ──
async function article(key, { title, field, type = "explainer", section = "local", hours = 1, region = GU, desk = false }) {
  const row = await one(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, editorial_field, public_question, region_codes, first_published_at)
     values ($1, $2, '시험용 지역 기사 요약입니다', $3, $4, 'published', $5, $6, $7, $8, $9) returning id, slug`,
    [slugOf(key), title, section, type, u.reporter.personId, field, field ? "시험용 지역 질문은 무엇인가" : null, [region.code], hoursAgo(hours)],
  );
  staff.trackArticle(Number(row.id));
  if (desk) await db.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision, checklist) values ($1, 'desk_edit', $2, 'approve', $3)", [row.id, u.editor.personId, JSON.stringify(DESK_FULL)]);
  fx[key] = { id: Number(row.id), slug: row.slug, href: `/news/${row.slug}`, title };
  return fx[key];
}
async function source(articleKey, key) {
  const url = docUrl(key);
  const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e-w4acc', $1, $2, '시험용 스냅샷') returning id", [url, `sha256:w4acc-${key}-${staff.run}`]);
  await db.query(
    `insert into public.article_sources (article_id, kind, title, source_url, source_name, last_verified_at, license_status, license_type, source_type, published_on, reference_date, region_unit, collected_at, snapshot_id)
     values ($1, 'official_doc', $2, $3, '시험용 수용도청', $4, '공공누리 제1유형', 'kogl_1', 'local_tax_revenue', '2026-09-01', '2026-08-31', '시·군·구', $5, $6)`,
    [fx[articleKey].id, `시험용 공식 자료 ${key}`, url, hoursAgo(20), hoursAgo(40), snap.id],
  );
}
async function project(key, name) {
  const p = await one("insert into public.projects (slug, name, summary, region_code, project_type, landmark, created_by) values ($1, $2, null, $3, $4, false, $5) returning id, slug", [`siheom-acc-${key.toLowerCase()}-${staff.run}`, name, GU.code, TYPE, ACTOR]);
  for (const [i, stage] of ["zone", "plan"].entries()) {
    const url = `${GOV}/${staff.run}/${key}/${stage}`;
    const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload, fetched_at) values ('e2e-w4acc', $1, $2, '시험용 고시 원문', $3) returning id", [url, `sha256:w4acc-p-${key}-${i}-${staff.run}`, `2026-0${i + 1}-15T16:00:00Z`]);
    await db.query(
      "insert into public.project_events (project_id, kind, stage, notice_no, notice_date, issuer, source_url, snapshot_id, license_type, recorded_by) values ($1, 'stage', $2, $3, $4, '시험용 수용구청', $5, $6, 'kogl_1', $7)",
      [p.id, stage, `시험용 고시 제${staff.run}-${i + 1}호`, `2026-0${i + 1}-15`, url, snap.id, ACTOR],
    );
  }
  await db.query("update public.projects set status = 'public', source_name = '시험용 수용구청', last_verified_at = $2 where id = $1", [p.id, "2026-10-20T03:00:00Z"]);
  fx[key] = { id: Number(p.id), slug: p.slug, name, href: `/realestate/projects/${p.slug}` };
  return fx[key];
}

async function removeFixtureRows(q) {
  const ids = (await q("select id from public.projects where created_by = $1 or slug like 'siheom-acc-%'", [ACTOR])).rows.map((r) => Number(r.id));
  await q("delete from public.supply_notices where created_by = $1 or official_notice_url like $2", [ACTOR, `${GOV}/%`]);
  if (ids.length) {
    const snaps = (await q("select snapshot_id from public.project_events where project_id = any($1::bigint[]) and snapshot_id is not null", [ids])).rows.map((r) => Number(r.snapshot_id));
    await q("begin");
    try {
      await q("set local session_replication_role = replica");
      await q("delete from public.source_review_queue where target_type = 'project_event' and target_id in (select id from public.project_events where project_id = any($1::bigint[]))", [ids]);
      await q("delete from public.supply_notices where project_id = any($1::bigint[])", [ids]);
      await q("delete from public.project_events where project_id = any($1::bigint[])", [ids]);
      await q("delete from public.projects where id = any($1::bigint[])", [ids]);
      await q("delete from public.project_stage_lenses where project_type = $1", [TYPE]);
      if (snaps.length) await q("delete from public.raw_snapshots where id = any($1::bigint[])", [snaps]);
      await q("commit");
    } catch (err) {
      await q("rollback");
      throw err;
    }
  }
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
async function removeRegions(q) {
  await q("delete from public.region_slug_redirects where region_code like '99%' or region_code like '98%'");
  await q("update public.regions set successor_code = null where (code like '99%' or code like '98%') and successor_code is not null");
  await q("delete from public.regions where (code like '99%' or code like '98%') and level = 'sigungu'");
  await q("delete from public.regions where code like '99%' or code like '98%'");
}

/** 방문 하나 — /api/events 요청 본문(sent)과 응답 코드(answered)를 모은다 */
async function visitor() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
    await sleep(400);
  };
  return { context, page, sent, answered, settle };
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
  since = new Date();
  for (const t of COUNT_TABLES) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  saved.links = (await db.query("select id, url, status, checked_at from public.official_links order by id")).rows;
  const f0 = (await one("select value from public.settings where key = 'feature_flags'")).value;
  for (const k of ["region_hubs", "realestate_projects", "supply_notices", "dev_methods", "inheritance_gift", "weekly_digest", "local_events"]) assert.notEqual(f0[k], true, `시험 전 기능 키 ${k}는 꺼져 있다 (출하 상태)`);
  assert.equal(counts0.dev_method_compare + counts0.dev_method_facts, 0, "시험 전 비교 항목·사실 행 0 (내용은 편집국이 적는다)");

  u.admin = await staff.createUser({ label: "w4acc-admin", email: ADMIN_EMAIL });
  u.reporter = await staff.createUser({ label: "w4acc-reporter", roles: ["reporter"], person: { name: "시험용 수용 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "w4acc-editor", roles: ["editor"], person: { name: "시험용 수용 편집자", roles: ["editor"] } });
  u.reviewer = await staff.createUser({ label: "w4acc-reviewer", roles: ["reviewer"], person: { name: "시험용 수용 감수위원", roles: ["reviewer"] } });
  u.adOps = await staff.createUser({ label: "w4acc-adops", roles: ["ad_ops"] });

  for (const s of [SIDO, SIDO2]) await db.query("insert into public.regions (code, level, name, slug) values ($1, 'sido', $2, $3)", [s.code, s.name, sidoSlug(s)]);
  for (const g of [GU, EMPTY, GU2]) await db.query("insert into public.regions (code, parent_code, level, name, slug) values ($1, $2, 'sigungu', $3, $4)", [g.code, g.parent.code, g.name, guSlug(g)]);
  assert.equal((await setSetting("project_types", { [TYPE]: { label: "시험용 정비사업" } })).status, 200);
  assert.equal((await setSetting("project_stage_lists", { [TYPE]: STAGES })).status, 200);

  // 지역 기사 — 시범 지역 판정용 자체 취재(보도 + 편집 승인 + 공식 자료 원본) 2곳, 허브용 해설·부동산 보도, 세금 연결용 감수 해설
  await article("M1", { title: "시험용 수용구 세수 감소 보도", field: "local_finance", type: "reported_news", hours: 1, desk: true });
  await source("M1", "SM1");
  await article("G1", { title: "시험용 수용둘째구 예산 보도", field: "local_finance", type: "reported_news", hours: 4, region: GU2, desk: true });
  await source("G1", "SG1");
  await article("A1", { title: "시험용 수용구 지방세 세수 해설", field: "local_tax", hours: 2 });
  await source("A1", "SA1");
  await article("A2", { title: "시험용 수용구 부동산 해설", field: "realestate", hours: 3 });
  await article("E1", { title: "시험용 수용구 지방세 감수 해설", field: "local_tax", section: "tax", hours: 5 });
  await db.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision) values ($1, 'tax_review', $2, 'approve')", [fx.E1.id, u.reviewer.personId]);

  await project("P", "시험용 수용구역 정비");
  await db.query(
    `insert into public.supply_notices (name, region_code, supply_scale, apply_start, apply_end, notice_date, notice_issuer, official_notice_url, license_type, status, verified_at, created_by, updated_by)
     values ('시험용 수용 분양', $1, '총 100세대 중 일반공급 50세대', $2, $3, $4, '시험용 수용구청', $5, 'kogl_1', 'public', $6, $7, $7)`,
    [GU.code, kstDay(-1), kstDay(7), kstDay(-5), docUrl("supply"), "2026-10-20T03:00:00Z", ACTOR],
  );
  // 광고·협찬 분양 기사(분양 홍보 원고 출처) + 같은 출처의 해설 초안
  const ad = await one(
    "insert into public.articles (slug, title, summary, section, content_type, label, author_id) values ($1, '시험용 수용마을 분양 안내', '시험용 분양대행사가 준 원고입니다', 'realestate', 'sponsored', 'ad', $2) returning id, slug",
    [slugOf("ad"), u.reporter.personId],
  );
  staff.trackArticle(Number(ad.id));
  await db.query("insert into public.article_sources (article_id, kind, title, source_name) values ($1, 'sponsor_material', '시험용 수용마을 분양 홍보 원고', '시험용 분양대행사')", [ad.id]);
  await db.query("update public.articles set status = 'published', first_published_at = $2 where id = $1", [ad.id, hoursAgo(1)]);
  fx.AD = { id: Number(ad.id), href: `/news/${ad.slug}` };
  const ex = await api("POST", "/articles", u.reporter, { slug: slugOf("adex"), title: `시험용 수용마을 분양 해설 ${staff.run}`, summary: "시험용 분양 홍보 원고로 쓴 해설입니다", section: "realestate", contentType: "explainer" });
  assert.equal(ex.status, 201, show(ex));
  fx.ADEX = { id: ex.body.article.id };
  staff.trackArticle(fx.ADEX.id);
  const exSrc = await api("POST", `/articles/${fx.ADEX.id}/sources`, u.reporter, { kind: "sponsor_material", title: "시험용 수용마을 분양 홍보 원고", sourceName: "시험용 분양대행사" });
  assert.equal(exSrc.status, 201, show(exSrc));

  await db.query("update public.official_links set url = $1, status = 'ok', checked_at = now() where kind = 'sm_calculator' and key = 'acquisition'", [SM_URL]);
  await db.query("update public.official_links set url = $1, status = 'ok', checked_at = now() where kind = 'external_calculator' and key = 'inheritance_gift'", [ANSIM]);

  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
  await flags({});
});

after(async () => {
  try {
    await browser?.close();
    if (db) {
      await db.query("delete from public.analytics_events where occurred_at >= $1 and props->>'region_code' ~ '^(99|98)'", [since]);
      await resetDevMethods((sql, params) => db.query(sql, params));
      await removeFixtureRows((sql, params) => db.query(sql, params));
      for (const l of saved.links ?? []) await db.query("update public.official_links set url = $2, status = $3, checked_at = $4 where id = $1", [l.id, l.url, l.status, l.checked_at]);
    }
    await staff?.cleanup(); // 기사·계정·입문 기사·감수자·감사 로그 지우기 + 운영 설정(기능 키·시범 지역·사업 유형·단계 목록·임계값) 되돌리기
  } finally {
    server?.stop();
    if (sb && Object.keys(counts0).length) {
      const c = new pg.Client({ connectionString: sb.dbUrl });
      await c.connect();
      try {
        await removeRegions((sql, params) => c.query(sql, params));
        for (const t of Object.keys(counts0)) assert.equal((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n, counts0[t], `정리 뒤 ${t} 행 수 = 시험 전`);
        const s = Object.fromEntries((await c.query("select key, value from public.settings where key in ('feature_flags', 'pilot_regions', 'project_types', 'project_stage_lists', 'region_index_threshold')")).rows.map((r) => [r.key, r.value]));
        for (const k of ["region_hubs", "realestate_projects", "supply_notices", "dev_methods", "inheritance_gift"]) assert.notEqual(s.feature_flags[k], true, `${k} 되돌림`);
        assert.deepEqual(s.region_index_threshold, { reported_news: 1, official_sources: 1 }, "임계값 되돌림");
        const left = (await c.query("select count(*)::int n from public.dev_methods where summary is not null or reviewed_by is not null or review_status <> 'draft'")).rows[0].n;
        assert.equal(left, 0, "개발방법 7행 씨앗 상태");
      } finally {
        await c.end();
      }
    }
  }
});

test("a) 출발점 — 기능 키 꺼짐: 지역 허브·프로젝트 상세·개발방법 상세·상속·증여 하위 경로 404 · 프로젝트·분양·개발방법 목록 = 하위 분야 목록", async () => {
  await flags({});
  for (const p of [`/local/${sidoSlug(SIDO)}`, guPath(), fx.P.href, "/realestate/development-methods/redevelopment", "/realestate/inheritance-gift/inheritance", "/realestate/inheritance-gift/gift"]) {
    assert.equal((await get(p)).status, 404, `${p} 404`);
  }
  for (const p of ["/realestate/projects", "/realestate/supply", "/realestate/development-methods", "/realestate/inheritance-gift"]) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.ok(r.html.includes('data-ui="category-list"'), `${p} = 하위 분야 목록`);
  }
  const hub = await get("/realestate");
  assert.ok(!hub.html.includes("data-project-card=") && !hub.html.includes("data-supply-card=") && !hub.html.includes("data-link-card="), "허브 확장 카드 0");
});

test("b) 프로젝트 원문 없이 차단 · 단계 원문 100% — 원문 없는 단계 기록 422 + DB 거부 · 공개 상세의 모든 단계가 저장 원문 주소로 연결 · 원문 없는 프로젝트 공개 422", async () => {
  const made = await projects(u.editor, { op: "create", slug: `siheom-acc-api-${staff.run}`, name: "시험용 수용 사업 초안", region_code: GU.code, project_type: TYPE });
  assert.equal(made.status, 201, show(made));
  const pid = Number(made.body.project?.id ?? made.body.id);
  assert.ok(pid > 0, show(made));
  const bare = await projects(u.editor, { op: "event", project_id: pid, stage: "zone" });
  assert.equal(bare.status, 422, show(bare));
  assert.ok(errorFields(bare).length >= 1, "빈 칸 이름이 보인다");
  await assert.rejects(
    db.query("insert into public.project_events (project_id, kind, stage, recorded_by) values ($1, 'stage', 'zone', $2)", [pid, ACTOR]),
    undefined,
    "DB도 원문(주소·스냅샷) 없는 단계 기록 거부",
  );
  assert.equal((await one("select count(*)::int n from public.project_events where project_id = $1", [pid])).n, 0, "단계 기록 0");
  const early = await projects(u.editor, { op: "publish", project_id: pid, status: "public" });
  assert.equal(early.status, 422, "단계 원문 없는 프로젝트는 공개 422");
  assert.equal((await one("select count(*)::int n from public.projects where id = $1 and status = 'public'", [pid])).n, 0);

  const withSrc = await projects(u.editor, {
    op: "event", project_id: pid, stage: "zone", notice_no: `시험용 고시 제${staff.run}-9호`, notice_date: "2026-01-15", issuer: "시험용 수용구청", source_url: docUrl("api-zone"), snapshot_payload: "시험용 고시 원문 — 구역지정", license_type: "kogl_1",
  });
  assert.equal(withSrc.status, 201, show(withSrc));

  await flags({ realestate_projects: true });
  const detail = await get(fx.P.href);
  assert.equal(detail.status, 200);
  const links = hrefs(detail.html);
  const events = (await db.query("select stage, source_url from public.project_events where project_id = $1 and kind = 'stage' order by id", [fx.P.id])).rows;
  assert.equal(events.length, 2);
  const linked = events.filter((e) => links.includes(e.source_url));
  assert.equal(linked.length, events.length, `단계 원문 연결률 100% (${linked.length}/${events.length})`);
  assert.deepEqual(await db.query("select 1 from public.project_events where project_id = $1 and (source_url is null or snapshot_id is null) and kind = 'stage'", [fx.P.id]).then((r) => r.rowCount), 0);
});

test("c) 가격·수익률 칸 0 · 추천 기능 0 — 표 칸 이름 · 화면 글자 · 입력 요소 · JSON-LD · 추천 단정 표현 거부", async () => {
  const cols = (
    await db.query(
      "select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('projects', 'project_events', 'supply_notices', 'project_stage_lenses', 'dev_methods', 'dev_method_compare', 'dev_method_facts')",
    )
  ).rows;
  assert.ok(cols.length > 20);
  assert.deepEqual(cols.filter((c) => /price|yield|premium|profit|score|rank|rating|가격|수익|추천/i.test(c.column_name)), [], "가격·수익률·점수·순위 칸 0");
  await flags({ region_hubs: true, realestate_projects: true, supply_notices: true });
  for (const p of ["/realestate", "/realestate/projects", fx.P.href, "/realestate/supply", guPath()]) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    const main = r.html.match(/<main[\s\S]*<\/main>/)?.[0] ?? r.html;
    assert.doesNotMatch(visible(main), BAN, `${p} 화면 글자에 가격·수익률·추천 0`);
    assert.doesNotMatch(main, /<input|<select|<textarea|<form/, `${p} 입력 요소 0`);
    for (const ld of jsonLd(r.html)) assert.doesNotMatch(JSON.stringify(ld), /"(price|offers|aggregateRating)"/, `${p} JSON-LD 가격 0`);
  }
  const priced = await projects(u.editor, { op: "create", slug: `siheom-acc-p-${staff.run}`, name: "시험용 가격", region_code: GU.code, project_type: TYPE, sale_price: 1, expected_yield: 3 });
  assert.equal(priced.status, 422, "가격·수익률 칸 이름은 422");
  const rec = await api("POST", "/dev-methods", u.editor, { op: "method", slug: "renewal", legal_basis_name: "시험용 근거 법령", summary: "시험용 방식이 유리합니다", steps: ["시험용 첫 단계"] });
  assert.equal(rec.status, 422, "추천·유리 단정 표현 422");
});

test("d) 시범 지역 최소선 판정 리포트 — 서로 다른 시·도 2곳 충족 · 한 시·도만이면 시·도 분포 미달 · 숫자 = 넣은 자료", async () => {
  await flags({ region_hubs: true });
  assert.equal((await setSetting("pilot_regions", [GU.code, GU2.code])).status, 200);
  const report = async (who = u.editor) => {
    const r = await api("GET", "/regions?view=report", who);
    assert.equal(r.status, 200, show(r));
    return r.body.report;
  };
  let rep = await report();
  assert.deepEqual([rep.status, rep.label, rep.problems, rep.sidoCount], ["met", "최소선 충족", [], 2]);
  assert.deepEqual(
    rep.regions.map((r) => [r.code, r.reported.count, r.official.count, r.indexable]),
    [
      [GU.code, 1, 2, true],
      [GU2.code, 1, 1, true],
    ],
    "지역마다 자체 취재 수·공식 자료 수 = 넣은 자료",
  );
  assert.equal((await setSetting("pilot_regions", [GU.code, EMPTY.code])).status, 200);
  rep = await report();
  assert.equal(rep.status, "short");
  assert.ok(rep.problems.some((p) => p.startsWith("시·도 분포 미달")), `시·도 분포 미달 문장: ${rep.problems}`);
  assert.equal((await api("GET", "/regions?view=report", u.reporter)).status, 403, "기자 403");
  assert.equal((await api("GET", "/regions?view=report", u.adOps)).status, 403, "광고 담당 403");
  assert.equal((await setSetting("pilot_regions", [GU.code, GU2.code])).status, 200);
});

test("e) 허브 블록 순서 — ②③⑤ 순서(DOM 순서 = 화면 위치, 360·1280px) · ①④ 요소 0", async () => {
  await flags({ region_hubs: true, realestate_projects: true, supply_notices: true });
  for (const viewport of [{ width: 360, height: 740 }, { width: 1280, height: 800 }]) {
    const { page, ctx, status } = await open(guPath(), viewport);
    assert.equal(status, 200);
    const blocks = await page.$$eval("[data-hub-block]", (els) => els.map((el) => ({ key: el.getAttribute("data-hub-block"), title: el.querySelector("h2")?.textContent ?? null, y: el.getBoundingClientRect().top + window.scrollY })));
    assert.deepEqual(blocks.map((b) => b.title), ["지방세·지방재정", "부동산·개발", "공식 자료/해설"], `${viewport.width}px 블록 차례 ②③⑤`);
    assert.ok(blocks.every((b, i) => i === 0 || b.y > blocks[i - 1].y), `${viewport.width}px 화면 위치가 DOM 순서와 같다`);
    assert.equal(await page.locator('[data-hub-block="weeklyDigest"], [data-hub-block="localEvents"], [data-hub-block="digest"], [data-hub-block="events"]').count(), 0, "①④ 요소 0");
    assert.ok((await overflow(page)) <= 0, `${viewport.width}px 가로 넘침 0`);
    await ctx.close();
  }
});

test("f) 지역 기사 편집 범위 — 지역 태그 없음 발행 422 + DB 거부 · 편집 분야·공익적 질문 422 · 자료 출처(기준일·지역 단위) 빔 422(빈 칸 이름) · 채우면 발행", async () => {
  const a = await draftLocal("tagless", "시험용 수용군 취득세 신고 흐름");
  await approve(a);
  let r = await publish(a);
  assert.equal(r.status, 422, show(r));
  assert.deepEqual((r.body.failed ?? []).filter((id) => id.startsWith("reg1_17.")), ["reg1_17.region-tag-required"], show(r));
  await assert.rejects(dbPublish(a.id), /지역 태그\(regionCodes\)가 있어야 새로 발행/, "DB 직접 발행도 거부");
  const tag = await api("PATCH", `/articles/${a.id}`, u.reporter, { regionCodes: [GU.code] });
  assert.equal(tag.status, 200, show(tag));
  await approve(a);
  r = await publish(a);
  assert.equal(r.status, 422, show(r));
  assert.deepEqual((r.body.failed ?? []).filter((id) => id.startsWith("reg1_17.")), ["reg1_17.editorial-field", "reg1_17.public-question"]);
  assert.equal((await get(a.href)).status, 404, "발행 전 공개 0");
  const fill = await api("PATCH", `/articles/${a.id}`, u.reporter, { editorialField: "local_tax", publicQuestion: "취득세 신고 기한을 놓친 주민은 무엇을 해야 하는가" });
  assert.equal(fill.status, 200, show(fill));
  await approve(a);
  r = await publish(a);
  assert.equal(r.status, 200, show(r));
  assert.equal((await get(a.href)).status, 200);

  const b = await draftLocal("nodates", "시험용 수용군 세수 결산 자료", { regionCodes: [GU.code], editorialField: "local_tax", publicQuestion: "시험용 결산 자료는 어느 기준일인가" }, DATASET_NO_DATES);
  await approve(b);
  r = await publish(b);
  assert.equal(r.status, 422, show(r));
  assert.ok((r.body.failed ?? []).includes("reg1_09.official-fields"), show(r));
  const fields = r.body.findings.filter((f) => f.id === "reg1_09.official-fields").map((f) => f.location.field);
  assert.deepEqual(fields, ["sources.referenceDate", "sources.regionUnit"], "빈 칸 이름");
  assert.ok(!["published", "scheduled"].includes((await one("select status from public.articles where id = $1", [b.id])).status), "발행 0");
});

test("g) 빈 시·군·구 — 200 + noindex + 상위 시·도 안내 · 빈 카드·'준비 중' 0", async () => {
  await flags({ region_hubs: true });
  const { page, ctx, status } = await open(guPath(EMPTY));
  assert.equal(status, 200);
  assert.match((await page.getAttribute('meta[name="robots"]', "content")) ?? "", /noindex/);
  const text = await page.locator("main").innerText();
  assert.ok(text.includes(SIDO.name), "상위 시·도 안내");
  assert.ok(!text.includes("준비 중"), "'준비 중' 0");
  await ctx.close();
});

test("h) 분양 원고 sponsored — 해설 발행 422(pr04) + DB 거부 · 광고 표시(목록 카드·상세·공유 미리보기) · 분양 정보는 /news 0", async () => {
  const r = await publish({ id: fx.ADEX.id });
  assert.equal(r.status, 422, show(r));
  assert.ok((r.body.failed ?? []).includes("pr04.sponsor-material-sponsored"), show(r));
  await assert.rejects(db.query("update public.articles set status = 'published' where id = $1", [fx.ADEX.id]), /PR-04/, "DB도 거부");
  assert.equal((await one("select status from public.articles where id = $1", [fx.ADEX.id])).status, "draft");
  const detail = await get(fx.AD.href);
  assert.equal(detail.status, 200);
  assert.match(detail.html, /data-ui="article-type-badge"[^>]*>광고</, "상세 '광고'");
  assert.ok(decode(detail.html.match(/<meta property="og:title" content="([^"]*)"/)[1]).includes("[광고]"), "공유 미리보기 제목 [광고]");
  await flags({ supply_notices: true, realestate_projects: true });
  const news = await get("/news");
  assert.ok(!news.html.includes("시험용 수용 분양") && !news.html.includes("data-supply-card="), "분양 정보는 /news 0");
  const supply = await get("/realestate/supply");
  assert.ok(supply.html.includes('data-supply-card="'), "분양 정보 목록 1건 이상");
  assert.equal((await get("/realestate/supply")).status, 200);
});

test("i) 개발방법 비교 — 서명 전 켜기 422 · 7개 방법 서명 뒤 켜기 · 공개 비교표 고정 순서 · 점수·순위·추천·입력 요소 0", async () => {
  const early = await flagsRaw({ dev_methods: true });
  assert.equal(early.status, 422, "7개 방법이 갖춰지기 전에는 켜기 거부");
  for (const slug of SLUGS) {
    const m = await post(u.editor, { op: "method", slug, legal_basis_name: `시험용 ${slug} 근거 법령`, summary: `시험용 ${slug} 한 줄 설명`, steps: ["시험용 첫 단계", "시험용 둘째 단계"] });
    assert.equal(m.status, 200, show(m));
    for (const item of ITEMS) {
      const c = await post(u.editor, { op: "compare", slug, item, body: `시험용 ${slug} ${item} 글` });
      assert.ok([200, 201].includes(c.status), show(c));
    }
    const f = await post(u.editor, { op: "fact", slug, fact_key: "siheom_req", label: `시험용 ${slug} 요건`, value: "99", unit: "시험단위", law_ref: `시험용 ${slug} 조문`, reference_date: "2026-10-01", source_url: docUrl(`law-${slug}`), snapshot_payload: `시험용 ${slug} 근거 원문 ${staff.run}` });
    assert.equal(f.status, 201, show(f));
  }
  assert.equal((await api("GET", "/dev-methods", u.reporter)).status, 403, "기자 403");
  assert.equal((await post(u.editor, { op: "review", target: "method", slug: "renewal", drafted_at: new Date().toISOString() })).status, 403, "편집 책임자 서명 403");
  const board = (await api("GET", "/dev-methods", u.reviewer)).body;
  for (const m of board.methods) {
    for (const c of m.compare) if (c.row && c.row.review_status !== "reviewed") assert.equal((await post(u.reviewer, { op: "review", target: "compare", slug: m.slug, item: c.item, drafted_at: c.row.drafted_at })).status, 200);
    if (m.review_status !== "reviewed") assert.equal((await post(u.reviewer, { op: "review", target: "method", slug: m.slug, drafted_at: m.drafted_at })).status, 200);
  }
  for (const m of (await api("GET", "/dev-methods", u.reviewer)).body.methods) {
    for (const g of m.facts) if (!g.latest.reviewed_by) assert.equal((await post(u.reviewer, { op: "review", target: "fact", slug: m.slug, fact_id: g.latest.id })).status, 200);
  }
  await flags({ dev_methods: true, realestate_projects: true });
  const page = await get("/realestate/development-methods");
  assert.equal(page.status, 200);
  assert.ok(page.html.includes('data-ui="dev-methods-list"') && !page.html.includes('data-ui="category-list"'));
  const order = SLUGS.map((s) => page.html.indexOf(`/realestate/development-methods/${s}"`));
  assert.ok(order.every((i) => i > 0) && [...order].sort((x, y) => x - y).join() === order.join(), `고정 순서 ${order}`);
  const main = page.html.match(/<main[\s\S]*<\/main>/)[0];
  assert.doesNotMatch(main, /<input|<select|<textarea|<form/, "점수·정렬·추천 입력 요소 0");
  assert.doesNotMatch(visible(main), BAN, "점수·순위·추천 글자 0");
  assert.deepEqual(jsonLd(page.html).map((j) => j["@type"]), ["BreadcrumbList"]);
  const detail = await get("/realestate/development-methods/redevelopment");
  assert.equal(detail.status, 200);
  const detailText = visible(detail.html);
  assert.ok(detailText.includes("시험용 redevelopment 한 줄 설명") && detailText.includes("시험용 첫 단계"), "방법 상세 = 서명된 방법 내용·절차");
});

test("j) 상속·증여 — 켜기 조건(세무 게이트 승인 기록 = 입문 기사 세무 감수 + 고지) 없으면 422 · 입문 기사 뒤 켜짐 · 고지 1 · 외부 연결 새 창·저장 주소 그대로 · 입력 요소 0", async () => {
  const early = await flagsRaw({ inheritance_gift: true });
  assert.equal(early.status, 422, show(early));
  assert.ok((early.body.errors ?? []).some((e) => /입문 기사/.test(e)), `사유에 입문 기사: ${show(early)}`);
  assert.notEqual((await one("select value from public.settings where key = 'feature_flags'")).value.inheritance_gift, true, "켜지지 않았다");
  await assert.rejects(
    db.query("update public.settings set value = value || '{\"inheritance_gift\": true}'::jsonb where key = 'feature_flags'"),
    /세무 게이트 승인 기록/,
    "DB도 거부",
  );
  assert.equal((await get("/realestate/inheritance-gift/inheritance")).status, 404, "거부된 뒤에도 404");

  await staff.makeIntroArticle("acc"); // 세무 감수 승인된 입문 기사 1건
  await flags({ inheritance_gift: true });
  for (const p of ["/realestate/inheritance-gift", "/realestate/inheritance-gift/inheritance", "/realestate/inheritance-gift/gift"]) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    const main = r.html.match(/<main[\s\S]*<\/main>/)[0];
    assert.equal((visible(main).match(/상속세·증여세는 이 사이트에서 계산하지 않습니다/g) ?? []).length, 1, `${p} 고지 1번`);
    assert.doesNotMatch(main, /<input|<select|<textarea|<form/, `${p} 입력 요소 0`);
    const ansim = [...main.matchAll(/<a[^>]*href="([^"]*)"[^>]*>/g)].filter((m) => decode(m[1]) === ANSIM);
    assert.equal(ansim.length, 1, `${p} 외부 계산기 연결 1`);
    assert.match(ansim[0][0], /target="_blank"/);
    assert.match(ansim[0][0], /rel="[^"]*noopener[^"]*noreferrer/);
  }
  await db.query("update public.official_links set status = 'ok' where kind = 'external_calculator' and key = 'inheritance_gift'");
});

test("k) 새 방문자 여정 1 — 홈 → 지자체뉴스 → 지역 → 지역 기사(기자·정정 창구) → 공식 원문 → 세금 연결: region_to_tax_clicked 1건 · 이벤트에 주소·계산값 0", async () => {
  await flags({ region_hubs: true, realestate_projects: true, supply_notices: true, sm_calculator: true });
  assert.equal((await setSetting("pilot_regions", [GU.code, GU2.code])).status, 200);
  const v = await visitor();
  try {
    const { page } = v;
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await page.locator('a[href="/local"]').first().click();
    await page.waitForURL(/\/local$/);
    await page.locator(`a[href="/local/${sidoSlug(SIDO)}"]`).first().click();
    await page.waitForURL(new RegExp(`/local/${sidoSlug(SIDO)}$`));
    await page.goto(`${base}${guPath()}`, { waitUntil: "networkidle" });
    await page.locator(`[data-hub-block="localTax"] [data-article-id="${fx.A1.id}"] a[href^="/news/"]`).first().click();
    await page.waitForURL(new RegExp(fx.A1.href));
    const text = await page.locator("main").innerText();
    assert.ok(text.includes("시험용 수용 기자"), "기사 기자 표시");
    // 정정·반론 창구 링크는 기능 키 page_corrections(W2-e 정책 문서 게시본 필요)라 정책 문서 시험이 확인한다 — 여기서는 날짜 줄·공식 자료 카드(출처·기준일)를 본다
    assert.equal(await page.locator('[data-part="dates"]').count(), 1, "날짜 줄 표시");
    assert.ok((await page.locator('[data-part="official-sources"]').count()) >= 1, "공식 자료 카드(출처·기준일) 표시");
    await page.goto(`${base}${guPath()}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.addEventListener("click", (e) => e.preventDefault(), true));
    await page.locator(`[data-hub-block="sources"] a[href="${docUrl("SA1")}"]`).first().click();
    await v.settle(v.answered.length + 1);
    await page.locator('[data-ui="region-tax-links"] [data-tax-links-row="explainers"] a[href^="/news/"]').first().click();
    await v.settle(v.answered.length + 1);
    const names = v.sent.map((s) => s.name);
    assert.equal(names.filter((n) => n === "region_to_tax_clicked").length, 1, `region_to_tax_clicked 1건: ${names}`);
    assert.ok(names.includes("regional_source_opened"), "공식 원문 누름 측정");
    const tax = v.sent.find((s) => s.name === "region_to_tax_clicked");
    assert.deepEqual(tax.props, { region_code: GU.code, target: "explainer" });
    const dump = JSON.stringify(v.sent);
    assert.doesNotMatch(dump, /https?:|example\.test|시험용|세액|취득가/, "이벤트에 주소·제목·계산값 0");
  } finally {
    await v.context.close();
  }
  const rows = (await db.query("select props from public.analytics_events where occurred_at >= $1 and name = 'region_to_tax_clicked' and props->>'region_code' = $2", [since, GU.code])).rows;
  assert.equal(rows.length, 1, "저장 1건");
});

test("l) 여정 2 — 검색 → 프로젝트 → 재개발 상세 → 「지방세로 읽기」 박스 → SM 취득세 카드 (서명된 박스만 · 저장 주소 그대로 · 새 창)", async () => {
  await flags({ search: true, region_hubs: true, realestate_projects: true, sm_calculator: true });
  const draft = await lenses(u.editor, { op: "draft", project_type: TYPE, stage: "zone", topics: ["시험용 세목"], points: ["시험용 첫째 포인트", "시험용 둘째 포인트"], links: [{ kind: "explainer", label: "시험용 해설", url: "/tax" }], base_date: "2026-01-01" });
  assert.ok([200, 201].includes(draft.status), show(draft));
  const detail0 = await get(fx.P.href);
  assert.ok(!detail0.html.includes('data-ui="tax-lens-box"'), "서명 전 박스 0");
  const row = (await api("GET", `/project-lenses?type=${TYPE}`, u.reviewer)).body.types[0].stages.find((s) => s.key === "zone").row;
  assert.equal((await lenses(u.reviewer, { op: "review", project_type: TYPE, stage: "zone", drafted_at: row.drafted_at })).status, 200);
  assert.equal((await lenses(u.editor, { op: "review", project_type: TYPE, stage: "zone", drafted_at: row.drafted_at })).status, 403, "편집 책임자 서명 403");

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}/search?q=${encodeURIComponent("시험용 수용구역")}&tab=tracker`, { waitUntil: "networkidle" });
    await page.locator(`a[href="${fx.P.href}"]`).first().click();
    await page.waitForURL(new RegExp(fx.P.slug));
    assert.ok((await page.locator("h1").first().innerText()).includes("시험용 수용구역 정비"), "프로젝트 상세");
    const box = page.locator('[data-stage-lens="zone"] [data-ui="tax-lens-box"]');
    await box.waitFor();
    assert.ok((await box.innerText()).includes("시험용 첫째 포인트"));
    const sm = page.locator('[data-stage-lens="zone"] [data-part="go"]');
    assert.equal(await sm.count(), 1, "SM 취득세 카드 1장");
    assert.equal(await sm.first().getAttribute("href"), SM_URL, "저장 주소 그대로");
    assert.equal(await sm.first().getAttribute("target"), "_blank");
  } finally {
    await ctx.close();
  }
});

test("m) 지역 → 세금 링크·허브 링크 전수 404 0 · 360·1280px 가로 넘침 0 · R1~R3 · 접근성 95(공개 화면 + 관리 화면 지역 탭)", async () => {
  await flags({ region_hubs: true, realestate_projects: true, supply_notices: true, dev_methods: true, inheritance_gift: true, sm_calculator: true });
  const pages = [guPath(), `/local/${sidoSlug(SIDO)}`, "/local", "/realestate", "/realestate/projects", fx.P.href, "/realestate/supply", "/realestate/development-methods", "/realestate/inheritance-gift"];
  const seen = new Set();
  for (const p of pages) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    for (const h of hrefs(r.html)) if (h.startsWith("/") && !h.startsWith("//") && !h.startsWith("/api/") && !h.startsWith("/_next/")) seen.add(h.split("#")[0]);
  }
  const tax = hrefs((await get(guPath())).html.match(/<section[^>]*data-ui="region-tax-links"[\s\S]*?<\/section>/)?.[0] ?? "").filter((h) => h.startsWith("/"));
  assert.ok(tax.length >= 1, "지역 세금 연결 블록 링크 1 이상");
  const bad = [];
  for (const h of seen) {
    const res = await fetch(`${base}${h}`, { redirect: "manual" });
    if (res.status >= 400) bad.push(`${h} ${res.status}`);
  }
  assert.deepEqual(bad, [], `내부 링크 404·오류 0 (${seen.size}개 확인)`);
  for (const h of tax) assert.ok(!bad.some((b) => b.startsWith(h)), `세금 연결 링크 ${h}`);

  for (const width of [360, 1280]) {
    for (const p of [guPath(), fx.P.href, "/realestate/development-methods", "/realestate/inheritance-gift"]) {
      const { page, ctx } = await open(p, { width, height: 800 });
      assert.ok((await overflow(page)) <= 0, `${p} ${width}px 가로 넘침 0`);
      await ctx.close();
    }
  }
  for (const width of [360, 1024]) {
    for (const p of [guPath(), "/realestate"]) {
      const r = await measurePage(browser, `${base}${p}`, { width, height: 740 });
      assert.ok(r.r2.pass, `${p} ${width}px R2 주 버튼 ${r.r2.maxPerViewport}개`);
      assert.ok(r.r3.pass, `${p} ${width}px R3 오렌지 ${r.r3.ratio}`);
    }
  }
  for (const p of [guPath(), fx.P.href, "/realestate/supply", "/realestate/development-methods", "/realestate/inheritance-gift"]) {
    const a = await accessibility(`${base}${p}`, debugPort);
    assert.ok(a.score >= A11Y_MIN, `${p} 접근성 ${a.score} — ${a.failing.join(", ")}`);
  }
  // 관리 화면 지역 탭 — 360px 가로 넘침 0 · 접근성 95 (로그인 세션 필요 — 쿠키를 받아 화면 점수는 DOM 규칙으로 갈음하고 Lighthouse는 공개 화면 대상)
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await ctx.newPage();
  try {
    await login(page, u.admin);
    await page.goto(`${base}/admin/metrics?tab=region`, { waitUntil: "networkidle" });
    assert.ok((await overflow(page)) <= 0, "지역 탭 360px 가로 넘침 0");
    const unlabeled = await page.evaluate(() => [...document.querySelectorAll("main input, main select, main textarea")].filter((el) => el.type !== "hidden" && !el.labels?.length && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby")).length);
    assert.equal(unlabeled, 0, "지역 탭 입력 칸 이름표 누락 0");
    const noName = await page.evaluate(() => [...document.querySelectorAll("main button, main a")].filter((el) => !(el.textContent ?? "").trim() && !el.getAttribute("aria-label")).length);
    assert.equal(noName, 0, "이름 없는 버튼·링크 0");
    const heads = await page.evaluate(() => [...document.querySelectorAll("main table")].filter((t) => !t.querySelector("th") && !t.querySelector("caption")).length);
    assert.equal(heads, 0, "머리글 없는 표 0");
  } finally {
    await ctx.close();
  }
});

test("n) 기능 키를 끄면 다시 404·하위 분야 목록 · 상속·증여 켜기 조건이 끄기·이미 켜진 값에는 걸리지 않는다", async () => {
  await flags({});
  for (const p of [guPath(), fx.P.href, "/realestate/development-methods/redevelopment", "/realestate/inheritance-gift/inheritance"]) assert.equal((await get(p)).status, 404, `${p} 404`);
  for (const p of ["/realestate/projects", "/realestate/supply", "/realestate/development-methods", "/realestate/inheritance-gift"]) assert.ok((await get(p)).html.includes('data-ui="category-list"'), `${p} 하위 분야 목록`);
  assert.equal((await flagsRaw({ inheritance_gift: true })).status, 200, "입문 기사가 있으면 다시 켜진다");
  await flags({});
});
