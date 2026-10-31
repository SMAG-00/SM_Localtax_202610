// 발행까지 할 일 단계표·묶음 메뉴 E2E (F4) — docs/dev/F4_설계.md
// standalone 빌드를 로컬 Supabase에 붙인다.
//  a) 출처 없는 보도기사 편집 화면 맨 위에 단계표 — 출처 단계 '할 일'·누가(기자, 지금 계정 가능)·편집 승인은 작성자 본인이라 안내 문장
//  b) [바로 가기] — 출처 단계 버튼이 [본문에서 출처 자동 채우기](source-suggest-button)에 포커스를 옮기고, 법안 상태 안내(법률안·입법예고(bill))가 칸 설명에 있다
//  c) 출처를 더하면 새로고침 없이 단계표가 새 판정으로 바뀐다(출처 단계 '끝남 ✓')
//  d) 묶음 메뉴 — 그룹 버튼 aria-expanded, 지금 화면의 그룹은 펼쳐져 있고 Esc로 닫으면 그 버튼에 포커스
//  e) 360px — 가로 스크롤 0, 메뉴는 '메뉴' 버튼 하나로 접힌다
//  f) 첫 화면 — 인물 등록이 없는 계정 안내에 /admin/people 링크
//  g) ② 확인 한 버튼 — 편집 책임자 [승인하고 발행]·작성자인 편집 책임자 [본인 발행], ① 막힘이 남으면 꺼짐 (2026-10-31)
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
  // ② 확인 한 버튼 (2026-10-31) — 다른 사람 기사를 보는 편집 책임자 · 자기 기사를 보는 편집 책임자(본인 발행)
  u.editor = await staff.createUser({ label: "steps-editor", roles: ["editor"], person: { name: "단계표 편집자", roles: ["editor"] } });
  u.selfEditor = await staff.createUser({ label: "steps-self", roles: ["editor"], person: { name: "단계표 본인 발행 편집자", roles: ["editor"] } });
  fx.own = await one(
    `insert into public.articles (slug, title, summary, section, content_type, reporting_method, status, author_id, format, label, body)
     values ($1, '본인 발행 시험 기사', '본인 발행 칸을 확인합니다.', 'tax', 'reported_news', 'qualitative', 'draft', $2, 'general', 'none', $3) returning id`,
    [`${slug}-own`, u.selfEditor.personId, JSON.stringify(body)],
  );
  staff.trackArticle(fx.own.id);
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
    // 3단계(① 쓰기 → ② 확인 → ③ 발행) 안에 예전 항목이 순서대로 (2026-10-31 PO 결정)
    assert.deepEqual(await steps.locator("li[data-step]").evaluateAll((els) => els.map((e) => e.dataset.step)), ["write", "confirm", "publish"]);
    assert.deepEqual(await steps.locator("li[data-check]").evaluateAll((els) => els.map((e) => e.dataset.check)), ["save", "image-rights", "sources", "other-blockers", "submit", "tax-review", "desk-edit"]);
    assert.equal(await page.getByTestId("step-status-write").innerText(), "할 일");
    assert.equal(await page.getByTestId("confirm-publish").count(), 0, "기자 계정에는 한 번에 확인·발행 칸이 없다");
    assert.equal(await page.getByTestId("step-status-sources").innerText(), "할 일");
    assert.match(await page.getByTestId("step-who-sources").innerText(), /기자.*지금 계정이 할 수 있음/);
    assert.equal(await page.getByTestId("step-status-desk-edit").innerText(), "다른 사람 차례");
    assert.match(await steps.locator('[data-check="desk-edit"]').innerText(), /작성자가 아닌 편집 책임자 계정으로 로그인해 승인/);
    assert.match(await steps.locator('[data-check="desk-edit"]').innerText(), /마지막에/);
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

    // 묶음 메뉴 — 지금 화면(기사)은 날마다 쓰는 메뉴라 '더 보기'는 접혀 있다 (2026-10-31 단순화)
    const nav = page.locator('nav[aria-label="편집국 메뉴"]');
    const more = nav.locator("button[data-more]");
    assert.equal(await more.getAttribute("aria-expanded"), "false");
    assert.equal(await nav.locator('a[aria-current="page"]').innerText(), "기사");
    await more.click();
    assert.equal(await more.getAttribute("aria-expanded"), "true");
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

test("g) ② 확인 한 버튼 — 편집 책임자는 [승인하고 발행], 작성자인 편집 책임자는 [본인 발행]. ① 막힘이 남으면 버튼은 꺼져 있다", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    // 다른 사람(기자) 기사 — 세무 감수 대상이 아닌 정성형 보도: 편집 확인 4항목 + [승인하고 발행]
    await loginAt(page, u.editor, `/admin/articles/${fx.article.id}`);
    const box = page.locator('[data-step="confirm"]').getByTestId("confirm-publish");
    await box.waitFor();
    assert.equal(await box.getAttribute("data-mode"), "combined");
    const button = box.getByTestId("confirm-publish-button");
    assert.equal(await button.innerText(), "승인하고 발행");
    assert.equal(await box.locator('input[id^="confirm-desk-"]').count(), 4, "편집 확인 4항목");
    assert.equal(await box.locator('input[id^="confirm-tax-"]').count(), 0, "세무 감수 대상이 아니면 감수 항목이 없다");
    // ① 쓰기 막힘(출처 등)이 남아 있으면 모두 체크해도 꺼져 있고 이유가 보인다
    for (const c of await box.locator('input[type="checkbox"]').all()) await c.check();
    assert.equal(await button.isDisabled(), true);
    assert.match(await box.innerText(), /① 쓰기의 할 일을 먼저 끝내면 이 버튼이 켜집니다/);
    assert.match(await page.locator('[data-check="desk-edit"]').innerText(), /한 번에 확인하고 발행/);
    assert.equal(await one("select count(*)::int n from public.editorial_reviews where article_id = $1", [fx.article.id]).then((r) => r.n), 0, "누르지 않았으니 기록 0");

    // 자기 기사 — 본인 발행 안내
    await context.clearCookies();
    await loginAt(page, u.selfEditor, `/admin/articles/${fx.own.id}`);
    const own = page.locator('[data-step="confirm"]').getByTestId("confirm-publish");
    await own.waitFor();
    assert.equal(await own.getAttribute("data-mode"), "self");
    assert.equal(await own.getByTestId("confirm-publish-button").innerText(), "본인 발행");
    assert.equal(await own.getByTestId("self-publish-note").innerText(), "다른 사람 승인 없이 발행합니다 — '본인 발행'으로 기록됩니다");
    assert.equal(await page.getByTestId("step-status-desk-edit").innerText(), "할 일");
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
    assert.equal(await nav.locator("button[data-more]").isVisible(), false, "접힌 메뉴에는 '더 보기' 버튼이 안 보인다");
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    assert.ok(await nav.locator("button[data-more]").isVisible());
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
