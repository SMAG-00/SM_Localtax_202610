// 백오피스 운영 화면 E2E (W2-a 4-2) — 분야 · 사전 · 설정 · 제휴사 · 회원·역할 (ADM-01 · ADM-02 · CAT-01 · UX-01 · ART-10)
//  a) 역할별 메뉴 — 편집 책임자: 분야·사전(제휴사 편집 메뉴 0, 제휴사 목록은 읽기만), 관리자: + 설정·회원·역할, 광고 담당: 제휴사
//  b) 회원·역할 화면 — 편집 책임자 + 광고 담당 겸직은 화면이 막고 사유를 보인다(역할 API 호출 0·DB 바뀜 0). 화면이 본 역할이 낡았으면 서버 409를 보인다
//  c) 사전 화면에서 금지 표현을 더하면 기사 편집 화면의 점검 패널이 그 표현을 차단 항목으로 보이고, 빼면 사라진다 (배포 없음)
//  c2) 쉬운 말 사전(W2-d 3단계 — GLO-01) — 쉬운 풀이 61자·풀이와 뜻의 숫자 + 단위는 입력 중·저장 뒤 경고, 저장은 된다(새 용어는 숨김) · [공개하기]·[숨기기] 감사 로그
//  d) 분야 화면 — 아래로 버튼이 순서를 바꾼다
//  e) 360·640px — 새 화면 전부 가로 스크롤 0
// standalone 빌드를 띄우고 로컬 Supabase에 붙인다. 모두가 같이 쓰는 사전·분야 순서는 끝나면 되돌리고, 만든 행은 지운다 (e2e/lib/staff.mjs).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e.example.test";
const ADMIN_EMAIL = "admin-settings-ui-e2e@example.test";

let sb, server, staff, db, browser, base;
const u = {};
const contexts = [];
const ids = {};

const one = async (sql, params) => (await db.query(sql, params)).rows[0];

async function api(method, path, user, body) {
  const res = await fetch(`${base}/api/admin${path}`, {
    method,
    headers: { authorization: `Bearer ${user.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
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
  await staff.snapshotOperations();
  u.reporter = await staff.createUser({ label: "opsui-reporter", roles: ["reporter"], person: { name: "화면 운영 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "opsui-editor", roles: ["editor"], person: { name: "화면 운영 편집자", roles: ["editor"] } });
  u.adOps = await staff.createUser({ label: "opsui-ad", roles: ["ad_ops"] });
  u.admin = await staff.createUser({ label: "opsui-admin", email: ADMIN_EMAIL });
  u.comboTarget = await staff.createUser({ label: "opsui-combo", roles: ["editor"] });
  u.staleTarget = await staff.createUser({ label: "opsui-stale" });

  // 화면에 보일 제휴사 1곳 (광고 담당이 API로 등록)
  const partner = await api("POST", "/partners", u.adOps, { name: `화면시험제휴 ${staff.run}`, kind: "media", contractTo: "2099-12-31", intro: "화면 시험용 제휴사" });
  assert.equal(partner.status, 201, JSON.stringify(partner.body));
  staff.trackRow("partners", partner.body.partner.id);
  ids.partner = partner.body.partner.id;
  browser = await chromium.launch();
});

after(async () => {
  try {
    for (const c of contexts) await c.close().catch(() => {});
    await browser?.close();
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

// ── 도우미 (e2e/admin-ui.test.mjs와 같은 방식) ─────────────

async function interactive(page) {
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^(로그아웃|로그인)$/.test(b.textContent.trim()) && !b.disabled));
}

async function open(page, path) {
  const res = await page.goto(`${base}${path}`);
  await interactive(page);
  assert.equal(await page.locator('[data-ui="assistant-launcher"]').count(), 0, `${path}: AI 도우미 런처가 있다`);
  return res;
}

async function login(user, { width = 1280, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`${base}/admin/login`);
  await interactive(page);
  await page.fill("#login-email", user.email);
  await page.fill("#login-password", user.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((url) => url.pathname !== "/admin/login");
  await interactive(page);
  return page;
}

const menuLabels = (page) => page.locator('nav[aria-label="편집국 메뉴"] a').allInnerTexts();

/** 점검 패널의 차단 규칙 ID — 다시 점검을 마칠 때까지 기다린다 */
async function blockerRules(page) {
  const panel = page.getByTestId("check-panel");
  await panel.getByTestId("blocker-count").waitFor();
  return panel.locator('[data-testid="check-blockers"] li').evaluateAll((els) => els.map((e) => e.getAttribute("data-rule")));
}

// ── a) 역할별 메뉴 ─────────────────────────────────────

test("a) 역할별 메뉴 — 편집 책임자 분야·사전(제휴사 편집 메뉴 0), 관리자 설정·회원·역할, 광고 담당 제휴사 / 화면 403", async () => {
  const editor = await login(u.editor);
  assert.deepEqual(await menuLabels(editor), ["첫 화면", "기사 기획", "기사", "검토·발행", "기사 배치", "홈 배치", "개정 트래커", "바깥 연결", "허브 지방세 포인트", "원문 검수", "지역 기사 판정", "프로젝트", "상황 카드", "분야", "사전", "검색어", "제휴 준비", "문의함", "정책 페이지"]);
  for (const path of ["/admin/settings", "/admin/members"]) {
    assert.equal((await open(editor, path)).status(), 403, `편집자 ${path}`);
    await editor.getByRole("heading", { name: "이 화면을 쓸 권한이 없습니다" }).waitFor();
  }
  for (const path of ["/admin/categories", "/admin/dictionaries"]) assert.equal((await open(editor, path)).status(), 200, `편집자 ${path}`);
  // 제휴사 목록은 읽기만 — 등록·고치기 폼 0
  assert.equal((await open(editor, "/admin/partners")).status(), 200);
  await editor.getByTestId(`partner-${ids.partner}`).waitFor();
  assert.equal(await editor.getByRole("form", { name: "제휴사 등록" }).count(), 0);
  assert.equal(await editor.getByText("고치기").count(), 0);
  await editor.getByText("편집 책임자는 제휴사를 읽기만 합니다").waitFor();

  const ad = await login(u.adOps);
  assert.deepEqual(await menuLabels(ad), ["첫 화면", "광고·협찬 콘텐츠", "제휴사", "문의함", "정책 페이지"]);
  for (const path of ["/admin/categories", "/admin/dictionaries", "/admin/settings", "/admin/members"]) assert.equal((await open(ad, path)).status(), 403, `광고 담당 ${path}`);
  assert.equal((await open(ad, "/admin/partners")).status(), 200);
  assert.equal(await ad.locator("summary", { hasText: "새 제휴사 적기" }).count(), 1, "광고 담당은 등록 폼을 본다");

  const reporter = await login(u.reporter);
  assert.deepEqual(await menuLabels(reporter), ["첫 화면", "기사 기획", "기사", "상황 카드", "문의함"]);
  for (const path of ["/admin/categories", "/admin/dictionaries", "/admin/partners", "/admin/settings", "/admin/members"]) {
    assert.equal((await open(reporter, path)).status(), 403, `기자 ${path}`);
  }

  const admin = await login(u.admin);
  const adminMenu = await menuLabels(admin);
  for (const label of ["분야", "사전", "제휴사", "설정", "회원·역할"]) assert.ok(adminMenu.includes(label), `관리자 메뉴 ${label}: ${adminMenu}`);
  for (const label of ["검토·발행", "기사 배치", "홈 배치", "개정 트래커", "바깥 연결"]) assert.ok(!adminMenu.includes(label), "editor 없는 관리자에게 편집 행위 메뉴 0");
  for (const path of ["/admin/settings", "/admin/members", "/admin/categories", "/admin/dictionaries", "/admin/partners"]) assert.equal((await open(admin, path)).status(), 200, `관리자 ${path}`);
});

// ── b) 회원·역할 — 겸직 금지는 화면이 먼저 막는다 ─────────────

test("b) 회원·역할 — 편집 책임자 + 광고 담당은 화면이 막고 사유를 보인다(역할 API 0회·DB 바뀜 0) / 낡은 화면이면 서버 409를 보인다", async () => {
  const page = await login(u.admin);
  const roleCalls = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === "/api/admin/roles") roleCalls.push(req.method());
  });

  await open(page, `/admin/members?q=${encodeURIComponent(u.comboTarget.email.split("@")[0])}`);
  const card = page.getByTestId(`member-${u.comboTarget.id}`);
  await card.waitFor();
  assert.deepEqual(await card.locator("[data-role]").evaluateAll((els) => els.map((e) => e.getAttribute("data-role"))), ["editor"]);
  await card.locator(`#member-${u.comboTarget.id}-role`).selectOption("ad_ops");
  const reason = "편집 책임자(editor)와 광고·협찬 담당(ad_ops)는 한 사람에게 함께 줄 수 없습니다";
  await card.locator(`#member-${u.comboTarget.id}-role-error`).filter({ hasText: reason }).waitFor();
  await card.getByRole("button", { name: "역할 주기" }).click();
  await card.getByRole("alert").filter({ hasText: reason }).waitFor();
  await page.waitForTimeout(500);
  assert.deepEqual(roleCalls, [], "겸직 금지 조합은 역할 부여 API를 부르지 않는다");
  assert.deepEqual((await db.query("select role from public.staff_roles where user_id = $1", [u.comboTarget.id])).rows.map((r) => r.role), ["editor"]);
  assert.equal((await one("select count(*)::int n from public.audit_logs where target = $1", [`staff_roles:${u.comboTarget.id}`])).n, 0);

  // 화면이 본 역할이 낡았다 — 화면을 연 뒤 다른 관리자가 editor를 줬다 → 화면 검사는 지나고 서버가 409, 그 문장을 보인다
  await open(page, `/admin/members?q=${encodeURIComponent(u.staleTarget.email.split("@")[0])}`);
  const stale = page.getByTestId(`member-${u.staleTarget.id}`);
  await stale.waitFor();
  await db.query("insert into public.staff_roles (user_id, role, granted_by) values ($1, 'editor', 'admin:e2e-other-admin')", [u.staleTarget.id]);
  await stale.locator(`#member-${u.staleTarget.id}-role`).selectOption("ad_ops");
  await stale.getByRole("button", { name: "역할 주기" }).click();
  await stale.getByRole("alert").filter({ hasText: "editor" }).waitFor();
  assert.deepEqual(roleCalls, ["POST"], "서버에 한 번 보냈다");
  assert.deepEqual((await db.query("select role from public.staff_roles where user_id = $1 order by role", [u.staleTarget.id])).rows.map((r) => r.role), ["editor"]);
  assert.equal(
    (await one("select count(*)::int n from public.audit_logs where actor = $1 and action = 'role.grant.rejected' and target = $2", [`user:${u.admin.id}`, `staff_roles:${u.staleTarget.id}`])).n,
    1,
  );

  // 막히지 않는 역할은 준다 — 감사 로그 1줄
  await open(page, `/admin/members?q=${encodeURIComponent(u.staleTarget.email.split("@")[0])}`);
  await stale.locator(`#member-${u.staleTarget.id}-role`).selectOption("reporter");
  await stale.getByRole("button", { name: "역할 주기" }).click();
  await stale.getByRole("status").filter({ hasText: "역할을 주었습니다 — 기자" }).waitFor();
  assert.deepEqual((await db.query("select role from public.staff_roles where user_id = $1 order by role", [u.staleTarget.id])).rows.map((r) => r.role), ["editor", "reporter"]);
  assert.equal(
    (await one("select count(*)::int n from public.audit_logs where actor = $1 and action = 'role.grant' and target = $2", [`user:${u.admin.id}`, `staff_roles:${u.staleTarget.id}`])).n,
    1,
  );
});

// ── c) 사전 → 점검 패널 ───────────────────────────────

test("c) 사전 화면에서 금지 표현을 더하면 기사 편집 화면 점검 패널이 차단하고, 빼면 사라진다 (배포 없음)", async () => {
  const phrase = `화면금지${staff.run}`;
  const created = await api("POST", "/articles", u.reporter, {
    slug: `e2e-ui-dict-${staff.run}`,
    title: `사전 화면 시험 ${staff.run}`,
    section: "tax",
    contentType: "explainer",
    body: { blocks: [{ type: "paragraph", text: `이 문단에는 ${phrase} 표현이 있다.` }], claims: [] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const articleId = created.body.article.id;
  staff.trackArticle(articleId);

  const page = await login(u.editor);
  await open(page, `/admin/articles/${articleId}`);
  assert.ok(!(await blockerRules(page)).includes("ux01.forbidden-phrase"));

  await open(page, "/admin/dictionaries?tab=forbidden");
  await page.fill("#dict-forbidden-phrase", phrase);
  await page.getByRole("button", { name: "사전에 더하기" }).click();
  await page.getByRole("status").filter({ hasText: `금지 표현 사전에 더했습니다 — ${phrase}` }).waitFor();
  await page.getByTestId("dict-forbidden-list").locator(`li[data-phrase="${phrase}"]`).waitFor();
  assert.ok((await one("select value from public.settings where key = 'forbidden_phrases'")).value.phrases.includes(phrase));

  await open(page, `/admin/articles/${articleId}`);
  await page.getByTestId("check-panel").locator('[data-testid="check-blockers"] li[data-rule="ux01.forbidden-phrase"]').waitFor();
  await page.getByTestId("check-panel").getByText(phrase).first().waitFor();

  await open(page, "/admin/dictionaries?tab=forbidden");
  await page.getByRole("button", { name: `‘${phrase}’ 빼기` }).click();
  await page.getByRole("status").filter({ hasText: `금지 표현 사전에서 뺐습니다 — ${phrase}` }).waitFor();
  assert.ok(!(await one("select value from public.settings where key = 'forbidden_phrases'")).value.phrases.includes(phrase));

  await open(page, `/admin/articles/${articleId}`);
  assert.ok(!(await blockerRules(page)).includes("ux01.forbidden-phrase"), "사전에서 빼면 다음 점검부터 막히지 않는다");
});

// ── c2) 쉬운 말 사전 — 저장 경고·공개 상태 (W2-d 3단계 — GLO-01) ─────────────

test("c2) 쉬운 말 사전 — 쉬운 풀이 61자·숫자 + 단위는 입력 중·저장 뒤 경고, 저장은 된다(숨김) · [공개하기]·[숨기기]는 감사 로그에 남는다", async () => {
  const term = `가짜용어화면${staff.run}`;
  const page = await login(u.editor);
  await open(page, "/admin/dictionaries?tab=glossary");
  await page.locator("#glossary-add summary").click();
  await page.fill("#glossary-new-term", term);
  await page.fill("#glossary-new-plain", "가".repeat(60));
  assert.equal(await page.locator("#glossary-new-warnings").count(), 0, "60자는 경고 0");
  await page.fill("#glossary-new-plain", "가".repeat(61));
  await page.locator("#glossary-new-warnings").filter({ hasText: "쉬운 풀이가 61자입니다" }).waitFor();
  await page.fill("#glossary-new-definition", "가짜 뜻 3%와 2단계");
  await page.locator("#glossary-new-warnings").filter({ hasText: "뜻에 숫자와 단위가 있습니다 (‘3%’)" }).waitFor();
  assert.equal(await page.locator("#glossary-new-plain").getAttribute("aria-invalid"), null, "경고는 칸 오류가 아니다");
  await page.getByRole("button", { name: "용어 더하기" }).click();
  await page.getByRole("status").filter({ hasText: `용어를 더했습니다 — ${term} (숨김` }).waitFor();
  const saved = page.locator("#glossary-new-saved-warnings");
  await saved.filter({ hasText: "저장했지만 확인할 문장이 있습니다" }).waitFor();
  assert.deepEqual((await saved.locator("li").allInnerTexts()).length, 2, "61자 경고 + 숫자 + 단위 경고");

  const row = await one("select id, char_length(plain) as n, visible from public.glossary_terms where term = $1", [term]);
  assert.ok(row, "저장되었다");
  staff.trackRow("glossary_terms", row.id);
  assert.deepEqual([row.n, row.visible], [61, false], "61자 그대로, 숨김");

  const item = page.getByTestId(`glossary-${row.id}`);
  await item.getByText("숨김", { exact: true }).waitFor();
  await item.locator('[data-part="glossary-item-warnings"]').filter({ hasText: "61자" }).waitFor();
  await page.getByRole("button", { name: `용어 ‘${term}’ 공개하기` }).click();
  await page.getByRole("button", { name: `용어 ‘${term}’ 숨기기` }).waitFor();
  await item.getByText("공개", { exact: true }).waitFor();
  assert.equal((await one("select visible from public.glossary_terms where id = $1", [row.id])).visible, true);
  const audit = (action) => one("select count(*)::int n from public.audit_logs where actor = $1 and action = $2 and target = $3", [`user:${u.editor.id}`, action, `glossary_terms:${row.id}`]);
  assert.equal((await audit("glossary.publish")).n, 1);
  await page.getByRole("button", { name: `용어 ‘${term}’ 숨기기` }).click();
  await page.getByRole("button", { name: `용어 ‘${term}’ 공개하기` }).waitFor();
  assert.equal((await one("select visible from public.glossary_terms where id = $1", [row.id])).visible, false);
  assert.equal((await audit("glossary.unpublish")).n, 1);
  assert.equal((await audit("glossary.update")).n, 0, "공개 상태만 바꿨다 — 내용 고치기 로그 0");
});

// ── d) 분야 순서 ────────────────────────────────────────

test("d) 분야 화면 — '아래로'를 누르면 순서가 바뀌고 감사 로그에 남는다", async () => {
  const rows = (await db.query("select id, name from public.categories where section = 'realestate' order by sort, id")).rows;
  const [first, second] = rows;
  const page = await login(u.editor);
  await open(page, "/admin/categories");
  await page.getByRole("button", { name: `${first.name} 아래로` }).click();
  await page.getByRole("status").filter({ hasText: `순서를 바꿨습니다 — ${first.name} 아래로` }).waitFor();
  const after = (await db.query("select id from public.categories where section = 'realestate' order by sort, id")).rows.map((r) => Number(r.id));
  assert.deepEqual(after.slice(0, 2), [Number(second.id), Number(first.id)]);
  assert.equal((await one("select count(*)::int n from public.audit_logs where actor = $1 and action = 'category.reorder'", [`user:${u.editor.id}`])).n, 1);
});

// ── e) 360px ─────────────────────────────────────────────

test("e) 360·640px — 분야·사전 3탭·설정·제휴사·회원·역할 화면 가로 스크롤 0", async () => {
  const admin = await login(u.admin, { width: 360, height: 740 });
  const paths = [
    "/admin/categories",
    "/admin/dictionaries?tab=forbidden",
    "/admin/dictionaries?tab=fear",
    "/admin/dictionaries?tab=glossary",
    "/admin/settings",
    "/admin/partners",
    "/admin/members",
    `/admin/members?q=${encodeURIComponent(u.comboTarget.email.split("@")[0])}`,
  ];
  for (const width of [360, 640]) {
    await admin.setViewportSize({ width, height: 740 });
    for (const path of paths) {
      await open(admin, path);
      // 접힌 폼도 펼쳐서 잰다
      for (const d of await admin.locator("details").all()) await d.evaluate((el) => (el.open = true));
      const { scrollWidth, clientWidth } = await admin.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      assert.ok(scrollWidth <= clientWidth, `${width}px ${path}: scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`);
    }
  }
});

test("시험 동안 예상 못 한 서버 오류(500)가 없었다", async () => {
  const log = server.log();
  for (const mark of ["[api] 처리 중 오류", "[db] ", "[audit] ", "[members] "]) assert.ok(!log.includes(mark), log.slice(-3000));
});
