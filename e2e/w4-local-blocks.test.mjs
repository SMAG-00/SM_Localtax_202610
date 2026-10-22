// 지자체 허브 ⑤ 공식 자료/해설·지역 세금 연결 블록·/local 전국 화면·지역 기사 API E2E (W4 9단계 — docs/dev/W4_설계.md 1장 9단계 증거 · 2.3 · 2.8 · 5장,
// PRD-01B REG1-02 · REG1-07 · REG1-10 · REG1-13 · REG-01 · REG-10 · 5.6). standalone 빌드를 띄우고 로컬 Supabase에 붙인다.
// 시험용 지역은 법정동코드에 없는 접두 99 가짜 코드와 '시험용' 이름이다(설계 8장) — 시·도 1(9900000000) + 시·군·구 2(통합구·이웃구).
// 공개 지역 기사·감수 해설·공식 자료(검수 · 스냅샷 없음 · 자료 종류 빔 · 옛 판 · 초안 기사)·보류·별도 상품 검토 큐 원고를 첫 요청 전에 DB에 넣는다.
//  a) ⑤ — 검수 공식 자료 카드(원문 블록)·감수 해설만, 미검수(스냅샷 없음·자료 종류 빔)·옛 판·비공개 기사 자료 0 · 원문 링크 새 창·noreferrer · 스냅샷 글자 0 · 검토 중
//  b) 지역 세금 연결 블록 — 지방세 감수 해설·공식 원문 · SM 취득세 카드는 sm_calculator 켜짐 + 주소 있을 때만(이동 주소 = 저장 주소, 새 창) · 국세 배지 0(취득세)
//  c) 허브 링크 전수 — 404 0 · 비공개(초안·보류·별도 상품 큐) 목적지 0 · 다른 지역 태그 기사 0 · 편집 분야 없는 기사 0 · '준비 중' 0 ·
//     자체 계산기(/calc/*)·정비사업 현황·조례 원문 링크 0 — 3단계 기능 키를 켜도 0
//  d) GET /api/regions/{code}/articles — 200 source·verifiedAt·status · 목록 밖 topic·page·모르는 칸·코드 형식 400 · 없는 지역·region_hubs 꺼짐 404 · 비공개·보류·큐 원고 0 · 500 0
//  e) 허브 문구 금지 표현(세금 혜택·가격 상승·투자 권유 — 사전 forbidden_phrases) 0
//  f) /local 전국 — 시·도 카드 = 오늘 유효한 시·도 전부(씨앗 17 + 시험용 1)·링크 전수 200 · region_hubs 꺼짐 → 글자만(링크 0) · ⑤ · 데이터 출처 줄 1개
//  g) 360·1280px 가로 넘침 0 · 데이터 출처 줄 '출처 · 기준일 · 정보 확인일' · 접근성 95
// 만든 계정·기사·자료·지역은 끝나면 지우고, 운영 설정(기능 키)·SM 계산기 주소는 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w4-local-blocks-e2e@example.test";
const SITE = "https://e2e.example.test";
const SIDO = { code: "9900000000", name: "시험용 블록도" };
const GU = { code: "9901100000", name: "시험용 블록구", key: "beullok" };
const OTHER = { code: "9902100000", name: "시험용 이웃구", key: "iut" };
const GOV = "https://gov.example.test/w4b";
const SNAPSHOT_TEXT = "시험용 원본 스냅샷 글자 — 화면에 0";
const SM_URL = "https://sm.example.test/calc/acquisition-w4b";

let sb, server, staff, db, browser, base, debugPort;
const u = {};
const fx = {};
const counts0 = {};
let smRow0;

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const kstDate = (iso) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);
const hoursAgo = (n) => new Date(Date.now() - n * 3600_000).toISOString();
const slugOf = (key) => `${key}-${staff.run}-gu`;
const sidoPath = () => `/local/${fx.sidoSlug}`;
const guPath = (g = GU) => `${sidoPath()}/${slugOf(g.key)}`;
const docUrl = (k) => `${GOV}/${staff.run}/${k}`;

async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const show = (r) => JSON.stringify(r.body).slice(0, 400);

async function setFlags(patch) {
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  const r = await api("PATCH", "/settings/feature_flags", u.admin, { value: { ...cur, ...patch } });
  assert.equal(r.status, 200, `기능 키 ${JSON.stringify(patch)}: ${show(r)}`);
}

async function get(p) {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
}
async function getJson(p) {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

async function open(p, viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const res = await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
  return { page, ctx, status: res.status() };
}

async function removeFixtureRegions(q) {
  await q("delete from public.region_slug_redirects where region_code like '99%'");
  await q("update public.regions set successor_code = null where code like '99%' and successor_code is not null");
  await q("delete from public.regions where code like '99%' and level = 'sigungu'");
  await q("delete from public.regions where code like '99%'");
}

/** 공개 지역 기사 — 발행일을 넣은 공개 행(이관 모양 — 7·8단계 새 발행 검사 밖, 읽기 시험 재료) */
async function article(key, { title, section = "local", type = "explainer", field = "local_tax", codes = [GU.code], hours = 1, status = "published", judgement = null }) {
  const at = hoursAgo(hours);
  const row = await one(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, editorial_field, public_question, region_codes, first_published_at, editorial_judgement, judged_by, judged_at)
     values ($1, $2, '시험용 지역 기사 요약입니다', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id, slug`,
    [
      `e2e-w4b-${key}-${staff.run}`,
      title,
      section,
      type,
      status,
      u.reporter.personId,
      field,
      field ? "시험용 지역 재정은 어떻게 바뀌나" : null,
      codes,
      status === "published" ? at : null,
      judgement,
      judgement ? `user:${u.editor.id}` : null,
      judgement ? new Date().toISOString() : null,
    ],
  );
  staff.trackArticle(Number(row.id));
  fx[key] = { id: Number(row.id), slug: row.slug, href: `/news/${row.slug}`, title, publishedOn: kstDate(at) };
  return fx[key];
}

/** 공식 자료 출처 — 카드 칸 전부 + 원본 스냅샷 (over로 빼거나 바꾼다) */
async function source(articleKey, key, over = {}) {
  const url = over.url ?? docUrl(key);
  const snap = over.snapshot === false ? null : await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('e2e-w4b', $1, $2, $3) returning id", [url, `sha256:${key}-${staff.run}`, SNAPSHOT_TEXT]);
  const verified = over.verified ?? hoursAgo(30);
  const row = await one(
    `insert into public.article_sources (article_id, kind, title, source_url, source_name, last_verified_at, license_status, license_type, source_type, published_on, reference_date, region_unit, collected_at, snapshot_id, supersedes_id, revision_reason)
     values ($1, 'official_doc', $2, $3, $4, $5, '공공누리 제1유형', 'kogl_1', $6, '2026-09-01', $7, '시·군·구', $8, $9, $10, $11) returning id`,
    [
      fx[articleKey].id,
      over.title ?? `시험용 공식 자료 ${key}`,
      url,
      over.issuer ?? "시험용 블록도청",
      verified,
      over.sourceType === undefined ? "local_tax_revenue" : over.sourceType,
      over.referenceDate ?? "2026-08-31",
      hoursAgo(40),
      snap?.id ?? null,
      over.supersedes ?? null,
      over.supersedes ? "시험용 수치 고침" : null,
    ],
  );
  fx[key] = { id: Number(row.id), url, verifiedOn: kstDate(verified) };
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
  await removeFixtureRegions((sql, params) => db.query(sql, params));
  await staff.snapshotOperations();
  for (const t of ["regions", "articles", "article_sources", "raw_snapshots", "source_review_queue", "separate_product_queue", "editorial_reviews"]) counts0[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  for (const k of ["region_hubs", "redevelopment_status", "ordinance_texts"]) assert.notEqual(flags[k], true, `시험 전 기능 키 ${k}는 꺼져 있어야 한다 (W4 2.4)`);
  smRow0 = await one("select id, url, status from public.official_links where kind = 'sm_calculator' and key = 'acquisition'");
  assert.ok(smRow0, "SM 취득세 계산기 행 (W3 씨앗)");

  u.admin = await staff.createUser({ label: "w4b-admin", email: ADMIN_EMAIL });
  u.reporter = await staff.createUser({ label: "w4b-reporter", roles: ["reporter"], person: { name: "시험용 블록 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "w4b-editor", roles: ["editor"], person: { name: "시험용 블록 편집자", roles: ["editor"] } });
  u.reviewer = await staff.createUser({ label: "w4b-reviewer", roles: ["reviewer"], person: { name: "시험용 블록 감수위원", roles: ["reviewer"] } });

  fx.sidoSlug = `beullok-${staff.run}`;
  await db.query("insert into public.regions (code, level, name, slug) values ($1, 'sido', $2, $3)", [SIDO.code, SIDO.name, fx.sidoSlug]);
  for (const g of [GU, OTHER]) await db.query("insert into public.regions (code, parent_code, level, name, slug) values ($1, $2, 'sigungu', $3, $4)", [g.code, SIDO.code, g.name, slugOf(g.key)]);

  // 공개 지역 기사 — A1(블록구 해설)·A2(블록도 자기 태그 보도)·A6(이웃구) · 감수 해설 E1(지자체뉴스)·E2(지방세 분야)
  await article("A1", { title: "시험용 블록구 지방세 세수 해설" });
  await article("A2", { title: "시험용 블록도 부동산 보도", type: "reported_news", field: "realestate", codes: [SIDO.code], hours: 2 });
  await article("A6", { title: "시험용 이웃구 지방세 해설", codes: [OTHER.code], hours: 3 });
  await article("E1", { title: "시험용 블록구 지방재정 감수 해설", field: "local_finance", hours: 4 });
  await article("E2", { title: "시험용 블록구 지방세 감수 해설", section: "tax", hours: 5 });
  // 비공개 — 초안(D)·보류(H — held)·별도 상품 검토 큐(Q — 여행 후기 판정 → 큐 1건)
  await article("D", { title: "시험용 초안 원고", status: "draft" });
  await article("H", { title: "시험용 보류 원고", status: "held" });
  await article("Q", { title: "시험용 주말 여행 후기", status: "draft", judgement: "travel_review" });
  assert.equal((await one("select count(*)::int n from public.separate_product_queue where article_id = $1 and status = 'open'", [fx.Q.id])).n, 1, "큐 원고 — 열린 항목 1건 (8단계)");

  await source("A1", "S1", { verified: hoursAgo(20) });
  await source("A1", "S2", { snapshot: false, title: "시험용 스냅샷 없는 자료" });
  await source("A1", "S3", { sourceType: null, title: "시험용 법령 인용" });
  await source("A1", "S4", { title: "시험용 옛 판 자료" });
  await source("A1", "S5", { supersedes: fx.S4.id, url: docUrl("S4"), title: "시험용 새 판 자료", verified: hoursAgo(25) });
  await source("A2", "S7", { url: docUrl("S1"), verified: hoursAgo(10) });
  await source("A6", "S11", { issuer: "시험용 이웃구청", referenceDate: "2026-03-31" });
  await source("D", "S8", { title: "시험용 초안 기사 자료" });
  await db.query("insert into public.source_review_queue (target_type, target_id, article_id, reason, basis_on, run_key, opened_by) values ('article_source', $1, $2, 'expired', '2025-10-01', $3, 'job:e2e-w4b')", [
    fx.S7.id,
    fx.A2.id,
    kstDate(new Date().toISOString()),
  ]);
  for (const k of ["E1", "E2"]) await db.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision) values ($1, 'tax_review', $2, 'approve')", [fx[k].id, u.reviewer.personId]);

  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
  await setFlags({ region_hubs: true, sm_calculator: false }); // 설정 쓰기 = 공개 데이터 캐시 만료
});

after(async () => {
  try {
    await browser?.close();
    if (db) {
      await db.query("delete from public.source_review_queue where article_id = any($1::bigint[])", [[...staff.articleIds]]);
      if (smRow0) await db.query("update public.official_links set url = $2, status = $3 where id = $1", [smRow0.id, smRow0.url, smRow0.status]);
    }
    await staff?.cleanup(); // 기사·출처·스냅샷·검토 기록·별도 큐·계정·감사 로그 지우기 + 운영 설정 되돌리기
  } finally {
    server?.stop();
    if (sb && Object.keys(counts0).length) {
      const c = new pg.Client({ connectionString: sb.dbUrl });
      await c.connect();
      try {
        await removeFixtureRegions((sql, params) => c.query(sql, params));
        for (const t of Object.keys(counts0)) assert.equal((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n, counts0[t], `정리 뒤 ${t} 행 수 = 시험 전`);
        const flags = (await c.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
        for (const k of ["region_hubs", "redevelopment_status", "ordinance_texts"]) assert.notEqual(flags[k], true, `기능 키 ${k} 되돌림`);
        if (smRow0) assert.equal((await c.query("select url from public.official_links where id = $1", [smRow0.id])).rows[0].url, smRow0.url, "SM 주소 되돌림");
      } finally {
        await c.end();
      }
    }
  }
});

/** ⑤ 블록 — 공식 자료 카드·감수 해설 카드 */
const officialOf = (page) =>
  page.$eval('[data-hub-block="sources"]', (el) => ({
    groups: [...el.querySelectorAll('[data-part="block-group"]')].map((g) => g.getAttribute("data-group")),
    cards: [...el.querySelectorAll('[data-part="official-source-card"]')].map((c) => ({
      id: Number(c.getAttribute("data-source-id")),
      href: c.querySelector('[data-part="official-source-open"]')?.getAttribute("href") ?? null,
      target: c.querySelector('[data-part="official-source-open"]')?.getAttribute("target") ?? null,
      rel: c.querySelector('[data-part="official-source-open"]')?.getAttribute("rel") ?? null,
      review: !!c.querySelector('[data-part="source-review-mark"]'),
      license: c.querySelector('[data-part="license-badge"]')?.textContent ?? null,
      articles: [...c.querySelectorAll("[data-article-link]")].map((a) => Number(a.getAttribute("data-article-link"))),
    })),
    explainers: [...el.querySelectorAll('[data-group="explainers"] [data-article-id]')].map((a) => Number(a.getAttribute("data-article-id"))),
    empty: el.querySelector('[data-part="block-empty"]')?.textContent ?? null,
  }));

test("a) ⑤ — 검수 공식 자료 카드·감수 해설만 · 미검수·옛 판·비공개 기사 자료 0 · 원문 새 창 · 스냅샷 글자 0 · 검토 중", async () => {
  const { page, ctx, status } = await open(guPath());
  assert.equal(status, 200);
  const o = await officialOf(page);
  assert.deepEqual(o.groups, ["sources", "explainers"], "묶음 = 공식 자료 원문 → 감수 해설 (원문 블록 ≠ 해석)");
  assert.deepEqual(o.cards.map((c) => c.href).sort(), [docUrl("S1"), docUrl("S4")].sort(), "검수 공식 자료만 — 스냅샷 없음(S2)·자료 종류 빔(S3)·옛 판(S4 원래 행)·초안 기사(S8)·다른 시·군·구(S11) 0");
  assert.deepEqual(o.cards.find((c) => c.href === docUrl("S4")).id, fx.S5.id, "같은 주소의 새 판만");
  for (const c of o.cards) {
    assert.equal(c.target, "_blank", "원문 링크 새 창");
    assert.match(c.rel ?? "", /noopener/);
    assert.match(c.rel ?? "", /noreferrer/);
    assert.equal(c.license, "공공누리 제1유형 (출처표시)", "권리 글자");
    assert.equal(c.review, false);
  }
  assert.deepEqual(o.cards.find((c) => c.href === docUrl("S1")).articles, [fx.A1.id], "이 자료를 다룬 기사 = 그 지역 공개 기사");
  assert.deepEqual(o.explainers, [fx.E1.id], "감수 해설 = 지자체뉴스 감수 해설 (지방세 분야 해설은 세금 연결 블록)");
  assert.equal(o.empty, null);
  const html = await page.content();
  for (const t of [SNAPSHOT_TEXT, "시험용 스냅샷 없는 자료", "시험용 법령 인용", "시험용 옛 판 자료", "시험용 초안 기사 자료"]) assert.ok(!html.includes(t), `${t} — 화면 0`);
  await ctx.close();

  // 시·도 허브 — 자기 + 하위 태그: 같은 원문 주소(S1·S7)는 카드 한 장 + 다룬 기사 둘, 열린 검수 → 검토 중
  const sido = await open(sidoPath());
  const so = await officialOf(sido.page);
  assert.deepEqual(so.cards.map((c) => c.href).sort(), [docUrl("S1"), docUrl("S11"), docUrl("S4")].sort());
  const same = so.cards.find((c) => c.href === docUrl("S1"));
  assert.equal(same.review, true, "검토 중 (6단계 표시 그대로)");
  assert.deepEqual(same.articles.sort(), [fx.A1.id, fx.A2.id].sort());
  assert.equal(await sido.page.locator('[data-hub-block="sources"] [data-part="source-review-mark"]').count(), 1);
  await sido.ctx.close();
});

test("b) 지역 세금 연결 블록 — 지방세 감수 해설·공식 원문 · SM 취득세 카드는 sm_calculator 켜짐 + 주소 있을 때만 (이동 = 저장 주소, 새 창)", async () => {
  const rowsOf = (page) =>
    page.$eval('[data-ui="region-tax-links"]', (el) => ({
      rows: [...el.querySelectorAll("[data-tax-links-row]")].map((r) => r.getAttribute("data-tax-links-row")),
      explainers: [...el.querySelectorAll('[data-tax-links-row="explainers"] [data-article-id]')].map((a) => Number(a.getAttribute("data-article-id"))),
      originals: [...el.querySelectorAll('[data-tax-links-row="originals"] a')].map((a) => [a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("rel")]),
      sm: [...el.querySelectorAll('[data-tax-links-row="sm-calculator"] [data-part="go"]')].map((a) => [a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("rel")]),
      national: el.querySelectorAll('[data-tax-kind="national"]').length,
    }));
  // 블록 자리 — ⑤ 뒤, 데이터 출처 줄 앞
  const { page, ctx } = await open(guPath());
  const order = await page.evaluate(() => {
    const y = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? -1;
    return [y('[data-hub-block="sources"]'), y('[data-ui="region-tax-links"]'), y('[data-ui="source-line"]')];
  });
  assert.ok(order[0] < order[1] && order[1] < order[2], `⑤ → 세금 연결 → 출처 줄 ${order}`);
  let r = await rowsOf(page);
  assert.ok(!r.rows.includes("sm-calculator"), "sm_calculator 꺼짐 — SM 카드 0");
  assert.deepEqual(r.explainers, [fx.E2.id], "지방세 감수 해설");
  assert.deepEqual(r.originals.map((o) => o[0]).sort(), [docUrl("S1"), docUrl("S4")].sort(), "공식 원문 = 검수 공식 자료 원문");
  for (const [, target, rel] of r.originals) assert.ok(target === "_blank" && /noreferrer/.test(rel ?? ""), "공식 원문 새 창");
  await ctx.close();

  // 키를 켜도 주소가 비면 0 (빈 링크 0)
  await setFlags({ sm_calculator: true });
  const empty = await open(guPath());
  assert.ok(!(await rowsOf(empty.page)).rows.includes("sm-calculator"), "주소 빈 행 — SM 카드 0");
  await empty.ctx.close();
  // 주소를 넣으면 다음 요청부터 — 이동 주소 = 저장 주소 그대로(쿼리·조각 0), 새 창·noreferrer, 취득세는 국세 배지 0
  await db.query("update public.official_links set url = $2, status = 'ok' where id = $1", [smRow0.id, SM_URL]);
  await setFlags({ sm_calculator: true, region_hubs: true }); // 캐시 만료
  const on = await open(guPath());
  r = await rowsOf(on.page);
  assert.deepEqual(r.sm, [[SM_URL, "_blank", "noopener noreferrer"]]);
  assert.equal(r.national, 0, "취득세 — 국세 배지 0 (TX-06 국세 연결만 배지)");
  assert.deepEqual(r.rows.slice(-2), ["sm-calculator", "originals"], "줄 순서 — … SM 카드 → 공식 원문");
  await on.ctx.close();
  await db.query("update public.official_links set url = $2, status = $3 where id = $1", [smRow0.id, smRow0.url, smRow0.status]);
  await setFlags({ sm_calculator: false });
});

test("c) 허브 링크 전수 — 404 0 · 비공개 목적지 0 · 다른 지역·편집 분야 없는 기사 0 · '준비 중'·자체 계산기·정비사업 현황·조례 원문 0 (3단계 키를 켜도)", async () => {
  const hidden = [fx.D, fx.H, fx.Q].map((a) => a.href);
  const check = async (label) => {
    const sidoScope = [SIDO.code, GU.code, OTHER.code];
    for (const [p, scope] of [
      [guPath(), [GU.code]],
      [sidoPath(), sidoScope],
    ]) {
      const { page, ctx } = await open(p);
      const hrefs = await page.$$eval("main a[href]", (as) => as.map((a) => a.getAttribute("href")));
      // 상위 시·도 대체(REG-06 — '○○ 기사가 없어 ○○ 기사를 보입니다' 문장이 있는 블록)의 기사는 상위 시·도 범위
      const fallback = new Set(await page.$$eval('[data-hub-block]:has([data-part="block-fallback"]) a[href^="/news/"]', (as) => as.map((a) => a.getAttribute("href").slice(6))));
      const text = await page.locator("main").innerText();
      assert.doesNotMatch(text, /준비 중|정비사업 현황|조례 원문|명소|맛집/, `${label} ${p}: '준비 중'·3단계·관광 글자 0`);
      assert.ok(!hrefs.some((h) => h.startsWith("/calc/")), `${label} ${p}: 자체 계산기 링크 0`);
      for (const h of hidden) assert.ok(!hrefs.includes(h), `${label} ${p}: 비공개 목적지 ${h} 0`);
      for (const slug of [...new Set(hrefs.filter((h) => h.startsWith("/news/")).map((h) => h.slice(6)))]) {
        const a = await one("select region_codes, editorial_field, status from public.articles where slug = $1", [slug]);
        assert.equal(a.status, "published", `${p}: ${slug} 공개 기사`);
        assert.ok(a.editorial_field, `${p}: ${slug} 편집 분야 있음`);
        const allowed = fallback.has(slug) ? sidoScope : scope;
        assert.ok(a.region_codes.some((c) => allowed.includes(c)), `${p}: ${slug} 그 지역 태그${fallback.has(slug) ? "(상위 시·도 대체)" : ""} (다른 지역 0)`);
      }
      await ctx.close();
      if (label === "꺼짐") for (const h of new Set(hrefs.filter((x) => x.startsWith("/") && !x.startsWith("//")))) assert.equal((await get(h.split("#")[0])).status, 200, `링크 ${h}: 200 (404 0)`);
    }
  };
  await check("꺼짐");
  await setFlags({ redevelopment_status: true, ordinance_texts: true });
  try {
    await check("3단계 키 켜짐");
  } finally {
    await setFlags({ redevelopment_status: false, ordinance_texts: false });
  }
});

test("d) GET /api/regions/{code}/articles — 200 source·verifiedAt·status · 400 · 404 · 비공개·보류·큐 원고 0 · 500 0", async () => {
  const ok = await getJson(`/api/regions/${GU.code}/articles`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.deepEqual(ok.body.region, { code: GU.code, name: GU.name, level: "sigungu" });
  assert.deepEqual(ok.body.items.map((a) => a.id), [fx.A1.id, fx.E1.id, fx.E2.id], "그 시·군·구 공개 지역 기사만 — 초안·보류·큐 원고·다른 시·군·구 0");
  for (const a of ok.body.items) {
    for (const k of ["source", "verifiedAt", "status"]) assert.ok(k in a, `항목마다 ${k}`);
    assert.ok(["published", "under_review"].includes(a.status));
  }
  assert.deepEqual([ok.body.items[0].source, ok.body.items[0].verifiedAt, ok.body.items[0].status], ["시험용 블록도청", [fx.S1.verifiedOn, fx.S5.verifiedOn].sort()[0], "published"]);
  assert.deepEqual([ok.body.items[1].source, ok.body.items[1].verifiedAt], ["편집국", null]);
  const sido = await getJson(`/api/regions/${SIDO.code}/articles?topic=realestate`);
  assert.equal(sido.status, 200);
  assert.deepEqual(sido.body.items.map((a) => [a.id, a.status]), [[fx.A2.id, "under_review"]], "topic = 그 분야만 · 열린 검수 → under_review");
  assert.deepEqual((await getJson(`/api/regions/${SIDO.code}/articles?topic=local_tax&page=1`)).body.items.map((a) => a.id), [fx.A1.id, fx.A6.id, fx.E2.id]);

  for (const [p, code] of [
    [`/api/regions/${GU.code}/articles?topic=tourism`, 400],
    [`/api/regions/${GU.code}/articles?topic=`, 400],
    [`/api/regions/${GU.code}/articles?topic=local_tax&topic=realestate`, 400],
    [`/api/regions/${GU.code}/articles?page=0`, 400],
    [`/api/regions/${GU.code}/articles?page=abc`, 400],
    [`/api/regions/${GU.code}/articles?page=99999`, 400],
    [`/api/regions/${GU.code}/articles?q=x`, 400],
    ["/api/regions/99011/articles", 400],
    ["/api/regions/abcdefghij/articles", 400],
    ["/api/regions/%27%3B--/articles", 400],
    ["/api/regions/9909900000/articles", 404],
    [`/api/regions/${GU.code}/articles?page=2`, 404],
  ]) {
    const r = await getJson(p);
    assert.equal(r.status, code, `${p}: ${JSON.stringify(r.body)}`);
    if (code === 400) assert.ok(Array.isArray(r.body.errors) && r.body.errors.length > 0, `${p}: 칸 사유`);
  }
  await setFlags({ region_hubs: false });
  try {
    assert.equal((await getJson(`/api/regions/${GU.code}/articles`)).status, 404, "region_hubs 꺼짐 404");
  } finally {
    await setFlags({ region_hubs: true });
  }
});

test("e) 허브 문구 금지 표현(세금 혜택·가격 상승·투자 권유 — forbidden_phrases) 0", async () => {
  const phrases = (await one("select value from public.settings where key = 'forbidden_phrases'")).value.phrases;
  assert.ok(phrases.length >= 10 && phrases.includes("투자 추천"));
  for (const p of [guPath(), sidoPath(), "/local"]) {
    const { page, ctx } = await open(p);
    const text = await page.locator("main").innerText();
    for (const ph of phrases) assert.ok(!text.includes(ph), `${p}: 금지 표현 '${ph}' 0`);
    await ctx.close();
  }
});

test("f) /local 전국 — 시·도 카드 = 오늘 유효한 시·도 전부·링크 전수 200 · region_hubs 꺼짐 → 글자만 · ⑤ · 데이터 출처 줄 1개", async () => {
  const valid = (await db.query("select code from public.regions where level = 'sido' and (valid_to is null or valid_to >= current_date) order by code")).rows.map((r) => r.code);
  assert.equal(valid.filter((c) => !c.startsWith("99")).length, 17, "씨앗 시·도 17");
  const { page, ctx } = await open("/local");
  const cards = await page.$$eval('[data-part="sido-cards"] [data-sido-code]', (els) => els.map((e) => [e.getAttribute("data-sido-code"), e.querySelector("a")?.getAttribute("href") ?? null]));
  assert.deepEqual(cards.map((c) => c[0]), valid, "시·도 카드 = 오늘 유효한 시·도 (코드 순)");
  for (const [, href] of cards) {
    assert.ok(href && href.startsWith("/local/"), "켜짐 — 카드마다 지역 허브 링크");
    assert.equal((await get(href)).status, 200, `${href}: 200`);
  }
  const parts = await page.$$eval("[data-hub-part]", (els) => els.map((e) => e.getAttribute("data-hub-part")));
  assert.equal(parts[0], "head");
  assert.equal(parts[1], "regions", "머리 뒤 시·도 카드");
  assert.equal(parts.at(-1), "source", "맨 아래 데이터 출처 줄");
  assert.equal(await page.locator('[data-ui="source-line"]').count(), 1, "데이터 출처 줄 1개");
  const hrefs = await page.$$eval('[data-hub-block="sources"] [data-part="official-source-open"]', (as) => as.map((a) => a.getAttribute("href")));
  for (const k of ["S1", "S4", "S11"]) assert.ok(hrefs.includes(docUrl(k)), `/local ⑤ — 전국 검수 자료 ${k}`);
  for (const k of ["S2", "S3", "S8"]) assert.ok(!hrefs.includes(docUrl(k)), `/local ⑤ — 미검수·비공개 ${k} 0`);
  await ctx.close();

  // 분야를 고르면 시·도 카드·블록 0, 출처 줄은 그대로 (REG-06 '탭마다 데이터 출처 줄')
  const topic = await open("/local?topic=local_finance");
  assert.deepEqual(await topic.page.$$eval("[data-hub-part]", (els) => els.map((e) => e.getAttribute("data-hub-part")).filter((k) => k === "regions" || k === "blocks" || k === "source")), ["source"]);
  await topic.ctx.close();

  await setFlags({ region_hubs: false });
  try {
    const off = await open("/local");
    const offCards = await off.page.$$eval('[data-part="sido-cards"] [data-sido-code]', (els) => els.map((e) => [e.getAttribute("data-sido-code"), e.querySelectorAll("a").length]));
    assert.deepEqual(offCards.map((c) => c[0]), valid, "꺼짐 — 카드는 그대로(이름만)");
    assert.ok(offCards.every((c) => c[1] === 0), "꺼짐 — 지역 허브 링크 0 (404 링크 0)");
    assert.equal(await off.page.locator('main a[href^="/local/"]').count(), 0, "꺼짐 — /local/[sido] 링크 0");
    await off.ctx.close();
  } finally {
    await setFlags({ region_hubs: true });
  }
});

test("g) 360·1280px 가로 넘침 0 · 데이터 출처 줄 '출처 · 기준일 · 정보 확인일' · 접근성 95", async () => {
  for (const viewport of [
    { width: 360, height: 740 },
    { width: 1280, height: 800 },
  ]) {
    for (const p of [guPath(), sidoPath(), "/local"]) {
      const { page, ctx } = await open(p, viewport);
      assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${p} ${viewport.width}px 가로 넘침 0`);
      await ctx.close();
    }
  }
  const { page, ctx } = await open(guPath());
  assert.deepEqual(await page.$$eval('[data-ui="source-line"]', (els) => els.map((e) => e.textContent)), [
    `출처 시험용 블록도청 · 기준일 2026-08-31 · 정보 확인일 ${[fx.S1.verifiedOn, fx.S5.verifiedOn].sort()[0]}`,
  ]);
  await ctx.close();
  for (const p of [guPath(), "/local"]) {
    const r = await accessibility(`${base}${p}`, debugPort);
    assert.ok(r.score >= A11Y_MIN, `${p} 접근성 ${r.score} — ${r.failing.join(", ")}`);
  }
});
