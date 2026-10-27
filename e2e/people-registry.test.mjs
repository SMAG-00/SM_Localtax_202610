// 기자·기고자 등록부 E2E (F2 · NAV-19) — docs/dev/F2_설계.md
// standalone 빌드를 로컬 Supabase에 붙인다.
//  a) 등록 — 관리자가 인물을 등록(201·registered_at 서버 기록·감사) / 기자·편집 책임자 403(거부 감사) / 입력 오류 422 / 같은 slug 409
//  b) 연결 — 인물이 연결되지 않은 기자는 기사 생성 409(등록부 안내 문구) → 계정 연결 200 → 같은 계정을 다른 인물에 연결 409 → 해제·재연결
//  c) 기사 — 연결된 계정으로 기사 생성 201 → 굵게·표 칸 링크·안내 상자 링크가 공개 화면에 그려진다(javascript: 링크는 글자 그대로)
//  d) 화면 — /admin/people 에서 인물을 등록하고 계정을 연결하며, 360px에서 가로 스크롤 0
// 만든 계정·인물·기사·감사 로그는 끝나면 지운다. 공개 데이터 캐시(30초) 때문에 기사를 만든 뒤 서버를 다시 띄운다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "admin-people-e2e@example.test";
const SITE = "https://e2e.example.test";
let sb, server, staff, db, base, browser;
const u = {};
const fx = {};
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

async function startAll() {
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
  });
  base = server.base;
}
async function restart() {
  await server?.stop?.();
  await startAll();
}
async function call(method, path, user, json) {
  const headers = {};
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (json !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api${path}`, { method, headers, body: json !== undefined ? JSON.stringify(json) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const show = (r) => JSON.stringify(r.body).slice(0, 1200);
const auditCount = async (userId, action, target) => (await one("select count(*)::int n from public.audit_logs where actor = $1 and action = $2 and target = $3", [`user:${userId}`, action, target])).n;
const slugOf = (s) => `e2e-people-${s}-${staff.run}`.toLowerCase();

before(async () => {
  sb = localSupabase();
  buildWeb();
  await startAll();
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  u.reporter = await staff.createUser({ label: "people-rep", roles: ["reporter"] }); // 인물 없는 기자 계정
  u.editor = await staff.createUser({ label: "people-ed", roles: ["editor"], person: { name: "등록부 편집자", roles: ["editor"] } });
  u.other = await staff.createUser({ label: "people-other", roles: ["reporter"] });
  u.admin = await staff.createUser({ label: "people-admin", email: ADMIN_EMAIL });
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

test("a) 관리자 등록 201(registered_at 서버 기록·감사) · 기자·편집 책임자 403 · 입력 오류 422 · 같은 slug 409", async () => {
  const body = { name: "등록부 기자", slug: slugOf("rep"), roles: ["reporter", "writer"], employment: "staff", affiliation: "편집국", beat: "취득세", conflicts: "없음", visibility: "public" };
  const r = await call("POST", "/admin/people", u.admin, { ...body, registered_at: "2001-01-01T00:00:00Z" });
  assert.equal(r.status, 422, "registered_at은 받지 않는다 — " + show(r));
  const ok = await call("POST", "/admin/people", u.admin, body);
  assert.equal(ok.status, 201, show(ok));
  const p = ok.body.person;
  fx.person = p;
  staff.personIds.add(Number(p.id));
  assert.equal(p.name, "등록부 기자");
  assert.deepEqual(p.roles.sort(), ["reporter", "writer"]);
  assert.equal(p.staff_user_id, null);
  assert.ok(Date.now() - new Date(p.registered_at).getTime() < 5 * 60_000, "registered_at은 서버가 지금으로 정한다");
  assert.equal(await auditCount(u.admin.id, "people.create", `people:${p.id}`), 1);

  for (const user of [u.reporter, u.editor]) {
    const denied = await call("POST", "/admin/people", user, { ...body, slug: slugOf("denied") });
    assert.equal(denied.status, 403, show(denied));
  }
  assert.equal(await auditCount(u.reporter.id, "people.manage.denied", "people:new"), 1);
  assert.equal((await call("GET", "/admin/people", u.editor)).status, 403);
  assert.equal((await call("POST", "/admin/people", null, body)).status, 401);

  const bad = await call("POST", "/admin/people", u.admin, { name: " ", slug: "Bad Slug", roles: ["boss"], visibility: "secret" });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.errors.length >= 4, show(bad));
  const bio = await call("POST", "/admin/people", u.admin, { ...body, slug: slugOf("bio"), bio_items: [] });
  assert.equal(bio.status, 422, "약력은 브랜드 관리 화면의 몫");
  const dup = await call("POST", "/admin/people", u.admin, body);
  assert.equal(dup.status, 409, show(dup));
  assert.match(dup.body.error, /slug/);

  const list = await call("GET", "/admin/people", u.admin);
  assert.equal(list.status, 200);
  const row = list.body.people.find((x) => x.id === p.id);
  assert.ok(row && typeof row.id === "number");
  assert.ok(!("bio_items" in row) && !("consent_doc_version" in row), "약력·동의 칸은 등록부 응답에 없다");
});

test("b) 인물 없는 계정의 기사 생성 409(등록부 안내) → 연결 200 → 같은 계정 두 번째 인물 409 → 해제·재연결", async () => {
  const article = { slug: slugOf("art"), title: `등록부 시험 기사 ${staff.run}`, summary: "굵게와 표 칸 링크를 그립니다.", section: "tax", contentType: "explainer" };
  const before = await call("POST", "/admin/articles", u.reporter, article);
  assert.equal(before.status, 409, show(before));
  assert.match(before.body.error, /\/admin\/people/, "등록부 경로 안내");

  const id = fx.person.id;
  const linked = await call("PATCH", `/admin/people/${id}`, u.admin, { staff_user_id: u.reporter.id });
  assert.equal(linked.status, 200, show(linked));
  assert.equal(linked.body.person.staff_user_id, u.reporter.id);
  assert.equal(await auditCount(u.admin.id, "people.link_account", `people:${id}`), 1);

  const second = await call("POST", "/admin/people", u.admin, { name: "둘째 인물", slug: slugOf("second"), roles: ["writer"], employment: "external" });
  assert.equal(second.status, 201, show(second));
  staff.personIds.add(Number(second.body.person.id));
  const clash = await call("PATCH", `/admin/people/${second.body.person.id}`, u.admin, { staff_user_id: u.reporter.id });
  assert.equal(clash.status, 409, show(clash));
  assert.match(clash.body.error, /이미 다른 인물/);
  assert.equal((await one("select staff_user_id from public.people where id = $1", [second.body.person.id])).staff_user_id, null);

  const noAccount = await call("PATCH", `/admin/people/${second.body.person.id}`, u.admin, { staff_user_id: "00000000-0000-4000-8000-000000000000" });
  assert.ok([409, 422].includes(noAccount.status), show(noAccount));
  assert.equal((await call("PATCH", `/admin/people/${id}`, u.admin, { staff_user_id: "not-a-uuid" })).status, 422);
  assert.equal((await call("PATCH", `/admin/people/${id}`, u.admin, {})).status, 422);
  assert.equal((await call("PATCH", `/admin/people/999999999`, u.admin, { beat: "x" })).status, 404);

  const unlinked = await call("PATCH", `/admin/people/${id}`, u.admin, { staff_user_id: null });
  assert.equal(unlinked.status, 200);
  assert.equal(unlinked.body.person.staff_user_id, null);
  assert.equal(await auditCount(u.admin.id, "people.unlink_account", `people:${id}`), 1);
  assert.equal((await call("POST", "/admin/articles", u.reporter, article)).status, 409, "해제하면 다시 막힌다");
  assert.equal((await call("PATCH", `/admin/people/${id}`, u.admin, { staff_user_id: u.reporter.id })).status, 200);

  const edited = await call("PATCH", `/admin/people/${id}`, u.admin, { beat: "재산세", visibility: "public" });
  assert.equal(edited.status, 200, show(edited));
  assert.equal(edited.body.person.beat, "재산세");
  assert.equal(edited.body.person.staff_user_id, u.reporter.id, "보내지 않은 칸은 그대로");
  assert.equal(await auditCount(u.admin.id, "people.update", `people:${id}`), 1);
});

test("c) 연결된 계정으로 기사 201 → 굵게·표 칸 링크·상자 링크가 공개 화면에 그려지고 javascript: 는 링크가 되지 않는다", async () => {
  await staff.addTestConsent(Number(fx.person.id));
  const slug = slugOf("art");
  const url = "https://commons.wikimedia.org/wiki/File:Government_Complex_Sejong_(N).jpg";
  const blocks = [
    { type: "paragraph", text: "취득세 **굵은 안내**와 [법령정보](https://www.law.go.kr/a) 입니다." },
    { type: "table", caption: "시험 표", rows: [["항목", "출처"], ["**굵은 칸**", `[사진](${url})`], ["위험", "[나쁜](javascript:alert(1))"]] },
    { type: "callout", kind: "tip", title: "", text: "상자 안 **굵게** 와 [내부](/news) 링크" },
  ];
  const r = await call("POST", "/admin/articles", u.reporter, { slug, title: `등록부 시험 기사 ${staff.run}`, summary: "굵게와 표 칸 링크를 그립니다.", section: "tax", contentType: "explainer", body: { blocks, claims: [] } });
  assert.equal(r.status, 201, show(r));
  staff.trackArticle(r.body.article.id);
  assert.equal((await one("select author_id from public.articles where id = $1", [r.body.article.id])).author_id, String(fx.person.id), "작성자는 연결된 인물");
  await db.query("update public.articles set status = 'published', first_published_at = now() - interval '1 day' where id = $1", [r.body.article.id]);
  await restart();
  const res = await fetch(`${base}/news/${slug}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<strong>(?:<span>)?굵은 안내(?:<\/span>)?<\/strong>/);
  assert.match(html, /<td[^>]*><strong>굵은 칸<\/strong><\/td>/);
  assert.match(html, /<strong>(?:<span>)?굵게(?:<\/span>)?<\/strong>/);
  const tableLink = html.match(/<a [^>]*>[^<]*사진[^<]*(?:<span[^>]*>[^<]*<\/span>)?<\/a>/)?.[0] ?? "";
  assert.ok(tableLink.includes(`href="${url}"`), "괄호가 든 주소가 끝까지 링크: " + tableLink);
  assert.ok(tableLink.includes('target="_blank"') && tableLink.includes('rel="noopener noreferrer"'), tableLink);
  assert.ok(!/href="javascript:/i.test(html), "javascript: 링크 0");
  assert.ok(!html.includes("**"), "별표 표기가 글자로 남지 않는다");
});

test("d) /admin/people 화면 — 등록 폼으로 인물을 만들고 계정을 연결하며 360px 가로 스크롤 0", async () => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
  try {
    const page = await context.newPage();
    await page.goto(`${base}/admin/login?next=${encodeURIComponent("/admin/people")}`);
    await page.fill("#login-email", u.admin.email);
    await page.fill("#login-password", u.admin.password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL((url) => url.pathname === "/admin/people");
    await page.waitForFunction(() => !document.querySelector('form[aria-label="인물 등록"] button[type="submit"]')?.disabled);
    await page.fill("#person-new-name", "화면 등록 기자");
    await page.fill("#person-new-slug", slugOf("ui"));
    await page.getByLabel("기자", { exact: true }).check();
    await page.getByRole("button", { name: "인물 등록" }).click();
    await page.getByText("인물을 등록했습니다").waitFor();
    const row = await one("select id, visibility, roles from public.people where slug = $1", [slugOf("ui")]);
    assert.ok(row, "화면에서 등록한 인물이 저장됐다");
    staff.personIds.add(Number(row.id));
    assert.equal(row.visibility, "hidden", "기본은 비공개");
    assert.deepEqual(row.roles, ["reporter"]);

    await page.getByTestId(`person-${row.id}`).waitFor();
    await page.locator(`#person-${row.id}-account`).selectOption({ label: u.other.email });
    await page.getByRole("button", { name: "화면 등록 기자 계정 연결" }).click();
    await page.getByTestId(`person-${row.id}`).getByTestId("person-linked").waitFor();
    assert.equal((await one("select staff_user_id from public.people where id = $1", [row.id])).staff_user_id, u.other.id);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    assert.ok(scrollWidth <= clientWidth, `가로 스크롤 ${scrollWidth} > ${clientWidth}`);
  } finally {
    await context.close();
  }
});
