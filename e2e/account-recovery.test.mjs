// 비밀번호 찾기·확인 메일 다시 받기·탈퇴·미확인 가입 정리 E2E (W2-e 2단계 뒷부분 2-B — docs/dev/W2-e_설계.md 4.2 · 4.3 · 9.3)
//  A) 비밀번호 찾기 → 로컬 수신함 → 확인 버튼 → 새 비밀번호(규칙 위반 문장 포함) → 옛 비밀번호 거부·새 비밀번호 로그인·다른 기기 세션 끊김·링크 재사용 410·감사 로그 1건
//  B) 없는 주소·미확인 주소·확인 계정 모두 같은 응답 / 메일은 확인 계정에만 / reset_email 4번째 429 / 형식·출처 거부 / 닫힘 404
//  C) 미확인 재가입 → 확인 메일 다시 감(같은 문장) → magiclink 확인으로 가입 완료 / 다시 받기 버튼 3번까지 메일 4번째 없음 / 만료 화면의 [확인 메일 다시 받기]
//  D) 탈퇴: 틀린 비밀번호 거부 → 맞으면 profiles·consents 0·Auth 계정 0·옛 비밀번호 로그인 불가·감사 로그에 이메일 0
//  E) 편집국 역할 계정 탈퇴 거부(화면·API) / 재설정 확인 없이 로그인만 한 세션으로는 재설정 API 410
//  F) 미확인 가입 정리 DB 함수 경계(기준 시각 = 가입 시각 − 1µs 남음 · 정확히 같으면 지움) · 확인된 계정은 제외 · 공개 키로 호출 불가
//  G) 서버 기록·감사 로그에 비밀번호·받는 주소 0
// 정리 함수의 일수 계산은 단위 시험(lib/auth/recovery.test.ts), 실제 삭제는 배치 연결(6단계)에서 확인한다.
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
const RECOVERY_SENT = "입력한 주소가 가입된 이메일이라면 재설정 안내 메일이 도착합니다 — 메일함을 확인해 주세요";
const BLOCKED = "편집국 역할이나 관리자 권한이 있는 계정은 탈퇴할 수 없습니다 — 관리자에게 역할 회수를 먼저 요청해 주세요";
const PASSWORD = "Zq7-correct-horse-9";
const NEW_PASSWORD = "Nw3-battery-staple-8";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let sb, staff, db, browser, t0, base, fill;
let ipSeq = 0;
const newIp = () => `10.${(Number.parseInt(staff.run.slice(-4), 36) % 200) + 20}.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
const emailOf = (label) => `recover-${label}-${staff.run}@e2e.example.test`;
const userRows = async (email) => (await db.query("select id, email_confirmed_at, created_at from auth.users where email = $1", [email])).rows;
const setMembers = (on) => db.query("update public.settings set value = jsonb_set(value, '{members}', $1::jsonb) where key = 'feature_flags'", [JSON.stringify(on)]);

const post = (path, body, { origin = base.base, headers = {} } = {}) =>
  fetch(`${base.base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}), "x-real-ip": newIp(), ...headers },
    body: JSON.stringify(body),
  });
const linkOf = (mail) => /https?:\/\/\S+\/auth\/confirm\?\S+/.exec(mail.Text)?.[0];
const tokenOf = (link) => ({ token_hash: new URL(link).searchParams.get("token_hash"), type: new URL(link).searchParams.get("type") });
const mailWith = (mails, subject) => mails.find((m) => m.Subject.includes(subject));
const newContext = () => browser.newContext({ extraHTTPHeaders: { "x-real-ip": newIp() } });

/** 가입(API) — confirm이 true면 수신함 링크의 확인까지 한다. 정리 목록에 올린다 */
async function signup(email, { confirm = true } = {}) {
  const res = await post("/api/auth/signup", { email, password: PASSWORD, agreeTerms: true, agreePrivacy: true, fill });
  assert.equal(res.status, 200, "가입");
  const [row] = await userRows(email);
  staff.userIds.add(row.id);
  const [mail] = await waitForMail(email, 1);
  if (confirm) assert.equal((await post("/api/auth/confirm", tokenOf(linkOf(mail)))).status, 200, "가입 확인");
  return row.id;
}
const loginStatus = async (email, password) => (await post("/api/auth/login", { email, password })).status;
const userToken = async (token) => (await fetch(`${sb.url}/auth/v1/user`, { headers: { apikey: sb.anonKey, authorization: `Bearer ${token}` } })).status;

before(async () => {
  sb = localSupabase();
  buildWeb();
  staff = new StaffFixture(sb);
  await staff.connect();
  removePolicies = await publishSignupPolicies(staff.db, staff.run);
  db = staff.db;
  await staff.snapshotOperations();
  t0 = (await db.query("select now() as t")).rows[0].t;
  await setMembers(true);
  base = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    NEXT_PUBLIC_SITE_URL: SITE,
    ...mailEnv(),
  });
  const html = await (await fetch(`${base.base}/signup`)).text();
  fill = /name="fill" value="([^"]+)"/.exec(html)?.[1];
  assert.ok(fill, "폼 열림 토큰");
  await sleep(3200);
  browser = await chromium.launch();
});

after(async () => {
  base?.stop();
  await browser?.close();
  if (db && t0) await db.query("delete from public.request_throttles where window_start >= $1", [t0]);
  await removePolicies?.(); // cleanup()이 DB 연결을 닫기 전에
  await staff?.cleanup();
});

test("A 비밀번호 찾기 → 메일 → 확인 버튼 → 규칙 위반 문장 → 새 비밀번호 → 옛 비밀번호 거부·새 비밀번호 로그인·다른 기기 세션 끊김·링크 재사용 410·감사 로그 1건", async () => {
  const email = emailOf("flow");
  const id = await signup(email);
  const otherSession = await staff.signIn(email, PASSWORD);
  assert.equal(await userToken(otherSession), 200, "다른 기기 세션은 재설정 전 유효");

  const ctx = await newContext();
  const page = await ctx.newPage();
  await page.goto(`${base.base}/forgot-password`);
  await page.fill("#forgot-email", email);
  await Promise.all([page.waitForURL(/\/forgot-password\?sent=1/), page.click('button[type="submit"]')]);
  assert.equal((await page.textContent('[data-testid="forgot-sent"]')).trim(), RECOVERY_SENT);

  const mails = await waitForMail(email, 2);
  const mail = mailWith(mails, "비밀번호 재설정");
  assert.ok(mail, "재설정 메일");
  const link = linkOf(mail);
  assert.equal(new URL(link).origin, base.base, "링크 호스트 = 요청 호스트");
  assert.equal(new URL(link).searchParams.get("type"), "recovery");
  assert.equal((await fetch(`${base.base}/reset-password`)).status, 200);
  assert.match(await (await fetch(`${base.base}/reset-password`)).text(), /data-testid="reset-expired"/, "링크 확인 전에는 새 비밀번호 폼이 없다");

  await fetch(link); // 미리 열기로는 소모되지 않는다
  await page.goto(link);
  await Promise.all([page.waitForURL(/\/reset-password$/), page.click('button:has-text("비밀번호 재설정하기")')]);
  // 규칙 위반(9글자) → 같은 화면에 칸 문장
  await page.fill("#reset-new", "abcdef1h9");
  await page.fill("#reset-confirm", "abcdef1h9");
  await Promise.all([page.waitForURL(/\/reset-password\?e=too_short/), page.click('button[type="submit"]')]);
  assert.equal((await page.textContent('[data-testid="reset-error"]')).trim(), "비밀번호가 너무 짧습니다");
  assert.equal(await loginStatus(email, PASSWORD), 200, "실패한 시도는 비밀번호를 바꾸지 않는다");
  // 두 칸 불일치
  await page.fill("#reset-new", NEW_PASSWORD);
  await page.fill("#reset-confirm", `${NEW_PASSWORD}x`);
  await Promise.all([page.waitForURL(/\/reset-password\?e=mismatch/), page.click('button[type="submit"]')]);
  assert.equal((await page.textContent('[data-testid="reset-error"]')).trim(), "새 비밀번호 두 칸이 같지 않습니다");
  // 성공
  await page.fill("#reset-new", NEW_PASSWORD);
  await page.fill("#reset-confirm", NEW_PASSWORD);
  await Promise.all([page.waitForURL(/\/login\?reset=1/), page.click('button[type="submit"]')]);
  assert.equal((await page.textContent('[data-testid="login-notice"]')).trim(), "비밀번호를 바꿨습니다 — 새 비밀번호로 로그인해 주세요");

  assert.equal(await loginStatus(email, PASSWORD), 401, "옛 비밀번호 거부");
  assert.equal(await loginStatus(email, NEW_PASSWORD), 200, "새 비밀번호 로그인");
  assert.notEqual(await userToken(otherSession), 200, "다른 기기 세션 끊김");
  await page.goto(`${base.base}/my`);
  assert.match(page.url(), /\/login/, "이 기기 세션도 끊겨 /my에서 로그인으로 돌아간다");
  assert.equal((await post("/api/auth/confirm", tokenOf(link))).status, 410, "같은 링크 재사용 410");
  await ctx.close();

  const audit = (await db.query("select actor, target, before, after, reason from public.audit_logs where action = 'account.password_reset' and target = $1", [`user:${id}`])).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor, `user:${id}`);
  assert.ok(!JSON.stringify(audit[0]).includes(NEW_PASSWORD) && !JSON.stringify(audit[0]).includes(staff.run), "감사 로그에 비밀번호·이메일 0");
});

test("B 없는 주소·미확인·확인 계정 모두 같은 응답, 메일은 확인 계정에만 / 형식·출처 거부 / reset_email 4번째 429 / 닫히면 404", async () => {
  const ghost = emailOf("ghost");
  const unconfirmed = emailOf("unconf");
  const confirmed = emailOf("conf");
  await signup(unconfirmed, { confirm: false });
  await signup(confirmed);
  const bodies = [];
  for (const email of [ghost, unconfirmed, confirmed]) {
    const res = await post("/api/auth/forgot", { email });
    assert.equal(res.status, 200, email.slice(0, 14));
    bodies.push(await res.json());
  }
  assert.deepEqual(bodies[0], { ok: true, message: RECOVERY_SENT });
  assert.deepEqual(bodies[1], bodies[0]);
  assert.deepEqual(bodies[2], bodies[0]);
  const confirmedMails = await waitForMail(confirmed, 2);
  assert.ok(mailWith(confirmedMails, "비밀번호 재설정"), "확인 계정에는 재설정 메일");
  assert.equal((await inboxFor(ghost)).length, 0, "없는 주소에는 메일 0");
  const unconfMails = await inboxFor(unconfirmed);
  assert.equal(unconfMails.length, 1, "미확인 주소에는 가입 확인 메일 하나뿐");
  assert.ok(!mailWith(unconfMails, "비밀번호 재설정"));

  assert.equal((await post("/api/auth/forgot", { email: "not-an-email" })).status, 422);
  assert.equal((await post("/api/auth/forgot", { email: ghost }, { origin: null })).status, 403);
  assert.equal((await post("/api/auth/forgot", { email: ghost }, { origin: "https://evil.example.org" })).status, 403);

  // reset_email 3번까지 허용, 4번째 429 — 없는 주소도 똑같이 센다
  const limited = emailOf("limited");
  const statuses = [];
  for (let i = 0; i < 4; i += 1) statuses.push((await post("/api/auth/forgot", { email: limited })).status);
  assert.deepEqual(statuses, [200, 200, 200, 429]);

  await setMembers(false);
  try {
    assert.equal((await post("/api/auth/forgot", { email: confirmed })).status, 404);
    assert.equal((await fetch(`${base.base}/forgot-password`)).status, 404);
    assert.equal((await post("/api/auth/resend-confirm", { email: unconfirmed })).status, 404);
  } finally {
    await setMembers(true);
  }
});

test("C 미확인 재가입 → 같은 문장 + 확인 메일 다시 감 → 링크로 가입 완료 / 다시 받기 3번까지 · 4번째 메일 없음 / 만료 화면 버튼", async () => {
  const email = emailOf("again");
  await signup(email, { confirm: false });
  const res = await post("/api/auth/signup", { email, password: PASSWORD, agreeTerms: true, agreePrivacy: true, fill });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).message, SENT);
  const mails = await waitForMail(email, 2);
  const again = mailWith(mails, "가입 확인 메일 다시 보냄");
  assert.ok(again, "확인 메일을 다시 보냈다(이미 가입 안내가 아니다)");
  assert.ok(!mailWith(mails, "이미 가입된 이메일"));
  assert.equal((await userRows(email)).length, 1, "계정 추가 0");
  const link = linkOf(again);
  assert.equal(new URL(link).searchParams.get("type"), "magiclink");
  assert.equal((await post("/api/auth/confirm", tokenOf(link))).status, 200);
  const [row] = await userRows(email);
  assert.ok(row.email_confirmed_at, "다시 받은 링크로 이메일 확인됨");
  assert.ok((await db.query("select confirmed_at from public.consents where user_id = $1 and kind = 'signup'", [row.id])).rows[0].confirmed_at, "동의 확인 시각");
  assert.equal((await post("/api/auth/confirm", tokenOf(link))).status, 410, "재사용 410");

  // 다시 받기 버튼 횟수: confirm_resend 3번까지 메일, 4번째는 메일 없이 같은 응답
  const limited = emailOf("resend");
  await signup(limited, { confirm: false });
  const replies = [];
  for (let i = 0; i < 4; i += 1) replies.push(await (await post("/api/auth/resend-confirm", { email: limited })).json());
  assert.ok(replies.every((r) => r.message === SENT));
  await waitForMail(limited, 4);
  await sleep(1500);
  assert.equal((await inboxFor(limited)).length, 4, "가입 메일 1 + 다시 받기 3, 4번째는 보내지 않는다");
  const ghost = emailOf("resend-ghost");
  const ghostReply = await post("/api/auth/resend-confirm", { email: ghost });
  assert.equal(ghostReply.status, 200);
  assert.equal((await ghostReply.json()).message, SENT);
  assert.equal((await inboxFor(ghost)).length, 0);

  // 만료 화면의 버튼
  const viaButton = emailOf("button");
  await signup(viaButton, { confirm: false });
  const ctx = await newContext();
  const page = await ctx.newPage();
  await page.goto(`${base.base}/auth/confirm?error=expired&type=signup`);
  assert.equal((await page.textContent('[data-testid="confirm-expired"]')).trim(), "링크가 만료되었습니다");
  await page.fill("#resend-email", viaButton);
  await Promise.all([page.waitForURL(/sent=1/), page.click('button:has-text("확인 메일 다시 받기")')]);
  assert.equal((await page.textContent('[data-testid="resend-sent"]')).trim(), SENT);
  assert.ok(mailWith(await waitForMail(viaButton, 2), "가입 확인 메일 다시 보냄"));
  await page.goto(`${base.base}/auth/confirm?error=expired&type=recovery`);
  assert.equal(await page.locator('a:has-text("비밀번호 재설정 메일 다시 받기")').count(), 1, "재설정 링크 만료 화면은 비밀번호 찾기로 안내");
  await ctx.close();
});

test("D 탈퇴 — 틀린 비밀번호 거부, 맞으면 profiles·consents·Auth 계정 0, 옛 비밀번호 로그인 불가, 감사 로그에 이메일 0", async () => {
  const email = emailOf("leave");
  const id = await signup(email);
  assert.equal((await db.query("select count(*)::int n from public.profiles where id = $1", [id])).rows[0].n, 1);
  const ctx = await newContext();
  const page = await ctx.newPage();
  await page.goto(`${base.base}/login?next=${encodeURIComponent("/my/withdraw")}`);
  await page.fill("#member-email", email);
  await page.fill("#member-password", PASSWORD);
  await Promise.all([page.waitForURL(/\/my\/withdraw$/), page.click('button[type="submit"]')]);
  await page.fill("#withdraw-password", "wrong-password-1");
  await Promise.all([page.waitForURL(/\/my\/withdraw\?e=wrong/), page.click('button:has-text("탈퇴하기")')]);
  assert.equal((await page.textContent('[data-testid="withdraw-error"]')).trim(), "현재 비밀번호가 맞지 않습니다");
  assert.equal((await userRows(email)).length, 1, "틀린 비밀번호면 계정이 남는다");

  await page.fill("#withdraw-password", PASSWORD);
  await Promise.all([page.waitForURL(/\/login\?withdrawn=1/), page.click('button:has-text("탈퇴하기")')]);
  assert.equal((await page.textContent('[data-testid="login-notice"]')).trim(), "탈퇴가 완료되었습니다");
  await ctx.close();

  assert.equal((await userRows(email)).length, 0, "Auth 계정 0");
  assert.equal((await db.query("select count(*)::int n from public.profiles where id = $1", [id])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from public.consents where user_id = $1", [id])).rows[0].n, 0);
  assert.equal(await loginStatus(email, PASSWORD), 401);
  const audit = (await db.query("select actor, target, before, after, reason from public.audit_logs where action = 'account.withdrawn' and target = $1", [`user:${id}`])).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor, `user:${id}`);
  assert.ok(!JSON.stringify(audit[0]).includes(staff.run) && !JSON.stringify(audit[0]).includes(PASSWORD), "감사 로그에 이메일·비밀번호 0");
});

test("E 편집국 역할 계정은 탈퇴 화면에서 안내만, API 403이고 계정이 남는다 / 재설정 확인 없이 로그인만 한 세션으로는 재설정 API 410", async () => {
  const reporter = await staff.createUser({ label: "recover-reporter", roles: ["reporter"] });
  const ctx = await newContext();
  const page = await ctx.newPage();
  await page.goto(`${base.base}/login?next=${encodeURIComponent("/my/withdraw")}`);
  await page.fill("#member-email", reporter.email);
  await page.fill("#member-password", reporter.password);
  await Promise.all([page.waitForURL(/\/my\/withdraw$/), page.click('button[type="submit"]')]);
  assert.equal((await page.textContent('[data-testid="withdraw-blocked"]')).trim(), BLOCKED);
  assert.equal(await page.locator("#withdraw-password").count(), 0, "탈퇴 폼은 보이지 않는다");
  const api = await ctx.request.post(`${base.base}/api/auth/withdraw`, { data: { currentPassword: reporter.password }, headers: { origin: base.base } });
  assert.equal(api.status(), 403);
  assert.equal((await api.json()).error, BLOCKED);
  assert.equal((await userRows(reporter.email)).length, 1, "계정이 남는다");
  assert.equal((await db.query("select count(*)::int n from public.staff_roles where user_id = $1", [reporter.id])).rows[0].n, 1, "역할도 남는다");

  // 로그인만 한 세션(재설정 링크 확인 없음)으로 비밀번호를 바꿀 수 없다
  const reset = await ctx.request.post(`${base.base}/api/auth/reset`, { data: { newPassword: NEW_PASSWORD, newPasswordConfirm: NEW_PASSWORD }, headers: { origin: base.base } });
  assert.equal(reset.status(), 410);
  assert.equal(await loginStatus(reporter.email, reporter.password), 200, "비밀번호는 그대로");
  await ctx.close();
});

test("F 미확인 가입 정리 DB 함수 경계 — 가입 시각−1µs는 남고 가입 시각 정각은 대상, 확인된 계정은 제외, 공개 키로는 호출 불가", async () => {
  const email = emailOf("purge");
  const id = await signup(email, { confirm: false });
  const confirmedId = await signup(emailOf("purge-ok"));
  const included = async (cutoffSql, userId) =>
    (await db.query(`select exists (select 1 from public.unconfirmed_account_ids(${cutoffSql}) as x(id) where x.id = $1) as hit`, [userId])).rows[0].hit;
  // 기준 시각은 DB 안에서 가입 시각에 더해 만든다(JS Date는 마이크로초를 잘라 경계가 어긋난다)
  const probe = async (offset, userId) =>
    (await db.query("select exists (select 1 from public.unconfirmed_account_ids((select created_at from auth.users where id = $1) + $2::interval) as x(id) where x.id = $1) as hit", [userId, offset])).rows[0].hit;
  assert.equal(await probe("-1 microsecond", id), false, "기준 시각이 가입 시각보다 1µs 이르면 남는다");
  assert.equal(await probe("0 microseconds", id), true, "기준 시각 = 가입 시각이면 지움 대상");
  assert.equal(await included("now() + interval '30 days'", confirmedId), false, "확인된 계정은 언제 기준이어도 제외");
  const anon = await fetch(`${sb.url}/rest/v1/rpc/unconfirmed_account_ids`, { method: "POST", headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}`, "content-type": "application/json" }, body: JSON.stringify({ p_before: new Date().toISOString() }) });
  assert.ok(anon.status >= 400, `공개 키 호출 거부 (${anon.status})`);
});

test("G 서버 기록에 비밀번호·받는 주소 0, 메일 기록은 템플릿 이름뿐, 감사 로그·프로필·동의 행에 비밀번호 0", async () => {
  const log = base.log();
  for (const secret of [PASSWORD, NEW_PASSWORD, staff.run]) assert.ok(!log.includes(secret), "서버 기록에 비밀번호·주소 없음");
  assert.match(log, /\[mail\] template=password_reset ok=true ms=\d+/);
  assert.match(log, /\[mail\] template=signup_resend ok=true ms=\d+/);
  const audit = (await db.query("select count(*)::int n from public.audit_logs where action in ('account.password_reset', 'account.withdrawn') and (actor || target || coalesce(before::text, '') || coalesce(after::text, '') || reason) ~ ($1 || '|' || $2)", [PASSWORD, NEW_PASSWORD])).rows[0].n;
  assert.equal(audit, 0);
});
