// 발행까지 할 일 단계표·묶음 메뉴 E2E (F4) — docs/dev/F4_설계.md
// standalone 빌드를 로컬 Supabase에 붙인다.
//  a) 출처 없는 보도기사 편집 화면 맨 위에 단계표 — 출처 단계 '할 일'·누가(기자, 지금 계정 가능)·편집 승인은 작성자 본인이라 안내 문장
//  b) [바로 가기] — 출처 단계 버튼이 [본문에서 출처 자동 채우기](source-suggest-button)에 포커스를 옮기고, 법안 상태 안내(법률안·입법예고(bill))가 칸 설명에 있다
//  c) 출처를 더하면 새로고침 없이 단계표가 새 판정으로 바뀐다(출처 단계 '끝남 ✓')
//  d) 묶음 메뉴 — 그룹 버튼 aria-expanded, 지금 화면의 그룹은 펼쳐져 있고 Esc로 닫으면 그 버튼에 포커스
//  e) 360px — 가로 스크롤 0, 메뉴는 '메뉴' 버튼 하나로 접힌다
//  f) 첫 화면 — 인물 등록이 없는 계정 안내에 /admin/people 링크
// 만든 계정·기사·감사 로그는 끝나면 지운다.
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
  u.reporter = await staff.createUser({ label: "steps-rep", roles: ["reporter"], person: { name: "단계표 기자", roles: ["reporter"] } });
  u.noPerson = await staff.createUser({ label: "steps-noperson", roles: ["reporter"] });
  const slug = `steps-e2e-${Date.now()}`;
  const body = { blocks: [{ type: "paragraph", text: "단계표 시험 문단입니다." }], claims: [] };
  fx.article = await one(
    `insert into public.articles (slug, title, summary, section, content_type, reporting_method, status, author_id, format, label, body)
     values ($1, '단계표 시험 기사', '단계표를 확인합니다.', 'tax', 'reported_news', 'qualitative', 'draft', $2, 'general', 'none', $3) returning id`,
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
const noHScroll = async (page) => {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  assert.ok(scrollWidth <= clientWidth, `가로 스크롤 ${scrollWidth} > ${clientWidth}`);
};

test("a~d) 단계표 노출 → 바로 가기로 출처 폼 포커스 → 출처 추가 뒤 단계 갱신 → 묶음 메뉴 키보드", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    const path = `/admin/articles/${fx.article.id}`;
    await loginAt(page, u.reporter, path);
    const steps = page.getByTestId("publish-steps");
    await steps.waitFor();
    // 제목 아래·탭 위: 단계표가 편집 화면 칸 탭(nav)보다 먼저 나온다
    const order = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="publish-steps"]');
      const tabs = document.querySelector('nav[aria-label="편집 화면 칸"]');
      return s.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING ? "before" : "after";
    });
    assert.equal(order, "before");
    assert.deepEqual(await steps.locator("li[data-step]").evaluateAll((els) => els.map((e) => e.dataset.step)), ["save", "image-rights", "sources", "other-blockers", "submit", "tax-review", "desk-edit", "publish"]);
    assert.equal(await page.getByTestId("step-status-sources").innerText(), "할 일");
    assert.match(await page.getByTestId("step-who-sources").innerText(), /기자.*지금 계정이 할 수 있음/);
    assert.equal(await page.getByTestId("step-status-desk-edit").innerText(), "다른 사람 차례");
    assert.match(await steps.locator('[data-step="desk-edit"]').innerText(), /작성자가 아닌 편집 책임자 계정으로 로그인해 승인/);
    assert.match(await steps.locator('[data-step="desk-edit"]').innerText(), /마지막에/);
    assert.equal(await steps.locator('[data-step="publish"] button[disabled]').count(), 1, "막힘이 있으면 발행 바로 가기는 꺼져 있다");

    // 바로 가기 → 출처 더하기 폼의 첫 칸
    await page.getByTestId("step-go-sources").click();
    assert.equal(await page.evaluate(() => document.activeElement?.id), "source-suggest-button");
    // 칸 설명 — 법안 상태 기사의 공식 자료 안내
    await page.selectOption("#src-kind", "official_doc");
    const formText = await page.locator('form[aria-label="출처 더하기"]').innerText();
    assert.ok(formText.includes("법률안·입법예고(bill)"), "자료 종류 칸 설명에 법안 상태 안내");
    assert.ok(formText.includes("원문을 직접 연 날"), "확인일 칸 설명");

    // 출처 추가 → 단계표 갱신
    await page.selectOption("#src-kind", "other");
    await page.fill("#src-title", "단계표 시험 출처");
    await page.getByRole("button", { name: "출처 더하기" }).last().click();
    await page.getByText("출처를 더했습니다").waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="step-status-sources"]')?.textContent === "끝남 ✓");
    assert.equal(await one("select count(*)::int n from public.article_sources where article_id = $1", [fx.article.id]).then((r) => r.n), 1);

    // 묶음 메뉴 — 지금 화면의 그룹(기사 만들기·발행)은 펼쳐져 있다
    const nav = page.locator('nav[aria-label="편집국 메뉴"]');
    const make = nav.locator('button[data-group="make"]');
    assert.equal(await make.getAttribute("aria-expanded"), "true");
    assert.equal(await nav.locator('a[aria-current="page"]').innerText(), "기사");
    const ops = nav.locator('button[data-group="ops"]');
    assert.equal(await ops.getAttribute("aria-expanded"), "false");
    await ops.click();
    assert.equal(await ops.getAttribute("aria-expanded"), "true");
    assert.ok(await nav.getByRole("link", { name: "문의함" }).isVisible());
    await page.keyboard.press("Escape");
    assert.equal(await ops.getAttribute("aria-expanded"), "false");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-group")), "ops");
  } finally {
    await context.close();
  }
});

test("e) 360px — 가로 스크롤 0, 메뉴는 '메뉴' 버튼 하나로 접힌다", async () => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
  try {
    const page = await context.newPage();
    await loginAt(page, u.reporter, `/admin/articles/${fx.article.id}`);
    await page.getByTestId("publish-steps").waitFor();
    await noHScroll(page);
    const nav = page.locator('nav[aria-label="편집국 메뉴"]');
    const toggle = nav.getByRole("button", { name: /^메뉴/ });
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await nav.locator('button[data-group]').first().isVisible(), false, "접힌 메뉴에는 그룹 버튼이 안 보인다");
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    assert.ok(await nav.locator('button[data-group="make"]').isVisible());
    await noHScroll(page);
  } finally {
    await context.close();
  }
});

test("f) 첫 화면 — 인물 등록이 없는 계정 안내에 /admin/people 링크", async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await loginAt(page, u.noPerson, "/admin");
    const link = page.getByTestId("people-register-link");
    await link.waitFor();
    assert.equal(await link.getAttribute("href"), "/admin/people");
  } finally {
    await context.close();
  }
});
