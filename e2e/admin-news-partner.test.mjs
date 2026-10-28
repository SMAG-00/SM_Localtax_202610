// 기사 생산·제휴 준비 대시보드 E2E (W2-c 5단계 — NAV-13 · NAV-14, docs/dev/W2-c_설계.md 1장 5단계 증거·8.5)
// standalone 빌드를 로컬 Supabase에 붙인다. 기사는 DB에 직접 넣는다(지난 달 날짜 — 서버의 '오늘' 기준 완결된 달 3·6개월 경계에 맞춰).
// 규정 버전은 편집 책임자가 화면에서 적고 확정한다(폼 → 규정 API → 감사 로그).
//  a) 확정 버전 없음 → 두 플랫폼 '요건 미확정'(카카오 '검토 전'), 공식 숫자·충족·미달 0, 내부 정의 숫자는 보인다 · 시작일 하루 전 제외·시작일 0시 포함 ·
//     기사 기획 캘린더의 기사 할당량도 '요건 미확정'(할당량 입력 칸 0)
//  b) 화면에서 새 버전(작성 중) → 확정 조건(원문 URL·확인일·등록 유형…)이 빠진 버전은 확정 API 422, 담당자 확인 표시 없이 422 → 화면에서 확정
//  c) 확정 뒤 대시보드 — 공식 정의(규정 버전 글자·거르개)와 내부 정의를 따로, 심사 기간 비교 '미달'·인력 보강·신청 연기 안내
//  d) 확정 버전은 고치기 409·DB 그대로, '이 버전을 바탕으로 새 버전' → 2번 작성 중 → 확정해도 1번이 남는다, 대시보드는 2번
//  e) 역할 — 기자·광고 담당 403·메뉴 0·API 403(새 버전 거부는 감사 로그), 편집 책임자·관리자 200·메뉴 '제휴 준비', 로그인 안 하면 로그인 화면
//  f) 화면 글자 — '인정'·'예상 점수'·'예측'·'판정'·보장 문구 0, 유사도는 '중복·표절 검토용 경고' · 감사 로그(등록·고치기·확정)
//  g) 360px — 대시보드·규정 화면 가로 스크롤 0
// 만든 계정·기사·규정 버전·감사 로그는 끝나면 지운다(StaffFixture — 확정 버전은 트리거를 끈 세션으로).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e.example.test";
const ADMIN_EMAIL = "admin-news-partner-e2e@example.test";
const DAY = 86_400_000;
const BANNED = ["인정", "예상 점수", "예측", "판정", "선정 예정", "제휴 확정", "네이버 제휴 언론사"];

let sb, server, staff, db, browser, base;
const u = {};
const fx = {};
const contexts = [];

// ── 한국 달력 ─────────────────────────────────────────────
const kstToday = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
const monthIndex = (date) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const firstDay = (i) => `${String(Math.floor(i / 12)).padStart(4, "0")}-${String((i % 12) + 1).padStart(2, "0")}-01`;
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const kst = (date, hms) => new Date(`${date}T${hms}+09:00`).toISOString();

async function api(method, path, user, body) {
  const res = await fetch(`${base}/api/admin${path}`, {
    method,
    headers: { authorization: `Bearer ${user.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const show = (r) => JSON.stringify(r.body).slice(0, 1500);

async function article(label, cols) {
  const all = { slug: `e2e-readiness-${label}-${staff.run}`, title: `생산 시험 ${label} ${staff.run}`, section: "tax", content_type: "reported_news", reporting_method: "quantitative", status: "published", author_id: u.reporter.personId, ...cols };
  const keys = Object.keys(all);
  const { rows } = await db.query(`insert into public.articles (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, Object.values(all));
  const id = Number(rows[0].id);
  staff.trackArticle(id);
  fx[label] = id;
  return id;
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
  u.admin = await staff.createUser({ label: "readiness-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "readiness-editor", roles: ["editor"], person: { name: "제휴 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "readiness-reporter", roles: ["reporter"], person: { name: "제휴 시험 기자", roles: ["reporter"] } });
  u.adOps = await staff.createUser({ label: "readiness-ad", roles: ["ad_ops"] });

  // 완결된 달 기간 (설정 씨앗 closed_months — 3·6·12개월)
  const today = kstToday();
  const current = monthIndex(today);
  fx.w3 = { from: firstDay(current - 3), to: addDays(firstDay(current), -1) };
  fx.w6 = { from: firstDay(current - 6) };
  fx.w12 = { from: firstDay(current - 12) };
  const seeded = (await db.query("select value from public.settings where key = 'news_readiness_windows'")).rows[0]?.value;
  assert.deepEqual({ months: seeded?.months, basis: seeded?.basis }, { months: [3, 6, 12], basis: "closed_months" }, "설정 씨앗 그대로에서 시험한다");
  // 다른 자료와 섞이지 않게 — 12개월 안 기사·규정 버전이 없는 로컬 DB에서만 숫자를 대조한다
  const other = (await db.query("select count(*)::int n from public.articles where first_published_at >= $1", [kst(fx.w12.from, "00:00:00")])).rows[0].n;
  assert.equal(other, 0, "로컬 DB에 최근 12개월 기사가 이미 있다 — 손 계산과 섞인다");
  const versions = (await db.query("select count(*)::int n from public.news_partner_requirements")).rows[0].n;
  assert.equal(versions, 0, "로컬 DB에 규정 버전이 이미 있다 — '요건 미확정' 시험을 할 수 없다");

  // 3개월: 시작일 0시 보도(정량) · 칼럼 · 금주 핫뉴스 · 해설 = 총 4, 자체 취재 후보 1 / 6개월: + 시작일 하루 전 보도(정성) = 총 5, 후보 2
  const mid = addDays(fx.w3.from, 20);
  await article("start", { first_published_at: kst(fx.w3.from, "00:00:00") });
  await article("dayBefore", { first_published_at: kst(addDays(fx.w3.from, -1), "12:00:00"), reporting_method: "qualitative" });
  await article("opinion", { first_published_at: kst(mid, "09:00:00"), content_type: "opinion", reporting_method: null, author_id: null });
  await article("digest", { first_published_at: kst(mid, "10:00:00"), content_type: "digest", reporting_method: null, digest_id: 1, author_id: null });
  await article("explainer", { first_published_at: kst(mid, "11:00:00"), content_type: "explainer", reporting_method: null });
  // 독자 반응(사람 조회 7) · 유사도 사전 경고(기준을 넘은 점검 1건)
  await db.query("insert into public.article_stats (article_id, hour, views_all, views_human, shares, engaged_views) values ($1, $2, 9, 7, 1, 3)", [fx.start, new Date(Date.parse(kst(mid, "12:00:00"))).toISOString()]);
  await db.query(
    "insert into public.seo_checks (target_type, target_id, rules_version, engine_version, scores, similarity, checked_at, checked_by) values ('article', $1, 'e2e', 'e2e', '{\"seo\":1,\"aeo\":1,\"geo\":1,\"common\":1}', '{\"status\":\"blocked\"}', $2, 'editor')",
    [String(fx.explainer), kst(mid, "11:30:00")],
  );
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

// ── 도우미 ─────────────────────────────────────────────

async function interactive(page) {
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^(로그아웃|로그인)$/.test(b.textContent.trim()) && !b.disabled));
}
async function open(page, path) {
  const res = await page.goto(`${base}${path}`);
  await interactive(page);
  assert.equal(await page.locator('[data-ui="assistant-launcher"]').count(), 0, `${path}: AI 도우미 런처`);
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
const text = async (page, sel) => (await page.locator(sel).innerText()).trim();
const internalCell = (page, metric, row, w) => text(page, `[data-section="internal"] [data-metric="${metric}"] [data-row="${row}"] [data-cell="${w}"]`);
const officialCell = (page, row, cell) => text(page, `[data-platform="naver"] [data-metric="official"] [data-row="${row}"] [data-cell="${cell}"]`);
const mainText = (page) => page.locator("main").innerText();

// ── a) 요건 미확정 ───────────────────────────────────────

test("a) 확정 버전 없음 — 두 플랫폼 '요건 미확정'(카카오 '검토 전'), 공식 숫자·충족·미달 0 · 내부 정의 숫자(시작일 하루 전 제외·시작일 0시 포함) · 기사 할당량도 요건 미확정", async () => {
  const page = await login(u.editor);
  assert.equal((await open(page, "/admin/news-readiness")).status(), 200);
  for (const p of ["naver", "kakao"]) {
    assert.equal(await page.locator(`[data-platform="${p}"]`).getAttribute("data-state"), "none", p);
    assert.equal(await text(page, `[data-platform="${p}"] [data-part="undetermined"] [data-cell="status"]`), "요건 미확정", p);
  }
  assert.match(await text(page, '[data-platform="kakao"] [data-part="undetermined"]'), /검토 전/);
  assert.equal(await page.locator('[data-part="official"], [data-metric="official"], [data-part="capacity-guidance"]').count(), 0, "공식 숫자·기준 비교 0");
  const body = await mainText(page);
  for (const w of ["충족", "미달", "규정 기준"]) assert.ok(!body.includes(w), `요건 미확정인데 '${w}'`);

  // 내부 정의 — 3개월: 총 4·후보 1 / 6개월: 총 5·후보 2 (시작일 하루 전 보도는 6개월에만)
  assert.equal(await internalCell(page, "production", "total", "w3"), "4");
  assert.equal(await internalCell(page, "production", "own", "w3"), "1 / 4 · 25%");
  assert.equal(await internalCell(page, "production", "total", "w6"), "5");
  assert.equal(await internalCell(page, "production", "own", "w6"), "2 / 5 · 40%");
  assert.equal(await internalCell(page, "production", "qualitative", "w3"), "0 / 1 · 0%");
  assert.equal(await internalCell(page, "production", "qualitative", "w6"), "1 / 2 · 50%");
  assert.equal(await internalCell(page, "similarity", "blocked", "w3"), "1");
  assert.equal(await internalCell(page, "reader", "views", "w3"), "7");
  // 지표마다 분자·분모·제외 글자
  const defs = await page.locator('[data-section="internal"] [data-part="definition"]').allInnerTexts();
  assert.ok(defs.length >= 10, `정의 ${defs.length}개`);
  for (const d of defs) for (const word of ["분자", "분모", "제외"]) assert.ok(d.includes(word), `정의에 '${word}': ${d.slice(0, 60)}`);
  // 추적 — 3개월 자체 취재 후보는 시작일 기사 하나
  assert.deepEqual(await page.locator('[data-metric="trace"] tbody tr').evaluateAll((rs) => rs.map((r) => Number(r.getAttribute("data-row")))), [fx.start]);
  assert.equal(await page.locator(`[data-metric="trace"] a[href="/admin/articles/${fx.start}"]`).count(), 1, "근거 → 편집 → 정정 기록으로 가는 링크");

  // 기사 기획 캘린더의 기사 할당량도 요건 미확정 (NAV-09 · NAV-13) — 기자도 같은 줄을 본다, 할당량 입력 칸 0
  for (const user of [u.editor, u.reporter]) {
    const p = user === u.editor ? page : await login(user);
    await open(p, "/admin/stories");
    for (const platform of ["naver", "kakao"]) {
      assert.equal(await p.locator(`[data-part="quota"] [data-platform="${platform}"]`).getAttribute("data-confirmed"), "false");
      assert.match(await text(p, `[data-part="quota"] [data-platform="${platform}"]`), /요건 미확정/);
    }
    assert.equal(await p.locator('[data-part="quota"] input, [data-part="quota"] textarea').count(), 0, "임의 할당량 입력 0");
  }
});

// ── b) 새 버전 · 확정 조건 ───────────────────────────────

test("b) 화면에서 새 버전(작성 중) — 확정 조건이 빠진 버전은 422, 담당자 확인 표시 없이 422, 화면에서 확정 → 감사 로그", async () => {
  // 확정 조건이 빠진 버전 (API) — 원문 URL·확인일·등록 유형·적용 시작일·심사 기간·요건이 없으면 확정 불가
  const bare = await api("POST", "/news-readiness/requirements", u.editor, { platform: "kakao", title: "카카오 검토 메모" });
  assert.equal(bare.status, 201, show(bare));
  const bareConfirm = await api("POST", `/news-readiness/requirements/${bare.body.requirement.id}/confirm`, u.editor, { attested: true });
  assert.equal(bareConfirm.status, 422, show(bareConfirm));
  assert.deepEqual(
    bareConfirm.body.errors.map((e) => e.split(":")[0]),
    ["requirement.sourceUrl", "requirement.checkedAt", "requirement.mediaType", "requirement.effectiveFrom", "requirement.reviewPeriod", "requirement.items"],
  );
  fx.kakaoDraft = bare.body.requirement.id;

  // 화면에서 네이버 새 버전 — 요건 1개(자체 생산 비율, 원문 기준 50% 이상)
  const page = await login(u.editor);
  await open(page, "/admin/news-readiness/requirements");
  await page.locator("summary", { hasText: "새 버전 적기" }).click();
  const today = kstToday();
  await page.selectOption("#req-new-platform", "naver");
  await page.fill("#req-new-title", `시험 뉴스 검색 제휴 규정 ${staff.run}`);
  await page.fill("#req-new-sourceUrl", "https://example.test/naver/news-partner-rules");
  await page.fill("#req-new-sourceTextRef", "공유 드라이브 제휴/규정 원문 제3조");
  await page.fill("#req-new-checkedAt", today);
  await page.fill("#req-new-mediaType", "인터넷신문");
  await page.fill("#req-new-effectiveFrom", fx.w12.from);
  await page.selectOption("#req-new-reviewPeriod-months", "3");
  await page.selectOption("#req-new-reviewPeriod-basis", "closed_months");
  await page.fill("#req-new-reviewPeriod-text", "최근 3개월 (시험 문구)");
  await page.getByRole("button", { name: "요건 더하기" }).first().click();
  await page.fill("#req-new-items-0-key", "own_ratio");
  await page.fill("#req-new-items-0-label", "자체 생산 기사 비율");
  await page.selectOption("#req-new-items-0-metric", "ratio");
  await page.check("#req-new-items-0-numerator-contentTypes-reported_news");
  await page.fill("#req-new-items-0-numeratorText", "규정이 정한 자체 취재 보도기사 (시험 문구)");
  await page.fill("#req-new-items-0-denominatorText", "규정이 정한 전체 송고 기사 (시험 문구)");
  await page.fill("#req-new-items-0-exclusionsText", "규정이 정한 제외 기사 (시험 문구)");
  await page.check("#req-new-items-0-hasCriterion");
  await page.fill("#req-new-items-0-criterion-value", "50");
  await page.getByRole("form", { name: "새 규정 버전" }).getByRole("button", { name: "작성 중 버전으로 저장" }).click();
  await page.getByText("새 버전을 저장했습니다").waitFor();
  const card = page.locator('[data-platform="naver"] [data-requirement]').first();
  await card.waitFor();
  fx.v1 = Number(await card.getAttribute("data-requirement"));
  assert.equal(await card.getAttribute("data-status"), "unconfirmed");
  assert.equal(await card.getAttribute("data-version"), "1");
  assert.equal(await text(page, `[data-requirement="${fx.v1}"] [data-item="own_ratio"] [data-cell="criterion"]`), "50% 이상");

  // 담당자 확인 표시 없이 확정 → 422 (그 칸만)
  const noAttest = await api("POST", `/news-readiness/requirements/${fx.v1}/confirm`, u.editor, {});
  assert.equal(noAttest.status, 422, show(noAttest));
  assert.deepEqual(noAttest.body.errors, ["requirement.attested: 공식 규정 원문과 우리 매체의 실제 등록 유형을 확인했다는 표시가 필요합니다"]);

  // 화면에서 확정
  const cardNow = page.locator(`[data-requirement="${fx.v1}"]`);
  await cardNow.locator("summary", { hasText: "확정하기" }).click();
  assert.equal(await cardNow.locator('[data-part="confirm-missing"]').count(), 0, "빠진 칸 0");
  await page.check(`#confirm-${fx.v1}-attested`);
  await cardNow.getByRole("button", { name: "이 버전 확정" }).click();
  await page.locator(`[data-requirement="${fx.v1}"][data-status="confirmed"]`).waitFor();
  const row = (await db.query("select status, approved_by, approved_at, created_by from public.news_partner_requirements where id = $1", [fx.v1])).rows[0];
  assert.deepEqual([row.status, row.approved_by, row.created_by], ["confirmed", `user:${u.editor.id}`, `user:${u.editor.id}`]);
  assert.ok(row.approved_at);
  const audits = (await db.query("select action from public.audit_logs where target = $1 order by id", [`news_partner_requirements:${fx.v1}`])).rows.map((r) => r.action);
  assert.deepEqual(audits, ["news_requirement.create", "news_requirement.confirm"]);
});

// ── c) 확정 뒤 대시보드 ──────────────────────────────────

test("c) 확정 뒤 — 공식 정의(규정 글자·거르개) 숫자와 내부 정의를 따로, 심사 기간(3개월) '미달 (25%)'·인력 보강·신청 연기 안내 / 카카오는 그대로 요건 미확정", async () => {
  const page = await login(u.editor);
  await open(page, "/admin/news-readiness");
  assert.equal(await page.locator('[data-platform="naver"]').getAttribute("data-state"), "confirmed");
  assert.equal(await text(page, '[data-platform="naver"] [data-cell="version"]'), "1번");
  assert.equal(await text(page, '[data-platform="naver"] [data-cell="media-type"]'), "인터넷신문");
  assert.equal(await officialCell(page, "own_ratio", "w3"), "1 / 4 · 25%");
  assert.equal(await officialCell(page, "own_ratio", "w6"), "2 / 5 · 40%");
  assert.equal(await officialCell(page, "own_ratio", "review"), "1 / 4 · 25%");
  assert.equal(await officialCell(page, "own_ratio", "criterion"), "50% 이상");
  assert.equal(await officialCell(page, "own_ratio", "result"), "미달 (25%)");
  assert.match(await text(page, '[data-platform="naver"] [data-part="capacity-guidance"]'), /인력.*보강.*신청을 미루.*비슷한 기사/);
  // 공식 정의 글자는 규정 버전 그대로, 내부 정의는 따로
  const official = await page.locator('[data-platform="naver"] [data-part="definition"]').allInnerTexts();
  assert.equal(official.length, 1);
  for (const w of ["규정이 정한 자체 취재 보도기사 (시험 문구)", "규정이 정한 전체 송고 기사 (시험 문구)", "규정이 정한 제외 기사 (시험 문구)", "유형 보도"]) assert.ok(official[0].includes(w), w);
  assert.equal(await internalCell(page, "production", "own", "w3"), "1 / 4 · 25%", "내부 정의 숫자는 그대로");
  const internalDefs = await page.locator('#internal-production [data-part="definition"]').allInnerTexts();
  assert.ok(internalDefs.some((d) => d.includes("보도(reported_news)") && d.includes("금주 핫뉴스·칼럼·광고")), "내부 정의 — 자체 취재 후보의 분자·제외");
  assert.equal(await page.locator('[data-platform="kakao"]').getAttribute("data-state"), "unconfirmed", "작성 중 카카오 버전만 — 요건 미확정");
  assert.equal(await text(page, '[data-platform="kakao"] [data-cell="status"]'), "요건 미확정");

  // 기사 할당량 — 네이버는 확정 버전에서 (비율 요건뿐이라 기사 수 기준 없음), 카카오는 그대로 요건 미확정
  await open(page, "/admin/stories");
  assert.equal(await text(page, '[data-part="quota"] [data-platform="naver"]'), "네이버 규정 1번 — 기사 수 기준이 없습니다");
  assert.equal(await page.locator('[data-part="quota"] [data-platform="naver"]').getAttribute("data-confirmed"), "true");
  assert.match(await text(page, '[data-part="quota"] [data-platform="kakao"]'), /요건 미확정/);
});

// ── d) 확정 버전은 그대로 · 새 버전 ──────────────────────

test("d) 확정 버전 고치기 409·DB 그대로 → '이 버전을 바탕으로 새 버전' 2번 작성 중 → 확정해도 1번이 남는다, 대시보드는 2번", async () => {
  const beforeRow = (await db.query("select title, requirements, updated_at from public.news_partner_requirements where id = $1", [fx.v1])).rows[0];
  const edit = await api("PATCH", `/news-readiness/requirements/${fx.v1}`, u.editor, { title: "확정 뒤 고친 제목" });
  assert.equal(edit.status, 409, show(edit));
  assert.match(edit.body.error, /확정된 규정 버전은 고칠 수 없습니다.*새 버전/);
  const afterRow = (await db.query("select title, requirements, updated_at from public.news_partner_requirements where id = $1", [fx.v1])).rows[0];
  assert.deepEqual(afterRow, beforeRow, "DB 그대로");

  const page = await login(u.editor);
  await open(page, "/admin/news-readiness/requirements");
  const v1 = page.locator(`[data-requirement="${fx.v1}"]`);
  assert.equal(await v1.locator("summary", { hasText: "고치기" }).count(), 0, "확정 버전에 고치기 0");
  await v1.locator("summary", { hasText: "이 버전을 바탕으로 새 버전 적기" }).click();
  await page.fill(`#req-next-${fx.v1}-title`, `시험 규정 개정판 ${staff.run}`);
  await page.fill(`#req-next-${fx.v1}-items-0-criterion-value`, "20");
  await v1.getByRole("button", { name: "작성 중 버전으로 저장" }).click();
  await page.locator('[data-platform="naver"] [data-requirement][data-version="2"]').waitFor();
  fx.v2 = Number(await page.locator('[data-platform="naver"] [data-requirement][data-version="2"]').getAttribute("data-requirement"));
  const v2row = (await db.query("select status, supersedes_id, source_url, requirements from public.news_partner_requirements where id = $1", [fx.v2])).rows[0];
  assert.deepEqual([v2row.status, Number(v2row.supersedes_id), v2row.source_url], ["unconfirmed", fx.v1, "https://example.test/naver/news-partner-rules"]);
  assert.equal(v2row.requirements[0].criterion.value, 20);

  const ok = await api("POST", `/news-readiness/requirements/${fx.v2}/confirm`, u.admin, { attested: true });
  assert.equal(ok.status, 200, show(ok));
  assert.equal((await api("POST", `/news-readiness/requirements/${fx.v2}/confirm`, u.admin, { attested: true })).status, 409, "두 번 확정 0");
  const list = await api("GET", "/news-readiness/requirements", u.editor);
  assert.equal(list.status, 200);
  const naver = list.body.requirements.filter((r) => r.platform === "naver").map((r) => [r.version, r.status]);
  assert.deepEqual(naver, [[1, "confirmed"], [2, "confirmed"]], "새 버전을 확정해도 앞 버전이 남는다");

  await open(page, "/admin/news-readiness");
  assert.equal(await text(page, '[data-platform="naver"] [data-cell="version"]'), "2번", "가장 늦게 확정된 버전");
  assert.equal(await officialCell(page, "own_ratio", "criterion"), "20% 이상");
  assert.equal(await officialCell(page, "own_ratio", "result"), "충족 (25%)");
  assert.equal(await page.locator('[data-part="capacity-guidance"]').count(), 0, "모두 충족이면 안내 0");
});

// ── e) 역할 ──────────────────────────────────────────────

test("e) 기자·광고 담당 403·메뉴 0·API 403(새 버전 거부는 감사 로그) / 편집 책임자·관리자 200·메뉴 '제휴 준비' / 로그인 안 하면 로그인 화면", async () => {
  for (const user of [u.reporter, u.adOps]) {
    const page = await login(user);
    assert.ok(!(await menuLabels(page)).includes("제휴 준비"), `${user.email} 메뉴`);
    for (const path of ["/admin/news-readiness", "/admin/news-readiness/requirements"]) {
      const res = await open(page, path);
      assert.equal(res.status(), 403, `${user.email} ${path}`);
      await page.getByRole("heading", { name: "이 화면을 쓸 권한이 없습니다" }).waitFor();
      assert.equal(await page.locator("[data-platform]").count(), 0);
    }
    assert.equal((await api("GET", "/news-readiness/requirements", user)).status, 403);
    const post = await api("POST", "/news-readiness/requirements", user, { platform: "naver", title: "권한 없는 버전" });
    assert.equal(post.status, 403, show(post));
    assert.equal((await api("POST", `/news-readiness/requirements/${fx.kakaoDraft}/confirm`, user, { attested: true })).status, 403);
    const denied = (await db.query("select count(*)::int n from public.audit_logs where actor = $1 and action = 'readiness.requirements.denied'", [`user:${user.id}`])).rows[0].n;
    assert.equal(denied, 2, "규정 버전 거부는 감사 로그");
  }
  assert.equal((await db.query("select count(*)::int n from public.news_partner_requirements where title = '권한 없는 버전'")).rows[0].n, 0);
  for (const user of [u.editor, u.admin]) {
    const page = await login(user);
    assert.ok((await menuLabels(page)).includes("제휴 준비"), `${user.email} 메뉴`);
    await page.locator('nav[aria-label="편집국 메뉴"] button[data-group]', { hasText: "수익·제휴" }).click();
    await page.locator('nav[aria-label="편집국 메뉴"] a', { hasText: "제휴 준비" }).click();
    await page.waitForURL(`${base}/admin/news-readiness`);
    assert.equal(await page.locator('nav[aria-label="편집국 메뉴"] a[aria-current="page"]').innerText(), "제휴 준비");
    assert.equal((await open(page, "/admin/news-readiness/requirements")).status(), 200);
  }
  const anonymous = await fetch(`${base}/admin/news-readiness`, { redirect: "manual" });
  assert.ok([302, 303, 307].includes(anonymous.status), `로그인 안 함: ${anonymous.status}`);
  assert.match(anonymous.headers.get("location") ?? "", /\/admin\/login/);
  assert.equal((await fetch(`${base}/api/admin/news-readiness/requirements`)).status, 401);
});

// ── f) 화면 글자 · 감사 로그 ─────────────────────────────

test("f) 화면 글자 — '인정'·'예상 점수'·'예측'·'판정'·보장 문구 0, 유사도는 '중복·표절 검토용 경고' · 고치기도 감사 로그", async () => {
  const page = await login(u.editor);
  for (const path of ["/admin/news-readiness", "/admin/news-readiness/requirements"]) {
    await open(page, path);
    const body = await mainText(page);
    for (const w of BANNED) assert.ok(!body.includes(w), `${path}: '${w}'`);
  }
  await open(page, "/admin/news-readiness");
  const similarity = await page.locator("#internal-similarity").innerText();
  assert.match(similarity, /중복·표절 검토용 경고/);
  assert.match(similarity, /네이버 심사와 관계없는/);
  for (const w of ["판정", "예측", "점수 예상", "인정"]) assert.ok(!similarity.includes(w), w);

  const patch = await api("PATCH", `/news-readiness/requirements/${fx.kakaoDraft}`, u.editor, { note: "카카오 현행 기준 실사 예정" });
  assert.equal(patch.status, 200, show(patch));
  const log = (await db.query("select action, before, after from public.audit_logs where target = $1 and action = 'news_requirement.update'", [`news_partner_requirements:${fx.kakaoDraft}`])).rows;
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].before, log[0].after], [{ note: null }, { note: "카카오 현행 기준 실사 예정" }]);
});

// ── g) 360px ─────────────────────────────────────────────

test("g) 360px — 대시보드·규정 화면 가로 스크롤 0 (표는 표 안에서만)", async () => {
  const page = await login(u.editor, { width: 360, height: 740 });
  for (const path of ["/admin/news-readiness", "/admin/news-readiness?window=12", "/admin/news-readiness/requirements"]) {
    await open(page, path);
    if (path.endsWith("requirements")) {
      for (const s of await page.locator("summary").all()) await s.click();
    }
    await page.waitForLoadState("networkidle");
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, `${path}: 가로 스크롤 ${over}px`);
  }
});

test("시험 동안 예상 못 한 서버 오류(500)가 없었다", () => {
  const log = server.log();
  for (const mark of ["[api] 처리 중 오류", "[db] ", "[audit] ", "[admin/news-readiness]"]) assert.ok(!log.includes(mark), log.slice(-3000));
});
