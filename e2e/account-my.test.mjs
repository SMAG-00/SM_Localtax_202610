// 회원 /my·맞춤 새 글 E2E (W2-e 3-A — docs/dev/W2-e_설계.md 5.1 · 5.2, ACC-02 · HOME-07)
//  A) 가입 화면에서 분야·지역을 골라 가입 → 확인 → /my 새 글 블록에 관심 분야 기사만 · 선택 동의 행 0 · signup_completed 1건(tier basic, 분야 수·지역 수뿐)
//  B) 상한+1·없는 코드·없는 하위 분야 거부(저장된 값 그대로) · 지역 저장만으로 consents에 새 행 0
//  C) 수신 동의 켜기(행 생성)·끄기(revoked_at, 행 보존)
//  D) 두 계정이 번갈아 들어와도 서로의 블록이 안 보임 · 홈 HTML에 회원 블록 0
//  E) 360px 가입 화면 R1~R3(측정 규칙 중 R2·R3) · 접근성 95
// standalone 빌드를 띄우고 로컬 Supabase(Auth·DB·메일 수신함)에 붙인다. 계정·기사는 시험이 만들고 끝나면 지운다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright";
import { buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { waitForMail } from "./lib/mail.mjs";
import { StaffFixture } from "./lib/staff.mjs";
import { publishSignupPolicies } from "./lib/policy-fixture.mjs";

/** 가입이 열리려면 이용약관·개인정보처리방침 게시본이 있어야 한다(W2-e 6.3) — 시험용 가짜 게시본을 지우는 함수 */
let removePolicies;
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { measurePage } from "./lib/screen-rules.mjs";

const SITE = "https://e2e.example.test";
const PASSWORD = "Zq7-correct-horse-9";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let sb, staff, db, browser, server, t0;
let ids = {};
let createdRegion = null;
let ctxA, pageA;
const email = (label) => `my-${label}-${staff.run}@e2e.example.test`;

const consentRows = async (userId) => (await db.query("select id, kind, channel, revoked_at from public.consents where user_id = $1 order by id", [userId])).rows;
const profileOf = async (userId) => (await db.query("select display_name, interests, interest_region_codes from public.profiles where id = $1", [userId])).rows[0];
const idOfEmail = async (address) => (await db.query("select id from auth.users where email = $1", [address])).rows[0].id;

async function postProfile(page, body) {
  const res = await page.request.post(`${server.base}/api/my/profile`, { headers: { origin: server.base }, data: body });
  return { status: res.status(), json: await res.json().catch(() => null) };
}
async function login(page, address, password) {
  await page.goto(`${server.base}/login`);
  await page.fill('input[name="email"]', address);
  await page.fill('input[name="password"]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click('button[type="submit"]')]);
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  staff = new StaffFixture(sb);
  await staff.connect();
  removePolicies = await publishSignupPolicies(staff.db, staff.run);
  db = staff.db;
  await staff.snapshotOperations();
  t0 = (await db.query("select now() as t")).rows[0].t;
  await db.query("update public.settings set value = jsonb_set(value, '{members}', 'true'::jsonb) where key = 'feature_flags'");
  // 앞 실행이 중간에 멈춰 남긴 이 시험의 지역 행(slug e2e-my-gu-*)을 먼저 지운다 — 남은 행을 '원래 있던 시·군·구'로 오인해 계속 남기지 않게
  await db.query("delete from public.regions where slug like 'e2e-my-gu-%'");
  const sido = (await db.query("select code, name from public.regions where level = 'sido' and (valid_to is null or valid_to >= current_date) order by code limit 1")).rows[0];
  let gu = (await db.query("select code, name from public.regions where level = 'sigungu' and parent_code = $1 and (valid_to is null or valid_to >= current_date) order by code limit 1", [sido.code])).rows[0];
  if (!gu) {
    // 로컬 씨앗에 시·군·구가 없으면 이 시험이 하나 만들고 끝나면 지운다. 코드는 DB 시험·통합 시험이 쓰는 xx999 대와 겹치지 않는 xx998 대
    gu = (await db.query("insert into public.regions (code, parent_code, level, name, slug) values ($1, $2, 'sigungu', '마이시험구', $3) returning code, name", [`${sido.code.slice(0, 2)}99800000`, sido.code, `e2e-my-gu-${staff.run}`])).rows[0];
    createdRegion = gu.code;
  }
  const person = (await db.query("insert into public.people (slug, name, roles, visibility) values ($1, '마이 시험 기자', array['reporter'], 'public') returning id", [`e2e-my-${staff.run}`])).rows[0];
  staff.personIds.add(Number(person.id));
  const article = async (title, section) => {
    const r = await db.query(
      "insert into public.articles (slug, title, section, content_type, status, author_id, body, first_published_at) values ($1, $2, $3, 'explainer', 'published', $4, $5, now() - interval '1 day') returning id",
      [`e2e-my-${section}-${staff.run}`, title, section, person.id, JSON.stringify({ blocks: [{ type: "paragraph", text: "본문" }], claims: [] })],
    );
    staff.articleIds.add(Number(r.rows[0].id));
    return Number(r.rows[0].id);
  };
  ids = { sido, gu, taxTitle: `마이시험 지방세 ${staff.run}`, finTitle: `마이시험 개발금융 ${staff.run}` };
  await article(ids.taxTitle, "tax");
  await article(ids.finTitle, "finance");
  server = await startServer({ NEXT_PUBLIC_SUPABASE_URL: sb.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey, SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey, NEXT_PUBLIC_SITE_URL: SITE });
  browser = await chromium.launch({ args: [] });
});

after(async () => {
  server?.stop();
  await browser?.close();
  if (db && t0) {
    await db.query("delete from public.request_throttles where window_start >= $1", [t0]);
    await db.query("delete from public.analytics_events where occurred_at >= $1 and name = 'signup_completed'", [t0]);
  }
  await removePolicies?.(); // cleanup()이 DB 연결을 닫기 전에
  await staff?.cleanup();
  // staff.cleanup()은 끝에 DB 연결을 닫는다 — 그 뒤의 지우기는 새 연결로 한다(예전에는 닫힌 연결로 지우다 조용히 실패해 지역 행이 남았다)
  if (createdRegion) {
    const c = new pg.Client({ connectionString: sb.dbUrl });
    await c.connect();
    try {
      const removed = await c.query("delete from public.regions where code = $1", [createdRegion]);
      assert.equal(removed.rowCount, 1, `시험이 만든 지역 ${createdRegion}을 지우지 못했다 — 다음 DB 시험과 충돌한다`);
    } finally {
      await c.end();
    }
  }
});

test("A 가입 화면에서 분야·지역을 골라 가입하면 /my 새 글 블록에 그 분야 기사만 나오고 선택 동의 행은 0, signup_completed 1건(tier basic)", async () => {
  const address = email("a");
  ctxA = await browser.newContext();
  pageA = await ctxA.newPage();
  await pageA.goto(`${server.base}/signup`);
  await pageA.fill("#signup-email", address);
  await pageA.fill("#signup-password", PASSWORD);
  await pageA.check('input[name="interests"][value="tax"]');
  const guBox = pageA.locator(`input[name="regionCodes"][value="${ids.gu.code}"]`);
  await pageA.locator("details", { has: guBox }).locator("summary").click();
  await guBox.check();
  assert.equal(await pageA.locator('input[name="optReceive"]').isChecked(), false, "선택 동의는 기본 해제");
  assert.equal(await pageA.locator('input[name="optMarketing"]').isChecked(), false, "선택 동의는 기본 해제");
  await pageA.check('input[name="agreeTerms"]');
  await pageA.check('input[name="agreePrivacy"]');
  await sleep(3200);
  await Promise.all([pageA.waitForURL(/\/signup\?sent=1/), pageA.click('button[type="submit"]')]);

  const [mail] = await waitForMail(address);
  const link = /https?:\/\/\S+\/auth\/confirm\?\S+/.exec(mail.Text)[0];
  await pageA.goto(link.replace(SITE, server.base));
  await Promise.all([pageA.waitForURL(/\/my\?welcome=1/), pageA.click('button:has-text("가입 확인하기")')]);
  ids.userA = await idOfEmail(address);
  staff.userIds.add(ids.userA);

  const feed = await pageA.textContent('[data-testid="my-feed"]');
  assert.ok(feed.includes(ids.taxTitle), "관심 분야(지방세) 기사가 블록에 있다");
  assert.ok(!feed.includes(ids.finTitle), "관심 밖(개발금융) 기사는 블록에 없다");
  assert.deepEqual((await consentRows(ids.userA)).map((r) => r.kind), ["signup"], "선택 동의를 체크하지 않았으면 가입 동의 행 하나뿐");

  let events = [];
  for (let i = 0; i < 20 && events.length === 0; i += 1) {
    events = (await db.query("select tier, props from public.analytics_events where name = 'signup_completed' and occurred_at >= $1", [t0])).rows;
    if (events.length === 0) await sleep(300);
  }
  assert.equal(events.length, 1, "가입 확인 완료 때 signup_completed 1건");
  assert.equal(events[0].tier, "basic");
  assert.deepEqual(events[0].props, { interest_count: 1, region_count: 1 }, "분야 수·지역 수뿐");
  await pageA.reload();
  await sleep(500);
  assert.equal((await db.query("select count(*)::int n from public.analytics_events where name = 'signup_completed' and occurred_at >= $1", [t0])).rows[0].n, 1, "새로고침해도 다시 보내지 않는다");
});

test("B 상한+1·없는 지역 코드·없는 하위 분야는 거부되고 저장된 값은 그대로, 지역만 저장하면 consents에 새 행이 없다", async () => {
  const limit = (await db.query("select (value->>'interest_region_limit')::int n from public.settings where key = 'member'")).rows[0].n;
  const before = await profileOf(ids.userA);
  const codes = (await db.query("select code from public.regions where valid_to is null order by code limit $1", [limit + 1])).rows.map((r) => r.code);
  assert.equal(codes.length, limit + 1);
  const over = await postProfile(pageA, { intent: "profile", interests: ["tax"], regionCodes: codes });
  assert.equal(over.status, 422);
  assert.equal(over.json.code, "regions");
  const fake = await postProfile(pageA, { intent: "profile", interests: ["tax"], regionCodes: ["9999999999"] });
  assert.equal(fake.status, 422);
  assert.equal(fake.json.code, "codes", "regions에 없는 코드");
  const badSub = await postProfile(pageA, { intent: "profile", interests: ["tax:no-such-sub"], regionCodes: [] });
  assert.equal(badSub.status, 422);
  assert.equal(badSub.json.code, "codes", "없는 하위 분야");
  assert.deepEqual(await profileOf(ivdUser()), before, "거부된 요청은 아무것도 바꾸지 않는다");

  const atLimit = await postProfile(pageA, { intent: "profile", interests: ["tax"], regionCodes: codes.slice(0, limit) });
  assert.equal(atLimit.status, 200, "상한 개수는 저장된다");
  assert.deepEqual((await profileOf(ids.userA)).interest_region_codes, codes.slice(0, limit));
  assert.deepEqual((await consentRows(ids.userA)).map((r) => r.kind), ["signup"], "관심 지역 저장만으로 새 동의 행은 생기지 않는다");
});

function ivdUser() {
  return ids.userA;
}

test("C 수신 동의 켜기는 행을 만들고 끄기는 revoked_at을 채우되 행은 남긴다 — 화면 버튼으로", async () => {
  await pageA.goto(`${server.base}/my`);
  assert.ok((await pageA.textContent("main")).includes("지금은 보내는 메일이 없습니다"), "보내는 메일이 없다는 안내");
  await Promise.all([pageA.waitForURL(/\/my\?saved=consent/), pageA.click('[data-testid="consent-receive"] button')]);
  let rows = (await consentRows(ids.userA)).filter((r) => r.kind === "receive");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channel, "web_my");
  assert.equal(rows[0].revoked_at, null);
  await Promise.all([pageA.waitForURL(/\/my\?saved=consent/), pageA.click('[data-testid="consent-receive"] button')]);
  rows = (await consentRows(ids.userA)).filter((r) => r.kind === "receive");
  assert.equal(rows.length, 1, "행은 남는다");
  assert.ok(rows[0].revoked_at, "끄면 revoked_at");
  assert.equal((await consentRows(ids.userA)).filter((r) => r.kind === "marketing").length, 0, "다른 동의는 그대로 0행");
});

test("D 두 계정이 번갈아 로그인해도 서로의 새 글 블록이 안 보이고, 홈 HTML에는 회원 블록이 없다", async () => {
  const b = await staff.createUser({ label: "my-b", email: email("b") });
  await db.query("insert into public.profiles (id, interests) values ($1, array['finance'])", [b.id]);
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await login(pageB, b.email, b.password);
  await pageB.goto(`${server.base}/my`);
  const feedB = await pageB.textContent('[data-testid="my-feed"]');
  assert.ok(feedB.includes(ids.finTitle) && !feedB.includes(ids.taxTitle), "B는 자기 관심(개발금융)만");
  await pageA.goto(`${server.base}/my`);
  const feedA = await pageA.textContent('[data-testid="my-feed"]');
  assert.ok(feedA.includes(ids.taxTitle) && !feedA.includes(ids.finTitle), "A는 자기 관심(지방세)만");
  await pageB.goto(`${server.base}/my`);
  assert.ok(!(await pageB.textContent('[data-testid="my-feed"]')).includes(ids.taxTitle), "다시 B로 와도 A의 글이 없다");

  for (const html of [await (await fetch(`${server.base}/`)).text(), await pageA.request.get(`${server.base}/`).then((r) => r.text())]) {
    assert.ok(!html.includes("내 관심 분야 새 글") && !html.includes("my-feed"), "홈 HTML에 회원 블록 0");
  }
  const res = await fetch(`${server.base}/my`, { redirect: "manual" });
  assert.ok([302, 303, 307].includes(res.status), "로그인 없이 /my는 로그인으로 보낸다");
  await ctxB.close();
});

test("E /my 응답은 noindex·캐시 없음이고 member_feed 정의는 analytics_events를 읽지 않는다", async () => {
  const res = await pageA.request.get(`${server.base}/my`);
  const html = await res.text();
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.match(res.headers()["cache-control"] ?? "", /no-store|private|no-cache/);
  const def = (await db.query("select pg_get_functiondef('public.member_feed(text[],text[],integer,integer)'::regprocedure) d")).rows[0].d;
  assert.ok(!/analytics_events/.test(def));
});

test("F 360px 가입 화면 — R2(주 버튼 ≤1)·R3(오렌지 ≤5%) 통과, 접근성 95 이상", async () => {
  const m = await measurePage(browser, `${server.base}/signup`, { width: 360, height: 740 });
  assert.ok(m.r2.pass, `R2 ${JSON.stringify(m.r2)}`);
  assert.ok(m.r3.pass, `R3 ${JSON.stringify(m.r3)}`);
  const port = freePort ? await freePort() : 9222;
  const lh = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
  try {
    const r = await accessibility(`${server.base}/signup`, port);
    assert.ok(r.score >= A11Y_MIN, `접근성 ${r.score} 미흡: ${r.failing.join(",")}`);
  } finally {
    await lh.close();
  }
});
