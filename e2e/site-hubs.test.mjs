// 4대 분야 허브·하위 분야·뉴스 전체·상황 페이지 E2E (W2-b 3단계 — CAT-02 · UX-05 · UX-06 · HOME-02 · FND-09, docs/dev/W2-b_설계.md 1장 3단계 증거)
// standalone 빌드를 띄우고 로컬 Supabase에 붙인다. 공개 기사·상황·용어·빈 하위 분야는 DB에 직접 넣는다(첫 화면 요청 전에 — 공개 데이터 캐시 30초).
//  a) 네 허브의 골격 DOM이 같다 — 머리(분야 허브 머리: 아이브로·제목 → 지방세 포인트 → 탭) → (분야 고유 블록 — 지자체뉴스만, 그 자리에) → 최신 목록 → 상황 카드 → 관련 용어
//  b) 기사 0건 하위 분야는 탭·헤더 하위 메뉴에 없고, 그 주소는 200 + noindex + 상위 허브 안내. 없는 하위 분야·지자체뉴스 하위 경로는 404
//  c) 뉴스 전체는 편집 승인된 reported_news만 (해설·칼럼·광고·승인 전 보도 0), 허브 탭으로 거른다
//  d) 상황 페이지 — 먼저 확인할 것 3개(단계 타임라인)·자주 틀리는 점(있을 때만)·해결 사례·기사·용어·다음 행동, 지역 선택(이 상황만), 숨긴 상황 404
//  e) 허브 상황 카드는 상한(설정)까지 — 상한을 3으로 내리면 3장, 되돌리면 4장 (설정 API 쓰기는 캐시를 바로 만료한다)
//  f) 화면 전환 — 홈 → 허브 → 하위 분야 → 뒤로·뒤로, 헤더 하위 메뉴 → 뉴스 전체: 문서 새로고침 0·페이지 표식 유지
//  g) R1~R3(360·640·1024) — 허브·상황 페이지, 360px 가로 스크롤 0, 탭·칩·버튼 터치 44px, 다음 행동 버튼 328px(UX-06)
//  h) 꺼진 기능·v1.2·단계 전 경로로 가는 링크 0
// 만든 계정·기사·상황·용어·분야·감사 로그는 끝나면 지우고, 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { measurePage } from "./lib/screen-rules.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "site-hubs-e2e@example.test";
const SITE = "https://e2e.example.test";
const HUBS = [
  { key: "tax", path: "/tax", name: "지방세" },
  { key: "realestate", path: "/realestate", name: "부동산" },
  { key: "finance", path: "/finance", name: "부동산개발금융" },
  { key: "local", path: "/local", name: "지자체뉴스" },
];
/** 기능 키로 여는 화면 (HOME-02 · HELP-05) — 꺼져 있으면 링크 0 */
const GATED = ["/calc", "/experts", "/store", "/edu", "/search", "/about", "/help", "/glossary", "/tax/amendments/"];
/** PRD-01A 3장·HOME-02 — 단계 전 경로와 v1.2 경로 (내부 링크 0) */
const NEVER = ["/calc/", "/law", "/cases", "/workspace", "/qna", "/library", "/region", "/resources", "/authors", "/news/cards", "/editorial-policy", "/corrections", "/advertise", "/terms", "/privacy", "/no-email-collection"];
const SEOUL = "1100000000";

let sb, server, staff, db, browser, base;
/** 기능 키와 상관없이 늘 열린 화면 — 측정 거부 안내(W2-c). W2-e 4단계부터 바닥글에 항상 있다(W2-e 설계 6.4) */
const ALWAYS_OPEN = new Set(["/about/measurement"]);
const u = {};
const fx = { articles: {}, situations: {} };

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();

async function api(method, apiPath, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${apiPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function article(label, over = {}) {
  const contentType = over.contentType ?? "explainer";
  const { rows } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, reporting_method, status, author_id, category_id, editorial_field, region_codes, label, subtype, digest_id, first_published_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
    [
      `e2e-hubs-${label}-${staff.run}`,
      over.title ?? `허브 시험 ${label}`,
      "무엇이 바뀌고 누구에게 영향이 있는지 정리했습니다",
      over.section ?? "tax",
      contentType,
      contentType === "reported_news" ? "qualitative" : null,
      over.status ?? "published",
      u.reporter.personId,
      over.categoryId ?? null,
      over.editorialField ?? null,
      over.regionCodes ?? [],
      contentType === "sponsored" ? "ad" : "none",
      over.subtype ?? "general",
      contentType === "digest" ? 1 : null,
      over.publishedAt ?? hoursAgo(24),
    ],
  );
  const id = Number(rows[0].id);
  staff.trackArticle(id);
  fx.articles[label] = id;
  return id;
}

// 지역 기사 편집 승인은 근거·관계·광고 독립성 3항목 확인이 있어야 들어간다 (REG1-17 — W4 7단계 DB 트리거)
const approve = (articleId) =>
  db.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision, checklist) values ($1, 'desk_edit', $2, 'approve', $3)", [
    articleId,
    u.editor.personId,
    { evidence: true, relation: true, ad_independence: true },
  ]);
const categoryId = async (section, slug) => Number((await one("select id from public.categories where section = $1 and slug = $2", [section, slug])).id);

const CHECKS = [
  { title: "자동차세를 1년치 미리 냈는지", when: "판 날", note: "납부 영수증이나 위택스 납부 내역을 찾아 둡니다" },
  { title: "등록 말소일" },
  { title: "환급 받을 계좌", note: "본인 명의 통장" },
];

async function situation(label, over = {}) {
  const r = await one(
    `insert into public.situations (slug, section, title, subtitle, pictogram, checks, mistakes, article_ids, solved_case_ids, glossary_ids, region_select, hub_slot, visible, reviewer_id, reviewed_at, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'user:e2e') returning id, slug`,
    [
      `e2e-${label}-${staff.run}`,
      over.section ?? "tax",
      over.title ?? `상황 ${label}`,
      over.subtitle ?? "무엇을 먼저 확인할지 알려 드립니다",
      over.pictogram ?? "notice-received",
      JSON.stringify(over.checks ?? CHECKS),
      over.mistakes ?? [],
      over.articleIds ?? [],
      over.solvedCaseIds ?? [],
      over.glossaryIds ?? [],
      over.regionSelect ?? false,
      over.hubSlot ?? null,
      over.visible ?? true,
      over.reviewed === false ? null : u.reviewer.personId,
      over.reviewed === false ? null : new Date().toISOString(),
    ],
  );
  staff.trackRow("situations", r.id);
  fx.situations[label] = { id: Number(r.id), slug: r.slug, href: `/situations/${r.slug}` };
  return fx.situations[label];
}

async function term(label, section, plain) {
  // 공개 용어 (W2-d 3단계 — 새 용어는 숨김이 기본값)
  const r = await one("insert into public.glossary_terms (term, plain, section, visible) values ($1, $2, $3, true) returning id", [`${label} ${staff.run}`, plain, [section]]);
  staff.trackRow("glossary_terms", r.id);
  return Number(r.id);
}

async function open(path, viewport = { width: 1280, height: 800 }) {
  const page = await browser.newPage({ viewport });
  const res = await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  return { page, status: res.status() };
}

/** 허브 골격 — 부분(data-hub-part) 순서와, 머리 안의 골격 요소 순서 */
async function skeleton(page) {
  return page.evaluate(() => {
    const parts = [...document.querySelectorAll("[data-hub-part]")].map((e) => e.getAttribute("data-hub-part"));
    const head = document.querySelector('[data-hub-part="head"] [data-ui="field-hub-head"]');
    const headOrder = head ? [...head.querySelectorAll('[data-ui="eyebrow"], h1, [data-ui="field-tax-point"], [data-ui="tab-nav"]')].map((e) => e.getAttribute("data-ui") ?? e.tagName.toLowerCase()) : [];
    return { parts, headOrder, h1: document.querySelector("h1")?.textContent ?? null, tabs: [...document.querySelectorAll('[data-ui="tab-nav"] a')].map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")]) };
  });
}

async function hrefs(page) {
  return page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
}
const pathOf = (href) => href.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
const hits = (list, prefixes) => list.filter((h) => h.startsWith("/") && prefixes.some((p) => (p.endsWith("/") ? pathOf(h).startsWith(p) : pathOf(h) === p || pathOf(h).startsWith(`${p}/`))));

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
  await staff.snapshotOperations();
  const leftover = (await one("select count(*)::int n from public.situations")).n;
  assert.equal(leftover, 0, "로컬 DB에 상황 카드가 남아 있다 — 허브 상한 시험 전에 비어 있어야 한다");
  u.editor = await staff.createUser({ label: "hubs-editor", roles: ["editor"], person: { name: "허브 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "hubs-reporter", roles: ["reporter"], person: { name: "김가온", roles: ["reporter"] } });
  u.reviewer = await staff.createUser({ label: "hubs-reviewer", roles: ["reviewer"], person: { name: "허브 시험 감수위원", roles: ["reviewer"] } });
  u.admin = await staff.createUser({ label: "hubs-admin", email: ADMIN_EMAIL });

  // 하위 분야 — 지방세 '해석'·부동산 '개발방법 비교'·개발금융 '신탁·PF 구조'에 기사, 개발금융에 기사 0건인 새 하위 분야(공개)
  const interpretations = await categoryId("tax", "interpretations");
  const methods = await categoryId("realestate", "development-methods");
  const trust = await categoryId("finance", "trust-pf");
  const empty = await one("insert into public.categories (section, slug, name, sort, visible) values ('finance', $1, $2, 999, true) returning id, slug, name", [`e2e-empty-${staff.run}`, `빈 하위 분야 ${staff.run}`]);
  staff.trackRow("categories", empty.id);
  fx.empty = { slug: empty.slug, name: empty.name };

  // 지방세 — 해설 2·보도(승인) 1·칼럼 1·광고 1·승인 전 보도 1·해결 사례 1
  await article("tax-explainer1", { categoryId: interpretations, publishedAt: hoursAgo(5), title: "지방세 해설 하나" });
  await article("tax-explainer2", { categoryId: interpretations, publishedAt: hoursAgo(6), title: "지방세 해설 둘" });
  await approve(await article("tax-report", { contentType: "reported_news", categoryId: interpretations, publishedAt: hoursAgo(2), title: "지방세 보도" }));
  await article("tax-opinion", { contentType: "opinion", categoryId: interpretations, publishedAt: hoursAgo(3) });
  await article("tax-ad", { contentType: "sponsored", categoryId: interpretations, publishedAt: hoursAgo(1) });
  await article("tax-report-pending", { contentType: "reported_news", categoryId: interpretations, publishedAt: hoursAgo(1.5) });
  await article("tax-solved", { categoryId: interpretations, subtype: "solved_case", publishedAt: hoursAgo(30), title: "환급 받은 해결 사례" });
  // 부동산 — 해설(서울 지역 태그) · 개발금융 — 해설 · 지자체뉴스 — 보도(승인, 지방세 편집 분야)·해설(도시정책)·금주 핫뉴스
  await article("re-explainer", { section: "realestate", categoryId: methods, regionCodes: [SEOUL], title: "서울 취득세 해설" });
  await article("fin-explainer", { section: "finance", categoryId: trust });
  await approve(await article("local-report", { section: "local", contentType: "reported_news", editorialField: "local_tax", regionCodes: [SEOUL], publishedAt: hoursAgo(4) }));
  await article("local-urban", { section: "local", editorialField: "urban_policy", publishedAt: hoursAgo(7) });
  await article("local-digest", { section: "local", contentType: "digest", publishedAt: hoursAgo(0.5) });

  // 용어 — 분야마다 1개
  const terms = {};
  for (const h of HUBS) terms[h.key] = await term(`허브용어${h.key}`, h.key, "쉬운 풀이");

  // 상황 — 지방세 허브 4장(자리 1~4) + 허브 밖 공개 1 + 숨긴 1, 나머지 분야는 1장씩. 차를 팔았어요는 연결·자주 틀리는 점까지
  await situation("car-sold", {
    title: "차를 팔았어요·폐차했어요",
    subtitle: "돌려받을 자동차세가 있는지 확인합니다",
    pictogram: "car-sold",
    hubSlot: 1,
    mistakes: ["판 날이 아니라 등록 말소일 기준으로 계산합니다"],
    articleIds: [fx.articles["tax-explainer1"], fx.articles["tax-report-pending"]],
    solvedCaseIds: [fx.articles["tax-solved"]],
    glossaryIds: [terms.tax],
  });
  await situation("notice", { title: "고지서를 받았어요", hubSlot: 2 });
  await situation("refund", { title: "세금을 돌려받고 싶어요", pictogram: "refund", hubSlot: 3 });
  await situation("worker", { title: "지방세 실무자예요", pictogram: "field-local-tax", hubSlot: 4 });
  await situation("tax-extra", { title: "허브 밖 상황이에요" });
  await situation("hidden", { title: "숨긴 상황", visible: false, reviewed: false, hubSlot: null });
  await situation("home-bought", { section: "realestate", title: "집을 샀어요", pictogram: "home-bought", hubSlot: 1, regionSelect: true });
  await situation("trust", { section: "finance", title: "신탁 부동산이에요", pictogram: "trust-property", hubSlot: 1 });
  await situation("local-notice", { section: "local", title: "우리 구 소식을 보고 싶어요", pictogram: "field-local-news", hubSlot: 1 });
  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

test("a) 네 허브의 골격 DOM이 같다 — 머리(아이브로 → 제목 → 탭) → 최신 목록 → 상황 카드 → 관련 용어, 분야 고유 블록은 지자체뉴스만 그 자리에", async () => {
  const seen = {};
  for (const h of HUBS) {
    const { page, status } = await open(h.path);
    assert.equal(status, 200, h.path);
    seen[h.key] = await skeleton(page);
    assert.equal(seen[h.key].h1, h.name, `${h.path}: 제목`);
    assert.equal(await page.locator('[data-hub-part="head"] [data-ui="field-hub-head"]').count(), 1, `${h.path}: 머리는 분야 허브 머리 컴포넌트 (CAT-02)`);
    assert.deepEqual(seen[h.key].tabs[0], ["전체", h.path, "page"], `${h.path}: 첫 탭 [전체]가 지금 탭`);
    await page.close();
  }
  // 분야 고유 블록(지자체뉴스)·상담 사례 HOT(지방세 허브 — HOME-05, W2-c 2단계)은 그 허브에만 있는 자리다
  const common = (s) => s.parts.filter((p) => p !== "blocks" && p !== "hot");
  for (const h of HUBS) {
    assert.deepEqual(common(seen[h.key]), ["head", "latest", "situations", "terms"], `${h.path} 골격`);
    assert.deepEqual(seen[h.key].headOrder, ["eyebrow", "h1", "tab-nav"], `${h.path} 머리 골격 (지방세 포인트는 01B 감수본 전이라 0)`);
  }
  assert.deepEqual(seen.local.parts, ["head", "blocks", "latest", "situations", "terms"], "지자체 허브 블록은 탭과 최신 목록 사이 고정 자리");
  for (const k of ["tax", "realestate", "finance"]) assert.ok(!seen[k].parts.includes("blocks"), `${k}: 분야 고유 블록(01B) 0`);
  assert.deepEqual(seen.tax.parts, ["head", "latest", "hot", "situations", "terms"], "지방세 허브 — 최신 목록 뒤에 상담 사례 HOT (해석 분야 기사가 있다)");
  for (const k of ["realestate", "finance", "local"]) assert.ok(!seen[k].parts.includes("hot"), `${k}: 상담 사례 HOT 0 (지방세 허브에만)`);

  // 지자체뉴스 — 탭은 기사 있는 편집 분야, 블록은 LG-08 순서(데이터가 있는 ② 지방세·지방재정 → ③ 부동산·개발만)
  assert.deepEqual(seen.local.tabs.map((t) => t[1]), ["/local", "/local?topic=local_tax", "/local?topic=urban_policy"]);
  const { page } = await open("/local");
  assert.deepEqual(await page.$$eval("[data-hub-block]", (els) => els.map((e) => e.getAttribute("data-hub-block"))), ["localTax", "realEstate"]);
  assert.deepEqual(await page.$$eval('[data-hub-block] h2', (els) => els.map((e) => e.textContent)), ["지방세·지방재정", "부동산·개발"]);
  assert.equal(await page.locator('[data-hub-part="latest"] [data-article-id]').count(), 2, "지자체뉴스 최신 목록 — 금주 핫뉴스(digest) 0");
  assert.ok((await page.locator('[data-hub-part="latest"] [data-ui="editorial-field-badge"]').count()) >= 2, "지역 기사 카드에 편집 분야 배지");
  await page.close();

  // 지방세 허브 최신 목록 — 해설·칼럼·광고는 유형 배지와 함께, 승인 전 보도는 목록에는 나온다(발행됨) — 금주 핫뉴스·초안 0
  const tax = await open("/tax");
  const badges = await tax.page.$$eval('[data-hub-part="latest"] [data-ui="article-type-badge"]', (els) => els.map((e) => e.textContent));
  for (const b of ["해설", "보도", "오피니언", "광고"]) assert.ok(badges.includes(b), `지방세 최신 목록에 '${b}' 배지 — ${badges}`);
  await tax.page.close();
});

test("b) 기사 0건 하위 분야 — 탭·헤더 하위 메뉴에 없고, 그 주소는 200 + noindex + 상위 허브 안내 / 없는 하위 분야·지자체뉴스 하위 경로는 404", async () => {
  const { page } = await open("/finance");
  const tabs = (await skeleton(page)).tabs.map((t) => t[1]);
  assert.deepEqual(tabs, ["/finance", "/finance/trust-pf"], "기사 있는 하위 분야만 — 빈 하위 분야·사례·규제 통계·칼럼 0");
  // 헤더 하위 메뉴 — 펼치면 기사 있는 하위 분야 + 뉴스 전체 (분야 데이터에서, HOME-02)
  await page.getByRole("button", { name: "부동산개발금융 하위 메뉴" }).click();
  const sub = await page.$$eval('[data-menu-section="finance"] [data-part="sub-link"]', (as) => as.map((a) => [a.textContent, a.getAttribute("href")]));
  assert.deepEqual(sub, [
    ["신탁·PF 구조", "/finance/trust-pf"],
    ["뉴스 전체", "/news?section=finance"],
  ]);
  assert.ok(!(await hrefs(page)).some((h) => h.includes(fx.empty.slug)), "빈 하위 분야로 가는 링크 0");
  await page.close();

  const empty = await open(`/finance/${fx.empty.slug}`);
  assert.equal(empty.status, 200, "빈 하위 분야 주소는 200 (설계 9장)");
  assert.match((await empty.page.getAttribute('meta[name="robots"]', "content")) ?? "", /noindex/);
  assert.equal(await empty.page.locator('meta[name="robots"]').count(), 1);
  assert.equal((await empty.page.locator("h1").textContent()).trim(), fx.empty.name);
  const guide = empty.page.locator('[data-part="empty-guide"]');
  assert.match(await guide.textContent(), /아직 공개된 기사가 없습니다/);
  assert.equal(await guide.locator("a").getAttribute("href"), "/finance", "상위 허브 안내");
  assert.equal(await empty.page.locator("[data-article-id]").count(), 0);
  assert.equal(await empty.page.getByText("준비 중").count(), 0);
  await empty.page.close();

  const full = await open("/tax/interpretations");
  assert.equal(full.status, 200);
  assert.ok((await full.page.locator('[data-part="category-articles"] [data-article-id]').count()) >= 5);
  assert.equal(await full.page.locator('[data-ui="tab-nav"] a[aria-current="page"]').textContent(), "해석", "지금 하위 분야가 고른 탭");
  await full.page.close();

  for (const p of ["/tax/no-such-category", "/tax/Bad_Slug", "/local/reporting", `/situations/${fx.situations.hidden.slug}`, "/tax/interpretations?page=99"]) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 404, p);
    if (p.startsWith("/tax/no-such")) assert.match(await res.text(), /찾는 화면이 없습니다/, "공개 틀 안의 404 안내");
  }
});

test("c) 뉴스 전체 — 편집 승인된 reported_news만(해설·칼럼·광고·승인 전 보도·금주 핫뉴스 0), [전체]+허브 탭 4로 거른다", async () => {
  const { page, status } = await open("/news");
  assert.equal(status, 200);
  const ids = await page.$$eval('[data-part="news-articles"] [data-article-id]', (els) => els.map((e) => Number(e.getAttribute("data-article-id"))));
  assert.deepEqual(ids, [fx.articles["tax-report"], fx.articles["local-report"]], "최신 순, 승인된 보도만");
  assert.deepEqual([...new Set(await page.$$eval('[data-part="news-articles"] [data-ui="article-type-badge"]', (els) => els.map((e) => e.textContent)))], ["보도"]);
  const sk = await skeleton(page);
  assert.equal(sk.h1, "뉴스 전체");
  assert.deepEqual(sk.tabs.map((t) => [t[0], t[1]]), [
    ["전체", "/news"],
    ["지방세", "/news?section=tax"],
    ["부동산", "/news?section=realestate"],
    ["개발금융", "/news?section=finance"],
    ["지자체", "/news?section=local"],
  ]);
  assert.deepEqual(sk.parts, ["head", "latest"], "같은 골격 — 머리(허브 탭) → 목록");
  await page.close();

  const local = await open("/news?section=local");
  assert.deepEqual(await local.page.$$eval('[data-part="news-articles"] [data-article-id]', (els) => els.map((e) => Number(e.getAttribute("data-article-id")))), [fx.articles["local-report"]]);
  assert.equal(await local.page.locator('[data-ui="tab-nav"] a[aria-current="page"]').textContent(), "지자체");
  await local.page.close();
  const finance = await open("/news?section=finance");
  assert.equal(await finance.page.locator("[data-article-id]").count(), 0);
  assert.equal(await finance.page.locator("h2", { hasText: "아직 취재 기사가 없습니다" }).count(), 1);
  await finance.page.close();
});

test("d) 상황 페이지 — 먼저 확인할 것 3개·자주 틀리는 점·해결 사례·기사(공개 것만)·용어·다음 행동, 숨긴 상황 404", async () => {
  const s = fx.situations["car-sold"];
  const { page, status } = await open(s.href);
  assert.equal(status, 200);
  assert.equal((await page.locator("h1").textContent()).trim(), "차를 팔았어요·폐차했어요");
  assert.equal(await page.locator('h1 [data-ui="pictogram"][data-pictogram="car-sold"]').count(), 1, "픽토그램 + 상황 제목");
  assert.match(await page.locator('[data-situation-part="head"] [data-ui="eyebrow"]').textContent(), /SITUATION/);
  const steps = await page.$$eval('[data-situation-part="checks"] [data-ui="step-timeline"] > li', (lis) => lis.map((li) => li.querySelector("span.text-\\[22px\\]")?.textContent));
  assert.deepEqual(steps, CHECKS.map((c) => c.title), "먼저 확인할 것 3개 (단계 타임라인)");
  assert.equal(await page.locator('[data-situation-part="mistakes"] [data-ui="status-box"][data-kind="mistake"]').count(), 1);
  assert.deepEqual(await page.$$eval('[data-part="solved-cases"] [data-article-id]', (els) => els.map((e) => Number(e.getAttribute("data-article-id")))), [fx.articles["tax-solved"]]);
  assert.deepEqual(
    await page.$$eval('[data-part="situation-articles"] [data-article-id]', (els) => els.map((e) => Number(e.getAttribute("data-article-id")))),
    [fx.articles["tax-explainer1"], fx.articles["tax-report-pending"]],
    "연결 기사 — 지정 순서 (발행된 것)",
  );
  assert.equal(await page.locator('[data-situation-part="terms"] [data-ui="chip"]').count(), 1);
  assert.equal(await page.locator('[data-situation-part="region"]').count(), 0, "지역 선택은 그 상황만");
  assert.deepEqual(await page.$$eval('[data-ui="next-action-band"] [data-next-action]', (els) => els.map((e) => [e.getAttribute("data-next-action"), e.querySelector("a")?.getAttribute("href")])), [["same_section", "/tax"]]);
  assert.equal(await page.locator('[data-ui="primary-button"]').count(), 0, "다음 행동 띠에 주 버튼 0 (R2)");
  await page.close();

  // 자주 틀리는 점이 없는 상황은 상태 상자 0
  const notice = await open(fx.situations.notice.href);
  assert.equal(await notice.page.locator('[data-ui="status-box"]').count(), 0);
  assert.equal(await notice.page.locator('[data-situation-part="checks"] [data-ui="step-timeline"] > li').count(), 3);
  await notice.page.close();

  // 지역 선택 — 시·도 17 칩, 서울을 고르면 서울 기사 (화면 전환), 시·군·구 칩이 생긴다
  const home = await open(fx.situations["home-bought"].href);
  const chips = home.page.locator('[data-situation-part="region"] ul[aria-label="시·도"] a');
  assert.equal(await chips.count(), 17);
  await home.page.evaluate(() => (window.__e2eMarker = "kept"));
  await home.page.locator(`[data-region-code="${SEOUL}"]`).first().click();
  await home.page.waitForURL((url) => url.pathname === fx.situations["home-bought"].href && url.searchParams.get("region") === SEOUL);
  await home.page.locator('[data-part="region-articles"]').waitFor();
  assert.equal(await home.page.evaluate(() => window.__e2eMarker), "kept", "지역 칩은 화면 전환");
  assert.equal(await home.page.locator(`[data-region-code="${SEOUL}"][aria-current="true"]`).count(), 1);
  assert.deepEqual(await home.page.$$eval('[data-part="region-article-list"] [data-article-id]', (els) => els.map((e) => Number(e.getAttribute("data-article-id")))), [fx.articles["re-explainer"]]);
  await home.page.close();
});

test("e) 허브 상황 카드는 상한(설정)까지 — 지방세 4장(허브 밖·숨긴 상황 0), 상한 3이면 3장, 되돌리면 4장 (설정 쓰기는 바로 반영)", async () => {
  const cards = async () => {
    const { page } = await open("/tax");
    const slugs = await page.$$eval('[data-part="hub-situations"] [data-situation-slug]', (els) => els.map((e) => e.getAttribute("data-situation-slug")));
    const links = await page.$$eval('[data-part="hub-situations"] a', (as) => as.map((a) => a.getAttribute("href")));
    await page.close();
    return { slugs, links };
  };
  const four = await cards();
  assert.deepEqual(four.slugs, ["car-sold", "notice", "refund", "worker"].map((k) => fx.situations[k].slug), "허브 자리 순서");
  assert.deepEqual(four.links, ["car-sold", "notice", "refund", "worker"].map((k) => fx.situations[k].href));
  let r = await api("PATCH", "/settings/hub_situation_limit", u.admin, { value: 3 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual((await cards()).slugs, ["car-sold", "notice", "refund"].map((k) => fx.situations[k].slug));
  r = await api("PATCH", "/settings/hub_situation_limit", u.admin, { value: 4 });
  assert.equal(r.status, 200);
  assert.equal((await cards()).slugs.length, 4);
  // 홈에는 상황 카드 섹션 0 (UX-05 '홈 HTML에 상황 카드 섹션 0')
  const { page } = await open("/");
  assert.equal(await page.locator('[data-ui="situation-card"]').count(), 0);
  await page.close();
});

test("f) 화면 전환 — 홈 → 허브 → 하위 분야 → 뒤로·뒤로, 헤더 하위 메뉴 → 뉴스 전체: 문서 새로고침 0·페이지 표식 유지", async () => {
  const { page } = await open("/");
  await page.evaluate(() => (window.__e2eMarker = "kept"));
  const documents = [];
  page.on("request", (r) => {
    if (r.resourceType() === "document") documents.push(new URL(r.url()).pathname);
  });
  await page.locator('nav[aria-label="분야 메뉴"] a[href="/tax"]').click();
  await page.waitForURL(`${base}/tax`);
  await page.locator('[data-ui="hub"][data-hub="tax"]').waitFor();
  assert.equal(await page.locator('nav[aria-label="분야 메뉴"] a[aria-current="page"]').textContent(), "지방세", "지금 보는 분야 표시");
  await page.locator('[data-ui="tab-nav"] a[href="/tax/interpretations"]').click();
  await page.waitForURL(`${base}/tax/interpretations`);
  await page.locator('[data-ui="category-list"]').waitFor();
  await page.locator('[data-part="category-articles"] [data-article-id]').first().waitFor();
  await page.goBack();
  await page.waitForURL(`${base}/tax`);
  await page.locator('[data-ui="hub"][data-hub="tax"]').waitFor();
  await page.goBack();
  await page.waitForURL(`${base}/`);
  await page.locator('[data-home-section="fields"]').waitFor();
  // 4대 분야 카드 → 지자체뉴스 허브 → 상황 카드 → 상황 페이지
  await page.locator('[data-ui="field-cards"] a[href="/local"]').click();
  await page.locator('[data-ui="hub"][data-hub="local"]').waitFor();
  await page.locator('[data-part="hub-situations"] a').first().click();
  await page.locator('[data-ui="situation-page"]').waitFor();
  // 헤더 하위 메뉴 → 뉴스 전체(지방세)
  await page.getByRole("button", { name: "지방세 하위 메뉴" }).click();
  await page.locator('[data-menu-section="tax"] [data-part="sub-link"][href="/news?section=tax"]').click();
  await page.waitForURL((url) => url.pathname === "/news" && url.searchParams.get("section") === "tax");
  await page.locator('[data-ui="news-list"][data-section="tax"]').waitFor();
  assert.equal(await page.getByRole("button", { name: "지방세 하위 메뉴" }).getAttribute("aria-expanded"), "false", "누르면 하위 메뉴가 닫힌다");
  assert.equal(await page.evaluate(() => window.__e2eMarker), "kept", "페이지 표식 유지 — 문서 새로고침 0");
  assert.deepEqual(documents, []);
  assert.equal(await page.evaluate(() => performance.getEntriesByType("navigation").length), 1);
  await page.close();
});

test("g) 화면 규칙 R1·R2·R3 — 허브·상황 페이지 폭 360·640·1024", async () => {
  for (const path of ["/tax", "/local", fx.situations["car-sold"].href]) {
    for (const width of [360, 640, 1024]) {
      const r = await measurePage(browser, `${base}${path}`, { width, height: 740 });
      // R1은 360×740 첫 화면 기준이다 (PRD-00 8.2 — run-screen-rules도 360에서만 잰다). 640·1024는 글자 수를 기록만 한다
      if (width === 360) assert.ok(r.r1.pass, `${path} ${width}px R1 ${r.r1.chars}자 > 150`);
      assert.ok(r.r2.pass, `${path} ${width}px R2 주 버튼 ${r.r2.maxPerViewport}개`);
      assert.ok(r.r3.pass, `${path} ${width}px R3 오렌지 ${r.r3.ratio}`);
    }
  }
});

test("g) 360px — 가로 스크롤 0, 탭·칩·카드·버튼 터치 44px, 다음 행동 버튼 328px (UX-06)", async () => {
  const pages = [...HUBS.map((h) => h.path), "/tax/interpretations", `/finance/${fx.empty.slug}`, "/news", fx.situations["car-sold"].href, `${fx.situations["home-bought"].href}?region=${SEOUL}`];
  for (const path of pages) {
    const { page } = await open(path, { width: 360, height: 740 });
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${path}: 가로 스크롤`);
    const small = await page.$$eval('main [data-ui="tab-nav"] a, main [data-region-code], main [data-ui="next-action-band"] a, main [data-part="pager"] a, main [data-part="empty-guide"] a', (as) =>
      as.map((a) => ({ t: a.textContent, ...a.getBoundingClientRect().toJSON() })).filter((r) => r.height < 44 || r.width < 44),
    );
    assert.deepEqual(small, [], `${path}: 터치 영역 44px 미만`);
    if (path.startsWith("/situations/")) {
      const box = await page.locator('[data-ui="next-action-band"] [data-ui="dark-button"]').first().boundingBox();
      assert.equal(Math.round(box.width), 328, `${path}: 다음 행동 버튼 너비 = 화면 폭 − 32px`);
    }
    await page.close();
  }
});

test("h) 허브·하위 분야·뉴스 전체·상황 페이지 — 꺼진 기능·v1.2·단계 전 경로 링크 0, 사이트 안 링크는 404 0", async () => {
  const flags = (await one("select value from public.settings where key = 'feature_flags'")).value;
  assert.ok(Object.values(flags).every((v) => v === false), "시험 전 기능 공개 목록이 모두 꺼져 있어야 한다");
  const internal = new Set();
  for (const path of [...HUBS.map((h) => h.path), "/tax/interpretations", "/news", fx.situations["car-sold"].href, fx.situations["home-bought"].href]) {
    const { page } = await open(path);
    const links = await hrefs(page);
    assert.deepEqual(hits(links, GATED).filter((h) => !ALWAYS_OPEN.has(pathOf(h))), [], `${path}: 꺼진 기능으로 가는 링크`);
    assert.deepEqual(hits(links, NEVER), [], `${path}: v1.2·단계 전 경로 링크`);
    for (const h of links) if (h.startsWith("/") && !h.startsWith("/news/") && !h.startsWith("//")) internal.add(h);
    await page.close();
  }
  for (const h of internal) {
    const res = await fetch(`${base}${h}`);
    assert.equal(res.status, 200, `사이트 안 링크 ${h}`);
  }
});

test("시험 동안 예상 못 한 서버 오류가 없었다", () => {
  assert.doesNotMatch(server.log(), /\[api\] 처리 중 오류|\[public\]/);
});
