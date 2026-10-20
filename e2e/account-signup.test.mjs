// 가입·인증 E2E (W2-e 2단계 앞부분 2-A — docs/dev/W2-e_설계.md 4.3 가입·인증 메일 · 4.4 로그인 · 4.5 공개 폼 규칙 · 8.1 메일 모듈)
//  A) 닫힘: 메일 설정이 없으면 / members 기능 키가 꺼져 있으면 가입 화면·API가 404
//  B) 열림: 실제 브라우저로 가입 → 로컬 수신함(Mailpit)의 메일 → 확인 버튼 → /my?welcome=1 로그인 상태 · 링크 호스트 = 요청 호스트 · consents 확인 시각
//  C) 같은 주소로 다시 가입: 같은 문장 · 계정 추가 0 · 안내 메일만 / 가입 요청의 역할·메타데이터는 무시(역할 0)
//  D) 봇·출처: 숨은 칸·열림 토큰 없음·너무 빠른 제출·Origin 없음/다른 사이트 거부
//  E) 메일 서버를 못 쓰면(잘못된 포트): 기존 회원 로그인(JSON·/login 폼)은 되고, 가입은 503 안내 문장 + 임시 계정 0
//  F) 서버 기록·DB에 비밀번호 0, 서버 기록에 받는 주소 0
// standalone 빌드를 띄우고 로컬 Supabase(Auth·DB·메일 수신함)에 붙인다. 계정은 시험이 만들고 끝나면 지운다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { mailEnv, waitForMail, inboxFor } from "./lib/mail.mjs";
import { StaffFixture } from "./lib/staff.mjs";
import { publishSignupPolicies } from "./lib/policy-fixture.mjs";

/** 가입이 열리려면 이용약관·개인정보처리방침 게시본이 있어야 한다(W2-e 6.3) — 시험용 가짜 게시본을 지우는 함수 */
let removePolicies;

const SITE = "https://e2e.example.test";
const SENT = "확인 메일을 보냈습니다 — 메일함을 확인해 주세요";
const MAIL_DOWN = "지금 메일을 보낼 수 없습니다 — 잠시 뒤 다시 시도해 주세요";
const BOT = "제출할 수 없습니다 — 페이지를 새로 열어 다시 시도해 주세요";
const PASSWORD = "Zq7-correct-horse-9";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let sb, staff, db, browser, t0, base;
const servers = [];
let ipSeq = 0;
const newIp = () => `10.${(Number.parseInt(staff.run.slice(-4), 36) % 200) + 20}.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
const emailOf = (label) => `signup-${label}-${staff.run}@e2e.example.test`;

const setMembers = (on) => db.query("update public.settings set value = jsonb_set(value, '{members}', $1::jsonb) where key = 'feature_flags'", [JSON.stringify(on)]);
const userRows = async (email) => (await db.query("select id, email_confirmed_at, raw_user_meta_data, raw_app_meta_data from auth.users where email = $1", [email])).rows;
async function launch(env) {
  const s = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    NEXT_PUBLIC_SITE_URL: SITE,
    ...env,
  });
  servers.push(s);
  return s;
}
/** 가입 화면을 열어 폼 열림 토큰을 받고 최소 작성 시간(3초)을 기다린다 */
async function openForm(server) {
  const html = await (await fetch(`${server.base}/signup`)).text();
  const fill = /name="fill" value="([^"]+)"/.exec(html)?.[1];
  assert.ok(fill, "폼 열림 토큰이 화면에 있어야 한다");
  await sleep(3200);
  return fill;
}
const post = (server, path, body, { origin = server.base, headers = {} } = {}) =>
  fetch(`${server.base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}), "x-real-ip": newIp(), ...headers },
    body: JSON.stringify(body),
  });
const signupBody = (email, fill, extra = {}) => ({ email, password: PASSWORD, agreeTerms: true, agreePrivacy: true, fill, ...extra });

before(async () => {
  sb = localSupabase();
  buildWeb();
  staff = new StaffFixture(sb);
  await staff.connect();
  removePolicies = await publishSignupPolicies(staff.db, staff.run);
  db = staff.db;
  await staff.snapshotOperations();
  t0 = (await db.query("select now() as t")).rows[0].t;
  browser = await chromium.launch();
});

after(async () => {
  for (const s of servers) s.stop();
  await browser?.close();
  if (db && t0) await db.query("delete from public.request_throttles where window_start >= $1", [t0]);
  await removePolicies?.(); // cleanup()이 DB 연결을 닫기 전에
  await staff?.cleanup();
});

test("A1 메일 설정이 없으면 members가 켜져 있어도 가입 화면·API가 404", async () => {
  await setMembers(true);
  const s = await launch({ MAIL_SMTP_HOST: "" });
  assert.equal((await fetch(`${s.base}/signup`)).status, 404);
  const res = await post(s, "/api/auth/signup", signupBody(emailOf("closed-mail"), "x"));
  assert.equal(res.status, 404);
  assert.equal((await userRows(emailOf("closed-mail"))).length, 0);
});

test("A2 members 기능 키가 꺼져 있으면 메일 설정이 있어도 404 — 켜면 화면이 열린다", async () => {
  await setMembers(false);
  const s = await launch({});
  assert.equal((await fetch(`${s.base}/signup`)).status, 404);
  assert.equal((await post(s, "/api/auth/signup", signupBody(emailOf("closed-flag"), "x"))).status, 404);
  await setMembers(true);
  assert.equal((await fetch(`${s.base}/signup`)).status, 200);
  base = s;
});

test("B 실제 브라우저 가입 → 수신함 메일 → 확인 버튼 → /my 로그인 상태, 링크 호스트는 요청 호스트", async () => {
  const email = emailOf("browser");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${base.base}/signup`);
  await page.fill("#signup-email", email);
  await page.fill("#signup-password", PASSWORD);
  await page.fill("#signup-name", "시험 회원");
  await page.check('input[name="interests"][value="tax"]');
  await page.check('input[name="agreeTerms"]');
  await page.check('input[name="agreePrivacy"]');
  await sleep(3200);
  await Promise.all([page.waitForURL(/\/signup\?sent=1/), page.click('button[type="submit"]')]);
  assert.equal((await page.textContent('[data-testid="signup-sent"]')).trim(), SENT);

  const [mail] = await waitForMail(email);
  assert.equal(mail.Subject, "[선명 지방세·부동산] 가입 확인");
  const link = /https?:\/\/\S+\/auth\/confirm\?\S+/.exec(mail.Text)?.[0];
  assert.ok(link, "본문에 확인 링크가 있어야 한다");
  assert.equal(new URL(link).origin, base.base, "링크 호스트 = 요청 호스트");

  const [row] = await userRows(email);
  staff.userIds.add(row.id);
  assert.equal(row.email_confirmed_at, null, "확인 전에는 이메일 미확인");
  assert.equal((await db.query("select confirmed_at from public.consents where user_id = $1 and kind = 'signup'", [row.id])).rows[0].confirmed_at, null);

  // 링크를 열기만 해서는(메일 보안 검사기의 미리 열기) 토큰이 소모되지 않는다
  await fetch(link);
  await page.goto(link);
  assert.equal(await page.locator('button:has-text("가입 확인하기")').count(), 1);
  await Promise.all([page.waitForURL(/\/my\?welcome=1/), page.click('button:has-text("가입 확인하기")')]);
  assert.equal((await page.textContent('[data-testid="my-welcome"]')).trim(), "가입이 완료되었습니다");
  assert.equal((await page.textContent('[data-testid="my-email"]')).trim(), email);

  const [after] = await userRows(email);
  assert.ok(after.email_confirmed_at, "확인 뒤 이메일 확인됨");
  const consent = (await db.query("select confirmed_at, channel, kind from public.consents where user_id = $1", [row.id])).rows;
  assert.equal(consent.length, 1);
  assert.ok(consent[0].confirmed_at);
  const profile = (await db.query("select display_name, interests from public.profiles where id = $1", [row.id])).rows[0];
  assert.deepEqual({ ...profile }, { display_name: "시험 회원", interests: ["tax"] });

  // 같은 링크를 다시 쓰면 만료
  const again = await fetch(`${base.base}/api/auth/confirm`, { method: "POST", headers: { "content-type": "application/json", origin: base.base }, body: JSON.stringify({ token_hash: new URL(link).searchParams.get("token_hash"), type: "signup" }) });
  assert.equal(again.status, 410);
  assert.equal((await again.json()).error, "링크가 만료되었습니다");
  await ctx.close();
});

test("C1 이미 가입된 주소로 다시 가입하면 같은 문장 · 계정 추가 0 · 안내 메일만", async () => {
  const email = emailOf("browser");
  const fill = await openForm(base);
  const res = await post(base, "/api/auth/signup", signupBody(email, fill));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).message, SENT);
  assert.equal((await userRows(email)).length, 1);
  const mails = await waitForMail(email, 2);
  assert.ok(mails.some((m) => m.Subject === "[선명 지방세·부동산] 이미 가입된 이메일입니다" && m.Text.includes(`${base.base}/login`)));
  assert.equal((await db.query("select count(*)::int as n from public.consents where user_id = $1", [(await userRows(email))[0].id])).rows[0].n, 1);
});

test("C2 가입 요청에 넣은 역할·메타데이터는 무시된다 (역할 0 · 메타데이터 비어 있음)", async () => {
  const email = emailOf("roles");
  const fill = await openForm(base);
  const res = await post(base, "/api/auth/signup", signupBody(email, fill, { role: "admin", roles: ["editor", "reviewer"], data: { role: "admin" }, app_metadata: { role: "admin" }, user_metadata: { roles: ["editor"] } }));
  assert.equal(res.status, 200);
  const [row] = await userRows(email);
  staff.userIds.add(row.id);
  assert.deepEqual(row.raw_user_meta_data ?? {}, {});
  assert.equal(row.raw_app_meta_data?.role, undefined);
  assert.equal((await db.query("select count(*)::int as n from public.staff_roles where user_id = $1", [row.id])).rows[0].n, 0);
});

test("D 봇·출처 검사 — 숨은 칸·열림 토큰 없음/위조·너무 빠른 제출은 같은 문장으로 거부, Origin 없음·다른 사이트는 403", async () => {
  const fill = await openForm(base);
  const rejected = async (body, label) => {
    const email = emailOf(label);
    const res = await post(base, "/api/auth/signup", signupBody(email, fill, body));
    assert.equal(res.status, 422, label);
    assert.equal((await res.json()).error, BOT, label);
    assert.equal((await userRows(email)).length, 0, `${label}: 계정 0`);
  };
  await rejected({ website: "http://spam.example.test" }, "honeypot");
  await rejected({ fill: undefined }, "nofill");
  await rejected({ fill: fill.replace(/.$/, (c) => (c === "0" ? "1" : "0")) }, "forged");
  // 방금 연 폼은 최소 작성 시간 안
  const fresh = /name="fill" value="([^"]+)"/.exec(await (await fetch(`${base.base}/signup`)).text())[1];
  const fast = await post(base, "/api/auth/signup", signupBody(emailOf("fast"), fresh));
  assert.equal(fast.status, 422);
  assert.equal((await fast.json()).error, BOT);
  assert.equal((await post(base, "/api/auth/signup", signupBody(emailOf("noorigin"), fill), { origin: null })).status, 403);
  assert.equal((await post(base, "/api/auth/signup", signupBody(emailOf("evil"), fill), { origin: "https://evil.example.org" })).status, 403);
  assert.equal((await userRows(emailOf("noorigin"))).length + (await userRows(emailOf("evil"))).length, 0);
});

test("D2 입력 오류 — 비밀번호 9글자·동의 빠짐·이메일 형식은 422와 칸 이름, 계정 0", async () => {
  const fill = await openForm(base);
  const cases = [
    [{ password: "abcdef1h9" }, "password", "password_too_short"],
    [{ agreePrivacy: false }, "agreeTerms", "terms"],
    [{ email: "not-an-email" }, "email", "email"],
  ];
  for (const [patch, field, code] of cases) {
    const email = patch.email ?? emailOf(`bad-${code}`);
    const res = await post(base, "/api/auth/signup", { ...signupBody(email, fill), ...patch });
    assert.equal(res.status, 422, code);
    const body = await res.json();
    assert.equal(body.code, code);
    assert.equal(body.field, field);
    assert.equal((await userRows(email)).length, 0);
  }
});

test("E 메일 서버를 못 쓰면(잘못된 포트) 기존 회원은 로그인되고 /login 폼도 되며, 가입은 안내 문장 + 임시 계정 0", async () => {
  const down = await launch(mailEnv({ MAIL_SMTP_PORT: "1" }));
  const member = emailOf("browser");
  const login = await post(down, "/api/auth/login", { email: member, password: PASSWORD });
  assert.equal(login.status, 200);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${down.base}/login?next=${encodeURIComponent("/my")}`);
  await page.fill("#member-email", member);
  await page.fill("#member-password", PASSWORD);
  await Promise.all([page.waitForURL(/\/my$/), page.click('button[type="submit"]')]);
  assert.equal((await page.textContent('[data-testid="my-email"]')).trim(), member);
  // 틀린 비밀번호는 같은 문장으로 /login에 돌아온다
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(`${down.base}/login`);
  await p2.fill("#member-email", member);
  await p2.fill("#member-password", "wrong-password-1");
  await Promise.all([p2.waitForURL(/\/login\?e=failed/), p2.click('button[type="submit"]')]);
  assert.equal((await p2.textContent('[data-testid="login-error"]')).trim(), "이메일 또는 비밀번호가 맞지 않습니다");
  await ctx.close();
  await ctx2.close();

  const fill = await openForm(down);
  const email = emailOf("maildown");
  const res = await post(down, "/api/auth/signup", signupBody(email, fill));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, MAIL_DOWN);
  assert.equal((await userRows(email)).length, 0, "만든 임시 계정은 정리된다");
  assert.equal((await inboxFor(email)).length, 0);
  assert.match(down.log(), /\[mail\] template=signup_confirm ok=false ms=\d+/);
});

test("F 서버 기록에 비밀번호·받는 주소 0, DB 프로필·동의 행에 비밀번호 0, 성공 기록은 템플릿 이름뿐", async () => {
  for (const s of servers) {
    const log = s.log();
    assert.ok(!log.includes(PASSWORD), "서버 기록에 비밀번호 없음");
    assert.ok(!log.includes(staff.run), "서버 기록에 받는 주소 없음");
  }
  assert.match(base.log(), /\[mail\] template=signup_confirm ok=true ms=\d+/);
  assert.match(base.log(), /\[mail\] template=signup_exists_notice ok=true ms=\d+/);
  const rows = (await db.query("select (select count(*)::int from public.profiles p where p::text like $1) + (select count(*)::int from public.consents c where c::text like $1) as n", [`%${PASSWORD}%`])).rows[0];
  assert.equal(rows.n, 0);
});
