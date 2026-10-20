// 백오피스 회원 탭·회원 삭제 E2E (W2-e 3-B — docs/dev/W2-e_설계.md 5.3 · 9.3 · 4.4)
//  a) 회원 탭에는 역할·인물이 없는 계정만 / 칸(가입일·마지막 로그인·이메일 확인·정지·관심 분야 수·관심 지역 수·수신 동의) 값이 DB와 같다
//  b) 이메일 일부 검색: 회원은 찾고, 편집국 계정은 회원 탭에서 찾지 못한다
//  c) 정지(API) → 회원 탭에 정지됨
//  d) 삭제: 사유 없음 422(화면은 사유 안내)·편집 책임자 403 + 감사 로그 member.delete.denied·역할 있는 계정 409·없는 계정 404 — 모두 행 그대로
//  e) 화면에서 사유를 적고 [삭제] → profiles·consents·Auth 0 + 감사 로그 member.delete 1건(대상 user:<uuid>, 이메일 0)
//  f) 360px 가로 스크롤 0
//  g) proxy: 로그인 쿠키 없이 /my·/my/withdraw → /login?next=…, /account/password → /admin/login?next=…
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e.example.test";
const ADMIN_EMAIL = "admin-members-e2e@example.test";

let sb, server, staff, db, browser, base, page;
const u = {};
const contexts = [];

const one = async (sql, params) => (await db.query(sql, params)).rows[0];

async function api(method, path, user, body) {
  const res = await fetch(`${base}/api/admin${path}`, {
    method,
    headers: { authorization: `Bearer ${user.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const counts = async (id) => ({
  profiles: (await one("select count(*)::int n from public.profiles where id = $1", [id])).n,
  consents: (await one("select count(*)::int n from public.consents where user_id = $1", [id])).n,
  auth: (await one("select count(*)::int n from auth.users where id = $1", [id])).n,
});
const auditCount = async (action, target) => (await one("select count(*)::int n from public.audit_logs where action = $1 and target = $2", [action, target])).n;

async function interactive(p) {
  await p.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^(로그아웃|로그인)$/.test(b.textContent.trim()) && !b.disabled));
}
const openMembers = async (query = "") => {
  const res = await page.goto(`${base}/admin/members?tab=member${query}`);
  await interactive(page);
  return res;
};
const emailsOnPage = () => page.locator('[data-testid="member-email"]').allInnerTexts();

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
  u.reporter = await staff.createUser({ label: "mem-reporter", roles: ["reporter"], person: { name: "회원탭 기자", roles: ["reporter"] } });
  u.editor = await staff.createUser({ label: "mem-editor", roles: ["editor"], person: { name: "회원탭 편집자", roles: ["editor"] } });
  u.admin = await staff.createUser({ label: "mem-admin", email: ADMIN_EMAIL });
  // 일반 회원 둘 — A는 관심 분야 2·관심 지역 1·수신 동의(철회 안 됨) 1, B는 기본값
  u.a = await staff.createUser({ label: "regm-a" });
  u.b = await staff.createUser({ label: "regm-b" });
  const regions = (await db.query("select code from public.regions where level = 'sido' and (valid_from is null or valid_from <= current_date) and (valid_to is null or valid_to >= current_date) order by code limit 1")).rows;
  assert.equal(regions.length, 1, "시험용 시·도 코드가 있어야 한다");
  await db.query(
    "insert into public.profiles (id, interests, interest_region_codes) values ($1, $2, $3) on conflict (id) do update set interests = excluded.interests, interest_region_codes = excluded.interest_region_codes",
    [u.a.id, ["tax", "local"], [regions[0].code]],
  );
  await db.query("insert into public.profiles (id) values ($1) on conflict (id) do nothing", [u.b.id]);
  await db.query("insert into public.consents (user_id, kind, channel, confirmed_at) values ($1, 'receive', 'web_my', now())", [u.a.id]);

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  contexts.push(context);
  page = await context.newPage();
  await page.goto(`${base}/admin/login`);
  await interactive(page);
  await page.fill("#login-email", u.admin.email);
  await page.fill("#login-password", u.admin.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((url) => url.pathname !== "/admin/login");
  await interactive(page);
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

test("a) 회원 탭에는 역할·인물이 없는 계정만, 칸 값이 DB와 같다", async () => {
  assert.equal((await openMembers()).status(), 200);
  const emails = await emailsOnPage();
  assert.ok(emails.includes(u.a.email) && emails.includes(u.b.email), "일반 회원 둘이 보인다");
  for (const staffUser of [u.reporter, u.editor]) assert.ok(!emails.includes(staffUser.email), `편집국 계정 ${staffUser.email}은 회원 탭에 없다`);
  assert.ok(emails.length <= 50, "한 쪽은 50명 이하");

  const rowA = page.getByTestId(`member-${u.a.id}`);
  assert.equal(await rowA.locator('[data-field="interests"]').innerText(), "2개");
  assert.equal(await rowA.locator('[data-field="regions"]').innerText(), "1개");
  assert.equal(await rowA.locator('[data-field="consents"]').innerText(), "수신");
  assert.equal(await rowA.locator('[data-field="confirmed"]').innerText(), "확인됨");
  assert.equal(await rowA.locator('[data-field="suspended"]').innerText(), "아니오");
  const rowB = page.getByTestId(`member-${u.b.id}`);
  assert.equal(await rowB.locator('[data-field="interests"]').innerText(), "0개");
  assert.equal(await rowB.locator('[data-field="regions"]').innerText(), "0개");
  assert.equal(await rowB.locator('[data-field="consents"]').innerText(), "없음");

  // 편집국 탭(기본)에는 역할 있는 계정이 보이고 일반 회원은 없다
  await page.goto(`${base}/admin/members`);
  await interactive(page);
  const staffEmails = await emailsOnPage();
  assert.ok(staffEmails.includes(u.editor.email) && staffEmails.includes(u.reporter.email));
  assert.ok(!staffEmails.includes(u.a.email));
});

test("b) 이메일 일부 검색 — 회원은 찾고 편집국 계정은 회원 탭에서 못 찾는다 / 한 글자 검색어는 안내", async () => {
  await openMembers(`&q=${encodeURIComponent(`regm-a-${staff.run}`)}`);
  assert.deepEqual(await emailsOnPage(), [u.a.email]);
  await openMembers(`&q=${encodeURIComponent(`mem-editor-${staff.run}`)}`);
  assert.deepEqual(await emailsOnPage(), []);
  await page.getByText("맞는 회원이 없습니다.").waitFor();
  await openMembers("&q=a");
  await page.getByText("공백·쉼표 없이 2~100자로 적어 주세요").waitFor();
  assert.deepEqual(await emailsOnPage(), []);
});

test("c) 정지 API 뒤 회원 탭에 정지됨으로 보인다 (정지 규칙은 그대로)", async () => {
  const res = await api("POST", `/members/${u.b.id}/suspension`, u.admin, { suspend: true, reason: "회원 탭 시험" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  await openMembers();
  const row = page.getByTestId(`member-${u.b.id}`);
  assert.equal(await row.locator('[data-field="suspended"]').innerText(), "정지됨");
  assert.equal(await page.getByTestId(`member-${u.a.id}`).locator('[data-field="suspended"]').innerText(), "아니오");
});

test("d) 삭제 거부 — 사유 없음 422·편집 책임자 403(+감사 로그)·역할 있는 계정 409·없는 계정 404, 행은 그대로", async () => {
  const before = await counts(u.a.id);
  assert.deepEqual(before, { profiles: 1, consents: 1, auth: 1 });

  for (const body of [{}, { reason: "   " }, { reason: "x".repeat(501) }, { reason: "정상", extra: 1 }]) {
    const r = await api("DELETE", `/members/${u.a.id}`, u.admin, body);
    assert.equal(r.status, 422, JSON.stringify(body).slice(0, 40));
  }
  const forbidden = await api("DELETE", `/members/${u.a.id}`, u.editor, { reason: "권한 없음 시험" });
  assert.equal(forbidden.status, 403);
  assert.equal(await auditCount("member.delete.denied", `user:${u.a.id}`), 1, "거부 감사 로그 1건");

  const roleHolder = await api("DELETE", `/members/${u.editor.id}`, u.admin, { reason: "역할 있는 계정" });
  assert.equal(roleHolder.status, 409, JSON.stringify(roleHolder.body));
  const self = await api("DELETE", `/members/${u.admin.id}`, u.admin, { reason: "자기 계정" });
  assert.equal(self.status, 409);
  const missing = await api("DELETE", `/members/00000000-0000-4000-8000-000000000000`, u.admin, { reason: "없는 계정" });
  assert.equal(missing.status, 404);

  assert.deepEqual(await counts(u.a.id), before, "회원 A는 그대로");
  assert.equal((await counts(u.editor.id)).auth, 1);
  assert.equal(await auditCount("member.delete", `user:${u.a.id}`) + (await auditCount("member.delete", `user:${u.editor.id}`)), 0, "지운 기록 0");

  // 화면: 사유 없이 [삭제] → 안내, 서버 호출 없음
  await openMembers();
  const form = page.getByRole("form", { name: `${u.a.email} 삭제` });
  await form.getByRole("button", { name: "삭제" }).click();
  await page.getByText("삭제하는 이유를 적어 주세요").waitFor();
  assert.equal((await counts(u.a.id)).auth, 1);
});

test("e) 화면에서 사유를 적고 삭제 — profiles·consents·Auth 0, 감사 로그 1건(이메일 0), 목록에서 사라진다", async () => {
  await openMembers();
  const form = page.getByRole("form", { name: `${u.a.email} 삭제` });
  await form.getByLabel("삭제하는 이유").fill("회원 요청에 따른 삭제 시험");
  await form.getByRole("button", { name: "삭제" }).click();
  await page.getByTestId(`member-${u.a.id}`).waitFor({ state: "detached" });

  assert.deepEqual(await counts(u.a.id), { profiles: 0, consents: 0, auth: 0 });
  assert.equal(await auditCount("member.delete", `user:${u.a.id}`), 1);
  const log = await one("select actor, target, before, after, reason from public.audit_logs where action = 'member.delete' and target = $1", [`user:${u.a.id}`]);
  assert.equal(log.actor, `user:${u.admin.id}`);
  assert.equal(log.reason, "회원 요청에 따른 삭제 시험");
  assert.ok(!JSON.stringify(log).includes(u.a.email) && !JSON.stringify(log).includes("@"), "감사 로그에 이메일 0");
  // 같은 계정을 다시 지우면 404
  assert.equal((await api("DELETE", `/members/${u.a.id}`, u.admin, { reason: "두 번째" })).status, 404);
  // 다른 회원은 그대로
  assert.deepEqual(await counts(u.b.id), { profiles: 1, consents: 0, auth: 1 });
});

test("f) 360px 회원 탭 가로 스크롤 0", async () => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openMembers();
  await page.getByTestId(`member-${u.b.id}`).waitFor();
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  assert.ok(scrollWidth <= clientWidth, `scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`);
  await page.setViewportSize({ width: 1280, height: 900 });
});

test("g) proxy — 로그인 쿠키 없이 /my·/my/withdraw는 /login, /account/password는 /admin/login으로 (돌아올 주소 포함)", async () => {
  const cases = [
    ["/my", "/login?next=%2Fmy"],
    ["/my/withdraw", "/login?next=%2Fmy%2Fwithdraw"],
    ["/account/password", "/admin/login?next=%2Faccount%2Fpassword"],
  ];
  for (const [path, location] of cases) {
    const res = await fetch(`${base}${path}`, { redirect: "manual" });
    assert.ok([302, 303, 307, 308].includes(res.status), `${path} 상태 ${res.status}`);
    const got = new URL(res.headers.get("location"), base);
    assert.equal(`${got.pathname}${got.search}`, location, path);
  }
  // 비슷한 이름은 막지 않는다
  assert.notEqual((await fetch(`${base}/mypage`, { redirect: "manual" })).status, 307);
});
