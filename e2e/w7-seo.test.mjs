// W7 1~3단계 E2E — 색인 관문·사이트맵·RSS·robots.txt·구조화 데이터 (docs/dev/W7_설계.md 1장 2·3단계 증거, PRD-01A OPT-01·02·08, SEO-01·04).
// standalone 빌드를 SITE_INDEXING=off 서버와 on 서버로 한 번씩 띄워 같은 로컬 Supabase에 붙인다. 기사·인물은 가상 값이고 끝나면 지운다(남는 행 0).
//  a) off — robots.txt 전체 차단 + Sitemap 줄 0, 사이트맵·뉴스·이미지·RSS 경로 404(+noindex 머리글), 홈·기사 HTML noindex
//  b) on인데 AI 학습 크롤러 정책 미결정 — robots.txt 전체 차단(닫힌 쪽), 사이트맵 404
//  c) on + 정책 갖춤 — robots.txt에 설정한 크롤러 규칙·Sitemap 3줄 · 사이트맵의 모든 주소가 200이고 noindex 0·기사 canonical = 자기 주소 · 관리/API/검색 경로 0
//     뉴스 사이트맵은 기간 안 일반 기사만(광고·협찬·기간 밖 0) · RSS는 광고·협찬 0 · 항목 제목·발행일 = 화면 · lastmod = 최초 발행일(수정 없음)
//  e) 저장 전 입력 점검 — POST check는 아무것도 쓰지 않고(버전·점검 기록 불변) 입력한 원고로 판정한다: 리드 3문장 → 경고, 저장본은 그대로 / 틀린 칸 422
//  d) 구조화 데이터 — 기사·분야 허브의 JSON-LD 검사기 오류 0, 기사 화면 값(제목·발행일) 일치, BreadcrumbList에 새 분야 이름(옛 이름 0), 발행 기관 SM(선명)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";
import { importSource } from "./lib/ts-source.mjs";

const SITE = "https://w7seo.example.test";
const ADMIN_EMAIL = "w7-seo-e2e@example.test";
const POLICY = { search: ["TestSearchBot"], ai_training: { decided: true, agents: [{ name: "TestAiBot", allow: false }] } };
const UNDECIDED = { search: ["TestSearchBot"], ai_training: { decided: false, agents: [] } };

let sb, off, on, staff, db, editor;
let validate;
const saved = {};
const art = {};

const hoursAgo = (n) => new Date(Date.now() - n * 3600_000).toISOString();
const get = (server, p, init) => fetch(`${server.base}${p}`, { redirect: "manual", ...init });
const robotsMeta = (html) => [...html.matchAll(/<meta name="robots" content="([^"]*)"/g)].map((m) => m[1]);
const locs = (xml) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
const setPolicy = (value) => db.query("update public.settings set value = $1::jsonb where key = 'crawler_policy'", [JSON.stringify(value)]);

async function insertArticle(key, over) {
  const row = {
    slug: `w7seo-${key}-${staff.run}`,
    title: `시험용 색인 기사 ${key}`,
    summary: `시험용 요약 ${key}`,
    section: "tax",
    content_type: "reported_news",
    label: "none",
    first_published_at: hoursAgo(1),
    ...over,
  };
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    const cat = (await db.query("select id from public.categories where section = 'tax' order by id limit 1")).rows[0];
    const r = (
      await db.query(
        `insert into public.articles (slug, title, summary, section, content_type, status, category_id, label, author_id, first_published_at, tax_review_status, body)
         values ($1, $2, $3, $4, $5, 'published', $6, $7, $8, $9, 'approved', '{"blocks":[{"type":"paragraph","text":"시험용 본문 문단입니다."}],"claims":[]}'::jsonb) returning id`,
        [row.slug, row.title, row.summary, row.section, row.content_type, cat.id, row.label, art.personId, row.first_published_at],
      )
    ).rows[0];
    await db.query("commit");
    staff.trackArticle(Number(r.id));
    return { ...row, id: Number(r.id) };
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  ({ validate } = await importSource(pathToFileURL(path.join(ROOT, "packages", "structured-data", "src", "validate.ts")).href));
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  for (const key of ["crawler_policy", "feature_flags"]) saved[key] = (await db.query("select value from public.settings where key = $1", [key])).rows[0].value;
  const person = (await db.query("insert into public.people (name, slug, roles, visibility) values ('시험용 기자', $1, '{reporter}', 'hidden') returning id", [`w7seo-rep-${staff.run}`])).rows[0];
  staff.personIds.add(Number(person.id));
  art.personId = Number(person.id);
  art.normal = await insertArticle("normal", {});
  art.old = await insertArticle("old", { first_published_at: hoursAgo(100) });
  // 광고(label ad)와 협찬(sponsored)은 DB 제약상 항상 함께다 (articles_label_sponsored). 정보 목록(digest) 제외는 단위 시험이 본다
  art.ad = await insertArticle("ad", { content_type: "sponsored", label: "ad" });
  art.realestate = await insertArticle("realestate", { section: "realestate", content_type: "explainer" });
  editor = await staff.createUser({ label: "w7seo-editor", roles: ["editor"], person: { name: "시험용 편집자", roles: ["editor"] } });
  await setPolicy(UNDECIDED);
  const base = { NEXT_PUBLIC_SUPABASE_URL: sb.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey, SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey, ADMIN_EMAILS: ADMIN_EMAIL, NEXT_PUBLIC_SITE_URL: SITE };
  off = await startServer({ ...base });
  on = await startServer({ ...base, SITE_INDEXING: "on" });
});

after(async () => {
  off?.stop();
  on?.stop();
  if (db) {
    for (const [key, value] of Object.entries(saved)) await db.query("update public.settings set value = $1::jsonb where key = $2", [JSON.stringify(value), key]);
  }
  await staff?.cleanup();
});

test("a) off — robots.txt 전체 차단·Sitemap 줄 0, 사이트맵·RSS 404(+noindex), 홈·기사 HTML noindex 100%", async () => {
  await setPolicy(POLICY); // 정책이 갖춰져도 off가 우선
  const robots = await (await get(off, "/robots.txt")).text();
  assert.equal(robots, "User-agent: *\nDisallow: /\n");
  for (const p of ["/sitemap.xml", "/sitemap-news.xml", "/sitemap-images.xml", "/rss.xml", "/rss/tax.xml", "/sitemap/1.xml"]) {
    const res = await get(off, p);
    assert.equal(res.status, 404, p);
    assert.match(res.headers.get("x-robots-tag") ?? "", /noindex/, p);
  }
  for (const p of ["/", `/news/${art.normal.slug}`, "/tax", "/news"]) {
    const res = await get(off, p);
    assert.equal(res.status, 200, p);
    const metas = robotsMeta(await res.text());
    assert.ok(metas.length > 0 && metas.every((m) => m.includes("noindex")), `${p}: ${metas}`);
  }
  assert.ok(!(await (await get(off, `/news/${art.normal.slug}`)).text()).includes("rss+xml"), "off — RSS 연결 0");
});

test("b) on인데 AI 학습 크롤러 정책 미결정 — robots.txt 전체 차단(닫힌 쪽)·사이트맵 404", async () => {
  await setPolicy(UNDECIDED);
  assert.equal(await (await get(on, "/robots.txt")).text(), "User-agent: *\nDisallow: /\n");
  assert.equal((await get(on, "/sitemap.xml")).status, 404);
  assert.equal((await get(on, "/rss.xml")).status, 404);
});

test("c) on + 정책 갖춤 — robots.txt 규칙·Sitemap 3줄, 사이트맵 전 주소 200·noindex 0·canonical = 자기 주소", async () => {
  await setPolicy(POLICY); // 배포 없이 다음 요청부터 바뀐다
  const robots = await (await get(on, "/robots.txt")).text();
  assert.match(robots, /User-agent: TestSearchBot\nAllow: \//);
  assert.match(robots, /User-agent: TestAiBot\nDisallow: \/\n/);
  assert.match(robots, /Disallow: \/admin/);
  for (const f of ["sitemap.xml", "sitemap-news.xml", "sitemap-images.xml"]) assert.ok(robots.includes(`Sitemap: ${SITE}/${f}`), f);

  const res = await get(on, "/sitemap.xml");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /xml/);
  const urls = locs(await res.text());
  assert.ok(urls.includes(`${SITE}/news/${art.normal.slug}`) && urls.includes(`${SITE}/news/${art.old.slug}`) && urls.includes(`${SITE}/tax`) && urls.includes(`${SITE}/`));
  for (const u of urls) {
    assert.ok(u.startsWith(SITE), u);
    const p = new URL(u).pathname;
    assert.ok(!/^\/(admin|api|account|my|login|signup|search|experts\/request)(\/|$)/.test(p), `색인 제외 경로: ${p}`);
    const page = await get(on, p);
    assert.equal(page.status, 200, p);
    const html = await page.text();
    assert.ok(robotsMeta(html).every((m) => !m.includes("noindex")), `${p} noindex`);
    if (p.startsWith("/news/")) assert.equal(html.match(/<link rel="canonical" href="([^"]*)"/)?.[1], u, `${p} canonical`);
  }
  // lastmod = 실질 수정일이 없으면 최초 발행일
  const xml = await (await get(on, "/sitemap.xml")).text();
  const lastmod = xml.match(new RegExp(`<loc>${SITE}/news/${art.normal.slug}</loc><lastmod>([^<]*)</lastmod>`))?.[1];
  assert.equal(lastmod, new Date(art.normal.first_published_at).toISOString());
});

test("c-2) 뉴스 사이트맵·RSS — 기간 안 일반 기사만, 광고·협찬·정보 목록 0, 제목·발행일 = 화면", async () => {
  const news = locs(await (await get(on, "/sitemap-news.xml")).text());
  assert.ok(news.includes(`${SITE}/news/${art.normal.slug}`));
  for (const k of ["old", "ad"]) assert.ok(!news.includes(`${SITE}/news/${art[k].slug}`), `뉴스 사이트맵에 ${k} 0`);

  const rss = await (await get(on, "/rss/tax.xml")).text();
  assert.match(rss, /<rss version="2.0">/);
  assert.ok(rss.includes(`<link>${SITE}/news/${art.normal.slug}</link>`));
  assert.ok(rss.includes(`<title>${art.normal.title}</title>`));
  assert.ok(rss.includes(`<pubDate>${new Date(art.normal.first_published_at).toUTCString()}</pubDate>`));
  for (const k of ["ad"]) assert.ok(!rss.includes(art[k].slug), `RSS에 ${k} 0`);
  assert.ok(!rss.includes(art.realestate.slug), "분야 RSS에 다른 분야 0");
  const all = await (await get(on, "/rss.xml")).text();
  assert.ok(all.includes(art.normal.slug) && all.includes(art.realestate.slug));
  assert.equal((await get(on, "/rss/nope.xml")).status, 404);
  assert.equal((await get(on, "/sitemap/1.xml")).status, 404, "한 파일이면 조각 경로는 404");
  const img = await get(on, "/sitemap-images.xml");
  assert.equal(img.status, 200);
  // 화면의 제목과 같은지
  const page = await (await get(on, `/news/${art.normal.slug}`)).text();
  assert.ok(page.includes(art.normal.title));
});

test("d) 구조화 데이터 — 기사·허브 JSON-LD 오류 0, 화면 값 대조 불일치 0, 새 분야 이름·발행 기관 SM(선명)", async () => {
  const nodesOf = async (p) => {
    const html = await (await get(on, p)).text();
    const scripts = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([^<]*)<\/script>/g)].map((m) => JSON.parse(m[1]));
    return { html, nodes: scripts.flat() };
  };
  const article = await nodesOf(`/news/${art.normal.slug}`);
  // 시험 기사는 공개 기자 페이지·대표 이미지가 없다 — 그 둘은 발행 점검(geo.author·이미지 권리)이 막는 칸이라 여기서는 검사기가 정확히 그 둘만 지적한다. 나머지 오류 0
  assert.deepEqual(validate(article.nodes).map((e) => e.path), ["NewsArticle.author", "NewsArticle.image"], "기사 JSON-LD 검사기: 시험 기사에 없는 칸 외 오류 0");
  const news = article.nodes.find((n) => n["@type"] === "NewsArticle");
  assert.equal(news.headline, art.normal.title);
  assert.equal(Date.parse(news.datePublished), Date.parse(art.normal.first_published_at), "발행일 = 기록");
  assert.equal(news.publisher.name, "SM(선명)");
  const crumbs = article.nodes.find((n) => n["@type"] === "BreadcrumbList").itemListElement.map((i) => i.name);
  assert.equal(crumbs[0], "홈");
  assert.equal(crumbs[1], "지방세·부동산세금");
  assert.equal(crumbs.at(-1), art.normal.title);

  for (const [p, name] of [["/tax", "지방세·부동산세금"], ["/realestate", "부동산재테크"], ["/finance", "부동산금융"]]) {
    const hub = await nodesOf(p);
    assert.deepEqual(validate(hub.nodes), [], `${p} 검사기 오류 0`);
    const list = hub.nodes.find((n) => n["@type"] === "BreadcrumbList");
    assert.deepEqual(list.itemListElement.map((i) => i.name), ["홈", name], p);
    assert.equal(hub.nodes.filter((n) => n["@type"] === "BreadcrumbList").length, 1, `${p} BreadcrumbList 하나`);
  }
});

test("e) 저장 전 입력 점검 — 쓰기 0(버전·seo_checks 불변), 입력한 원고로 판정, 저장본 점검은 그대로, 틀린 칸 422", async () => {
  const url = `/api/admin/articles/${art.normal.id}/check`;
  const call = (method, body) =>
    fetch(`${on.base}${url}`, { method, headers: { authorization: `Bearer ${editor.token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const state = async () => ({
    version: (await db.query("select version, title from public.articles where id = $1", [art.normal.id])).rows[0],
    checks: (await db.query("select count(*)::int n from public.seo_checks where target_id = $1", [String(art.normal.id)])).rows[0].n,
  });
  const before = await state();
  const saved = await (await call("GET")).json();
  assert.equal(saved.seoLint.warnings.includes("aeo.lead-answer"), false, "저장본 리드는 1문장");

  const draft = await call("POST", { body: { blocks: [{ type: "paragraph", text: "첫째 문장입니다. 둘째 문장입니다. 셋째 문장입니다." }], claims: [] }, title: "시험용 고친 제목" });
  assert.equal(draft.status, 200);
  const body = await draft.json();
  assert.equal(body.draft, true);
  assert.ok(body.seoLint.warnings.includes("aeo.lead-answer"), "입력한 리드 3문장 → 경고");
  assert.equal(body.canPublish === true || body.canPublish === false, true);
  assert.match(body.seoLint.disclaimer, /내부 품질 지표/);

  assert.deepEqual(await state(), before, "점검만으로 버전·제목·점검 기록이 바뀌지 않는다");
  assert.equal((await (await call("GET")).json()).seoLint.warnings.includes("aeo.lead-answer"), false, "저장본 점검은 그대로");
  assert.equal((await call("POST", { nope: 1 })).status, 422);
  const anon = await fetch(`${on.base}${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.ok([401, 403].includes(anon.status), "로그인 없이는 거부");
});
