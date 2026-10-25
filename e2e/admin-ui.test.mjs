// 백오피스(편집국) 화면 E2E (W2-a 4-1단계 — PRD-01A 9장 W2-a 끝났다는 증거) — ADM-01 · ART-01 · ART-05 · NAV-03 · NAV-06 · NAV-09~12 · OPT-03
//  a) 정량형 1건: 로그인 화면 → 기획 등록·상태 진행 → 정량형 템플릿 → 출처·근거·재현 정보·확인 목록 → 검토 요청 → 편집자 점검 패널(차단) → 채움 →
//     편집 승인 → 발행 → 공개 REST(anon)로 읽힘 → 기획 발행
//  b) 정성형 1건: 인터뷰 기록·인용·관점별 기록·원문 대조 → 승인 → 발행 → 공개
//  c) 정정: 이유 없이 저장하면 칸 오류·저장 0, 이유가 있으면 전후 버전과 함께 기록
//  d) 역할별 메뉴·403: 편집국 외 역할 4종, 편집자 메뉴, AI 도우미 런처 0
//  e) 로그인: 안 하면 로그인 화면으로, 틀린 비밀번호 같은 문장, 바깥 next 버림
//  f) 360px 가로 스크롤 0
// standalone 빌드를 띄우고 로컬 Supabase에 붙인다. 계정은 e2e/lib/staff.mjs로 만들고 끝나면 지운다 (가상 도시 가온시 — 실제 기사·통계 아님).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e.example.test";
const ADMIN_EMAIL = "admin-ui-e2e@example.test";
const NON_NEWSROOM = ["ad_ops", "store_ops", "brand_ops", "expert_ops"];
const OWN_MENU = { ad_ops: "광고·협찬 콘텐츠", store_ops: "스토어·구독", brand_ops: "브랜드 관리", expert_ops: "전문가 등재" };
const APPROVE_SORT_PUBLISH_MENUS = ["검토·발행", "기사 배치", "홈 배치", "개정 트래커", "바깥 연결"];
// 편집자 화면에 없어야 하는 운영 메뉴 — 편집국 외 역할 4종의 자기 메뉴 + 제휴사 관리(광고 편집 메뉴, 4-2)
const OPERATIONS_MENUS = [...Object.values(OWN_MENU), "제휴사"];
const STATUS_LABEL = { idea: "아이디어", assigned: "배정", reporting: "취재 중", fact_check: "사실 확인", review: "검토", published: "발행", held: "보류" };

let sb, server, staff, db, browser, base;
const u = {};
const contexts = [];
const ids = {};
let localReportingCategory;

const one = async (sql, params) => (await db.query(sql, params)).rows[0];

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
  u.reporter = await staff.createUser({ label: "ui-reporter", roles: ["reporter"], person: { name: "화면 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "ui-editor", roles: ["editor"], person: { name: "화면 편집자", roles: ["editor"] } });
  for (const role of NON_NEWSROOM) u[role] = await staff.createUser({ label: `ui-${role.replace("_", "-")}`, roles: [role] });
  localReportingCategory = Number((await one("select id from public.categories where section = 'local' and slug = 'reporting'")).id);
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

// ── 도우미 ────────────────────────────────────────────────

/** 화면 스크립트가 살아날 때까지 — 작업 버튼은 그 전까지 꺼져 있다(useHydrated). 머리의 로그아웃·로그인 버튼이 켜지면 화면 전체가 살아났다 */
async function interactive(page) {
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^(로그아웃|로그인)$/.test(b.textContent.trim()) && !b.disabled));
}

/** 화면을 연다 — 연 백오피스 화면마다 AI 도우미 런처 0을 확인한다 (ADM-01) */
async function open(page, path) {
  const res = await page.goto(`${base}${path}`);
  await interactive(page);
  await assertNoLauncher(page, path);
  return res;
}

async function assertNoLauncher(page, where) {
  assert.equal(await page.locator('[data-ui="assistant-launcher"]').count(), 0, `${where}: AI 도우미 런처가 있다`);
}

/** 로그인 화면으로 로그인 — 새 브라우저 문맥(쿠키 따로) */
async function login(user, { width = 1280, height = 900, next } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`${base}/admin/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await interactive(page);
  await page.fill("#login-email", user.email);
  await page.fill("#login-password", user.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((url) => url.pathname !== "/admin/login");
  await interactive(page);
  return page;
}

async function menuLabels(page) {
  return page.locator('nav[aria-label="편집국 메뉴"] a').allInnerTexts();
}

async function createAssignment(page, { hypothesis, method }) {
  await open(page, "/admin/stories");
  const details = page.locator("details", { has: page.locator("summary", { hasText: "새 기획 등록" }) });
  if (!(await details.evaluate((d) => d.open))) await details.locator("summary").click();
  await page.selectOption("#asg-section", "local");
  await page.fill("#asg-hypothesis", hypothesis);
  await page.fill("#asg-public-interest", "주민이 세수 변화를 알아야 한다");
  await page.fill("#asg-relevance", "지방세 세수와 부동산 거래의 관계 — 전문 분야");
  await page.selectOption("#asg-method", method);
  await page.fill("#asg-due-date", "2026-10-30");
  await page.selectOption("#asg-reporter", String(u.reporter.personId));
  await page.selectOption("#asg-editor", String(u.editor.personId));
  await page.fill("#asg-plan", "원자료 집계 → 세정과 확인 → 전문가 의견");
  await page.fill("#asg-conflicts", "없음");
  await page.getByRole("button", { name: "기획 등록" }).click();
  // 화면 확인보다 먼저 지울 목록에 올린다 — 시험이 중간에 실패해도 남지 않게
  let row;
  for (let i = 0; i < 100 && !row; i++) {
    row = await one("select id, status from public.story_assignments where hypothesis = $1", [hypothesis]);
    if (!row) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(row, "기획이 DB에 있다");
  staff.trackAssignment(row.id);
  await page.getByText("기획을 등록했습니다").waitFor();
  assert.equal(row.status, "idea");
  return Number(row.id);
}

async function moveAssignment(page, id, status) {
  const card = page.getByTestId(`assignment-${id}`);
  await card.locator(`#asg-${id}-status`).selectOption(status);
  await card.getByRole("button", { name: "상태 바꾸기" }).click();
  await card.getByTestId("assignment-status").filter({ hasText: STATUS_LABEL[status] }).waitFor();
}

/** 기획 카드의 "이 기획으로 기사 쓰기" → 새 기사 → 편집 화면. 기사 번호를 돌려준다 */
async function writeFromAssignment(page, assignmentId, { title, slug, template }) {
  await page.getByTestId(`assignment-${assignmentId}`).getByRole("link", { name: "이 기획으로 기사 쓰기" }).click();
  await page.waitForURL(/\/admin\/articles\/new\?assignment=/);
  await interactive(page);
  assert.equal(await page.locator(`input[name="template"][value="${template}"]`).isChecked(), true, `${template} 템플릿이 골라져 있다`);
  assert.equal(await page.locator("#new-section").inputValue(), "local", "기획의 분야로 시작한다");
  await page.fill("#new-title", title);
  await page.fill("#new-slug", slug);
  await page.selectOption("#new-category", String(localReportingCategory));
  await page.getByRole("button", { name: "초안 만들기" }).click();
  await page.waitForURL(/\/admin\/articles\/\d+$/);
  await interactive(page);
  const id = Number(new URL(page.url()).pathname.split("/").pop());
  staff.trackArticle(id);
  const row = await one("select story_assignment_id, content_type, reporting_method, status from public.articles where id = $1", [id]);
  assert.equal(Number(row.story_assignment_id), assignmentId, "기사가 기획에 이어진다");
  // 지역 기사 게이트 (REG1-17 — W4 7단계): 지자체뉴스 기사는 지역 태그 + 편집 분야 + 공익적 질문이 있어야 발행된다.
  // 시험 자료로 채우고(버전은 그대로) 편집 화면을 다시 연다 — 뒤의 저장이 같은 값을 그대로 보낸다
  await one("update public.articles set region_codes = '{1100000000}', editorial_field = 'local_finance', public_question = '거래 변화가 가온시 지방세 세수에 어떤 영향을 주는가' where id = $1 returning id", [id]);
  await page.reload();
  await interactive(page);
  return id;
}

// W4 5단계 — 공식 자료 칸 (시험용 값)
const OFFICIAL_UI = { licenseType: "kogl_1", published: "2026-10-01", reference: "2026-10-01", regionUnit: "시·군·구", collected: "2026-10-10" };

async function addSource(page, s) {
  const form = page.getByRole("form", { name: "출처 더하기" });
  await form.locator("#src-kind").selectOption(s.kind);
  await form.locator("#src-title").fill(s.title);
  await form.locator("#src-url").fill(s.url ?? "");
  await form.locator("#src-source-name").fill(s.sourceName ?? "");
  await form.locator("#src-verified").fill(s.verified ?? "");
  await form.locator("#src-license").fill(s.license ?? "");
  // W4 5단계 — 공공누리 유형(PR-07) · 자료 종류(REG1-07) · 공식 자료 발표일·기준일·지역 단위·수집일(REG1-09)
  if (s.licenseType) await form.locator("#src-license-type").selectOption(s.licenseType);
  if (s.sourceType) await form.locator("#src-source-type").selectOption(s.sourceType);
  for (const [field, key] of [["src-published", "published"], ["src-reference", "reference"], ["src-region-unit", "regionUnit"], ["src-collected", "collected"]]) {
    if (s[key] !== undefined) await form.locator(`#${field}`).fill(s[key]);
  }
  await form.getByRole("button", { name: "출처 더하기" }).click();
  const note = form.getByRole("status").filter({ hasText: "출처를 더했습니다" });
  await note.waitFor();
  return (await note.innerText()).match(/src:\d+/)[0];
}

async function addEvidence(page, e) {
  const form = page.getByRole("form", { name: "근거 더하기" });
  await form.locator("#ev-type").selectOption(e.type);
  await form.locator("#ev-location").fill(e.location);
  await form.locator("#ev-rights").selectOption("confirmed");
  await form.locator("#ev-verification").selectOption("verified");
  await form.locator("#ev-verified-date").fill(e.verified);
  await form.locator("#ev-retention").fill("2031-10-09");
  for (const [key, value] of Object.entries(e.dataset ?? {})) await form.locator(`#ev-ds-${key}`).fill(value);
  if (e.interview) {
    await form.locator("#ev-iv-role").fill(e.interview.role);
    await form.locator("#ev-iv-contacted").fill(e.interview.contacted);
    await form.locator("#ev-iv-record").fill(e.interview.record);
    await form.locator("#ev-iv-consent").selectOption("full");
  }
  await form.getByRole("button", { name: "근거 더하기" }).click();
  const note = form.getByRole("status").filter({ hasText: "근거를 더했습니다" });
  await note.waitFor();
  return (await note.innerText()).match(/ev:\d+/)[0];
}

const block = (page, i) => page.getByTestId(`block-${i}`);
/** 블록 안 입력창 — 블록 옮기기 버튼의 aria-label과 겹치지 않게 역할(textbox)로 찾는다 */
const textbox = (page, i, name) => block(page, i).getByRole("textbox", { name, exact: true });

async function save(page) {
  await page.getByRole("form", { name: "기사 저장" }).getByRole("button", { name: "저장", exact: true }).click();
  const note = page.getByRole("form", { name: "기사 저장" }).getByRole("status").filter({ hasText: /저장했습니다 — 버전 \d+/ });
  await note.waitFor();
  return Number((await note.innerText()).match(/버전 (\d+)/)[1]);
}

/** 점검 패널의 차단 규칙 ID — 패널이 다시 점검을 마칠 때까지 기다린다 */
async function blockers(page, { expectCount } = {}) {
  const panel = page.getByTestId("check-panel");
  if (expectCount !== undefined) await panel.getByTestId("blocker-count").filter({ hasText: new RegExp(`^${expectCount}$`) }).waitFor();
  else await panel.getByTestId("blocker-count").waitFor();
  return panel.locator('[data-testid="check-blockers"] li').evaluateAll((els) => els.map((e) => e.getAttribute("data-rule")));
}

async function anonPublic(id) {
  const res = await fetch(`${sb.url}/rest/v1/public_articles?id=eq.${id}&select=id,slug,title`, { headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}` } });
  assert.equal(res.status, 200);
  return res.json();
}

async function anonEvidenceText(id) {
  const res = await fetch(`${sb.url}/rest/v1/article_evidence?article_id=eq.${id}`, { headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}` } });
  return res.text();
}

/** 검토·발행 화면에서 편집 승인(확인 항목 모두 + 승인) */
async function approveDesk(page) {
  const form = page.getByRole("form", { name: "편집 승인 결정" });
  for (const box of await form.locator('input[type="checkbox"]').all()) await box.check();
  await form.getByLabel("승인", { exact: true }).check();
  await form.getByRole("button", { name: "결정 남기기" }).click();
  await form.getByRole("status").filter({ hasText: "편집 승인 결정 ‘승인’을 남겼습니다" }).waitFor();
}

async function publishFromPanel(page, id) {
  const panel = page.getByTestId("check-panel");
  const button = panel.getByRole("button", { name: "발행", exact: true });
  await panel.getByTestId("blocker-count").filter({ hasText: /^0$/ }).waitFor();
  await assertEnabled(button);
  await button.click();
  await page.getByTestId("article-status").filter({ hasText: "발행됨" }).waitFor();
  const row = await one("select status, first_published_at from public.articles where id = $1", [id]);
  assert.equal(row.status, "published");
  assert.ok(row.first_published_at);
}

async function assertEnabled(locator) {
  for (let i = 0; i < 50 && (await locator.isDisabled()); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(await locator.isDisabled(), false, "버튼이 켜져 있어야 한다");
}

// ── e) 로그인 ─────────────────────────────────────────────

test("e) 로그인 안 하면 로그인 화면으로 · 틀린 비밀번호는 같은 문장 · 바깥 next는 버린다 · 세션 쿠키 httpOnly · 로그아웃", async () => {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`${base}/admin/articles?status=draft`);
  const url = new URL(page.url());
  assert.equal(url.pathname, "/admin/login");
  assert.equal(url.searchParams.get("next"), "/admin/articles?status=draft", "돌아올 주소를 붙인다");
  assert.match((await page.getAttribute('meta[name="robots"]', "content")) ?? "", /noindex/, "로그인 화면도 검색 노출 차단");
  await interactive(page);
  await assertNoLauncher(page, "/admin/login");

  const failed = "이메일 또는 비밀번호가 맞지 않습니다";
  await page.fill("#login-email", u.reporter.email);
  await page.fill("#login-password", "틀린-비밀번호-123");
  await page.getByRole("button", { name: "로그인" }).click();
  await page.getByRole("alert").filter({ hasText: failed }).waitFor();
  await page.fill("#login-email", staff.email("no-such-user"));
  await page.getByRole("button", { name: "로그인" }).click();
  await page.getByRole("alert").filter({ hasText: failed }).waitFor();
  assert.equal((await context.cookies()).filter((c) => /^sb-.+-auth-token/.test(c.name)).length, 0, "실패하면 세션 쿠키 0");
  const api = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: u.reporter.email, password: "x" }) });
  assert.equal(api.status, 401);
  assert.deepEqual(await api.json(), { error: failed }, "어느 칸이 틀렸는지 알리지 않는다");

  await page.goto(`${base}/admin/login?next=${encodeURIComponent("https://evil.example/admin")}`);
  await interactive(page);
  await page.fill("#login-email", u.reporter.email);
  await page.fill("#login-password", u.reporter.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(`${base}/admin`);
  await interactive(page);
  assert.equal(new URL(page.url()).host, new URL(base).host, "바깥 사이트로 보내지 않는다");
  const auth = (await context.cookies()).filter((c) => /^sb-.+-auth-token/.test(c.name));
  assert.ok(auth.length > 0, "세션 쿠키");
  for (const c of auth) {
    assert.equal(c.httpOnly, true, `${c.name} httpOnly`);
    assert.equal(c.sameSite, "Lax");
  }
  assert.equal(await page.getByTestId("viewer-email").innerText(), u.reporter.email);
  assert.deepEqual(await page.locator('ul[aria-label="내 역할"] li').allInnerTexts(), ["기자"]);
  const res = await page.goto(`${base}/admin`);
  assert.match(res.headers()["x-robots-tag"] ?? "", /noindex/, "백오피스 응답 머리글 noindex");

  await page.getByRole("button", { name: "로그아웃" }).click();
  await page.waitForURL(/\/admin\/login/);
  await interactive(page);
  assert.equal((await context.cookies()).filter((c) => /^sb-.+-auth-token/.test(c.name) && c.value).length, 0, "로그아웃하면 세션 쿠키 0");
  await page.goto(`${base}/admin/stories`);
  assert.equal(new URL(page.url()).pathname, "/admin/login", "로그아웃 뒤 다시 막힌다");

  const back = await login(u.reporter, { next: "/admin/stories" });
  assert.equal(new URL(back.url()).pathname, "/admin/stories", "같은 사이트 /admin 아래 next는 따라간다");

  // 쿠키 이름만 맞고 읽을 수 없는 세션 — proxy.ts가 로그인 화면으로 보내고 그 쿠키를 지운다 (서버 오류 0)
  const forged = await browser.newContext();
  contexts.push(forged);
  const cookieName = `sb-${new URL(sb.url).hostname.split(".")[0]}-auth-token`;
  await forged.addCookies([{ name: cookieName, value: "base64-bm90LWEtc2Vzc2lvbg", url: base }]);
  const fp = await forged.newPage();
  await fp.goto(`${base}/admin/reviews`);
  assert.equal(new URL(fp.url()).pathname, "/admin/login");
  assert.equal(new URL(fp.url()).searchParams.get("next"), "/admin/reviews");
  assert.equal((await forged.cookies()).filter((c) => c.name === cookieName && c.value).length, 0, "읽을 수 없는 세션 쿠키는 지운다");
  const apiRes = await fp.request.get(`${base}/api/admin/me`);
  assert.equal(apiRes.status(), 401, "API도 로그인 아님");
});

// ── a) 정량형: 기획 → 취재 → 검증 → 승인 → 공개 ─────────────

test("a) 정량형 보도 — 기획 등록·상태 진행 → 템플릿 → 출처·근거·재현 정보 → 검토 요청 → 점검 패널 차단 → 채움 → 편집 승인 → 발행 → 공개", async () => {
  const reporter = await login(u.reporter);
  const hypothesis = `가온시 상반기 취득세 감소는 거래 감소와 같이 움직였다 ${staff.run}`;
  const asg = await createAssignment(reporter, { hypothesis, method: "quantitative" });
  ids.quantAssignment = asg;

  // DB가 막는 순서 — 거부 문장(409)을 화면에 그대로
  const card = reporter.getByTestId(`assignment-${asg}`);
  await card.locator(`#asg-${asg}-status`).selectOption("published");
  await card.getByRole("button", { name: "상태 바꾸기" }).click();
  await card.getByRole("alert").filter({ hasText: "fact_check·review를 거치지 않은" }).waitFor();
  for (const s of ["assigned", "reporting", "fact_check", "review"]) await moveAssignment(reporter, asg, s);

  const id = await writeFromAssignment(reporter, asg, { title: `가온시 상반기 취득세 18.4% 감소 ${staff.run}`, slug: `e2e-ui-quant-${staff.run}`, template: "quantitative" });
  ids.quant = id;
  const created = await one("select content_type, reporting_method, check_log from public.articles where id = $1", [id]);
  assert.deepEqual([created.content_type, created.reporting_method], ["reported_news", "quantitative"]);
  assert.deepEqual(created.check_log.checklists.quantitative, { sourceCrossCheck: null, limitations: null, relatedPartyCheck: null }, "정량형 확인 칸이 미리 놓인다");
  assert.deepEqual(await reporter.locator('[data-testid^="block-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-block-type"))), ["key_summary", "paragraph", "table", "paragraph"]);
  // 7묶음 안내 — 처음에는 모두 빔
  await reporter.getByTestId("quant-groups").getByText("정량형 필수 7묶음 (NAV-10) — 0/7 채움").waitFor();

  // 출처 — 공공 데이터는 URL·발표기관·확인일·이용 조건이 모두 있어야 한다 (FND-04): 비우면 칸 오류, 저장 0
  const sourceForm = reporter.getByRole("form", { name: "출처 더하기" });
  await sourceForm.locator("#src-kind").selectOption("dataset");
  await sourceForm.locator("#src-title").fill("가온시 지방세 세목별 징수 실적(2026년 6월 말)");
  await sourceForm.getByRole("button", { name: "출처 더하기" }).click();
  assert.match(await sourceForm.locator("#src-url-error").innerText(), /FND-04/);
  assert.equal(await sourceForm.locator("#src-url").getAttribute("aria-describedby"), "src-url-error", "오류 문장이 칸에 이어진다");
  assert.equal((await one("select count(*)::int n from public.article_sources where article_id = $1", [id])).n, 0);
  const src = await addSource(reporter, {
    kind: "dataset",
    title: "가온시 지방세 세목별 징수 실적(2026년 6월 말)",
    url: "https://www.gaon-si.example/open-data/local-tax-collection-2026-06",
    sourceName: "가온시 세정과",
    verified: "2026-10-07",
    license: "공공누리 제1유형",
    ...OFFICIAL_UI,
    sourceType: "local_tax_revenue",
    reference: "2026-06-30",
    regionUnit: "시·구",
  });

  const ev = await addEvidence(reporter, {
    type: "dataset",
    location: "편집국 자료실/2026/e2e/징수실적_2026H1.xlsx",
    verified: "2026-10-09",
    dataset: {
      sourceUrl: "https://www.gaon-si.example/open-data/local-tax-collection-2026-06",
      provider: "가온시 세정과",
      collectedDate: "2026-10-07",
      license: "공공누리 제1유형",
      definition: "취득세 징수액 — 신고·납부가 끝난 취득세(지방교육세 제외)",
      period: "2025년·2026년 각 1월 1일~6월 30일",
      unit: "억 원",
      regionUnit: "시·구",
      denominator: "2025년 같은 기간 징수액(1,574억 원)",
      exclusions: "지방교육세·농어촌특별세, 과오납 환급분",
      transform: "구별 징수액 합산, 증감률 = (2026년 − 2025년) ÷ 2025년",
      reproFileHash: "sha256:3f6c1a9d0b7e45c2a8f1d6e9b4c7a2e5f8d1c4b7a0e3f6c9d2b5a8e1f4c7d0b3",
    },
  });
  const dataset = await one("select d.denominator, d.repro_file_hash from public.article_datasets d join public.article_evidence e on e.id = d.evidence_id where e.article_id = $1", [id]);
  assert.equal(dataset.denominator, "2025년 같은 기간 징수액(1,574억 원)", "재현 정보가 비공개 표에 저장된다");

  // 본문 — 템플릿 블록을 채운다
  await textbox(reporter, 0, "핵심 요약 (줄마다 한 문장, 3줄 이하)").fill("가온시 상반기 취득세 징수액은 1,284억 원으로 1년 전보다 18.4% 줄었습니다.\n같은 기간 아파트 매매 거래는 21.6% 줄었습니다.\n거래 감소만으로 세수 감소를 설명할 수는 없습니다.");
  await textbox(reporter, 1, "문단").fill("편집국이 가온시 세목별 징수 실적을 집계해 보니 올해 1~6월 취득세 징수액은 1,284억 원이었다. 지난해 같은 기간보다 290억 원 적다.");
  await textbox(reporter, 2, "설명(캡션)").fill("가온시 구별 취득세 징수액(1~6월)");
  await textbox(reporter, 2, "표 내용").fill("구 | 2026년(억 원)\n한빛구 | 512\n누리구 | 431\n가람구 | 341");
  await textbox(reporter, 2, "축").fill("구");
  await textbox(reporter, 2, "단위").fill("억 원");
  await textbox(reporter, 2, "출처").fill("가온시 세목별 징수 실적(편집국 집계)");
  await textbox(reporter, 3, "문단").fill("이 수치는 거래량과 세수가 함께 줄었다는 사실만 보여 준다. 감면 확대 같은 다른 요인은 따로 떼어 보지 않았다.");

  // 확인 목록 — 관계자 확인은 일부러 비워 둔다 (편집자 화면에서 차단 항목으로 보여야 한다)
  await reporter.fill("#chk-q-source-cross-check", "징수 실적 파일 구별 합계를 재정공시 화면 값과 2026-10-09에 대조함");
  await reporter.fill("#chk-q-limitations", "상관관계만 확인 — 감면 확대·신고 시점 요인은 분리하지 않음");

  // 핵심 주장 + 근거
  const claims = reporter.locator("#claims");
  await claims.getByRole("button", { name: "핵심 주장 더하기" }).click();
  await claims.getByLabel("주장 문장").fill("올해 1~6월 가온시 취득세 징수액은 1,284억 원이다.");
  await claims.getByLabel("문장이 있는 블록").selectOption({ label: "블록 2 · 문단" });
  await claims.getByLabel(new RegExp(`^${ev} `)).check();
  await claims.getByLabel(new RegExp(`^${src} `)).check();
  assert.equal(await save(reporter), 2);
  await reporter.getByTestId("quant-groups").getByText("정량형 필수 7묶음 (NAV-10) — 6/7 채움").waitFor();

  const stored = await one("select body, check_log from public.articles where id = $1", [id]);
  assert.deepEqual(stored.body.claims, [{ id: "claim-1", text: "올해 1~6월 가온시 취득세 징수액은 1,284억 원이다.", kind: "fact", evidenceIds: [ev, src], blockIndex: 1 }]);
  assert.deepEqual(stored.body.blocks[2].chart, { axis: "구", unit: "억 원", source: "가온시 세목별 징수 실적(편집국 집계)" });
  assert.equal(stored.check_log.checklists.quantitative.relatedPartyCheck, null);

  // 기자 — 발행 버튼은 꺼져 있다(역할), 검토 요청
  const reporterPanel = reporter.getByTestId("check-panel");
  await reporterPanel.getByTestId("publish-reason").filter({ hasText: "발행은 편집 책임자(editor)만 합니다" }).waitFor();
  assert.equal(await reporterPanel.getByRole("button", { name: "발행", exact: true }).isDisabled(), true);
  await reporter.getByRole("button", { name: "검토 요청" }).click();
  await reporter.getByText("검토를 요청했습니다").waitFor();
  assert.equal((await one("select status from public.articles where id = $1", [id])).status, "in_review");

  // 편집자 — 검토 대기 → 점검 패널: 차단 항목이 남아 발행 버튼이 꺼져 있다
  const editor = await login(u.editor);
  await open(editor, "/admin/reviews");
  await editor.getByTestId(`desk-row-${id}`).getByRole("link").click();
  await editor.waitForURL(new RegExp(`/admin/reviews/${id}$`));
  await interactive(editor);
  const before = await blockers(editor);
  for (const rule of ["nav10.related-party-check", "nav10.no-causal-claim", "nav03.desk-edit-required", "core01.box-or-reason"]) assert.ok(before.includes(rule), `차단 ${rule}: ${before}`);
  assert.ok(!before.includes("nav10.source-data") && !before.includes("nav10.calculation"), "채운 묶음은 차단에 없다");
  const panel = editor.getByTestId("check-panel");
  assert.equal(await panel.getByRole("button", { name: "발행", exact: true }).isDisabled(), true, "차단 항목이 남으면 발행 버튼이 꺼진다");
  assert.match(await panel.getByTestId("publish-reason").innerText(), new RegExp(`차단 항목 ${before.length}개`));
  await panel.locator('[data-rule="nav10.related-party-check"]').getByText("관계자 확인 묶음이 비었습니다").waitFor();
  assert.match(await panel.innerText(), /내부 품질 지표 — 검색 순위 예측이 아닙니다/);

  // 편집자 — 관계자 확인을 채우고 「지방세로 읽기」 생략 사유(편집 책임자만)를 적어 저장
  await open(editor, `/admin/articles/${id}`);
  await editor.fill("#chk-q-related-party", "가온시 세정과 관계자 전화 확인(2026-10-08)");
  await editor.locator("#taxlens").getByLabel("생략 사유 쓰기").check();
  await editor.fill("#taxlens-omission", "세금 영향은 후속 기사에서 다룬다");
  assert.equal(await save(editor), 3);
  await editor.getByTestId("quant-groups").getByText("정량형 필수 7묶음 (NAV-10) — 7/7 채움").waitFor();

  await open(editor, `/admin/reviews/${id}`);
  assert.deepEqual((await blockers(editor, { expectCount: 2 })).sort(), ["nav03.desk-edit-required", "nav10.no-causal-claim"]);
  await approveDesk(editor);
  await publishFromPanel(editor, id);
  const review = await one("select checklist, version from public.editorial_reviews where article_id = $1 and kind = 'desk_edit' order by id desc limit 1", [id]);
  assert.equal(review.checklist.noCausalClaim, true, "'인과 단정 없음' 확인이 승인 기록에 남는다");
  assert.equal(review.version, 3);

  // 공개 — 공개 키(anon)로 읽힌다. 비공개 근거는 공개 키로 0
  const pub = await anonPublic(id);
  assert.equal(pub.length, 1);
  assert.equal(pub[0].slug, `e2e-ui-quant-${staff.run}`);
  assert.ok(!(await anonEvidenceText(id)).includes("징수실적_2026H1"), "비공개 취재 근거는 공개 키로 읽히지 않는다");

  // 기획 → 발행
  await open(editor, "/admin/stories");
  await moveAssignment(editor, asg, "published");
  const events = (await db.query("select to_status from public.story_assignment_events where assignment_id = $1 order by id", [asg])).rows.map((e) => e.to_status);
  assert.deepEqual(events, ["idea", "assigned", "reporting", "fact_check", "review", "published"]);
});

// ── b) 정성형 ─────────────────────────────────────────────

test("b) 정성형 보도 — 인터뷰 기록·인용·관점별 기록·원문 대조 → 편집 승인 → 발행 → 공개", async () => {
  const reporter = await login(u.reporter);
  const asg = await createAssignment(reporter, { hypothesis: `착한 임대인 재산세 감면 신청이 적은 이유는 증빙 부담이다 ${staff.run}`, method: "qualitative" });
  for (const s of ["assigned", "reporting", "fact_check", "review"]) await moveAssignment(reporter, asg, s);
  const id = await writeFromAssignment(reporter, asg, { title: `‘착한 임대인’ 감면, 신청이 적은 이유는 ${staff.run}`, slug: `e2e-ui-qual-${staff.run}`, template: "qualitative" });
  ids.qual = id;
  assert.equal((await one("select reporting_method from public.articles where id = $1", [id])).reporting_method, "qualitative");

  const ordinance = await addSource(reporter, {
    kind: "official_doc",
    title: "가온시 시세 감면 조례 제12조(착한 임대인 재산세 감면)",
    url: "https://www.gaon-si.example/law/ordinance/tax-relief#a12",
    sourceName: "가온시",
    verified: "2026-10-14",
    license: "공공저작물 자유이용",
    ...OFFICIAL_UI,
    sourceType: "ordinance",
  });
  const interview = (role, n) => ({
    type: "interview",
    location: `편집국 취재 기록함 R-2026-1013-0${n}`,
    verified: "2026-10-13",
    interview: { role, contacted: "2026-10-13", record: `편집국 취재 기록함 R-2026-1013-0${n}` },
  });
  const gov = await addEvidence(reporter, interview("가온시 세정과 주무관", 1));
  const resident = await addEvidence(reporter, interview("누리구 상가 임대인", 2));
  const expert = await addEvidence(reporter, interview("세무사", 3));
  await addEvidence(reporter, { type: "document", location: "편집국 자료실/2026/0102/감면조례_원문.pdf", verified: "2026-10-14" });
  const interviews = (await one("select count(*)::int n from public.article_interviews i join public.article_evidence e on e.id = i.evidence_id where e.article_id = $1", [id])).n;
  assert.equal(interviews, 3, "인터뷰 기록 3건 — 연락처·녹취 원문 없이 보존 위치만");

  await textbox(reporter, 0, "핵심 요약 (줄마다 한 문장, 3줄 이하)").fill("가온시는 임대료를 낮춘 상가 임대인의 재산세를 최대 50% 감면합니다.\n임대인들은 증빙서류를 모으는 부담을 가장 큰 어려움으로 꼽았습니다.");
  await textbox(reporter, 1, "문단").fill("누리구 상가 세 곳을 찾아가 보니 임대인 두 명은 감면 제도를 알고 있었지만 신청하지 않았다. 임대료 입금 내역과 인하 약정서를 따로 챙겨 두지 않았기 때문이다.");
  await textbox(reporter, 2, "인용문").fill("증빙을 모으는 데만 일주일이 걸렸습니다.");
  await textbox(reporter, 2, "발언자 표기").fill("누리구 상가 임대인 A씨");
  await block(reporter, 2).getByRole("combobox", { name: "인터뷰 기록", exact: true }).selectOption(resident);
  await textbox(reporter, 3, "문단").fill("시는 신청 절차가 간단하다고 설명했다. 세무사는 임대인과 임차인이 특수관계인인지부터 확인하라고 조언했다.");

  await reporter.fill("#chk-ql-questions", "① 신청이 적은 이유 ② 증빙 준비에 걸리는 시간 ③ 시의 안내·접수 방식");
  await reporter.fill("#chk-ql-field", "2026-10-13 누리구 상가 3곳 방문, 임대인 2명·임차인 1명 면담");
  await reporter.fill("#chk-ql-counter", "시는 신청 절차가 간단하다고 설명 — 임대인·세무사의 증빙 부담 관점을 함께 실음");
  await reporter.fill("#chk-ql-conflicts", "취재 대상과 SM 사이 광고·제휴·자문 관계 없음(2026-10-14 확인)");
  await reporter.getByLabel(/지역 정책 쟁점 원고입니다/).check();
  for (const [key, ref] of [["local_gov", gov], ["residents_taxpayers", resident], ["experts", expert]]) {
    await reporter.locator(`#chk-p-${key}-status`).selectOption("interviewed");
    await reporter.locator(`#chk-p-${key}-evidence`).selectOption(ref);
    await reporter.locator(`#chk-p-${key}-date`).fill("2026-10-13");
  }
  await reporter.getByRole("button", { name: "원문 대조 더하기" }).click();
  await reporter.locator("#chk-otc-0-source").selectOption(ordinance);
  await reporter.locator("#chk-otc-0-date").fill("2026-10-14");
  assert.equal(await save(reporter), 2);
  await reporter.getByTestId("qual-records").getByText("정성형 필수 기록 (NAV-11) — 7/7 채움").waitFor();
  const log = (await one("select check_log, body from public.articles where id = $1", [id])).check_log.checklists;
  assert.deepEqual(log.perspectives.residents_taxpayers, { status: "interviewed", evidenceId: resident, contactedAt: "2026-10-13" });
  assert.deepEqual(log.originalTextChecks, [{ sourceId: ordinance, checkedAt: "2026-10-14" }]);
  await reporter.getByRole("button", { name: "검토 요청" }).click();
  await reporter.getByText("검토를 요청했습니다").waitFor();

  const editor = await login(u.editor);
  await open(editor, `/admin/reviews/${id}`);
  const before = await blockers(editor);
  assert.ok(before.includes("core01.box-or-reason") && before.includes("nav03.desk-edit-required"), `${before}`);
  assert.ok(!before.some((r) => r.startsWith("nav11.")), `정성형 필수 기록은 모두 채웠다: ${before}`);
  await open(editor, `/admin/articles/${id}`);
  await editor.locator("#taxlens").getByLabel("생략 사유 쓰기").check();
  await editor.fill("#taxlens-omission", "세금 계산이 아닌 신청 절차 기사 — 감면 해설은 별도 해설 기사로");
  assert.equal(await save(editor), 3);
  await open(editor, `/admin/reviews/${id}`);
  assert.deepEqual(await blockers(editor, { expectCount: 1 }), ["nav03.desk-edit-required"]);
  const deskForm = editor.getByRole("form", { name: "편집 승인 결정" });
  assert.equal(await deskForm.getByLabel(/인과 단정 없음/).count(), 0, "정성형 승인에는 '인과 단정 없음' 항목이 없다");
  // 지역 기사면 W4 7단계 지역 확인 3항목(근거·관계·광고 독립성)이 더 붙는다 — 그것을 뺀 기본 항목은 4개
  const regionalChecks = await deskForm.getByLabel(/^(근거|관계|광고 독립성) — /).count();
  assert.equal((await deskForm.locator('input[type="checkbox"]').count()) - regionalChecks, 4, "정성형 승인 기본 확인 항목 4개");
  await approveDesk(editor);
  await publishFromPanel(editor, id);
  assert.equal((await anonPublic(id)).length, 1, "공개 키로 읽힌다");

  await open(editor, "/admin/stories");
  await moveAssignment(editor, asg, "published");
  assert.equal((await one("select status from public.story_assignments where id = $1", [asg])).status, "published");
});

// ── c) 정정 ───────────────────────────────────────────────

test("c) 정정 — 이유 없이 저장하면 칸 오류·기록 0, 이유와 함께면 전후 버전이 정정 이력에 남는다 (기자 요청 → 편집자 결정)", async () => {
  const id = ids.quant;
  assert.ok(id, "a) 시험의 발행 기사");
  const reporter = await login(u.reporter);
  await open(reporter, `/admin/articles/${id}`);
  await reporter.getByText("발행된 기사는 편집 책임자만 고칩니다").waitFor();
  await reporter.fill("#cor-req-reason", "징수액 1,284억 원은 1,248억 원의 오기입니다");
  await reporter.getByRole("button", { name: "정정 요청 보내기" }).click();
  await reporter.getByText("정정 요청을 남겼습니다").waitFor();
  const inquiry = await one("select id, status from public.inquiries where related_article_id = $1 and kind = 'correction'", [id]);
  assert.equal(inquiry.status, "received");

  const editor = await login(u.editor);
  await open(editor, `/admin/articles/${id}`);
  const form = editor.getByRole("form", { name: "정정 결정" });
  await form.locator("#cor-p-1").fill("편집국이 가온시 세목별 징수 실적을 집계해 보니 올해 1~6월 취득세 징수액은 1,248억 원이었다.");
  await form.getByRole("button", { name: "결정 기록" }).click();
  assert.match(await form.locator("#cor-reason-error").innerText(), /이유/);
  assert.equal(await form.locator("#cor-reason").getAttribute("aria-invalid"), "true");
  assert.equal((await one("select count(*)::int n from public.article_corrections where article_id = $1", [id])).n, 0, "이유가 없으면 아무것도 저장하지 않는다");

  const before = await one("select version from public.articles where id = $1", [id]);
  await form.locator("#cor-reason").fill("징수액 오기 정정 (1,284억 원 → 1,248억 원)");
  await form.locator("#cor-inquiry").selectOption(String(inquiry.id));
  await form.getByRole("button", { name: "결정 기록" }).click();
  await form.getByRole("status").filter({ hasText: "정정을 기록했습니다" }).waitFor();

  const c = await one("select kind, reason, before_revision_id, after_revision_id, decided_by from public.article_corrections where article_id = $1", [id]);
  assert.equal(c.kind, "correction");
  assert.equal(c.decided_by, `user:${u.editor.id}`);
  const revs = (await db.query("select version from public.article_revisions where id = any($1::bigint[]) order by version", [[c.before_revision_id, c.after_revision_id]])).rows.map((r) => r.version);
  assert.deepEqual(revs, [before.version, before.version + 1], "전후 버전");
  assert.deepEqual(await one("select status, resolution from public.inquiries where id = $1", [inquiry.id]), { status: "done", resolution: "correction_published" });
  const row = await one("select status, update_kind from public.articles where id = $1", [id]);
  assert.deepEqual(row, { status: "published", update_kind: "correction" }, "정정해도 게재 상태 유지");

  const list = editor.getByTestId("correction-list");
  await list.getByTestId("correction-versions").filter({ hasText: `버전 ${before.version} → 버전 ${before.version + 1}` }).waitFor();
  assert.match(await list.innerText(), /1,284억 원이었다/);
  assert.match(await list.innerText(), /1,248억 원이었다/);
});

// ── d) 역할별 메뉴 · 403 · AI 도우미 런처 0 ──────────────────

test("d) 편집국 외 역할 4종 — 승인·정렬·발행 메뉴 0, 검토·발행·배치·보도기사 화면 403 / 편집자 — 상품·광고·전문가·브랜드 메뉴 0", async () => {
  const id = ids.quant;
  for (const role of NON_NEWSROOM) {
    const page = await login(u[role]);
    const menu = await menuLabels(page);
    for (const label of APPROVE_SORT_PUBLISH_MENUS) assert.ok(!menu.includes(label), `${role} 메뉴에 '${label}'`);
    assert.ok(!menu.includes("기사"), `${role} 메뉴에 기사(편집국) 메뉴`);
    assert.ok(menu.includes(OWN_MENU[role]), `${role} 메뉴에 자기 메뉴 '${OWN_MENU[role]}': ${menu}`);
    for (const path of ["/admin/reviews", `/admin/reviews/${id}`, "/admin/placement", "/admin/home", `/admin/articles/${id}`, "/admin/stories"]) {
      const res = await open(page, path);
      assert.equal(res.status(), 403, `${role} ${path}`);
      await page.getByRole("heading", { name: "이 화면을 쓸 권한이 없습니다" }).waitFor();
    }
    const ownPath = role === "ad_ops" ? "/admin/articles?type=sponsored" : { store_ops: "/admin/store", brand_ops: "/admin/brand", expert_ops: "/admin/experts" }[role];
    const own = await open(page, ownPath);
    assert.equal(own.status(), 200, `${role} 자기 화면`);
  }

  const editor = await login(u.editor);
  const menu = await menuLabels(editor);
  assert.deepEqual(menu, ["첫 화면", "기사 기획", "기사", "검토·발행", "기사 배치", "홈 배치", "개정 트래커", "바깥 연결", "허브 지방세 포인트", "원문 검수", "공통 검수", "지역 기사 판정", "프로젝트", "분양 정보", "개발방법 비교", "부동산금융", "지자체뉴스", "상황 카드", "분야", "사전", "검색어", "제휴 준비", "검색 최적화", "문의함", "정책 페이지"]);
  assert.equal((await open(editor, "/admin/home")).status(), 200, "편집자 홈 배치 화면");
  for (const label of OPERATIONS_MENUS) assert.ok(!menu.includes(label));
  for (const path of ["/admin/store", "/admin/brand", "/admin/experts"]) assert.equal((await open(editor, path)).status(), 403, `편집자 ${path}`);

  const reporter = await login(u.reporter);
  assert.deepEqual(await menuLabels(reporter), ["첫 화면", "기사 기획", "기사", "상황 카드", "문의함"]);
  for (const path of ["/admin/reviews", "/admin/placement", "/admin/home"]) assert.equal((await open(reporter, path)).status(), 403, `기자 ${path}`);

  // 편집자가 쓰는 백오피스 화면 전부 — AI 도우미 런처 0 (open이 확인한다)
  for (const path of ["/admin", "/admin/articles", `/admin/articles/${id}`, "/admin/articles/new", "/admin/stories", "/admin/reviews", `/admin/reviews/${id}`, "/admin/placement"]) {
    assert.equal((await open(editor, path)).status(), 200, path);
  }
});

// ── f) 360px ───────────────────────────────────────────────

test("f) 360·640·1024px — /admin · 기사 편집 · 검토 대기 등에서 가로 스크롤 0 (표는 표 안에서만 넘친다)", async () => {
  const editor = await login(u.editor, { width: 360, height: 740 });
  for (const width of [360, 640, 1024]) {
    await editor.setViewportSize({ width, height: 740 });
    for (const path of ["/admin", `/admin/articles/${ids.quant}`, "/admin/reviews", "/admin/articles", "/admin/stories", `/admin/reviews/${ids.qual}`]) {
      await open(editor, path);
      await editor.waitForLoadState("networkidle");
      const { scrollWidth, clientWidth } = await editor.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      assert.ok(scrollWidth <= clientWidth, `${width}px ${path}: scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`);
    }
  }
});

test("시험 동안 예상 못 한 서버 오류(500)가 없었다", async () => {
  const log = server.log();
  for (const mark of ["[api] 처리 중 오류", "[db] ", "[audit] "]) assert.ok(!log.includes(mark), log.slice(-3000));
});
