// 계정 기반 E2E (W2-e 1단계 — docs/dev/W2-e_설계.md 1장 1단계 증거, 4.1 로그인 시도 제한 · 4.2 비밀번호 바꾸기 · 2.6 비밀번호 규칙)
//  A) 로그인 시도 제한: 5번 실패 → 6번째 429(+retry-after) · 다른 IP·다른 계정 영향 없음 · 성공하면 짝·계정 횟수 초기화(IP 횟수는 유지) ·
//     계정이 없는 이메일도 같은 6번째 429 · 대소문자·공백을 바꿔도 한 계정 · 이메일 전체·IP 한도(설정을 낮춰 n번째 허용·n+1번째 차단) ·
//     설정(auth_limits)을 바꾸면 다음 요청부터 적용 · 열쇠(GUARD_SECRET)가 없으면 로그인이 닫힌다(503) · 표에 이메일·IP 원문 0
//  B) 비밀번호 바꾸기 API: 비로그인 401 · Bearer만 401 · 다른 사이트 403 · 현재 비밀번호 틀림 422 + 5번 뒤 429 · 규칙 위반 422(설계 2.6 거부 견본) ·
//     바꾸면 이 기기 유지 · 다른 기기(쿠키)·다른 세션(Bearer)이 끊김 · 옛 비밀번호 거부·새 비밀번호 로그인 · 감사 로그 1건에 비밀번호·이메일 0 · 서버 기록에 비밀번호 0 · 편집국 역할 계정도 사용
//  C) 실제 브라우저: 머리말 링크 → 화면 → 칸 오류 → 완료 → 새 비밀번호로 다시 로그인 / 로그인 전에는 로그인 화면으로 갔다가 돌아온다 · noindex
// standalone 빌드를 띄우고 로컬 Supabase(Auth·DB)에 붙인다. 계정은 e2e/lib/staff.mjs로 만들고 끝나면 지운다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e.example.test";
const ADMINS = ["acct-admin-sessions@example.test", "acct-admin-throttle@example.test", "acct-admin-rules@example.test", "acct-admin-ui@example.test"];
const FAILED = "이메일 또는 비밀번호가 맞지 않습니다";
const TOO_MANY = "시도가 너무 많습니다. 잠시 뒤 다시 시도하세요";
const GUARD = crypto.randomBytes(24).toString("hex");

let sb, server, staff, db, browser, t0;
const contexts = [];
const passwordsUsed = new Set();

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const keyOf = (scope, value) => crypto.createHmac("sha256", GUARD).update(`${scope}:${value}`).digest("hex").slice(0, 32);
const throttleRow = async (scope, value) => (await db.query("select count, window_start from public.request_throttles where scope = $1 and key_hash = $2 order by window_start desc", [scope, keyOf(scope, value)])).rows;

let ipSeq = 0;
/** 이 실행만의 IP (문서용 대역 아닌 시험 대역) — x-real-ip로 넘긴다 */
const newIp = () => `10.${(Number.parseInt(staff.run.slice(-4), 36) % 200) + 20}.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMINS.join(","),
    NEXT_PUBLIC_SITE_URL: SITE,
    GUARD_SECRET: GUARD,
  });
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.snapshotOperations();
  t0 = (await one("select now() as t")).t;
  for (const email of ADMINS) await staff.removeLeftover(email);
  browser = await chromium.launch();
});

after(async () => {
  try {
    for (const c of contexts) await c.close().catch(() => {});
    await browser?.close();
    // 시험이 만든 시도 횟수 줄 — DB 시계로 시작 뒤에 열린 창을 지운다
    if (db && t0) await db.query("delete from public.request_throttles where window_start >= $1", [t0]);
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

// ── 도우미 ────────────────────────────────────────────────

const parseSetCookie = (list) => list.map((c) => c.split(";")[0]).map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]);
const mergeJar = (jar, setCookies) => {
  for (const [name, value] of parseSetCookie(setCookies)) {
    if (value === "") jar.delete(name);
    else jar.set(name, value);
  }
};
const cookieHeader = (jar) => [...jar].map(([n, v]) => `${n}=${v}`).join("; ");

async function loginReq(email, password, ip, srv = server) {
  passwordsUsed.add(password);
  const res = await fetch(`${srv.base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, retryAfter: res.headers.get("retry-after"), setCookies: res.headers.getSetCookie() };
}

/** 한 기기 = 쿠키 보관함 하나. 로그인하면 새 세션이 생긴다 */
async function device(user, password = user.password, ip = newIp()) {
  const r = await loginReq(user.email, password, ip);
  assert.equal(r.status, 200, `로그인 실패 ${r.status} ${JSON.stringify(r.body)}`);
  const jar = new Map();
  mergeJar(jar, r.setCookies);
  assert.ok(jar.size > 0, "세션 쿠키가 없다");
  return { jar, ip };
}

async function call(dev, method, path, body, headers = {}) {
  const h = { cookie: cookieHeader(dev.jar), "x-real-ip": dev.ip, ...headers };
  if (body !== undefined) {
    h["content-type"] = "application/json";
    for (const v of Object.values(body)) if (typeof v === "string") passwordsUsed.add(v);
  }
  const res = await fetch(`${server.base}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  mergeJar(dev.jar, res.headers.getSetCookie());
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json, location: res.headers.get("location"), retryAfter: res.headers.get("retry-after"), text };
}

const changePassword = (dev, current, next, confirm = next, headers) => call(dev, "POST", "/api/auth/password", { currentPassword: current, newPassword: next, newPasswordConfirm: confirm }, headers);
const adminApiStatus = async (init) => (await fetch(`${server.base}/api/admin/members`, init)).status;

async function withLimits(patch, fn) {
  const before = (await one("select value from public.settings where key = 'auth_limits'")).value;
  const next = { ...before, ...patch, version: `e2e-${staff.run}` };
  await db.query("update public.settings set value = $1::jsonb where key = 'auth_limits'", [JSON.stringify(next)]);
  try {
    return await fn();
  } finally {
    await db.query("update public.settings set value = $1::jsonb where key = 'auth_limits'", [JSON.stringify(before)]);
  }
}

// ── A. 로그인 시도 제한 ────────────────────────────────────

test("A1 로그인 5번 실패는 같은 문장의 401, 6번째는 올바른 비밀번호여도 429 + retry-after — 횟수는 DB에 해시로만 있다", async () => {
  const user = await staff.createUser({ label: "lim-pair" });
  const ip = newIp();
  for (let n = 1; n <= 5; n++) {
    const r = await loginReq(user.email, `wrong-${n}-${staff.run}`, ip);
    assert.equal(r.status, 401, `${n}번째 실패`);
    assert.equal(r.body.error, FAILED);
  }
  const blocked = await loginReq(user.email, user.password, ip);
  assert.equal(blocked.status, 429, "6번째 — 올바른 비밀번호여도 막힌다");
  assert.equal(blocked.body.error, TOO_MANY);
  const wait = Number(blocked.retryAfter);
  assert.ok(Number.isInteger(wait) && wait >= 1 && wait <= 900, `retry-after ${blocked.retryAfter}`);
  assert.equal(blocked.body.retry_after_seconds, wait);
  assert.equal(blocked.setCookies.length, 0, "막힌 요청은 세션을 만들지 않는다");
  // 7번째도 계속 막힌다 — 막힌 요청은 횟수를 더 올리지 않는다
  assert.equal((await loginReq(user.email, user.password, ip)).status, 429);
  const pair = await throttleRow("login_pair", `${user.email.toLowerCase()}|${ip}`);
  assert.equal(pair.length, 1);
  assert.equal(pair[0].count, 5, "실패 5번만 센다 — 막힌 시도는 세지 않는다");
  assert.equal((await throttleRow("login_account", user.email.toLowerCase()))[0].count, 5);
  assert.equal((await throttleRow("login_ip", ip))[0].count, 5);
});

test("A2 같은 계정을 다른 IP에서 시도하는 사람이 있어도 본인은 자기 IP에서 로그인된다 (이메일+IP 짝 단위 잠금)", async () => {
  const user = await staff.createUser({ label: "lim-victim" });
  const attackerIp = newIp();
  for (let n = 1; n <= 5; n++) assert.equal((await loginReq(user.email, `guess-${n}-${staff.run}`, attackerIp)).status, 401);
  assert.equal((await loginReq(user.email, user.password, attackerIp)).status, 429, "공격자 IP의 짝은 막힘");
  const own = await loginReq(user.email, user.password, newIp());
  assert.equal(own.status, 200, "본인은 다른 IP — 짝이 달라 막히지 않는다");
  assert.ok(own.setCookies.length > 0);
});

test("A3 막힌 IP에서도 다른 계정은 영향이 없다 (IP 횟수는 30회 한도 아래)", async () => {
  const blockedUser = await staff.createUser({ label: "lim-a" });
  const otherUser = await staff.createUser({ label: "lim-b" });
  const ip = newIp();
  for (let n = 1; n <= 5; n++) await loginReq(blockedUser.email, `nope-${n}-${staff.run}`, ip);
  assert.equal((await loginReq(blockedUser.email, blockedUser.password, ip)).status, 429);
  assert.equal((await loginReq(otherUser.email, otherUser.password, ip)).status, 200, "같은 IP의 다른 계정");
});

test("A4 로그인에 성공하면 짝·이메일 횟수는 지워지고 IP 횟수는 남는다 — 지운 뒤 다시 5번까지 허용, 6번째 429", async () => {
  const user = await staff.createUser({ label: "lim-reset" });
  const ip = newIp();
  for (let n = 1; n <= 3; n++) assert.equal((await loginReq(user.email, `bad-${n}-${staff.run}`, ip)).status, 401);
  assert.equal((await throttleRow("login_pair", `${user.email.toLowerCase()}|${ip}`))[0].count, 3);
  assert.equal((await loginReq(user.email, user.password, ip)).status, 200);
  assert.deepEqual(await throttleRow("login_pair", `${user.email.toLowerCase()}|${ip}`), [], "짝 횟수 초기화");
  assert.deepEqual(await throttleRow("login_account", user.email.toLowerCase()), [], "이메일 횟수 초기화");
  assert.equal((await throttleRow("login_ip", ip))[0].count, 3, "IP 횟수는 그대로");
  for (let n = 1; n <= 5; n++) assert.equal((await loginReq(user.email, `again-${n}-${staff.run}`, ip)).status, 401, `초기화 뒤 ${n}번째`);
  assert.equal((await loginReq(user.email, user.password, ip)).status, 429);
});

test("A5 없는 계정도 똑같이 6번째에 429 — 계정 유무가 드러나지 않고, 대소문자·공백·전각을 바꿔도 한 계정으로 센다", async () => {
  const ghost = `ghost-${staff.run}@e2e.example.test`;
  const ip = newIp();
  const variants = [ghost, ghost.toUpperCase(), ` ${ghost} `, ghost, ghost.replace("@", "＠"), ghost.toUpperCase()];
  for (const [i, v] of variants.slice(0, 5).entries()) {
    const r = await loginReq(v, `x-${i}-${staff.run}`, ip);
    assert.equal(r.status, 401, `${i + 1}번째 (${JSON.stringify(v)})`);
    assert.equal(r.body.error, FAILED, "없는 계정도 같은 문장");
  }
  const sixth = await loginReq(variants[5], `x-5-${staff.run}`, ip);
  assert.equal(sixth.status, 429);
  assert.equal(sixth.body.error, TOO_MANY, "있는 계정의 429와 같은 문장");
});

test("A6 이메일 전체(login_account)·IP(login_ip) 한도 — 설정을 낮춰 n번째 허용 · n+1번째 차단, 짝이 달라도 합쳐서 센다", () =>
  withLimits({ login_account: { window: 900, limit: 3 }, login_ip: { window: 900, limit: 4 } }, async () => {
    const user = await staff.createUser({ label: "lim-account" });
    // 이메일 한도 3: 서로 다른 IP 3곳에서 실패 → 4번째 IP의 시도는 막힌다 (올바른 비밀번호여도)
    for (let n = 1; n <= 3; n++) assert.equal((await loginReq(user.email, `acct-${n}-${staff.run}`, newIp())).status, 401, `${n}번째`);
    const fourth = await loginReq(user.email, user.password, newIp());
    assert.equal(fourth.status, 429, "이메일 3번 한도 다음 번");
    // IP 한도 4: 한 IP에서 서로 다른 이메일 4번 실패 → 5번째는 새 이메일이어도 막힌다
    const ip = newIp();
    for (let n = 1; n <= 4; n++) assert.equal((await loginReq(`spray-${n}-${staff.run}@e2e.example.test`, `spray-${n}-${staff.run}`, ip)).status, 401, `IP ${n}번째`);
    const spray = await loginReq(`spray-5-${staff.run}@e2e.example.test`, `spray-5-${staff.run}`, ip);
    assert.equal(spray.status, 429, "IP 4번 한도 다음 번");
    const lim2 = await staff.createUser({ label: "lim-account-2" });
    assert.equal((await loginReq(lim2.email, lim2.password, newIp())).status, 200, "다른 IP·다른 계정은 영향 없다");
  }));

test("A7 설정(auth_limits)을 바꾸면 다음 요청부터 적용된다 — 짝 한도를 2로 낮추면 3번째부터 429 (코드에 5가 박혀 있지 않다)", () =>
  withLimits({ login_pair: { window: 900, limit: 2 } }, async () => {
    const user = await staff.createUser({ label: "lim-config" });
    const ip = newIp();
    assert.equal((await loginReq(user.email, `c1-${staff.run}`, ip)).status, 401);
    assert.equal((await loginReq(user.email, `c2-${staff.run}`, ip)).status, 401);
    assert.equal((await loginReq(user.email, user.password, ip)).status, 429);
  }));

test("A8 시도 횟수 열쇠(GUARD_SECRET)가 없으면 로그인은 닫힌다(503) — 올바른 비밀번호여도 세션을 만들지 않는다", async () => {
  const user = await staff.createUser({ label: "lim-nosecret" });
  const closed = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    NEXT_PUBLIC_SITE_URL: SITE,
    GUARD_SECRET: "",
  });
  try {
    const r = await loginReq(user.email, user.password, newIp(), closed);
    assert.equal(r.status, 503);
    assert.equal(r.setCookies.length, 0);
    assert.match(r.body.error, /서버 설정이 끝나지 않았습니다/);
    assert.match(closed.log(), /GUARD_SECRET이 없습니다/, "원인은 서버 기록에 남는다(값은 없다)");
  } finally {
    closed.stop();
  }
});

test("A9 시도 횟수 표에는 이메일·IP 원문이 없다 — 이 시험이 만든 모든 줄의 키는 해시 32글자", async () => {
  const { rows } = await db.query("select * from public.request_throttles where window_start >= $1", [t0]);
  assert.ok(rows.length >= 6, `시험이 만든 줄 ${rows.length}`);
  const dump = JSON.stringify(rows);
  assert.ok(!dump.includes("@"), "이메일 원문");
  assert.ok(!/\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(dump), "IP 원문");
  for (const r of rows) assert.match(r.key_hash, /^[0-9a-f]{32}$/);
});

// ── B. 비밀번호 바꾸기 API ─────────────────────────────────

test("B1 로그인하지 않았거나 쿠키 없이 Bearer 토큰만 있거나 다른 사이트에서 오면 거부한다 (401·401·403)", async () => {
  const user = await staff.createUser({ label: "pw-guard", email: ADMINS[2], roles: [] });
  const none = await fetch(`${server.base}/api/auth/password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currentPassword: user.password, newPassword: "Zk3#unused-pass", newPasswordConfirm: "Zk3#unused-pass" }),
  });
  assert.equal(none.status, 401);
  const bearer = await fetch(`${server.base}/api/auth/password`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${user.token}` },
    body: JSON.stringify({ currentPassword: user.password, newPassword: "Zk3#unused-pass", newPasswordConfirm: "Zk3#unused-pass" }),
  });
  assert.equal(bearer.status, 401, "이 기기가 어느 세션인지는 쿠키 세션으로만 안다");
  const dev = await device(user);
  const cross = await changePassword(dev, user.password, "Zk3#unused-pass", "Zk3#unused-pass", { origin: "https://evil.example" });
  assert.equal(cross.status, 403);
  assert.equal((await loginReq(user.email, user.password, newIp())).status, 200, "비밀번호는 그대로");
});

test("B2 현재 비밀번호가 틀리면 422(currentPassword)이고 비밀번호는 그대로 — 5번 틀린 뒤 6번째는 올바른 현재 비밀번호여도 429", async () => {
  const user = await staff.createUser({ label: "pw-throttle", email: ADMINS[1] });
  const dev = await device(user);
  const newPw = `Nw7!${staff.run}-aa`;
  for (let n = 1; n <= 5; n++) {
    const r = await changePassword(dev, `wrong-${n}-${staff.run}`, newPw);
    assert.equal(r.status, 422, `${n}번째`);
    assert.equal(r.body.field, "currentPassword");
    assert.equal(r.body.error, "현재 비밀번호가 맞지 않습니다");
  }
  const sixth = await changePassword(dev, user.password, newPw);
  assert.equal(sixth.status, 429);
  assert.equal(sixth.body.error, TOO_MANY);
  assert.ok(Number(sixth.retryAfter) >= 1);
  assert.equal((await loginReq(user.email, user.password, newIp())).status, 200, "비밀번호는 그대로");
  assert.equal((await loginReq(user.email, newPw, newIp())).status, 401, "새 비밀번호로는 로그인되지 않는다");
  // 횟수는 계정 기준 해시 — 다른 계정은 영향이 없다
  const other = await staff.createUser({ label: "pw-other" });
  const otherDev = await device(other);
  assert.equal((await changePassword(otherDev, `wrong-${staff.run}`, newPw)).status, 422);
});

test("B3 새 비밀번호 규칙 위반은 422(newPassword) — 설계 2.6 거부 견본, 확인 칸이 다르면 422(newPasswordConfirm), 현재와 같아도 422 — 비밀번호는 그대로", async () => {
  await staff.removeLeftover("acct-rules-user@example.test");
  const user = await staff.createUser({ label: "pw-rules", email: "acct-rules-user@example.test" });
  const dev = await device(user);
  const local = "acct-rules-user";
  const bad = [
    ["짧은암호1", "10글자 이상"],
    ["          ", "공백"],
    ["aaaaaaaaaaaa", "한 글자만 반복"],
    ["1234567890", "흔한"],
    ["password1234", "흔한"],
    ["qwertyuiop", "흔한"],
    [`${local}-secret-9`, "이메일 주소의 앞부분"],
    [user.email, "이메일 주소와 같은"],
    ["Ab1".repeat(24) + "Z", "72바이트"],
  ];
  for (const [candidate, reason] of bad) {
    const r = await changePassword(dev, user.password, candidate);
    assert.equal(r.status, 422, `'${candidate.trim()}' (${reason})`);
    assert.equal(r.body.field, "newPassword");
    assert.ok(r.body.error.includes(reason), `${JSON.stringify(candidate)} → ${r.body.error}`);
  }
  const mismatch = await changePassword(dev, user.password, `Nw7!${staff.run}-bb`, `Nw7!${staff.run}-cc`);
  assert.deepEqual([mismatch.status, mismatch.body.field], [422, "newPasswordConfirm"]);
  const same = await changePassword(dev, user.password, user.password);
  assert.deepEqual([same.status, same.body.field], [422, "newPassword"]);
  const empty = await call(dev, "POST", "/api/auth/password", { currentPassword: user.password, newPassword: "", newPasswordConfirm: "" });
  assert.deepEqual([empty.status, empty.body.field], [422, "newPassword"]);
  assert.equal((await loginReq(user.email, user.password, newIp())).status, 200, "규칙을 어긴 요청은 모두 비밀번호를 바꾸지 못했다");
  // 경계: 정확히 10글자·72바이트는 통과한다 (이 요청들은 실제로 바꾸므로 마지막에)
  const ten = `Tn7!${staff.run.slice(0, 6)}`;
  assert.equal(ten.length, 10);
  const ok10 = await changePassword(dev, user.password, ten);
  assert.equal(ok10.status, 200, JSON.stringify(ok10.body));
  const seventyTwo = "Zx9".repeat(24);
  const ok72 = await changePassword(dev, ten, seventyTwo);
  assert.equal(ok72.status, 200, JSON.stringify(ok72.body));
  assert.equal((await loginReq(user.email, seventyTwo, newIp())).status, 200);
});

test("B4 비밀번호를 바꾸면 이 기기는 로그인이 유지되고, 다른 기기(쿠키 세션)와 다른 세션(Bearer 토큰)은 끊기며, 옛 비밀번호는 거부·새 비밀번호는 로그인된다 — 감사 로그 정확히 1건(비밀번호·이메일 0)", async () => {
  const user = await staff.createUser({ label: "pw-sessions", email: ADMINS[0] });
  const a = await device(user);
  const b = await device(user);
  const bearer = await staff.signIn(user.email, user.password);
  const statuses = async () => ({
    a: await adminApiStatus({ headers: { cookie: cookieHeader(a.jar) } }),
    b: await adminApiStatus({ headers: { cookie: cookieHeader(b.jar) } }),
    bearer: await adminApiStatus({ headers: { authorization: `Bearer ${bearer}` } }),
  });
  assert.deepEqual(await statuses(), { a: 200, b: 200, bearer: 200 }, "바꾸기 전에는 세 세션 모두 관리자 API가 열린다");

  const newPw = `Nw7!${staff.run}-zz`;
  const done = await changePassword(a, user.password, newPw);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.otherSessionsEnded, true);

  assert.deepEqual(await statuses(), { a: 200, b: 401, bearer: 401 }, "이 기기(A)만 남고 다른 기기(B)·Bearer 세션은 끊겼다");
  const pageA = await call(a, "GET", "/account/password");
  assert.equal(pageA.status, 200, "이 기기는 화면도 그대로 열린다");
  const pageB = await call(b, "GET", "/account/password");
  assert.equal(pageB.status, 307, "끊긴 기기는 화면 대신 로그인으로 보낸다");
  assert.match(pageB.location, /^\/admin\/login\?next=%2Faccount%2Fpassword$/);
  assert.equal((await loginReq(user.email, user.password, newIp())).status, 401, "옛 비밀번호 거부");
  assert.equal((await loginReq(user.email, newPw, newIp())).status, 200, "새 비밀번호 로그인");

  const logs = (await db.query("select actor, action, target, before, after, reason from public.audit_logs where action = 'account.password_changed' and target = $1", [`user:${user.id}`])).rows;
  assert.equal(logs.length, 1, "감사 로그 정확히 1건");
  assert.equal(logs[0].actor, `user:${user.id}`);
  const dump = JSON.stringify(logs);
  for (const secret of [user.password, newPw, user.email, ADMINS[0]]) assert.ok(!dump.includes(secret), "감사 로그에 비밀번호·이메일 0");
  // 틀린 시도는 감사 로그를 만들지 않는다
  assert.equal((await one("select count(*)::int n from public.audit_logs where action = 'account.password_changed' and target = $1", [`user:${user.id}`])).n, 1);
});

test("B5 편집국 역할만 있는 계정(관리자 아님)도 비밀번호를 바꿀 수 있다 (설계 4.2 — 편집국·관리자·회원 모두)", async () => {
  const reporter = await staff.createUser({ label: "pw-reporter", roles: ["reporter"], person: { name: "비밀번호 기자", roles: ["reporter"] } });
  const dev = await device(reporter);
  const newPw = `Rp5#${staff.run}-qq`;
  assert.equal((await changePassword(dev, reporter.password, newPw)).status, 200);
  assert.equal((await loginReq(reporter.email, newPw, newIp())).status, 200);
});

test("B6 서버 기록에 비밀번호·이메일이 없다 (이 시험이 쓴 모든 비밀번호를 서버 표준 출력·오류에서 찾는다)", () => {
  const log = server.log();
  for (const secret of passwordsUsed) {
    if (secret.trim().length < 6) continue;
    assert.ok(!log.includes(secret), `서버 기록에 비밀번호가 있다: ${secret.slice(0, 4)}…`);
  }
  assert.ok(!/@e2e\.example\.test|@example\.test/.test(log), "서버 기록에 시험 이메일이 있다");
});

// ── C. 실제 브라우저 ───────────────────────────────────────

async function interactive(page) {
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^(로그아웃|로그인|비밀번호 바꾸기)$/.test(b.textContent.trim()) && !b.disabled));
}

async function browserLogin(user, password, next) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  contexts.push(context);
  const page = await context.newPage();
  await page.setExtraHTTPHeaders({ "x-real-ip": newIp() });
  await page.goto(`${server.base}/admin/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await interactive(page);
  await page.fill("#login-email", user.email);
  await page.fill("#login-password", password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((url) => url.pathname !== "/admin/login");
  return page;
}

test("C1 로그인하지 않고 /account/password를 열면 로그인 화면으로 갔다가 로그인 뒤 그 화면으로 돌아온다 — noindex", async () => {
  const user = await staff.createUser({ label: "pw-ui-next" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  contexts.push(context);
  const page = await context.newPage();
  await page.setExtraHTTPHeaders({ "x-real-ip": newIp() });
  await page.goto(`${server.base}/account/password`);
  assert.equal(new URL(page.url()).pathname, "/admin/login");
  assert.equal(new URL(page.url()).searchParams.get("next"), "/account/password");
  await interactive(page);
  await page.fill("#login-email", user.email);
  await page.fill("#login-password", user.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((url) => url.pathname === "/account/password");
  await page.getByRole("heading", { name: "비밀번호 바꾸기" }).waitFor();
  assert.match((await page.locator('meta[name="robots"]').getAttribute("content")) ?? "", /noindex/);
  assert.equal(await page.getByTestId("account-email").innerText(), user.email);
  assert.ok(await page.getByRole("link", { name: "홈으로 돌아가기" }).isVisible(), "편집국 역할이 없는 계정은 홈으로 돌아간다");
  const res = await fetch(`${server.base}/account/password`, { redirect: "manual" });
  assert.equal(res.status, 307, "쿠키 없이는 화면을 주지 않는다");
  assert.match(res.headers.get("x-robots-tag") ?? "", /noindex/);
});

test("C2 머리말 [비밀번호 바꾸기] 링크 → 화면 → 칸 오류(두 칸 다름·규칙·틀린 현재 비밀번호) → 완료 문구 → 새 비밀번호로 다시 로그인", async () => {
  const user = await staff.createUser({ label: "pw-ui", email: ADMINS[3] });
  const page = await browserLogin(user, user.password);
  await interactive(page);
  await page.getByTestId("password-link").click();
  await page.waitForURL((url) => url.pathname === "/account/password");
  await interactive(page);
  const submit = () => page.getByRole("button", { name: "비밀번호 바꾸기" }).click();
  const newPw = `Ui6#${staff.run}-kk`;
  passwordsUsed.add(newPw);

  await page.fill("#current-password", user.password);
  await page.fill("#new-password", newPw);
  await page.fill("#new-password-confirm", `${newPw}x`);
  await submit();
  await page.getByText("새 비밀번호 두 칸이 같지 않습니다").waitFor();

  await page.fill("#new-password", "짧은암호1");
  await page.fill("#new-password-confirm", "짧은암호1");
  await submit();
  await page.getByText("비밀번호는 10글자 이상이어야 합니다").waitFor();

  await page.fill("#current-password", `wrong-${staff.run}`);
  await page.fill("#new-password", newPw);
  await page.fill("#new-password-confirm", newPw);
  await submit();
  await page.getByText("현재 비밀번호가 맞지 않습니다").waitFor();
  assert.equal(await page.locator("#current-password").getAttribute("aria-invalid"), "true", "틀린 칸이 표시된다");

  await page.fill("#current-password", user.password);
  await submit();
  await page.locator("#password-done").waitFor();
  assert.equal(await page.locator("#current-password").inputValue(), "", "완료 뒤 입력칸을 비운다");
  assert.equal((await loginReq(user.email, user.password, newIp())).status, 401);
  assert.equal((await loginReq(user.email, newPw, newIp())).status, 200);
  // 이 기기는 로그인이 유지된다 — 편집국으로 돌아가는 링크가 있고 화면이 열린다
  await page.getByRole("link", { name: "편집국으로 돌아가기" }).click();
  await page.waitForURL((url) => url.pathname === "/admin");
});
