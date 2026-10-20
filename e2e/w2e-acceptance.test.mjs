// W2-e 수용 E2E (7단계) — PRD-01A 9장 W2-e 증거 전부를 한 시험 자료·한 서버·한 브라우저로 (docs/dev/W2-e_설계.md 1장 7단계 · 9.2 · 11.7)
// 9장 증거: 회원 E2E 통과 · 평문 이메일 0 검사 통과 · 바닥글·기사 하단 정책 링크 전수 404 0
// 수용 기준: ACC-01~03 · HOME-06 · HOME-07 · HELP-01~05 · ADM-02 · ADM-03 · ADM-04
//  1) 자료·출발점 — 기능 키가 켜져 있어도 정책 게시본이 없으면 새 경로 전부 404·링크 0 (시나리오 12 의존) → 가짜 게시본을 만들면 열린다
//  2) 시나리오 1 회원 E2E — 가입(관심 분야·지역) → 수신함 메일 → 확인 → /my 새 글 → 문의(로그인 상태) → 재설정 → 탈퇴 → 프로필·동의·Auth 0
//  3) 시나리오 7 평문 이메일 0 — 9.2 여섯 면(공개 HTML 전수 크롤링 · 공개 API · DB 전체 칸 · 감시 주소 추적 · 서버 기록 · 측정 이벤트)
//  4) 시나리오 6 정책 링크 전수 — 바닥글·기사 하단·메뉴 어디서 따라가도 404·5xx 0
//  5) 시나리오 3·8·10 짧게 — 가입 요청에 역할 값 · 고객센터 폼 5종 → 문의함 · 브리핑 사전 알림(확인 전 미확정·철회) · subscribers 표 없음
//  6) 시나리오 11 ADM-02 회원 삭제 · ADM-04 PO 아닌 관리자 403 + 감사 로그 정확히 1건
//  7) 시나리오 12 기능 키 꺼짐 → 새 경로 404·링크 0, 켜면 배포 없이 열림
//  8) 시나리오 14 정적 — 정책 본문은 마이그레이션·코드·씨앗에 없다
//  9) 시나리오 15 새 화면 R1~R3(360·640·1024) · 360px 가로 스크롤 0 · 접근성 95
// 10) 정리 — 표마다 시험 전 행 수, 운영 설정 값 그대로
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { chromium } from "playwright";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { ROOT, buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { mailEnv, waitForMail } from "./lib/mail.mjs";
import { publishPolicies } from "./lib/policy-fixture.mjs";
import { measurePage } from "./lib/screen-rules.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e.example.test";
const ADMIN_EMAIL = "w2e-acceptance-admin@example.test";
const PO_EMAIL = "w2e-acceptance-po@example.test";
const HUMAN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const SECRET = crypto.randomBytes(24).toString("hex");
const PASSWORD = "Zq7-correct-horse-9";
const NEW_PASSWORD = "Nw3-battery-staple-8";
const BODY = "기사 본문에 오류가 있어 알려 드립니다. 확인 부탁드립니다.";
const POLICY_DOCS = ["about", "editorial-policy", "ethics", "corrections", "ad-policy", "privacy", "terms", "advertise"];
const NEW_FLAGS = ["page_about", "page_editorial_policy", "page_ethics", "page_corrections", "page_ad_policy", "page_privacy", "page_terms", "page_no_email", "page_advertise", "members", "brief", "page_help"];
const NEW_PATHS = ["/about", "/about/editorial-policy", "/about/ethics", "/about/corrections", "/about/ad-policy", "/about/privacy", "/about/terms", "/about/advertise", "/signup", "/brief", "/help/report", "/help/subscribe", "/help/ad", "/help/contribute"];

// 9.2 같은 정규식 — 운영 코드의 상수를 그대로 읽는다
const EMAIL_SOURCE = JSON.parse(`"${/EMAIL_SOURCE = "(.*)";/.exec(fs.readFileSync(path.join(ROOT, "apps", "web", "lib", "policy", "email.ts"), "utf8"))[1]}"`);
const EMAIL_JS = () => new RegExp(EMAIL_SOURCE, "g");
const EMAIL_PG = "[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}[.][A-Za-z]{2,24}";
const NAMED = { commat: "@", period: ".", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decodeEntities = (s) => s.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g, (m, d, h, n) => (n ? (NAMED[n] ?? m) : String.fromCodePoint(d ? Number(d) : parseInt(h, 16))));
const emailsIn = (html) => {
  const text = decodeEntities(html).normalize("NFKC");
  return [...new Set([...(html.match(EMAIL_JS()) ?? []), ...(text.match(EMAIL_JS()) ?? []), ...(text.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").match(EMAIL_JS()) ?? [])])];
};

let sb, server, staff, db, browser, base, debugPort, removePolicies, t0, auditMark, auditChangeMark, inquiryMark, eventMark, run, createdRegion;
const u = {};
const fx = {};
const contexts = [];
const before0 = {};
let cleaned = false;
let ipSeq = 0;
const nextIp = () => `10.66.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const count = async (sql, params) => Number((await one(sql, params)).n);
const fillToken = (prefix, ageMs = 10_000) => {
  const opened = Date.now() - ageMs;
  return `${opened}.${crypto.createHmac("sha256", SECRET).update(`${prefix}:${opened}`).digest("hex").slice(0, 32)}`;
};
const get = async (p, init = {}) => {
  const res = await fetch(`${base}${p}`, { redirect: "manual", headers: { "user-agent": HUMAN_UA, "x-real-ip": nextIp() }, ...init });
  return { status: res.status, html: await res.text(), location: res.headers.get("location") ?? "" };
};
const post = (p, body, { headers = {} } = {}) =>
  fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json", origin: base, "x-real-ip": nextIp(), "x-forwarded-for": nextIp(), ...headers }, body: JSON.stringify(body) });
async function admin(method, p, user, body) {
  const res = await fetch(`${base}/api/admin${p}`, {
    method,
    headers: { authorization: `Bearer ${user.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const setFlags = (patch) => db.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify(patch)]);
/** 설정·게시본 읽기에는 짧은 보관 시간이 있다 — 바뀐 상태가 보일 때까지 기다린다(배포 없이) */
async function settle(paths, want) {
  const end = Date.now() + 60_000;
  for (;;) {
    const got = [];
    for (const p of paths) got.push([p, (await get(p)).status]);
    const bad = got.filter(([, st]) => (want === 404 ? st !== 404 : st !== 200));
    if (!bad.length) return;
    if (Date.now() > end) assert.deepEqual(bad, [], "기대한 상태가 되지 않았다 (" + want + ")");
    await sleep(1000);
  }
}
const footerHrefs = (html) => [...(/<nav[^>]*aria-label="바닥글 메뉴"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "").matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const newContext = async (extra = {}) => {
  const c = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": nextIp() }, userAgent: HUMAN_UA, ...extra });
  contexts.push(c);
  return c;
};
const linkOf = (mail) => /https?:\/\/\S+\/auth\/confirm\?\S+/.exec(mail.Text)?.[0];
const auditCount = async (action, target) => count("select count(*) n from public.audit_logs where id > $1 and action = $2 and ($3::text is null or target = $3)", [auditMark, action, target ?? null]);

async function signupApi(address, extra = {}) {
  const res = await post("/api/auth/signup", { email: address, password: PASSWORD, agreeTerms: true, agreePrivacy: true, fill: fillToken("signup_fill"), ...extra });
  if (res.status !== 200) return { status: res.status, id: null };
  const row = await one("select id from auth.users where email = $1", [address]);
  staff.userIds.add(row.id);
  const [mail] = await waitForMail(address, 1);
  const c = await post("/api/auth/confirm", (() => { const l = new URL(linkOf(mail)); return { token_hash: l.searchParams.get("token_hash"), type: l.searchParams.get("type") }; })());
  assert.equal(c.status, 200, "가입 확인");
  return { status: 200, id: row.id };
}

// ── 크롤링·스캔 ─────────────────────────────────────────
const SEEDS = () => ["/", "/signup", "/login", "/forgot-password", "/brief", "/help/report", "/help/subscribe", "/help/ad", "/help/contribute", "/tax", "/news", `/news/${fx.taxSlug}`, `/news/${fx.finSlug}`, "/about/measurement", `/zz-없는-화면-${run}`];
async function crawl() {
  const seen = new Map();
  const queue = SEEDS();
  while (queue.length && seen.size < 400) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    const r = await get(p);
    seen.set(p, r);
    if (r.status !== 200) continue;
    for (const m of r.html.matchAll(/href="([^"#]+)"/g)) {
      const h = decodeEntities(m[1]);
      if (!h.startsWith("/") || h.startsWith("//") || /^\/(api|admin|_next)/.test(h) || /\.(png|jpe?g|svg|ico|xml|txt|webp|pdf|css|js)(\?|$)/.test(h)) continue;
      queue.push(h.startsWith("/search") ? h : h.split("?")[0]);
    }
  }
  return seen;
}
/** DB 전체 칸 스캔 — 허용 칸 둘(consents.email·inquiries.contact_email)·직원 기록·정책 본문·회사 정보는 뺀다 */
const ALLOWED = new Set(["consents.email", "inquiries.contact_email", "audit_logs.actor", "policy_versions.body"]);
const SKIP_TABLES = new Set(["audit_log_changes"]);
async function dbColumns() {
  const { rows } = await db.query(
    `select c.table_name t, c.column_name col from information_schema.columns c join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
      where c.table_schema = 'public' and x.table_type = 'BASE TABLE' and (c.data_type in ('text', 'character varying', 'jsonb', 'json') or (c.data_type = 'ARRAY' and c.udt_name in ('_text', '_varchar')))`,
  );
  return rows.filter((r) => !SKIP_TABLES.has(r.t));
}
async function dbScan({ needle, includeAllowed = false }) {
  const hits = [];
  for (const { t, col } of await dbColumns()) {
    if (!includeAllowed && ALLOWED.has(`${t}.${col}`)) continue;
    const extra = t === "settings" ? " and key <> 'company_info'" : "";
    const where = needle ? `strpos(lower("${col}"::text), $1) > 0` : `"${col}"::text ~ $1`;
    const n = await count(`select count(*) n from public."${t}" where ${where}${extra}`, [needle ?? EMAIL_PG]);
    if (n > 0) hits.push(`${t}.${col} ${n}행`);
  }
  return hits;
}
async function scanSurfaces({ watch }) {
  const pages = await crawl();
  const out = { pages, html: [], api: [], db: [], log: [], events: [], watch: [] };
  for (const [p, r] of pages) {
    for (const e of emailsIn(r.html)) out.html.push(`${p}: ${e}`);
    if (watch && r.html.toLowerCase().includes(watch)) out.watch.push(`화면 ${p}`);
  }
  for (const qs of ["q=%EC%B7%A8%EB%93%9D%EC%84%B8", `q=${encodeURIComponent(watch ?? "w2e")}`]) {
    const r = await get(`/api/search?${qs}`);
    for (const e of emailsIn(r.html)) out.api.push(`${qs}: ${e}`);
  }
  out.db = await dbScan({});
  const log = server.log();
  out.log = emailsIn(log).filter((e) => !e.toLowerCase().includes("example.test") || e.toLowerCase().includes(`-${run}`));
  const events = await db.query("select t::text s from public.analytics_events t");
  out.events = events.rows.flatMap((r) => emailsIn(r.s));
  if (watch) {
    if (log.toLowerCase().includes(watch)) out.watch.push("서버 기록");
    if (events.rows.some((r) => r.s.toLowerCase().includes(watch))) out.watch.push("측정 이벤트");
    for (const h of await dbScan({ needle: watch })) out.watch.push(`DB ${h}`);
  }
  return out;
}
function assertClean(s, label) {
  assert.deepEqual(s.html, [], `${label} ① 공개 화면 HTML 평문 이메일`);
  assert.deepEqual(s.api, [], `${label} ② 공개 API`);
  assert.deepEqual(s.db, [], `${label} ③ DB 전체 칸(허용 칸 제외)`);
  assert.deepEqual(s.log, [], `${label} ⑤ 서버 기록`);
  assert.deepEqual(s.events, [], `${label} ⑥ 측정 이벤트`);
}

// ── 정리 ────────────────────────────────────────────────
async function residue(client = db) {
  const tables = ["articles", "article_revisions", "audit_logs", "audit_log_changes", "consents", "inquiries", "profiles", "policy_versions", "analytics_events", "request_throttles", "agent_runs", "regions", "people", "staff_roles", "media"];
  const out = {};
  for (const t of tables) out[t] = (await client.query(`select count(*)::int n from public.${t}`)).rows[0].n;
  out["auth.users"] = (await client.query("select count(*)::int n from auth.users")).rows[0].n;
  out.settings = JSON.stringify((await client.query("select key, value from public.settings order by key")).rows);
  return out;
}
async function removeOwnRows() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.inquiries where id > $1", [inquiryMark]);
    await db.query("delete from public.consents where email like $1", [`%-${run}@example.test`]);
    await db.query("delete from public.audit_log_changes where id > $1", [auditChangeMark]);
    await db.query("delete from public.audit_logs where id > $1 and (actor like $2 or action like 'e2e.%' or action like 'audit.amend%')", [auditMark, `e2e-w2e-${run}%`]);
    await db.query("delete from public.analytics_events where id > $1", [eventMark]);
    await db.query("delete from public.request_throttles where window_start >= $1", [t0]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
  await removePolicies?.();
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: `${ADMIN_EMAIL},${PO_EMAIL}`,
    AUDIT_ADMIN_EMAILS: PO_EMAIL,
    GUARD_SECRET: SECRET,
    NEXT_PUBLIC_SITE_URL: SITE,
    ...mailEnv(),
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase();
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.removeLeftover(PO_EMAIL);
  await staff.snapshotOperations();
  t0 = (await one("select now() t")).t;
  auditMark = Number((await one("select coalesce(max(id), 0) m from public.audit_logs")).m);
  auditChangeMark = Number((await one("select coalesce(max(id), 0) m from public.audit_log_changes")).m);
  inquiryMark = Number((await one("select coalesce(max(id), 0) m from public.inquiries")).m);
  eventMark = Number((await one("select coalesce(max(id), 0) m from public.analytics_events")).m);
  Object.assign(before0, await residue());
  u.admin = await staff.createUser({ label: "w2e-admin", email: ADMIN_EMAIL });
  u.po = await staff.createUser({ label: "w2e-po", email: PO_EMAIL });
  u.editor = await staff.createUser({ label: "w2e-editor", roles: ["editor"], person: { name: "수용 시험 편집자", roles: ["editor"] } });
  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
});

after(async () => {
  try {
    for (const c of contexts) await c.close().catch(() => {});
    await browser?.close();
    if (!cleaned && staff) {
      await removeOwnRows();
      await staff.cleanup();
    }
  } finally {
    server?.stop();
  }
});

// ── 1) 자료 ─────────────────────────────────────────────
test("1) 출발점 — 정책 게시본 0행 · 기능 키가 모두 켜져 있어도 게시본이 없으면 새 경로 404·정책 링크 0(측정 거부만) → 가짜 게시본을 만들면 열린다", async () => {
  assert.equal(before0.policy_versions, 0, "policy_versions 씨앗 0행");
  const prd = fs.readFileSync(path.join(ROOT, "docs", "PRD", "PRD-01A_1단계_기반_편집_유입.md"), "utf8").split("\n").find((l) => l.includes("| W2-e |"));
  assert.ok(prd, "PRD-01A 9장 W2-e 증거 줄");
  await setFlags(Object.fromEntries(NEW_FLAGS.map((k) => [k, true])));
  for (const p of NEW_PATHS) assert.equal((await get(p)).status, 404, `게시본 없음: ${p}`);
  assert.equal((await post("/api/help/report", { body: BODY, agreePrivacy: "on", fill: fillToken("help_fill"), website: "" })).status, 404, "폼 제출 API도 404");
  assert.equal((await post("/api/brief", { email: `w2e-x-${run}@example.test`, agree: "on", fill: fillToken("signup_fill"), website: "" })).status, 404, "브리핑 API 404");
  assert.deepEqual(footerHrefs((await get("/")).html), ["/about/measurement"], "측정 거부만 항상 보인다");

  // 시험 자료 — 기사 둘(지방세·개발금융), 지역 하나
  const person = await one("insert into public.people (slug, name, roles, visibility) values ($1, '수용 시험 기자', array['reporter'], 'public') returning id", [`e2e-w2e-${run}`]);
  staff.personIds.add(Number(person.id));
  const article = async (title, section) => {
    const r = await one(
      "insert into public.articles (slug, title, section, content_type, status, author_id, body, first_published_at) values ($1, $2, $3, 'explainer', 'published', $4, $5, now() - interval '1 day') returning id, slug",
      [`e2e-w2e-${section}-${run}`, title, section, person.id, JSON.stringify({ blocks: [{ type: "paragraph", text: "본문" }], claims: [] })],
    );
    staff.articleIds.add(Number(r.id));
    return r.slug;
  };
  fx.taxTitle = `수용시험 지방세 ${run}`;
  fx.finTitle = `수용시험 개발금융 ${run}`;
  fx.taxSlug = await article(fx.taxTitle, "tax");
  fx.finSlug = await article(fx.finTitle, "finance");
  const sido = await one("select code from public.regions where level = 'sido' and (valid_to is null or valid_to >= current_date) order by code limit 1");
  fx.gu = await one("select code from public.regions where level = 'sigungu' and parent_code = $1 and (valid_to is null or valid_to >= current_date) order by code limit 1", [sido.code]);
  if (!fx.gu) {
    fx.gu = await one("insert into public.regions (code, parent_code, level, name, slug) values ($1, $2, 'sigungu', '수용시험구', $3) returning code", [`${sido.code.slice(0, 2)}99700000`, sido.code, `e2e-w2e-gu-${run}`]);
    createdRegion = fx.gu.code;
  }

  removePolicies = await publishPolicies(db, staff.run, POLICY_DOCS);
  await settle(NEW_PATHS, 200);
});

// ── 2) 시나리오 1 회원 E2E ───────────────────────────────
test("2) 시나리오 1 회원 E2E — 가입(관심 분야·지역) → 수신함 → 확인 → /my 새 글 → 로그인 상태 문의 → 비밀번호 재설정 → 탈퇴 → 프로필·동의·Auth 0 + 연락처 비움 (ACC-01·02·03·HOME-07)", async () => {
  fx.watch = `w2e-${run}@example.test`;
  const ctx = await newContext();
  const page = await ctx.newPage();
  await page.goto(`${base}/signup`);
  await page.fill("#signup-email", fx.watch);
  await page.fill("#signup-password", PASSWORD);
  await page.check('input[name="interests"][value="tax"]');
  const guBox = page.locator(`input[name="regionCodes"][value="${fx.gu.code}"]`);
  await page.locator("details", { has: guBox }).locator("summary").click();
  await guBox.check();
  assert.equal(await page.locator('input[name="optReceive"]').isChecked(), false, "선택 동의는 기본 해제");
  await page.check('input[name="agreeTerms"]');
  await page.check('input[name="agreePrivacy"]');
  await sleep(3200);
  await Promise.all([page.waitForURL(/\/signup\?sent=1/), page.click('button[type="submit"]')]);
  const [mail] = await waitForMail(fx.watch, 1);
  assert.equal(new URL(linkOf(mail)).origin, base, "확인 링크 호스트 = 요청 호스트");
  await page.goto(linkOf(mail).replace(SITE, base));
  await Promise.all([page.waitForURL(/\/my\?welcome=1/), page.click('button:has-text("가입 확인하기")')]);
  fx.userId = (await one("select id from auth.users where email = $1", [fx.watch])).id;
  staff.userIds.add(fx.userId);
  const feed = await page.textContent('[data-testid="my-feed"]');
  assert.ok(feed.includes(fx.taxTitle) && !feed.includes(fx.finTitle), "관심 분야(지방세) 새 글만");
  assert.deepEqual((await db.query("select kind from public.consents where user_id = $1", [fx.userId])).rows.map((r) => r.kind), ["signup"], "선택 동의 0 — 가입 동의 행 하나");
  assert.equal(await count("select count(*) n from public.staff_roles where user_id = $1", [fx.userId]), 0, "회원은 역할 0");
  assert.equal(await page.locator('[data-testid="my-feed"] a[href^="mailto:"]').count(), 0);

  // 로그인한 채 문의 — submitted_by가 이 회원이어야 탈퇴 때 연락처가 비워진다
  const help = await ctx.request.post(`${base}/api/help/report`, { headers: { origin: base, "x-forwarded-for": nextIp() }, data: { fill: fillToken("help_fill"), website: "", agreePrivacy: "on", body: BODY, contactEmail: fx.watch } });
  assert.equal(help.status(), 201, JSON.stringify(await help.json().catch(() => null)));
  fx.inquiryRef = (await help.json()).ref;
  const inq = await one("select submitted_by, contact_email from public.inquiries where ref_code = $1", [fx.inquiryRef]);
  assert.deepEqual([inq.submitted_by, inq.contact_email], [fx.userId, fx.watch], "연락처는 허용 칸(inquiries.contact_email)에만");

  // 브리핑 사전 알림은 다른 감시 주소로 (비회원 동의는 consents.email — 허용 칸 ①)
  fx.watch2 = `w2e-brief-${run}@example.test`;
  const brief = await post("/api/brief", { email: fx.watch2, agree: "on", fill: fillToken("signup_fill"), website: "" });
  assert.equal(brief.status, 200);
  await waitForMail(fx.watch2, 1);

  // 탈퇴 전 — 허용 칸 밖에 감시 주소 0, 어느 면에도 이메일 모양 0
  const alive = await scanSurfaces({ watch: fx.watch });
  assertClean(alive, "탈퇴 전");
  assert.deepEqual(alive.watch, [], "④ 탈퇴 전: 감시 주소는 허용 칸 밖 어디에도 없다");
  fx.crawled = alive.pages;

  // 비밀번호 재설정 (메일 → 확인 버튼 → 새 비밀번호)
  assert.equal((await post("/api/auth/forgot", { email: fx.watch })).status, 200);
  const resetMail = (await waitForMail(fx.watch, 2)).find((m) => m.Subject.includes("비밀번호 재설정"));
  assert.ok(resetMail, "재설정 메일");
  const rctx = await newContext();
  const rpage = await rctx.newPage();
  await rpage.goto(linkOf(resetMail).replace(SITE, base));
  await Promise.all([rpage.waitForURL(/\/reset-password$/), rpage.click('button:has-text("비밀번호 재설정하기")')]);
  await rpage.fill("#reset-new", NEW_PASSWORD);
  await rpage.fill("#reset-confirm", NEW_PASSWORD);
  await Promise.all([rpage.waitForURL(/\/login\?reset=1/), rpage.click('button[type="submit"]')]);
  assert.equal((await post("/api/auth/login", { email: fx.watch, password: PASSWORD })).status, 401, "옛 비밀번호 거부");
  assert.equal((await post("/api/auth/login", { email: fx.watch, password: NEW_PASSWORD })).status, 200, "새 비밀번호 로그인");

  // 탈퇴
  await rpage.goto(`${base}/login?next=${encodeURIComponent("/my/withdraw")}`);
  await rpage.fill("#member-email", fx.watch);
  await rpage.fill("#member-password", NEW_PASSWORD);
  await Promise.all([rpage.waitForURL(/\/my\/withdraw$/), rpage.click('button[type="submit"]')]);
  await rpage.fill("#withdraw-password", NEW_PASSWORD);
  await Promise.all([rpage.waitForURL(/\/login\?withdrawn=1/), rpage.click('button:has-text("탈퇴하기")')]);
  assert.equal(await count("select count(*) n from auth.users where email = $1", [fx.watch]), 0, "Auth 계정 0");
  assert.equal(await count("select count(*) n from public.profiles where id = $1", [fx.userId]), 0, "프로필 0");
  assert.equal(await count("select count(*) n from public.consents where user_id = $1", [fx.userId]), 0, "동의 행 0");
  const cleared = await one("select submitted_by, contact_email from public.inquiries where ref_code = $1", [fx.inquiryRef]);
  assert.deepEqual([cleared.submitted_by, cleared.contact_email], [null, null], "문의 연락처 비움(ACC-03)");
  assert.equal(await auditCount("account.withdrawn", `user:${fx.userId}`), 1, "탈퇴 감사 로그 1건");
});

// ── 3) 시나리오 7 평문 이메일 0 ──────────────────────────
test("3) 시나리오 7 평문 이메일 0 — 탈퇴 뒤 여섯 면 전부 0 · 감시 주소는 Auth·consents·문의·감사 로그를 포함해 어디에도 없다 (HELP-03)", async () => {
  const after = await scanSurfaces({ watch: fx.watch });
  assertClean(after, "탈퇴 뒤");
  assert.deepEqual(after.watch, [], "④ 탈퇴 뒤: 감시 주소 어디에도 0");
  assert.deepEqual(await dbScan({ needle: fx.watch, includeAllowed: true }), [], "허용 칸 포함 전체 DB에 감시 주소 0");
  assert.equal(await count("select count(*) n from public.audit_logs where actor like $1 or target like $1 or coalesce(before::text, '') || coalesce(after::text, '') like $1", [`%${fx.watch}%`]), 0, "감사 로그에 회원 이메일 0");
  // 허용 칸은 기대한 칸에서만 — 비회원 사전 알림 동의는 consents.email
  assert.equal(await count("select count(*) n from public.consents where email = $1 and kind = 'brief_prereg'", [fx.watch2]), 1);
  assert.ok(after.pages.size >= 15, `크롤링 규모 ${after.pages.size}쪽`);
  fx.crawled = after.pages;
  // 이메일 모양이 오가는 공개 입력은 거부 — 측정 수집은 from_path에 이메일 모양이면 400
  const ev = await post("/api/events", { name: "page_view", from_path: `/x?e=${fx.watch}` });
  assert.ok(ev.status >= 400 && ev.status < 500, `이메일 모양 경로 거부(${ev.status})`);
});

// ── 4) 시나리오 6 정책 링크 전수 ─────────────────────────
test("4) 시나리오 6 정책 페이지 링크 전수 — 바닥글·기사 하단·허브에서 따라간 사이트 안 링크 404·5xx 0, 게시본 없는 문서는 링크 0, 개인정보처리방침은 굵게", async () => {
  const bad = [];
  for (const [p, r] of fx.crawled) if (!p.includes("zz-없는") && (r.status === 404 || r.status >= 500)) bad.push(`${p} ${r.status}`);
  assert.deepEqual(bad, [], "링크로 닿은 화면 404·5xx 0");
  assert.equal(fx.crawled.get(`/zz-없는-화면-${run}`).status, 404, "없는 주소는 404(오류 화면도 크롤링 대상)");
  const home = fx.crawled.get("/");
  const hrefs = footerHrefs(home.html);
  assert.deepEqual(hrefs, ["/about", "/about/editorial-policy", "/about/ethics", "/about/corrections", "/about/ad-policy", "/help/report", "/about/terms", "/about/privacy", "/about/measurement", "/my"]);
  const article = fx.crawled.get(`/news/${fx.taxSlug}`);
  assert.deepEqual(footerHrefs(article.html), hrefs, "기사 화면 바닥글도 같은 링크");
  const policyLinks = [...article.html.matchAll(/href="(\/(?:about|help|brief|signup)[^"#]*)"/g)].map((m) => m[1]);
  for (const l of new Set(policyLinks)) assert.ok((fx.crawled.get(l.split("?")[0]) ?? (await get(l))).status < 400, `기사 하단 링크 ${l}`);
  assert.ok(!hrefs.includes("/about/no-email-collection"), "게시본 없는 문서 링크 0");
  assert.equal((await get("/about/no-email-collection")).status, 404);
  assert.match(/<a[^>]*href="\/about\/privacy"[^>]*>/.exec(home.html.slice(home.html.indexOf('aria-label="바닥글 메뉴"')))?.[0] ?? "", /font-bold/, "개인정보처리방침 굵게");
  assert.equal(home.html.includes('href="/about/privacy"') && /<header[\s\S]*?<\/header>/.exec(home.html)?.[0].includes('/about/privacy'), false, "헤더에는 정책 링크 0");
});

// ── 5) 시나리오 3·8·10 ──────────────────────────────────
test("5) 시나리오 3 가입 요청에 역할 값을 넣어도 회원 · 시나리오 8 고객센터 5종 → 문의함 종류 · 시나리오 10 브리핑 확인 전 미확정·철회·subscribers 없음", async () => {
  const email = `w2e-role-${run}@example.test`;
  const res = await post("/api/auth/signup", { email, password: PASSWORD, agreeTerms: true, agreePrivacy: true, fill: fillToken("signup_fill"), role: "admin", roles: ["admin"] });
  const row = await db.query("select id from auth.users where email = $1", [email]);
  if (row.rows[0]) staff.userIds.add(row.rows[0].id);
  assert.ok([200, 400, 422].includes(res.status), `역할 값 가입 응답 ${res.status}`);
  if (row.rows[0]) assert.equal(await count("select count(*) n from public.staff_roles where user_id = $1", [row.rows[0].id]), 0, "역할 0 회원");

  const forms = [
    ["report", { body: BODY }, "tip"],
    ["subscribe", { body: BODY, contactEmail: `w2e-h1-${run}@example.test` }, "subscription"],
    ["ad", { body: BODY, contactEmail: `w2e-h2-${run}@example.test` }, "advertising"],
    ["contribute", { title: "독자 투고 시험 제목", body: BODY, contactEmail: `w2e-h3-${run}@example.test` }, "reader_submission"],
    ["corrections", { body: BODY, requestType: "correction", articleUrl: "/news/e2e-x", contactEmail: `w2e-h4-${run}@example.test` }, "correction"],
  ];
  for (const [slug, fields, kind] of forms) {
    const r = await post(`/api/help/${slug}`, { fill: fillToken("help_fill"), website: "", agreePrivacy: "on", ...fields });
    const body = await r.json().catch(() => ({}));
    assert.equal(r.status, 201, `${slug}: ${JSON.stringify(body)}`);
    const q = await one("select * from public.inquiries where ref_code = $1", [body.ref]);
    assert.ok(Object.values(q).includes(kind), `${slug} → 문의함 종류 ${kind}`);
    if (fields.contactEmail) assert.equal(q.contact_email, fields.contactEmail);
  }
  assert.equal((await post("/api/help/report", { fill: fillToken("help_fill"), website: "봇", agreePrivacy: "on", body: BODY })).status >= 400, true, "숨은 칸이 차면 거부");
  assert.equal((await post("/api/help/report", { fill: fillToken("help_fill", 100), website: "", agreePrivacy: "on", body: BODY })).status >= 400, true, "너무 빠른 제출 거부");
  assert.equal((await post("/api/help/expert", { fill: fillToken("help_fill"), website: "", agreePrivacy: "on", body: BODY })).status, 404, "전문가 연락 요청 종류 0");

  // 브리핑 — 동의 없이 제출 불가 · 확인 전 미확정 · 중복 0 · 철회
  assert.ok((await post("/api/brief", { email: `w2e-b0-${run}@example.test`, fill: fillToken("signup_fill"), website: "" })).status >= 400, "동의 없이 제출 불가");
  assert.ok((await post("/api/brief", { email: "not-an-email", agree: "on", fill: fillToken("signup_fill"), website: "" })).status >= 400, "형식 오류");
  const prereg = async () => (await db.query("select confirmed_at, revoked_at from public.consents where kind = 'brief_prereg' and email = $1", [fx.watch2])).rows;
  assert.equal((await prereg()).length, 1, "중복 0 — 행 하나");
  assert.equal((await prereg())[0].confirmed_at, null, "확인 전에는 미확정");
  const mails = await waitForMail(fx.watch2, 1);
  const tokens = { confirm: /\/brief\/confirm\?token=([A-Za-z0-9_-]+)/.exec(mails[0].Text)?.[1], revoke: /\/brief\/unsubscribe\?token=([A-Za-z0-9_-]+)/.exec(mails[0].Text)?.[1] };
  assert.ok(tokens.confirm && tokens.revoke, "확인·철회 링크");
  assert.equal(await count("select count(*) n from public.consents c where c::text like $1", [`%${tokens.confirm}%`]), 0, "토큰 원문은 DB에 없다");
  assert.equal((await post("/api/brief/confirm", { token: tokens.confirm })).status < 400, true);
  assert.notEqual((await prereg())[0].confirmed_at, null, "확인하면 확정");
  assert.equal((await post("/api/brief/unsubscribe", { token: tokens.revoke })).status < 400, true);
  assert.notEqual((await prereg())[0].revoked_at, null, "철회");
  assert.equal((await one("select to_regclass('public.subscribers') r")).r, null, "subscribers 표 없음");
  const home = await get("/");
  assert.doesNotMatch(home.html, /api\/brief|name="agree"/, "홈에는 사전 알림 폼이 없다");
});

// ── 6) 시나리오 11 ──────────────────────────────────────
test("6) 시나리오 11 ADM-02 회원 삭제(편집자 403 + 거부 로그 → 관리자 성공 + 감사 로그 1건, 이메일 0) · ADM-04 PO 아닌 관리자 403 + 거부 로그 정확히 1건, 기록 그대로, PO는 성공", async () => {
  const email = `w2e-del-${run}@example.test`;
  const m = await signupApi(email);
  assert.equal(m.status, 200);
  const denied = await admin("DELETE", `/members/${m.id}`, u.editor, { reason: "권한 없음 시험" });
  assert.equal(denied.status, 403);
  assert.equal(await auditCount("member.delete.denied", `user:${m.id}`), 1, "거부 감사 로그 1건");
  assert.equal(await count("select count(*) n from auth.users where id = $1", [m.id]), 1, "회원 그대로");
  assert.equal((await admin("DELETE", `/members/${m.id}`, u.admin, {})).status, 422, "사유 없으면 422");
  assert.equal((await admin("DELETE", `/members/${m.id}`, u.admin, { reason: "회원 요청 삭제 시험" })).status, 200);
  assert.equal(await count("select count(*) n from auth.users where id = $1", [m.id]), 0, "Auth 0");
  assert.equal(await count("select (select count(*) from public.profiles where id = $1) + (select count(*) from public.consents where user_id = $1) n", [m.id]), 0, "프로필·동의 0");
  assert.equal(await auditCount("member.delete", `user:${m.id}`), 1, "삭제 감사 로그 1건");
  const log = await one("select actor, target, before, after, reason from public.audit_logs where action = 'member.delete' and target = $1", [`user:${m.id}`]);
  assert.ok(!JSON.stringify(log).includes(run.slice(0, 0) + email), "감사 로그에 회원 이메일 0");

  // ADM-04
  const seeded = await one("insert into public.audit_logs (actor, action, target, reason) values ($1, 'e2e.w2e.seed', 'e2e-w2e', '시험 원본') returning id", [`e2e-w2e-${run}`]);
  const changeBody = { changes: { reason: "수정된 이유" }, reason: "오타 정정" };
  for (const [name, user] of [["관리자(PO 아님)", u.admin], ["편집자", u.editor]]) {
    for (const [method, body] of [["PATCH", changeBody], ["DELETE", { reason: "삭제 시도" }]]) {
      const before = await auditCount("audit.amend.denied");
      const r = await admin(method, `/audit/${seeded.id}`, user, body);
      assert.equal(r.status, 403, `${name} ${method}`);
      assert.equal((await auditCount("audit.amend.denied")) - before, 1, `${name} ${method}: 거부 감사 로그 정확히 1건`);
    }
  }
  assert.equal((await one("select reason from public.audit_logs where id = $1", [seeded.id])).reason, "시험 원본", "기록 그대로");
  assert.equal((await admin("PATCH", `/audit/${seeded.id}`, u.po, changeBody)).status, 200, "PO 성공");
  assert.equal((await one("select reason from public.audit_logs where id = $1", [seeded.id])).reason, "수정된 이유");
  assert.equal(await count("select count(*) n from public.audit_log_changes where log_id = $1", [seeded.id]), 1, "변경 기록 남음");
  assert.equal((await admin("DELETE", `/audit/${seeded.id}`, u.po, { reason: "시험 삭제" })).status, 200);
});

// ── 7) 시나리오 12 ──────────────────────────────────────
test("7) 시나리오 12 기능 키를 끄면 새 경로 전부 404·링크 0·서버 오류 0, 다시 켜면 배포 없이 열린다", async () => {
  await setFlags(Object.fromEntries(NEW_FLAGS.map((k) => [k, false])));
  await settle(NEW_PATHS, 404);
  assert.equal((await post("/api/brief", { email: `w2e-off-${run}@example.test`, agree: "on", fill: fillToken("signup_fill"), website: "" })).status, 404);
  assert.equal((await post("/api/help/report", { fill: fillToken("help_fill"), website: "", agreePrivacy: "on", body: BODY })).status, 404);
  for (const p of ["/", `/news/${fx.taxSlug}`, "/tax"]) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.deepEqual(footerHrefs(r.html), ["/about/measurement"], `${p}: 바닥글은 측정 거부만`);
    const links = [...r.html.matchAll(/href="(\/(?:about\/(?!measurement)|help|signup|brief)[^"]*)"/g)].map((x) => x[1]);
    assert.deepEqual(links, [], `${p}: 새 기능 링크 0`);
  }
  await setFlags(Object.fromEntries(NEW_FLAGS.map((k) => [k, true])));
  await settle(NEW_PATHS, 200);
  assert.doesNotMatch(server.log(), /\[api\] 처리 중 오류|\[public\]|\[db\]/, "예상 못 한 서버 오류 0");
});

// ── 8) 시나리오 14 ──────────────────────────────────────
test("8) 시나리오 14 정적 — 마이그레이션에 policy_versions 씨앗 insert 0 · 정책 코드·씨앗에 조문 본문 0 · policy_versions는 이 시험의 가짜 게시본뿐", async () => {
  const dir = path.join(ROOT, "packages", "db", "supabase", "migrations");
  const seeds = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).filter((f) => /insert\s+into\s+(public\.)?policy_versions/i.test(fs.readFileSync(path.join(dir, f), "utf8")));
  assert.deepEqual(seeds, [], "policy_versions 씨앗 insert 0");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const code = walk(path.join(ROOT, "apps", "web", "lib", "policy")).filter((f) => /\.ts$/.test(f) && !/\.test\./.test(f));
  assert.ok(code.length > 0);
  for (const f of code) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /제\s?\d+\s?조(\s|\()/, `${path.basename(f)}에 조문 본문 0`);
  const real = await count("select count(*) n from public.policy_versions where updated_by not like 'e2e-signup-policy-%'");
  assert.equal(real, 0, "가짜 게시본 말고 다른 행 0");
});

// ── 9) 시나리오 15 ──────────────────────────────────────
test("9) 시나리오 15 새 화면 R1~R3(360·640·1024) · 360px 가로 스크롤 0 · 접근성 95 — 가입·로그인·브리핑·고객센터·정책 페이지", async () => {
  const urls = [`${base}/signup`, `${base}/login`, `${base}/brief`, `${base}/help/report`, `${base}/about/privacy`];
  for (const url of urls) {
    for (const width of [360, 640, 1024]) {
      const r = await measurePage(browser, url, { width, height: 740 });
      if (width === 360) assert.ok(r.r1.pass, `${url} R1 ${r.r1.chars}자`);
      assert.ok(r.r2.pass, `${url} ${width}px R2`);
      assert.ok(r.r3.pass, `${url} ${width}px R3`);
    }
    const ctx = await newContext({ viewport: { width: 360, height: 740 } });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${url}: 360px 가로 스크롤`);
  }
  for (const url of urls) {
    const r = await accessibility(url, debugPort);
    assert.ok(r.score >= A11Y_MIN, `${url} 접근성 ${r.score} — ${r.failing.join(", ")}`);
  }
});

// ── 10) 정리 ────────────────────────────────────────────
test("10) 정리 — 만든 계정·문의·동의·감사·정책 게시본·측정 이벤트를 지우면 표마다 시험 전 행 수, 운영 설정 값 그대로", async () => {
  for (const c of contexts) await c.close().catch(() => {});
  await removeOwnRows();
  await staff.cleanup();
  cleaned = true;
  const client = new pg.Client({ connectionString: sb.dbUrl });
  await client.connect();
  try {
    if (createdRegion) await client.query("delete from public.regions where code = $1", [createdRegion]);
    assert.deepEqual(await residue(client), before0);
  } finally {
    await client.end();
  }
});
