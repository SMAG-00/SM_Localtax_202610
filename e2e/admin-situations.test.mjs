// 상황 카드 백오피스 E2E (W2-b 3단계 — UX-05 · FAM-02 · PRD-01A 1.3 감수 대상, docs/dev/W2-b_설계.md 8.3) — API와 화면
// standalone 빌드를 띄우고 로컬 Supabase(Auth·DB)에 붙인다. 상태 코드·감사 로그·DB 값과 공개 화면(/situations/[slug] · 허브)을 함께 본다.
//  API) 기자·편집 책임자 만들기 201(비공개로 시작) · 먼저 확인할 것 2·4개 422(바뀜 0, DB도 공개 2개 거부) · 편집국 외 역할·감수위원 쓰기 403
//       감수 서명은 세무 감수위원만(편집자 403 + 감사 로그 review.tax_review.denied) · 낡은 판 서명 409 · 감수 전 공개 409 · 공개는 편집 책임자만(기자 403 + 감사)
//       공개 중 감수 대상 문장 고치기 409 · 내린 뒤 고치면 감수 기록이 지워진다(reviewCleared) · 허브 5번째 카드 409(DB 트리거도) · 허브 순서
//       저장 뒤 공개 화면이 30초를 기다리지 않고 바로 바뀐다(캐시 만료) · 주소 중복은 DB 오류 문장 그대로 409
//  화면) 편집자 — 2·4개면 API를 부르지 않고 칸 오류, 3개면 만들어짐 · 주소 중복은 서버(DB) 문장을 보인다 · 감수위원 서명 · 공개 · 고치면 감수 기록 지워짐 알림 ·
//        허브가 찬 분야의 [허브에 넣기] 꺼짐 + 사유 · 광고 담당 403 · 360px 가로 스크롤 0
// 만든 계정·상황·감사 로그는 끝나면 지운다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "admin-situations-e2e@example.test";
const SITE = "https://e2e.example.test";

let sb, server, staff, db, browser, base;
const u = {};
const fx = {};
const contexts = [];

async function api(method, path, user, body) {
  const headers = {};
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body: json };
}

const show = (r) => JSON.stringify(r.body).slice(0, 1200);
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const auditCount = async (userId, action, target) =>
  (await one("select count(*)::int n from public.audit_logs where actor = $1 and action = $2 and target = $3", [`user:${userId}`, action, target])).n;
const lastAudit = (userId, action, target) => one("select before, after, reason from public.audit_logs where actor = $1 and action = $2 and target = $3 order by id desc limit 1", [`user:${userId}`, action, target]);
const situationCount = async () => (await one("select count(*)::int n from public.situations")).n;
const row = (id) => one("select * from public.situations where id = $1", [id]);
const checks = (n) => Array.from({ length: n }, (_, i) => ({ title: `확인할 것 ${i + 1}` }));

/** 상황 만들기 (API) — 만든 상황은 시험이 끝나면 지운다 */
async function create(label, over = {}, user = u.editor) {
  const r = await api("POST", "/situations", user, { slug: `e2e-sit-${label}-${staff.run}`, section: "tax", title: `상황 ${label}`, pictogram: "car-sold", checks: checks(3), ...over });
  if (r.status === 201) staff.trackRow("situations", r.body.situation.id);
  return r;
}

async function signOff(id, user = u.reviewer) {
  const r = await row(id);
  return api("POST", `/situations/${id}/review`, user, { updatedAt: r.updated_at.toISOString() });
}

/** 공개 화면 HTML — 매번 새 요청 (서버 데이터 캐시가 있으면 그 값) */
async function publicPage(path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, html: await res.text() };
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
  // 지난 실행이 중간에 멈춰 남긴 상황(만든 계정이 지워진 것)은 허브 상한 시험을 흐리므로 지운다
  await db.query("delete from public.situations s where s.updated_by like 'user:%' and not exists (select 1 from auth.users x where 'user:' || x.id::text = s.updated_by)");
  assert.equal(await situationCount(), 0, "로컬 DB에 상황 카드가 남아 있다 — 허브 상한 시험 전에 비어 있어야 한다");
  u.editor = await staff.createUser({ label: "sit-editor", roles: ["editor"], person: { name: "상황 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "sit-reporter", roles: ["reporter"], person: { name: "상황 시험 기자", roles: ["reporter"] } });
  u.reviewer = await staff.createUser({ label: "sit-reviewer", roles: ["reviewer"], person: { name: "상황 시험 감수위원", roles: ["reviewer"] } });
  u.adOps = await staff.createUser({ label: "sit-ad", roles: ["ad_ops"] });
  u.admin = await staff.createUser({ label: "sit-admin", email: ADMIN_EMAIL });
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

// ── API ───────────────────────────────────────────────

test("API 만들기 — 기자·편집 책임자 201(비공개·감수 전으로 시작, 감사 로그), 먼저 확인할 것 2·4개 422(바뀜 0), 광고 담당·감수위원 403", async () => {
  const r = await create("car", { title: "차를 팔았어요·폐차했어요", subtitle: "돌려받을 자동차세가 있는지 확인합니다", mistakes: ["판 날이 아니라 말소일 기준입니다"] });
  assert.equal(r.status, 201, show(r));
  fx.car = r.body.situation;
  assert.deepEqual([fx.car.visible, fx.car.hubSlot, fx.car.review, fx.car.checksCount], [false, null, null, 3]);
  assert.equal(await auditCount(u.editor.id, "situation.create", `situations:${fx.car.id}`), 1);
  const byReporter = await create("reporter-draft", {}, u.reporter);
  assert.equal(byReporter.status, 201, "기자도 쓴다 (PRD-00 6장 'CMS 작성·상황 카드')");
  fx.reporterDraft = byReporter.body.situation;

  const before = await situationCount();
  for (const n of [2, 4, 0]) {
    const bad = await create(`checks-${n}`, { checks: checks(n) });
    assert.equal(bad.status, 422, `${n}개: ${show(bad)}`);
    assert.ok(bad.body.errors.some((e) => e.includes(`지금 ${n}개`)), `${n}개 사유: ${show(bad)}`);
  }
  const noSection = await create("no-section", { section: undefined });
  assert.equal(noSection.status, 422);
  assert.match(noSection.body.errors.join(" "), /분야 없이 저장할 수 없습니다/);
  for (const who of [u.adOps, u.reviewer]) {
    const denied = await create(`by-${who.roles[0]}`, {}, who);
    assert.equal(denied.status, 403, `${who.roles[0]}: ${show(denied)}`);
  }
  assert.equal((await api("GET", "/situations", u.adOps)).status, 403, "편집국 외 역할은 목록도 403");
  assert.equal((await api("GET", "/situations", u.reviewer)).status, 200, "감수위원은 읽는다");
  assert.equal((await api("POST", "/situations", null, { slug: "x" })).status, 401);
  assert.equal(await situationCount(), before, "거부된 요청은 행을 만들지 않는다");

  // DB가 마지막에 막는다 — 직접 SQL로도 4개는 저장 0, 공개 행의 2개도 저장 0
  await assert.rejects(db.query("update public.situations set checks = $2 where id = $1", [fx.car.id, JSON.stringify(checks(4))]), /situations_checks_shape/);
  await assert.rejects(
    db.query("update public.situations set checks = $2, visible = true, reviewer_id = $3, reviewed_at = now() where id = $1", [fx.car.id, JSON.stringify(checks(2)), u.reviewer.personId]),
    /situations_publish_ready/,
  );
  // 주소가 겹치면 DB 오류 문장을 그대로 409로
  const dup = await create("car");
  assert.equal(dup.status, 409, show(dup));
  assert.match(dup.body.error, /같은 주소\(slug\)의 상황이 이미 있습니다/);
});

test("API 감수 서명 — 세무 감수위원만(편집자·기자 403 + 감사 로그 review.tax_review.denied), 낡은 판 409, 서명 뒤 감수 기록과 감사 로그", async () => {
  const target = `situations:${fx.car.id}`;
  for (const who of [u.editor, u.reporter]) {
    const denied = await signOff(fx.car.id, who);
    assert.equal(denied.status, 403, `${who.roles[0]}: ${show(denied)}`);
    assert.equal(await auditCount(who.id, "review.tax_review.denied", target), 1, "거부도 감사 로그에 남는다");
  }
  assert.equal((await row(fx.car.id)).reviewer_id, null);
  const stale = await api("POST", `/situations/${fx.car.id}/review`, u.reviewer, { updatedAt: "2020-01-01T00:00:00Z" });
  assert.equal(stale.status, 409, "감수위원이 읽은 뒤 바뀐 판에는 서명하지 않는다");
  const ok = await signOff(fx.car.id);
  assert.equal(ok.status, 200, show(ok));
  assert.equal(ok.body.situation.review.by, "상황 시험 감수위원");
  const after = await row(fx.car.id);
  assert.equal(Number(after.reviewer_id), u.reviewer.personId);
  assert.ok(after.reviewed_at);
  const audit = await lastAudit(u.reviewer.id, "situation.review", target);
  assert.equal(audit.after.checks.length, 3, "감사 로그에 감수한 문장이 남는다");
});

test("API 공개 — 편집 책임자만(기자·editor 없는 관리자 403 + 감사 로그), 감수 전 409, 공개하면 상황 페이지가 바로 200 · 내리면 바로 404", async () => {
  const target = `situations:${fx.car.id}`;
  const path = `/situations/e2e-sit-car-${staff.run}`;
  assert.equal((await publicPage(path)).status, 404, "공개 전 404");
  for (const who of [u.reporter, u.admin]) {
    const denied = await api("PATCH", `/situations/${fx.car.id}`, who, { visible: true });
    assert.equal(denied.status, 403, show(denied));
    assert.equal(await auditCount(who.id, "situation.publish.denied", target), 1);
  }
  const unreviewed = await api("PATCH", `/situations/${fx.reporterDraft.id}`, u.editor, { visible: true });
  assert.equal(unreviewed.status, 409, show(unreviewed));
  assert.match(unreviewed.body.error, /세무 감수 서명이 있어야/);

  const pub = await api("PATCH", `/situations/${fx.car.id}`, u.editor, { visible: true });
  assert.equal(pub.status, 200, show(pub));
  assert.equal(await auditCount(u.editor.id, "situation.publish", target), 1);
  let page = await publicPage(path);
  assert.equal(page.status, 200, "저장 뒤 바로 공개 (30초 캐시를 기다리지 않는다)");
  assert.match(page.html, /차를 팔았어요·폐차했어요/);

  // 제목만 고치면 감수 기록은 그대로, 공개 화면은 바로 새 제목
  const retitle = await api("PATCH", `/situations/${fx.car.id}`, u.editor, { title: "차를 팔았어요" });
  assert.equal(retitle.status, 200, show(retitle));
  assert.equal(retitle.body.reviewCleared, false);
  page = await publicPage(path);
  assert.match(page.html, /<h1[^>]*>.*차를 팔았어요<\/span>/s);
  assert.doesNotMatch(page.html, /차를 팔았어요·폐차했어요/);

  // 공개 중에는 감수 대상 문장을 고칠 수 없다 (409 — 바뀜 0)
  const locked = await api("PATCH", `/situations/${fx.car.id}`, u.editor, { checks: [{ title: "바뀐 확인" }, { title: "b" }, { title: "c" }] });
  assert.equal(locked.status, 409, show(locked));
  assert.match(locked.body.error, /먼저 내린 뒤 고치고/);
  assert.equal((await row(fx.car.id)).checks[0].title, "확인할 것 1");

  const down = await api("PATCH", `/situations/${fx.car.id}`, u.editor, { visible: false });
  assert.equal(down.status, 200);
  assert.equal(await auditCount(u.editor.id, "situation.unpublish", target), 1);
  assert.equal((await publicPage(path)).status, 404, "내리면 바로 404");
});

test("API 고치기 — 내린 상황의 감수 대상 문장을 고치면 감수 기록이 지워진다(reviewCleared · 감사 로그 전후), 다시 감수해야 공개", async () => {
  const target = `situations:${fx.car.id}`;
  const same = await api("PATCH", `/situations/${fx.car.id}`, u.editor, { checks: checks(3), mistakes: ["판 날이 아니라 말소일 기준입니다"], checklist: null });
  assert.equal(same.status, 200, show(same));
  assert.equal(same.body.reviewCleared, false, "같은 문장을 다시 보내면 감수 기록이 남는다");
  const edit = await api("PATCH", `/situations/${fx.car.id}`, u.reporter, { mistakes: ["등록 말소일을 먼저 확인하세요"] });
  assert.equal(edit.status, 200, show(edit));
  assert.equal(edit.body.reviewCleared, true);
  assert.equal(edit.body.situation.review, null);
  const r = await row(fx.car.id);
  assert.deepEqual([r.reviewer_id, r.reviewed_at], [null, null]);
  const audit = await lastAudit(u.reporter.id, "situation.update", target);
  assert.ok(audit.before.reviewed_at && audit.after.reviewed_at === null, "감사 로그에 감수 기록이 지워진 전후");
  assert.match(audit.reason, /감수 기록이 지워짐/);
  const pub = await api("PATCH", `/situations/${fx.car.id}`, u.editor, { visible: true });
  assert.equal(pub.status, 409, "다시 감수 전에는 공개 0");
  for (const bad of [{ checks: checks(4) }, { checks: checks(2) }, { slug: "new-slug" }, { mistakes: ["a", "b", "c", "d"] }]) {
    const res = await api("PATCH", `/situations/${fx.car.id}`, u.editor, bad);
    assert.equal(res.status, 422, `${JSON.stringify(bad)}: ${show(res)}`);
  }
  assert.equal((await api("PATCH", `/situations/${fx.car.id}`, u.adOps, { title: "x" })).status, 403);
  assert.equal((await api("PATCH", `/situations/${fx.car.id}`, u.reviewer, { title: "x" })).status, 403, "감수위원은 문장을 고치지 못한다");
});

test("API 허브 — 상한 4에서 5번째 카드 409(DB 트리거도 거부), 허브 순서 바꾸기는 바로 공개 허브에, 기자 순서 403 + 감사", async () => {
  fx.hub = [];
  for (let i = 1; i <= 5; i++) {
    const r = await create(`hub${i}`, { section: "finance", title: `금융 상황 ${i}`, pictogram: "trust-property" });
    assert.equal(r.status, 201, show(r));
    assert.equal((await signOff(r.body.situation.id)).status, 200);
    assert.equal((await api("PATCH", `/situations/${r.body.situation.id}`, u.editor, { visible: true })).status, 200);
    fx.hub.push(r.body.situation.id);
  }
  for (const [i, id] of fx.hub.slice(0, 4).entries()) {
    const r = await api("PATCH", `/situations/${id}`, u.editor, { hubSlot: i + 1 });
    assert.equal(r.status, 200, show(r));
    assert.equal(await auditCount(u.editor.id, "situation.hub", `situations:${id}`), 1);
  }
  const fifth = fx.hub[4];
  for (const slot of [5, 2]) {
    const r = await api("PATCH", `/situations/${fifth}`, u.editor, { hubSlot: slot });
    assert.equal(r.status, 409, `자리 ${slot}: ${show(r)}`);
    assert.match(r.body.error, /4장까지.*5번째/);
  }
  assert.equal((await row(fifth)).hub_slot, null);
  await assert.rejects(db.query("update public.situations set hub_slot = 5 where id = $1", [fifth]), /4장까지/, "직접 SQL로도 5번 자리는 거부 (DB 트리거)");
  const list = await api("GET", "/situations", u.editor);
  assert.equal(list.body.limit, 4);
  assert.deepEqual(list.body.hubs.finance.map((h) => h.id), fx.hub.slice(0, 4));

  const hubOrder = async () => {
    const { html } = await publicPage("/finance");
    return [...html.matchAll(/data-situation-slug="([^"]+)"/g)].map((m) => m[1]);
  };
  const slugs = fx.hub.map((_, i) => `e2e-sit-hub${i + 1}-${staff.run}`);
  assert.deepEqual(await hubOrder(), slugs.slice(0, 4), "공개 허브 — 4장, 자리 순");
  const reversed = [...fx.hub.slice(0, 4)].reverse();
  assert.equal((await api("POST", "/situations/order", u.reporter, { section: "finance", ids: reversed })).status, 403);
  assert.equal(await auditCount(u.reporter.id, "situation.publish.denied", "situations:order:finance"), 1);
  assert.equal((await api("POST", "/situations/order", u.editor, { section: "finance", ids: reversed.slice(0, 3) })).status, 422, "허브 카드 전부를 보내야 한다");
  const ordered = await api("POST", "/situations/order", u.editor, { section: "finance", ids: reversed });
  assert.equal(ordered.status, 200, show(ordered));
  assert.deepEqual(ordered.body.order, reversed);
  assert.equal(await auditCount(u.editor.id, "situation.reorder", "situations:order:finance"), 1);
  assert.deepEqual(await hubOrder(), slugs.slice(0, 4).reverse(), "순서를 바꾸면 바로 공개 허브에 (배포 없이)");

  // 허브에 놓인 상황의 분야를 바꾸려면 먼저 빼야 한다 · 빼면 5번째가 들어갈 자리가 생긴다
  const move = await api("PATCH", `/situations/${fx.hub[0]}`, u.editor, { section: "tax" });
  assert.equal(move.status, 409, show(move));
  assert.equal((await api("PATCH", `/situations/${fx.hub[0]}`, u.editor, { hubSlot: null })).status, 200);
  // 순서를 뒤집어 hub[0]은 4번 자리였다 — 그 자리가 비었다
  const now = await api("PATCH", `/situations/${fifth}`, u.editor, { hubSlot: 4 });
  assert.equal(now.status, 200, show(now));
});

// ── 화면 ───────────────────────────────────────────────

async function interactive(page) {
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^(로그아웃|로그인)$/.test(b.textContent.trim()) && !b.disabled));
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

async function open(page, path) {
  const res = await page.goto(`${base}${path}`);
  await interactive(page);
  return res;
}

const menuLabels = (page) => page.locator('nav[aria-label="편집국 메뉴"] a').allInnerTexts();

test("화면 — 편집자: 먼저 확인할 것 2·4개면 API를 부르지 않고 칸 오류, 3개면 만들어진다 / 주소 중복은 서버(DB) 문장을 보인다", async () => {
  const page = await login(u.editor);
  assert.ok((await menuLabels(page)).includes("상황 카드"));
  const calls = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === "/api/admin/situations" && req.method() === "POST") calls.push(req.method());
  });
  assert.equal((await open(page, "/admin/situations")).status(), 200);
  await page.getByRole("link", { name: "상황 카드 만들기" }).click();
  await page.waitForURL("**/admin/situations/new");
  await interactive(page);
  const slug = `e2e-sit-ui-${staff.run}`;
  await page.fill("#situation-slug", slug);
  await page.selectOption("#situation-section", "realestate");
  await page.fill("#situation-title", "집을 샀어요");
  await page.fill("#situation-subtitle", "취득세 신고 전에 확인할 것");
  await page.locator('[data-pictogram-option="home-bought"]').click();
  for (let i = 0; i < 3; i++) await page.fill(`#situation-check-${i}-title`, `화면 확인 ${i + 1}`);
  const groupError = page.locator("#situation-checks-error");

  await page.getByRole("button", { name: "확인할 것 3 빼기" }).click();
  await page.getByRole("button", { name: "상황 카드 만들기" }).click();
  assert.equal(await groupError.textContent(), "먼저 확인할 것은 정확히 3개여야 합니다 — 지금 2개입니다");
  await page.getByRole("button", { name: "확인할 것 더하기" }).click();
  await page.getByRole("button", { name: "확인할 것 더하기" }).click();
  for (let i = 2; i < 4; i++) await page.fill(`#situation-check-${i}-title`, `화면 확인 ${i + 1}`);
  await page.getByRole("button", { name: "상황 카드 만들기" }).click();
  assert.equal(await groupError.textContent(), "먼저 확인할 것은 정확히 3개여야 합니다 — 지금 4개입니다");
  assert.deepEqual(calls, [], "2·4개는 서버에 보내지 않는다");

  await page.getByRole("button", { name: "확인할 것 4 빼기" }).click();
  await page.getByRole("button", { name: "상황 카드 만들기" }).click();
  await page.waitForURL(/\/admin\/situations\/\d+\?created=1$/);
  await interactive(page);
  fx.uiId = Number(new URL(page.url()).pathname.split("/").pop());
  staff.trackRow("situations", fx.uiId);
  assert.equal(calls.length, 1);
  assert.equal(await page.getByTestId("situation-review").textContent(), "감수 전");
  const saved = await row(fx.uiId);
  assert.deepEqual([saved.section, saved.pictogram, saved.visible, saved.checks.map((c) => c.title)], ["realestate", "home-bought", false, ["화면 확인 1", "화면 확인 2", "화면 확인 3"]]);
  assert.equal(await page.getByRole("form", { name: "상황 카드 고치기" }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "감수 서명" }).count(), 0, "편집자에게 감수 서명 단추 0");

  // 같은 주소로 또 만들면 — 화면 검사는 통과, DB가 거부한 문장을 보인다
  await open(page, "/admin/situations/new");
  await page.fill("#situation-slug", slug);
  await page.selectOption("#situation-section", "tax");
  await page.fill("#situation-title", "같은 주소");
  await page.locator('[data-pictogram-option="notice-received"]').click();
  for (let i = 0; i < 3; i++) await page.fill(`#situation-check-${i}-title`, `확인 ${i + 1}`);
  await page.getByRole("button", { name: "상황 카드 만들기" }).click();
  await page.getByRole("alert").filter({ hasText: "같은 주소(slug)의 상황이 이미 있습니다" }).waitFor();
  assert.equal(calls.length, 2);
});

test("화면 — 감수위원 서명 → 편집자 공개(공개 화면 바로) → 내리고 문장을 고치면 '감수 기록이 지워졌습니다'", async () => {
  const reviewer = await login(u.reviewer);
  assert.ok((await menuLabels(reviewer)).includes("상황 카드"));
  await open(reviewer, `/admin/situations/${fx.uiId}`);
  assert.deepEqual(await reviewer.getByTestId("review-checks").locator("li").allInnerTexts(), ["화면 확인 1", "화면 확인 2", "화면 확인 3"]);
  assert.equal(await reviewer.getByRole("form", { name: "상황 카드 고치기" }).count(), 0, "감수위원에게 고치기 폼 0");
  await reviewer.getByRole("button", { name: "감수 서명" }).click();
  await reviewer.getByRole("status").filter({ hasText: "감수 서명을 남겼습니다" }).waitFor();
  await reviewer.getByTestId("situation-review").filter({ hasText: "상황 시험 감수위원" }).waitFor();

  const editor = await login(u.editor);
  await open(editor, "/admin/situations");
  const card = editor.getByTestId(`situation-${fx.uiId}`);
  await card.getByRole("button", { name: "집을 샀어요 공개하기" }).click();
  await card.getByRole("status").filter({ hasText: "공개했습니다" }).waitFor();
  const path = `/situations/e2e-sit-ui-${staff.run}`;
  assert.equal((await publicPage(path)).status, 200, "공개하면 바로 상황 페이지");

  await editor.getByTestId(`situation-${fx.uiId}`).getByRole("button", { name: "집을 샀어요 내리기" }).click();
  await editor.getByTestId(`situation-${fx.uiId}`).getByRole("status").filter({ hasText: "내렸습니다" }).waitFor();
  await open(editor, `/admin/situations/${fx.uiId}`);
  assert.match(await editor.getByTestId("review-warning").textContent(), /감수 기록이 지워져/);
  await editor.fill("#situation-check-1-title", "화면 확인 2 — 고침");
  await editor.getByRole("button", { name: "저장" }).click();
  await editor.getByRole("status").filter({ hasText: "감수 기록이 지워졌습니다" }).waitFor();
  await editor.getByTestId("situation-review").filter({ hasText: "감수 전" }).waitFor();
  assert.equal((await row(fx.uiId)).reviewer_id, null);
});

test("화면 — 허브가 찬 분야의 [허브에 넣기]는 꺼지고 사유를 보인다, 기자에게 공개 단추 0, 광고 담당 403, 360px 가로 스크롤 0", async () => {
  // 앞 API 시험: 개발금융 허브 4장(5번째를 넣으려고 1장을 뺐다) — 뺀 상황이 허브 밖에 있다
  const editor = await login(u.editor);
  await open(editor, "/admin/situations");
  assert.equal(await editor.getByTestId("hub-count-finance").textContent(), "4/4");
  const outside = editor.getByTestId(`situation-${fx.hub[0]}`);
  assert.equal(await outside.getByRole("button", { name: "금융 상황 1 허브에 넣기" }).isDisabled(), true);
  assert.match(await editor.getByTestId(`hub-full-${fx.hub[0]}`).textContent(), /4장 있습니다 — 5번째는 넣을 수 없습니다/);

  const reporter = await login(u.reporter);
  assert.deepEqual(await menuLabels(reporter), ["첫 화면", "기사 기획", "기사", "상황 카드"]);
  await open(reporter, "/admin/situations");
  assert.equal(await reporter.getByRole("button", { name: /공개하기|허브에 넣기|내리기/ }).count(), 0, "기자에게 공개·허브 단추 0");
  assert.equal(await reporter.getByRole("link", { name: "상황 카드 만들기" }).count(), 1);

  const ad = await login(u.adOps);
  assert.ok(!(await menuLabels(ad)).includes("상황 카드"));
  for (const p of ["/admin/situations", "/admin/situations/new", `/admin/situations/${fx.uiId}`]) assert.equal((await open(ad, p)).status(), 403, p);

  const narrow = await login(u.editor, { width: 360, height: 740 });
  for (const p of ["/admin/situations", "/admin/situations/new", `/admin/situations/${fx.uiId}`]) {
    await open(narrow, p);
    assert.ok((await narrow.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${p}: 360px 가로 스크롤`);
  }
});

test("시험 동안 예상 못 한 서버 오류가 없었다", () => {
  assert.doesNotMatch(server.log(), /\[api\] 처리 중 오류|\[public\]|\[db\]/);
});
