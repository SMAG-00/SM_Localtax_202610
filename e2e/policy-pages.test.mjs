// 정책 페이지·바닥글 E2E (W2-e 4단계 — docs/dev/W2-e_설계.md 1장 4단계 · 2.3 · 2.5 · 2.7 · 6장 · 9.2)
//  a) 켜기 거부: 게시본이 없는 정책 키·약관 없는 members는 운영 설정 화면(API)에서 켤 수 없다(422 + 사유, 값 그대로)
//  b) 게시 전: 기능 키가 켜져 있어도 정책 페이지 404 · 바닥글 정책 링크 0(측정 거부만) · 가입 404
//  c) 승인 기록 없이 게시 거부(422, 초안 그대로) · 편집 책임자는 관리자 전용 문서(처리방침) 초안 403 · 게시 403 + 거부 감사 로그
//  d) 게시 후: 정책 페이지 200 · 바닥글 링크 전수 404 0 · 게시본 없는 문서(이메일무단수집거부)는 링크 0 + 404 · 가입은 약관+처리방침 둘 다 게시돼야 열림
//  e) 개정 이력: 버전 2는 개정 사유 필수 · 이전 판 ?v=1 (noindex·안내) · 없는 판 404 · 이력 목록
//  f) 본문 표기: ①㈜ 원문 유지 · 평문 이메일 0(원문 HTML과 엔티티 풀기+NFKC 둘 다) · 닫힌 화면 링크는 글자만
//  g) 백오피스 /admin/pages: 뼈대 항목 이름만 · 360px 가로 스크롤 0
// 정책 문구는 시험 자료이고 끝나면 지운다 (정책 문구는 코드·씨앗에 없다).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { mailEnv } from "./lib/mail.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e.example.test";
const ADMIN_EMAIL = "policy-pages-admin@example.test";
const EMAIL_SHAPE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/;
const POLICY_FLAGS = ["page_about", "page_editorial_policy", "page_ethics", "page_corrections", "page_ad_policy", "page_privacy", "page_terms", "page_no_email", "page_advertise", "members"];

let sb, server, staff, db, browser, base, page, idMark;
const u = {};
const contexts = [];

async function api(method, path, user, body) {
  const res = await fetch(`${base}/api/admin${path}`, {
    method,
    headers: { authorization: `Bearer ${user.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const get = async (path) => {
  const res = await fetch(`${base}${path}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
};
const flags = async () => (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
const setFlags = (patch) => db.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify(patch)]);
const versions = async (doc) => (await db.query("select version, status from public.policy_versions where doc_key = $1 order by version", [doc])).rows;
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
/** 바닥글 링크 — nav[aria-label="바닥글 메뉴"] 안의 사이트 안 주소 */
const footerHrefs = (html) => {
  const nav = /<nav[^>]*aria-label="바닥글 메뉴"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
  return [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
};
const BODY_TEXT = "## 시험 절\n①②③ ㈜시험회사 문의는 contact@e2e.example.test 로 보내세요. [개인정보](/about/privacy) 와 [고객센터](/help/report) 를 보세요.\n\n- 항목 하나\n\n> 강조 한 줄";
const draft = (user, doc, textBody = BODY_TEXT, eff = "2026-11-01") => api("PUT", `/policies/${doc}`, user, { text: textBody, effectiveOn: eff });
const approval = (version, over = {}) => ({ version, approvedBy: "시험 법률 검토자", approvedOn: "2026-10-20", approvalNote: "시험 승인 근거", ...over });
const publish = (doc, version, over) => api("POST", `/policies/${doc}/publish`, u.admin, approval(version, over));

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
    ...mailEnv(),
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  idMark = Number((await db.query("select coalesce(max(id), 0) m from public.policy_versions")).rows[0].m);
  u.editor = await staff.createUser({ label: "pol-editor", roles: ["editor"], person: { name: "정책시험 편집자", roles: ["editor"] } });
  u.admin = await staff.createUser({ label: "pol-admin", email: ADMIN_EMAIL });
  await setFlags(Object.fromEntries(POLICY_FLAGS.map((k) => [k, false])));
  browser = await chromium.launch();
});

after(async () => {
  try {
    for (const c of contexts) await c.close().catch(() => {});
    await browser?.close();
    // 시험이 만든 정책 버전 — 게시본은 트리거가 지우지 못하게 막으므로 트리거를 끈 세션으로 이 시험이 만든 행(번호가 시작 때보다 큰 것)만 지운다. cleanup()은 DB 연결을 닫으니 그 앞에서
    await db.query("begin");
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.policy_versions where id > $1", [idMark]);
    await db.query("commit");
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

test("a) 켜기 거부 - 게시본 없는 정책 키, 약관 없는 members는 422 + 사유, 값 그대로", async () => {
  const before = await flags();
  for (const key of ["page_terms", "members", "page_privacy"]) {
    const r = await api("PATCH", "/settings/feature_flags", u.admin, { value: { ...before, [key]: true } });
    assert.equal(r.status, 422, key);
    assert.ok(r.body.errors.some((e) => e.includes(`feature_flags.${key}`)), `${key} 사유: ${JSON.stringify(r.body.errors)}`);
  }
  const members = await api("PATCH", "/settings/feature_flags", u.admin, { value: { ...before, members: true } });
  assert.ok(members.body.errors.some((e) => e.includes("게시본이 없는 정책 페이지는 켤 수 없습니다")), "사유 문장");
  assert.deepEqual(await flags(), before, "값 그대로");
  // 의존이 없는 키는 그대로 켜진다
  const calc = await api("PATCH", "/settings/feature_flags", u.admin, { value: { ...before, calc: true } });
  assert.equal(calc.status, 200);
  await api("PATCH", "/settings/feature_flags", u.admin, { value: before });
});

test("b) 게시 전 - 기능 키가 켜져 있어도 정책 페이지 404 · 바닥글 정책 링크 0 · 가입 404", async () => {
  await setFlags(Object.fromEntries(POLICY_FLAGS.map((k) => [k, true])));
  for (const p of ["/about", "/about/editorial-policy", "/about/ethics", "/about/corrections", "/about/ad-policy", "/about/privacy", "/about/terms", "/about/no-email-collection", "/about/advertise", "/signup"]) {
    assert.equal((await get(p)).status, 404, p);
  }
  assert.equal((await get("/about/unknown-doc")).status, 404);
  const home = await get("/");
  assert.equal(home.status, 200);
  assert.deepEqual(footerHrefs(home.html), ["/about/measurement"], "측정 거부만 항상 보인다");
  assert.ok(!/준비 중/.test(text(home.html)), "준비 중 문구 0");
});

test("c) 승인 기록 없이 게시 거부, 권한 밖 편집·게시 403 + 감사 로그", async () => {
  assert.equal((await draft(u.admin, "privacy")).status, 200);
  assert.equal((await draft(u.editor, "privacy")).status, 403, "처리방침은 관리자만 고친다");
  assert.equal((await draft(u.editor, "ethics")).status, 200, "윤리강령은 편집 책임자도 고친다");
  for (const [name, over] of [
    ["검토자 없음", { approvedBy: "" }],
    ["검토일 없음", { approvedOn: "" }],
    ["메모 없음", { approvalNote: "  " }],
  ]) {
    const r = await publish("privacy", 1, over);
    assert.equal(r.status, 422, name);
    assert.ok(r.body.errors.some((e) => e.includes("승인 기록이 없으면 게시할 수 없습니다")), name);
  }
  assert.deepEqual(await versions("privacy"), [{ version: 1, status: "draft" }], "초안 그대로");
  const denied = await api("POST", "/policies/ethics/publish", u.editor, approval(1));
  assert.equal(denied.status, 403);
  assert.deepEqual(await versions("ethics"), [{ version: 1, status: "draft" }]);
  const logs = (await db.query("select count(*)::int n from public.audit_logs where action = 'policy.publish.denied' and actor = $1", [`user:${u.editor.id}`])).rows[0].n;
  assert.equal(logs, 1, "거부 감사 로그 1건");
  assert.equal((await get("/about/privacy")).status, 404, "초안은 공개되지 않는다");
});

test("d) 게시 후 - 가입은 약관+처리방침 둘 다 있어야 열리고, 바닥글 링크 전수 404 0, 게시본 없는 문서는 링크 0", async () => {
  assert.equal((await draft(u.admin, "terms")).status, 200);
  assert.equal((await publish("terms", 1)).status, 200);
  assert.equal((await get("/signup")).status, 404, "약관만 게시 - 가입 닫힘");
  assert.equal((await publish("privacy", 1)).status, 200);
  assert.equal((await get("/signup")).status, 200, "약관+처리방침 게시 - 가입 열림");
  for (const doc of ["about", "editorial-policy", "corrections", "ad-policy", "advertise"]) {
    assert.equal((await draft(u.admin, doc)).status, 200, doc);
    assert.equal((await publish(doc, 1)).status, 200, doc);
  }
  assert.equal((await publish("ethics", 1)).status, 200);

  const home = await get("/");
  const hrefs = footerHrefs(home.html);
  // 옛 사이트 바닥글 순서(회사 소개·개인정보처리방침·이용약관 …) 뒤에 편집 원칙류 (PRD-01A HELP-05, 2026-10-25 PO)
  assert.deepEqual(hrefs, ["/about", "/about/privacy", "/about/terms", "/about/editorial-policy", "/about/ethics", "/about/corrections", "/about/ad-policy", "/about/measurement", "/my"]);
  const bad = [];
  for (const h of hrefs) {
    const r = await get(h);
    if (r.status === 404) bad.push(h);
    if (r.status >= 500) bad.push(`${h} ${r.status}`);
  }
  assert.deepEqual(bad, [], "바닥글 링크 404·5xx 0");
  assert.ok(!hrefs.includes("/about/no-email-collection"), "게시본 없는 이메일무단수집거부 링크 0");
  assert.equal((await get("/about/no-email-collection")).status, 404);
  assert.ok(!hrefs.includes("/help/report"), "고객센터는 page_help가 꺼져 있어 링크 0");
  assert.equal((await get("/about/advertise")).status, 200);
  const privacy = hrefs.indexOf("/about/privacy");
  assert.ok(/font-bold/.test(/<a[^>]*href="\/about\/privacy"[^>]*>/.exec(home.html.slice(home.html.indexOf('aria-label="바닥글 메뉴"')))?.[0] ?? ""), "개인정보처리방침은 굵게");
  assert.ok(privacy >= 0);
});

test("f) 본문 표기 - 원문 ①㈜ 유지 · 평문 이메일 0 · 닫힌 화면 링크는 글자만 · 사이트 안 링크는 링크", async () => {
  const r = await get("/about/privacy");
  assert.equal(r.status, 200);
  const plain = text(r.html);
  assert.ok(plain.includes("①②③ ㈜시험회사"), "①②③·㈜는 그대로");
  assert.ok(plain.includes("contact [at] e2e [dot] example [dot] test"), "이메일은 가림 표기");
  assert.ok(!r.html.includes("mailto:"), "mailto 링크 0");
  assert.ok(/<a[^>]*href="\/about\/privacy"[^>]*>개인정보<\/a>/.test(r.html), "열린 화면은 링크");
  assert.ok(!/href="\/help\/report"/.test(r.html), "닫힌 화면(고객센터)은 글자만");
  assert.ok(plain.includes("고객센터"), "글자는 남는다");
  // 모든 열린 화면에서 평문 이메일 0 - 원문 HTML과 엔티티 풀기 + NFKC 본문 둘 다
  for (const p of ["/", "/about", "/about/privacy", "/about/terms", "/about/advertise", "/about/measurement"]) {
    const x = await get(p);
    const decoded = x.html.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
    assert.ok(!EMAIL_SHAPE.test(x.html), `${p} 원문 HTML`);
    assert.ok(!EMAIL_SHAPE.test(text(decoded).normalize("NFKC")), `${p} 엔티티 풀기 + NFKC`);
  }
});

test("e) 개정 이력 - 버전 2는 개정 사유 필수, 이전 판 ?v=1 (noindex), 없는 판 404, 이력 목록", async () => {
  const d2 = await draft(u.admin, "privacy", "## 개정 절\n둘째 판 본문", "2026-12-01");
  assert.equal(d2.status, 200);
  assert.equal(d2.body.draft.version, 2);
  const noSummary = await publish("privacy", 2);
  assert.equal(noSummary.status, 422);
  assert.ok(noSummary.body.errors.some((e) => e.includes("개정 사유")));
  assert.deepEqual(await versions("privacy"), [{ version: 1, status: "published" }, { version: 2, status: "draft" }]);
  assert.equal((await publish("privacy", 2, { changeSummary: "시험 개정 사유" })).status, 200);
  assert.deepEqual(await versions("privacy"), [{ version: 1, status: "superseded" }, { version: 2, status: "published" }]);

  const cur = await get("/about/privacy");
  assert.ok(text(cur.html).includes("둘째 판 본문"));
  assert.ok(!text(cur.html).includes("①②③"), "현재 판에는 옛 본문 0");
  assert.ok(text(cur.html).includes("개정 이력") && text(cur.html).includes("시험 개정 사유"), "이력 목록과 개정 사유");
  assert.ok(text(cur.html).includes("시행일 2026-12-01"));
  assert.ok(/href="\/about\/privacy\?v=1"/.test(cur.html), "이전 판 링크");

  const old = await get("/about/privacy?v=1");
  assert.equal(old.status, 200);
  assert.ok(text(old.html).includes("①②③ ㈜시험회사"), "이전 판 본문");
  assert.ok(text(old.html).includes("이전 판(버전 1)"));
  assert.ok(/name="robots" content="[^"]*noindex/.test(old.html), "이전 판 noindex");
  for (const v of ["99", "abc", "0"]) assert.equal((await get(`/about/privacy?v=${v}`)).status, 404, `?v=${v}`);
  // 이전 판 본문도 DB에 그대로 (덮어쓰지 않는다)
  const body1 = (await db.query("select body from public.policy_versions where doc_key = 'privacy' and version = 1")).rows[0].body;
  assert.equal(body1[0].heading, "시험 절");
});

test("g) 백오피스 /admin/pages - 뼈대 항목 이름만, 360px 가로 스크롤 0, 공개 360px 가로 스크롤 0", async () => {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  contexts.push(context);
  page = await context.newPage();
  await page.goto(`${base}/admin/login`);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^로그인$/.test(b.textContent.trim()) && !b.disabled));
  await page.fill("#login-email", u.admin.email);
  await page.fill("#login-password", u.admin.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL((url) => url.pathname !== "/admin/login");
  const res = await page.goto(`${base}/admin/pages`);
  assert.equal(res.status(), 200);
  const skeleton = await page.locator('[data-doc="editorial-policy"] [data-part="skeleton"]').innerText();
  assert.ok(skeleton.includes("편집 독립") && skeleton.includes("AI 사용 원칙"), skeleton);
  assert.equal(await page.locator('[data-doc="editorial-policy"] textarea').inputValue(), "", "문장은 채워 두지 않는다");
  assert.ok((await page.locator("#policy-privacy").innerText()).includes("게시 버전 2"));
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(wide, false, "/admin/pages 360px 가로 스크롤 0");
  for (const p of ["/about/privacy", "/about/privacy?v=1", "/"]) {
    await page.goto(`${base}${p}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${p} 360px 가로 스크롤 0`);
  }
});
