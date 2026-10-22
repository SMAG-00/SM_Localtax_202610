// 얇은 페이지·시범 지역·최소선 리포트 E2E (W4 11단계 — docs/dev/W4_설계.md 1장 11단계 증거 · 2.2 · 5장 · 12장 #6·#27·#81~, PRD-01B REG-09 · REG1-01 · REG1-12 · 9.2).
// standalone 빌드를 SITE_INDEXING=on으로 띄우고 로컬 Supabase에 붙인다(운영 전환 게이트가 열린 모양 — 최소선 이상 지역 허브만 index).
// 시험용 지역은 법정동코드에 없는 접두 99·98 가짜 코드와 '시험용' 이름이다(설계 8장) — 시·도 2(색인도·둘째도) + 시·군·구 4(충족구·경계구·빈구·둘째구).
// 기사: 충족구 보도 2(편집 승인) + 공식 자료 1 · 경계구 보도 1 + 해설 1 + 공식 자료 1 · 둘째구 보도 1 + 공식 자료 1 · 빈구 0 (발행일을 넣은 공개 행 — 읽기 시험 재료)
//  a) 임계값 경계 — 자체 취재 2 필요: 충족구(2 = n) index·경계구(1 = n-1) noindex(사유 최소선 미달)·사이트맵 원본 0 · 되돌리면 다음 렌더부터 index (배포 없음) ·
//     틀린 임계값 422(0·모르는 칸)·편집 책임자 고치기 403
//  b) 유일한 자체 취재 보도를 held로 → noindex, 되돌리면 index · 유일한 공식 자료를 스냅샷 없는 새 판으로 대체 → noindex · 빈 시·군·구는 SITE_INDEXING이 켜져도 noindex
//  c) 색인 대상 허브끼리 제목·메타 설명 중복 0 · 메타 설명 = 그 지역 코드 하나만 단 보도 제목(템플릿 문장 0) · canonical = 허브 주소(분야 필터도 허브로) · 분야 필터 제목에 분야 글자 ·
//     JSON-LD BreadcrumbList 이름 = 화면 이동 줄
//  d) /local 시·도 카드 — '시범 지역'(pilot_regions의 시·도 또는 그 아래 시·군·구)·'색인 대상'(최소선 이상 시·도) 글자 칩 · 설정을 바꾸면 다음 요청부터 · 360·1280px 가로 넘침 0
//  e) 최소선 판정 리포트 — 화면·API 숫자 = 넣은 자료(지역마다 자체 취재·공식 자료·최소선·판정) · 서로 다른 시·도 2곳 → 최소선 충족 · 한 시·도만 → '시·도 분포 미달' · 비면 '시범 지역 미지정' ·
//     없는 코드 422 · 편집 책임자 200 · 기자·광고 담당 화면·API 403(+ 거부 감사) · 판정판에서 리포트로 가는 링크
// 만든 계정·기사·자료·지역은 끝나면 지우고, 운영 설정(기능 키·임계값·시범 지역)은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-region-index-e2e@example.test";
const SITE = "https://e2e.example.test";
const SIDO = { code: "9900000000", name: "시험용 색인도", key: "saegin" };
const SIDO2 = { code: "9800000000", name: "시험용 둘째도", key: "duljjae" };
const MET = { code: "9901100000", name: "시험용 충족구", key: "chungjok", parent: SIDO };
const EDGE = { code: "9902100000", name: "시험용 경계구", key: "gyeonggye", parent: SIDO };
const EMPTY = { code: "9903100000", name: "시험용 빈구", key: "bin", parent: SIDO };
const GU2 = { code: "9801100000", name: "시험용 둘째구", key: "duljjaegu", parent: SIDO2 };
const DESK_FULL = { evidence: true, relation: true, ad_independence: true };
const GOV = "https://gov.example.test/w4ri";

let sb, server, staff, db, browser, base;
const u = {};
const fx = {};
const counts0 = {};

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const hoursAgo = (n) => new Date(Date.now() - n * 3600_000).toISOString();
const sidoSlug = (s) => `${s.key}-${staff.run}`;
const guSlug = (g) => `${g.key}-${staff.run}-gu`;
const pathOf = (r) => (r.parent ? `/local/${sidoSlug(r.parent)}/${guSlug(r)}` : `/local/${sidoSlug(r)}`);
const show = (r) => JSON.stringify(r.body).slice(0, 600);

async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function setSetting(key, value, user = u.admin) {
  return api("PATCH", `/settings/${key}`, user, { value });
}
/** 공개 데이터 캐시 만료 — 기능 키를 같은 값으로 저장(설정 쓰기 = 캐시 만료). DB를 직접 고친 뒤 부른다 */
async function expire() {
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  assert.equal((await setSetting("feature_flags", cur)).status, 200);
}
const auditCount = (action, target, actorId) =>
  one("select count(*)::int n from public.audit_logs where action = $1 and target = $2 and actor = $3 and at >= $4", [action, target, `user:${actorId}`, staff.startedAt]).then((r) => r.n);

async function get(p) {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
}
const robotsOf = (html) => [...html.matchAll(/<meta name="robots" content="([^"]*)"/g)].map((m) => m[1]);
const attr = (html, name) => html.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;
const metaDescription = (html) => html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? null;
const titleOf = (html) => html.match(/<title>([^<]*)<\/title>/)?.[1] ?? null;
const canonicalOf = (html) => html.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? null;
const decode = (s) => s?.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">") ?? null;

/** 지역 허브 판정 — robots 메타·화면 값 */
async function verdict(r, query = "") {
  const res = await get(`${pathOf(r)}${query}`);
  assert.equal(res.status, 200, `${r.name}${query}`);
  return { robots: robotsOf(res.html), noindex: attr(res.html, "data-region-noindex"), reason: attr(res.html, "data-region-noindex-reason"), indexable: attr(res.html, "data-region-indexable"), html: res.html };
}
/** 사이트맵 원본(public_region_index) — anon 역할로 읽는다 */
async function sitemapCodes() {
  await db.query("begin");
  try {
    await db.query("set local role anon");
    const { rows } = await db.query("select code, path from public.public_region_index where code like '99%' or code like '98%' order by code");
    return rows;
  } finally {
    await db.query("rollback");
  }
}

async function removeFixtureRegions(q) {
  await q("delete from public.region_slug_redirects where region_code like '99%' or region_code like '98%'");
  await q("update public.regions set successor_code = null where (code like '99%' or code like '98%') and successor_code is not null");
  await q("delete from public.regions where (code like '99%' or code like '98%') and level = 'sigungu'");
  await q("delete from public.regions where code like '99%' or code like '98%'");
}

/** 공개 지역 기사 — 발행일을 넣은 공개 행. 보도기사는 편집 승인 기록(지역 기사 3항목)까지 */
async function reported(key, region, title, hours, type = "reported_news") {
  const row = await one(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, editorial_field, public_question, region_codes, first_published_at)
     values ($1, $2, '시험용 지역 보도 요약입니다', 'local', $6, 'published', $3, 'local_finance', '시험용 지역 재정은 어떻게 바뀌나', $4, $5) returning id, slug`,
    [`e2e-w4ri-${key}-${staff.run}`, title, u.reporter.personId, [region.code], hoursAgo(hours), type],
  );
  staff.trackArticle(Number(row.id));
  if (type === "reported_news") {
    await db.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision, checklist) values ($1, 'desk_edit', $2, 'approve', $3)", [row.id, u.editor.personId, JSON.stringify(DESK_FULL)]);
  }
  fx[key] = { id: Number(row.id), slug: row.slug, title };
  return fx[key];
}

/** 공식 자료 — 카드 칸 전부 + 원본 스냅샷 (snapshot: false = 원본 없음) */
async function source(articleKey, key, over = {}) {
  const url = over.url ?? `${GOV}/${staff.run}/${key}`;
  const snap = over.snapshot === false ? null : await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e-w4ri', $1, $2, '시험용 원본') returning id", [url, `sha256:${key}-${staff.run}`]);
  const row = await one(
    `insert into public.article_sources (article_id, kind, title, source_url, source_name, last_verified_at, license_status, license_type, source_type, published_on, reference_date, region_unit, collected_at, snapshot_id, supersedes_id, revision_reason)
     values ($1, 'official_doc', $2, $3, '시험용 색인도청', $4, '공공누리 제1유형', 'kogl_1', 'local_tax_revenue', '2026-09-01', '2026-08-31', '시·군·구', $5, $6, $7, $8) returning id`,
    [fx[articleKey].id, `시험용 공식 자료 ${key}`, url, hoursAgo(30), hoursAgo(40), snap?.id ?? null, over.supersedes ?? null, over.supersedes ? "시험용 수치 고침" : null],
  );
  fx[key] = { id: Number(row.id), url };
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
    SITE_INDEXING: "on",
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  await removeFixtureRegions((sql, params) => db.query(sql, params));
  await staff.snapshotOperations();
  for (const t of ["regions", "articles", "article_sources", "raw_snapshots", "editorial_reviews"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  const settings = Object.fromEntries((await db.query("select key, value from public.settings where key in ('feature_flags', 'region_index_threshold', 'pilot_regions')")).rows.map((r) => [r.key, r.value]));
  assert.notEqual(settings.feature_flags.region_hubs, true, "시험 전 region_hubs는 꺼져 있어야 한다 (W4 2.4)");
  assert.deepEqual(settings.region_index_threshold, { reported_news: 1, official_sources: 1 }, "임계값 씨앗 = 설계 2.2 (9.2 최소선)");
  assert.deepEqual(settings.pilot_regions, ["1100000000", "2600000000"], "시범 지역 씨앗 = PO 승인 서울·부산");

  u.admin = await staff.createUser({ label: "w4ri-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w4ri-editor", roles: ["editor"], person: { name: "시험용 색인 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "w4ri-reporter", roles: ["reporter"], person: { name: "시험용 색인 기자", roles: ["reporter"] } });
  u.adOps = await staff.createUser({ label: "w4ri-adops", roles: ["ad_ops"] });

  for (const s of [SIDO, SIDO2]) await db.query("insert into public.regions (code, level, name, slug) values ($1, 'sido', $2, $3)", [s.code, s.name, sidoSlug(s)]);
  for (const g of [MET, EDGE, EMPTY, GU2]) await db.query("insert into public.regions (code, parent_code, level, name, slug) values ($1, $2, 'sigungu', $3, $4)", [g.code, g.parent.code, g.name, guSlug(g)]);

  await reported("M1", MET, "시험용 충족구 세수 감소 보도", 1);
  await reported("M2", MET, "시험용 충족구 재산세 부과 보도", 2);
  await reported("E1", EDGE, "시험용 경계구 지방채 보도", 3);
  await reported("X1", EDGE, "시험용 경계구 지방재정 해설", 5, "explainer"); // 자체 취재 수 밖(해설) — 보도를 보류해도 빈 지역은 아니다
  await reported("G1", GU2, "시험용 둘째구 예산 보도", 4);
  await source("M1", "SM");
  await source("E1", "SE");
  await source("G1", "SG");

  browser = await chromium.launch();
  await setSetting("feature_flags", { ...settings.feature_flags, region_hubs: true }); // 설정 쓰기 = 공개 데이터 캐시 만료
  assert.equal((await setSetting("pilot_regions", [MET.code, GU2.code])).status, 200);
});

after(async () => {
  try {
    await browser?.close();
    await staff?.cleanup(); // 기사·출처·스냅샷·검토 기록·계정·감사 로그 지우기 + 운영 설정(기능 키·임계값·시범 지역) 되돌리기
  } finally {
    server?.stop();
    if (sb && Object.keys(counts0).length) {
      const c = new pg.Client({ connectionString: sb.dbUrl });
      await c.connect();
      try {
        await removeFixtureRegions((sql, params) => c.query(sql, params));
        for (const t of Object.keys(counts0)) assert.equal((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n, counts0[t], `정리 뒤 ${t} 행 수 = 시험 전`);
        const s = Object.fromEntries((await c.query("select key, value from public.settings where key in ('feature_flags', 'region_index_threshold', 'pilot_regions')")).rows.map((r) => [r.key, r.value]));
        assert.notEqual(s.feature_flags.region_hubs, true, "region_hubs 되돌림");
        assert.deepEqual(s.region_index_threshold, { reported_news: 1, official_sources: 1 }, "임계값 되돌림");
        assert.deepEqual(s.pilot_regions, ["1100000000", "2600000000"], "시범 지역 되돌림");
      } finally {
        await c.end();
      }
    }
  }
});

test("a) 임계값 경계 — 자체 취재 2 필요: n(2) index · n-1(1) noindex + 사이트맵 원본 0 · 되돌리면 다음 렌더부터 index · 틀린 값 422 · 편집 책임자 403", async () => {
  // 초기값(9.2 최소선 1·1) — 두 지역 모두 index (SITE_INDEXING=on)
  for (const r of [MET, EDGE]) {
    const v = await verdict(r);
    assert.deepEqual(v.robots, ["index, follow"], `${r.name} — 최소선 이상 + SITE_INDEXING=on → index`);
    assert.deepEqual([v.noindex, v.reason, v.indexable], ["false", "", "true"]);
  }
  assert.ok((await sitemapCodes()).some((r) => r.code === EDGE.code), "사이트맵 원본에 경계구");

  const raised = await setSetting("region_index_threshold", { reported_news: 2, official_sources: 1 });
  assert.equal(raised.status, 200, show(raised));
  const met = await verdict(MET);
  assert.deepEqual([met.robots, met.reason], [["index, follow"], ""], "충족구 2 = 2 → index");
  const edge = await verdict(EDGE);
  assert.deepEqual(edge.robots, ["noindex, nofollow"], "경계구 1 = 2-1 → noindex");
  assert.deepEqual([edge.noindex, edge.reason, edge.indexable], ["true", "below_minimum", "false"]);
  const codes = (await sitemapCodes()).map((r) => r.code);
  assert.ok(!codes.includes(EDGE.code), "미달 — 사이트맵 원본 0");
  assert.ok(codes.includes(MET.code));
  assert.ok(!edge.html.includes('data-part="empty-guide"'), "미달이지만 기사가 있는 지역 — 빈 지역 안내 0 (블록 그대로)");

  for (const [bad, msg] of [
    [{ reported_news: 0, official_sources: 1 }, /reported_news: 1~1000 정수여야 합니다 — 0이면 빈 지역/],
    [{ reported_news: 1, official_sources: 1, digest: 1 }, /digest: 모르는 칸/],
  ]) {
    const r = await setSetting("region_index_threshold", bad);
    assert.equal(r.status, 422, show(r));
    assert.ok(r.body.errors.some((e) => msg.test(e)), show(r));
  }
  assert.equal((await setSetting("region_index_threshold", { reported_news: 1, official_sources: 1 }, u.editor)).status, 403, "임계값 고치기는 관리자만");

  assert.equal((await setSetting("region_index_threshold", { reported_news: 1, official_sources: 1 })).status, 200);
  assert.deepEqual((await verdict(EDGE)).robots, ["index, follow"], "되돌리면 다음 렌더부터 index (배포 0)");
});

test("b) 유일한 보도 held → noindex · 되돌리면 index · 유일한 공식 자료를 스냅샷 없는 새 판으로 대체 → noindex · 빈 시·군·구는 SITE_INDEXING=on이어도 noindex", async () => {
  await db.query("update public.articles set status = 'held' where id = $1", [fx.E1.id]);
  await expire();
  let v = await verdict(EDGE);
  assert.deepEqual([v.robots, v.reason, v.indexable], [["noindex, nofollow"], "below_minimum", "false"], "유일한 보도 held — 해설만 남음 → 최소선 미달 noindex");
  assert.ok(!v.html.includes('data-part="empty-guide"'), "해설이 있어 빈 지역은 아니다");
  assert.ok(!(await sitemapCodes()).some((r) => r.code === EDGE.code));
  await db.query("update public.articles set status = 'published' where id = $1", [fx.E1.id]);
  await expire();
  assert.deepEqual((await verdict(EDGE)).robots, ["index, follow"], "되돌리면 index");

  // 충족구: 보도 2건 중 하나만 held → 여전히 1 ≥ 1
  await db.query("update public.articles set status = 'held' where id = $1", [fx.M2.id]);
  await expire();
  assert.deepEqual((await verdict(MET)).robots, ["index, follow"], "보도 1건 남음 — index");
  await db.query("update public.articles set status = 'published' where id = $1", [fx.M2.id]);

  // 유일한 공식 자료 → 스냅샷 없는 새 판 (원자료 새 버전, 원본 아직 없음) → 검수 공식 자료 0
  await source("E1", "SE2", { supersedes: fx.SE.id, url: fx.SE.url, snapshot: false });
  await expire();
  v = await verdict(EDGE);
  assert.deepEqual([v.robots, v.reason, v.indexable], [["noindex, nofollow"], "below_minimum", "false"], "공식 자료 0 — 미달");
  await source("E1", "SE3", { supersedes: fx.SE2.id, url: fx.SE.url });
  await expire();
  assert.deepEqual((await verdict(EDGE)).robots, ["index, follow"], "스냅샷 있는 새 판 — 다시 index");

  const empty = await verdict(EMPTY);
  assert.deepEqual([empty.robots, empty.reason], [["noindex, nofollow"], "empty"], "빈 시·군·구 200 + noindex (REG1-01)");
  assert.ok(empty.html.includes('data-part="empty-guide"'), "상위 지역 안내");
});

test("c) 색인 대상 허브 제목·메타 설명 중복 0 · 메타 설명 = 그 지역 코드 하나만 단 보도 제목 · canonical = 허브 주소 · 분야 필터 제목 · JSON-LD 이름 = 화면", async () => {
  const indexed = [];
  for (const r of [SIDO, MET, EDGE, SIDO2, GU2]) {
    const v = await verdict(r);
    assert.deepEqual(v.robots, ["index, follow"], `${r.name} 색인 대상`);
    indexed.push({ r, title: decode(titleOf(v.html)), description: decode(metaDescription(v.html)), canonical: canonicalOf(v.html), html: v.html });
  }
  const titles = indexed.map((x) => x.title);
  assert.equal(new Set(titles).size, titles.length, `제목 중복 0: ${titles.join(" / ")}`);
  const descriptions = indexed.map((x) => x.description).filter((d) => d !== null);
  assert.equal(new Set(descriptions).size, descriptions.length, `메타 설명 중복 0: ${descriptions.join(" / ")}`);
  const by = (r) => indexed.find((x) => x.r === r);
  assert.equal(by(MET).title, `${SIDO.name} ${MET.name} · 지자체뉴스 — ${by(MET).title.split(" — ").at(-1)}`);
  assert.equal(by(MET).description, `${fx.M1.title} · ${fx.M2.title}`, "충족구 — 그 지역 보도 제목 2건(최신 순)");
  assert.equal(by(EDGE).description, fx.E1.title);
  assert.equal(by(SIDO).description, null, "시·도 코드 하나만 단 보도 0 — 메타 설명 없음(하위 허브와 같은 설명 0, 템플릿 0)");
  for (const x of indexed) {
    assert.equal(x.canonical, `${SITE}${pathOf(x.r)}`, `${x.r.name} canonical`);
    // 지명만 바꾼 템플릿 소개 문장 0 — 설명은 기사 제목뿐, 화면에 지역 소개 칸 0
    if (x.description) for (const part of x.description.split(" · ")) assert.ok(Object.values(fx).some((f) => f.title === part), `설명 조각 '${part}'는 기사 제목`);
    assert.ok(!x.html.includes('data-part="region-intro"'), "지역 소개(편집자 한 줄 자리) 0 — 템플릿 문장 0");
  }

  // 분야 필터 — 제목에 분야 글자, canonical은 허브
  const topic = await verdict(MET, "?topic=local_finance");
  assert.deepEqual(topic.robots, ["index, follow"]);
  assert.match(decode(titleOf(topic.html)), new RegExp(`^${SIDO.name} ${MET.name} 지방재정 · 지자체뉴스`));
  assert.equal(canonicalOf(topic.html), `${SITE}${pathOf(MET)}`);
  const none = await verdict(MET, "?topic=urban_policy");
  assert.deepEqual([none.robots, none.reason], [["noindex, nofollow"], "topic_empty"], "고른 분야 0건 noindex (4단계 그대로)");

  // JSON-LD BreadcrumbList 이름 = 화면 이동 줄
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const page = await ctx.newPage();
    await page.goto(`${base}${pathOf(MET)}`, { waitUntil: "networkidle" });
    const scripts = await page.$$eval('script[type="application/ld+json"]', (els) => els.map((e) => e.textContent));
    assert.equal(scripts.length, 1, "JSON-LD 1개");
    const nodes = JSON.parse(scripts[0]);
    assert.deepEqual(nodes.map((n) => n["@type"]), ["BreadcrumbList"]);
    const shown = await page.$$eval('nav[aria-label="지역 이동"] a', (as) => as.map((a) => ({ name: a.textContent.trim(), href: a.getAttribute("href") })));
    assert.deepEqual(shown.map((x) => x.name), ["홈", "지자체뉴스", SIDO.name, MET.name], "화면 이동 줄");
    assert.deepEqual(
      nodes[0].itemListElement.map((i) => [i.name, i.item]),
      shown.map((x) => [x.name, new URL(x.href, SITE).href]),
      "JSON-LD 이름·주소 = 화면 이동 줄",
    );
  } finally {
    await ctx.close();
  }
});

test("d) /local 시·도 카드 — '시범 지역'·'색인 대상' 글자 칩 · 설정을 바꾸면 다음 요청부터 · 360·1280px 가로 넘침 0", async () => {
  const cards = async () => {
    const { html } = await get("/local");
    return Object.fromEntries(
      [...html.matchAll(/<li data-sido-code="(\d{10})" data-pilot="(true|false)" data-indexed="(true|false)">([\s\S]*?)<\/li>/g)].map((m) => [m[1], { pilot: m[2] === "true", indexed: m[3] === "true", chips: [...m[4].matchAll(/data-chip="(\w+)">([^<]+)</g)].map((c) => [c[1], c[2]]) }]),
    );
  };
  let c = await cards();
  assert.deepEqual(c[SIDO.code], { pilot: true, indexed: true, chips: [["pilot", "시범 지역"], ["indexed", "색인 대상"]] }, "충족구(시범) → 상위 시·도 카드에 시범 지역, 시·도 최소선 이상 → 색인 대상");
  assert.deepEqual(c[SIDO2.code], { pilot: true, indexed: true, chips: [["pilot", "시범 지역"], ["indexed", "색인 대상"]] });
  for (const code of ["1100000000", "2600000000"]) assert.deepEqual(c[code], { pilot: false, indexed: false, chips: [] }, `${code} — 시범 목록 밖·자료 0`);

  assert.equal((await setSetting("pilot_regions", ["1100000000"])).status, 200);
  c = await cards();
  assert.deepEqual([c["1100000000"].pilot, c[SIDO.code].pilot, c[SIDO.code].indexed], [true, false, true], "시범 지역 바꾸면 다음 요청부터 · 색인 표시는 판정 그대로");
  assert.equal((await setSetting("pilot_regions", [MET.code, GU2.code])).status, 200);

  for (const viewport of [{ width: 360, height: 740 }, { width: 1280, height: 800 }]) {
    const ctx = await browser.newContext({ viewport });
    try {
      const page = await ctx.newPage();
      await page.goto(`${base}/local`, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `${viewport.width}px 가로 넘침 ${overflow}`);
      assert.equal(await page.locator(`[data-sido-code="${SIDO.code}"] [data-chip="pilot"]`).textContent(), "시범 지역");
    } finally {
      await ctx.close();
    }
  }
});

test("e) 최소선 판정 리포트 — 숫자 = 넣은 자료 · 서로 다른 시·도 2 → 충족 · 한 시·도 → 시·도 분포 미달 · 비면 미지정 · 없는 코드 422 · 기자·광고 담당 403 + 감사", async () => {
  const report = async (who = u.editor) => {
    const r = await api("GET", "/regions?view=report", who);
    assert.equal(r.status, 200, show(r));
    return r.body.report;
  };
  let rep = await report();
  assert.deepEqual([rep.status, rep.label, rep.problems, rep.sidoCount, rep.threshold], ["met", "최소선 충족", [], 2, { reported: 1, official: 1 }]);
  assert.deepEqual(
    rep.regions.map((r) => [r.code, r.reported.count, r.reported.min, r.official.count, r.official.min, r.indexable]),
    [
      [MET.code, 2, 1, 1, 1, true],
      [GU2.code, 1, 1, 1, 1, true],
    ],
    "지역마다 자체 취재 수·공식 자료 수 = 넣은 자료",
  );
  assert.ok(rep.indexedCount >= 5, "전국 색인 대상 — 시험 지역 5곳 이상");
  assert.equal((await api("GET", "/regions?view=bogus", u.editor)).status, 422);

  // 화면 — 편집 책임자가 판정판 → 리포트 링크로 연다
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await ctx.newPage();
    await login(page, u.editor);
    await page.goto(`${base}/admin/regions`);
    await Promise.all([page.waitForURL(/\/admin\/regions\/report$/), page.locator('[data-testid="region-report-link"]').click()]);
    assert.equal(await page.locator('[data-testid="region-report-summary"]').getAttribute("data-status"), "met");
    const rows = await page.$$eval('[data-testid="pilot-row"]', (trs) =>
      trs.map((tr) => [
        tr.getAttribute("data-region-code"),
        Number(tr.querySelector('[data-testid="pilot-reported"]').getAttribute("data-count")),
        Number(tr.querySelector('[data-testid="pilot-official"]').getAttribute("data-count")),
        tr.getAttribute("data-indexable"),
      ]),
    );
    assert.deepEqual(rows, [
      [MET.code, 2, 1, "true"],
      [GU2.code, 1, 1, "true"],
    ]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `리포트 가로 넘침 ${overflow}`);

    // 한 시·도 안의 시범 지역만 → 시·도 분포 미달 (경계구를 미달로 만들어 미달 지역도 한 줄)
    assert.equal((await setSetting("pilot_regions", [MET.code, EDGE.code])).status, 200);
    assert.equal((await setSetting("region_index_threshold", { reported_news: 2, official_sources: 1 })).status, 200);
    rep = await report();
    assert.equal(rep.status, "short");
    assert.deepEqual(rep.problems, ["시·도 분포 미달 — 서로 다른 시·도 1곳 (최소 2곳)", "최소선 미달 지역 1곳"]);
    assert.deepEqual(rep.regions.map((r) => [r.code, r.reported.count, r.reported.min, r.reported.ok, r.indexable]), [
      [MET.code, 2, 2, true, true],
      [EDGE.code, 1, 2, false, false],
    ]);
    await page.reload();
    assert.match(await page.locator('[data-testid="region-report-problems"]').textContent(), /시·도 분포 미달/);
    assert.equal((await setSetting("region_index_threshold", { reported_news: 1, official_sources: 1 })).status, 200);

    // 비면 시범 지역 미지정
    assert.equal((await setSetting("pilot_regions", [])).status, 200);
    rep = await report();
    assert.deepEqual([rep.status, rep.label, rep.regions], ["unset", "시범 지역 미지정", []]);
    await page.reload();
    assert.match(await page.locator('[data-testid="region-report-summary"]').textContent(), /시범 지역 미지정/);
  } finally {
    await ctx.close();
  }

  // 없는 코드·폐지 코드 422 (칸마다 사유) · DB도 거부
  const bad = await setSetting("pilot_regions", [MET.code, "9909900000"]);
  assert.equal(bad.status, 422, show(bad));
  assert.deepEqual(bad.body.errors, ["[1]: 9909900000는 오늘 유효한 행정구역(regions)이 아닙니다"]);
  assert.equal((await setSetting("pilot_regions", ["990000000"])).status, 422, "10자리 아님");
  assert.equal((await setSetting("pilot_regions", [MET.code, GU2.code])).status, 200);

  // 권한 — 기자·광고 담당 API 403 + 거부 감사, 화면 403
  for (const who of [u.reporter, u.adOps]) {
    assert.equal((await api("GET", "/regions?view=report", who)).status, 403);
    assert.equal(await auditCount("regional.judge.denied", "region_index_status:report", who.id), 1, "리포트 거부 감사 1건");
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const p = await c2.newPage();
      await login(p, who);
      const res = await p.goto(`${base}/admin/regions/report`);
      assert.equal(res.status(), 403, "리포트 화면 403");
    } finally {
      await c2.close();
    }
  }
  // 관리자 200
  assert.equal((await api("GET", "/regions?view=report", u.admin)).status, 200);
});
