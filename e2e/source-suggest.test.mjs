// 출처 자동 채우기 E2E (F5) — docs/dev/F5_설계.md
// standalone 빌드를 로컬 Supabase에 붙인다. 외부 사이트는 부르지 않는다.
//  출처 칸은 기사 편집 화면의 접힌 '그 밖의 칸' 안에 있다(간편 발행 2026-10-31) — 화면에서 펼친 뒤 쓴다
//  a) 본문에 링크 둘(시험용 로컬 링크 = 기타 종류 · 8443 포트 .go.kr = 공식 문서 → 서버 SSRF 규칙이 요청 전에 거부) → [본문에서 출처 자동 채우기] → 후보 카드 2장
//  b) 공식 문서 후보는 확인일·이용 조건·공공누리 유형이 비어 [이대로 추가]가 꺼지고 이유 문장이 보인다
//  c) 기타 후보 [이대로 추가] → 출처가 저장된다(기존 POST)
//  d) 공식 문서 후보 [고쳐서 추가] → 출처 더하기 폼에 값이 채워진다
//  e) 360px 가로 스크롤 0
// 프로덕션 코드에 시험 전용 허용 분기는 없다 — 로컬 주소가 막히는 규칙 그대로를 시험한다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

let sb, server, staff, db, base, browser;
const u = {};
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const fx = {};

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    NEXT_PUBLIC_SITE_URL: "https://e2e.example.test",
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  u.reporter = await staff.createUser({ label: "suggest-rep", roles: ["reporter"], person: { name: "자동채우기 기자", roles: ["reporter"] } });
  const slug = `suggest-e2e-${Date.now()}`;
  const body = {
    blocks: [
      { type: "paragraph", text: "출처: 시험 기관 · 2026.10.1 [시험 링크](http://127.0.0.1:9/local-page)" },
      { type: "paragraph", text: "출처: 시험 공문서 · 2026.10.2 [시험 공문서](https://suggest-e2e.go.kr:8443/doc)" },
    ],
    claims: [],
  };
  fx.article = await one(
    `insert into public.articles (slug, title, summary, section, content_type, reporting_method, status, author_id, format, label, body)
     values ($1, '자동 채우기 시험 기사', '출처 자동 채우기를 확인합니다.', 'tax', 'reported_news', 'qualitative', 'draft', $2, 'general', 'none', $3) returning id`,
    [slug, u.reporter.personId, JSON.stringify(body)],
  );
  staff.trackArticle(fx.article.id);
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

async function loginAt(page, user, next) {
  await page.goto(`${base}/admin/login?next=${encodeURIComponent(next)}`);
  await page.fill("#login-email", user.email);
  await page.fill("#login-password", user.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((url) => url.pathname === next);
}
/** '그 밖의 칸'을 눌러 펼친다 — 출처 칸이 그 안에 있다 */
async function openMore(page) {
  await page.locator("details#more-sections > summary").click();
  await page.locator("#source-suggest-button").waitFor();
}
const noHScroll = async (page) => {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  assert.ok(scrollWidth <= clientWidth, `가로 스크롤 ${scrollWidth} > ${clientWidth}`);
};

test("a~d) 그 밖의 칸 펼치기 → 자동 채우기 → 후보 카드 → 막힘 문장 → 이대로 추가 → 고쳐서 추가", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    await loginAt(page, u.reporter, `/admin/articles/${fx.article.id}`);
    assert.equal(await page.locator("#source-suggest-button").isVisible(), false, "출처 칸은 처음에 접혀 있다");
    await openMore(page);
    await page.click("#source-suggest-button");
    const cards = page.getByTestId("suggest-card");
    await cards.first().waitFor();
    assert.equal(await cards.count(), 2);

    const local = page.locator('[data-testid="suggest-card"][data-url^="http://127.0.0.1"]');
    const gov = page.locator('[data-testid="suggest-card"][data-url^="https://suggest-e2e.go.kr"]');
    assert.match(await local.getByTestId("suggest-title").innerText(), /시험 기관 · 2026\.10\.1/);
    assert.match(await local.getByTestId("suggest-published").innerText(), /2026-10-01/);
    assert.equal(await local.getByTestId("suggest-collected").getAttribute("data-empty"), "false");

    // b) 공식 문서 후보: 서버가 주소를 거부해 확인일·공공누리가 비어 있다
    assert.equal(await gov.getByTestId("suggest-verified").getAttribute("data-empty"), "true");
    assert.equal(await gov.getByTestId("suggest-license-type").getAttribute("data-empty"), "true");
    assert.match(await gov.getByTestId("suggest-blocked").innerText(), /이대로 추가할 수 없습니다.*확인일.*공공누리 유형/);
    assert.equal(await gov.getByTestId("suggest-add").isDisabled(), true);
    assert.match(await gov.innerText(), /기본 포트\(443\)가 아닌 주소는 확인하지 않습니다/);

    // c) 기타 후보 이대로 추가 → 출처 저장
    const added = page.waitForResponse((res) => res.request().method() === "POST" && new URL(res.url()).pathname === `/api/admin/articles/${fx.article.id}/sources`);
    await local.getByTestId("suggest-add").click();
    assert.equal((await added).status(), 201);
    const row = await one("select kind, title, source_url from public.article_sources where article_id = $1", [fx.article.id]);
    assert.equal(row.kind, "other");
    assert.equal(row.title, "시험 기관 · 2026.10.1");
    assert.equal(row.source_url, "http://127.0.0.1:9/local-page");

    // d) 공식 문서 후보 고쳐서 추가 → 폼 채움
    await gov.getByTestId("suggest-fill").click();
    await page.waitForFunction(() => document.getElementById("src-title")?.value === "시험 공문서 · 2026.10.2");
    assert.equal(await page.inputValue("#src-url"), "https://suggest-e2e.go.kr:8443/doc");
    assert.equal(await page.inputValue("#src-kind"), "official_doc");
    assert.equal(await page.inputValue("#src-published"), "2026-10-02");
    assert.equal(await page.inputValue("#src-verified"), "");

    // 다시 누르면 이미 등록된 주소는 빠진다
    await page.click("#source-suggest-button");
    await page.getByTestId("suggest-summary").filter({ hasText: "이미 등록된 출처 1건" }).waitFor();
  } finally {
    await context.close();
  }
});

test("e) 360px — 후보 카드가 있어도 가로 스크롤 0", async () => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
  try {
    const page = await context.newPage();
    await loginAt(page, u.reporter, `/admin/articles/${fx.article.id}`);
    await openMore(page);
    await page.click("#source-suggest-button");
    await page.getByTestId("suggest-card").first().waitFor();
    await noHScroll(page);
  } finally {
    await context.close();
  }
});
