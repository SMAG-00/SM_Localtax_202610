// 국세 미산출 검사·홈 핵심 메시지·4대 분야 카드·허브 지방세 포인트 E2E (W3 9단계 — 01B TX-06 · CORE-02 · PRD-01A HOME-01, docs/dev/W3_설계.md 1장 9단계 증거 · 2.7 · 2.8)
// standalone 빌드를 로컬 Supabase에 붙인다. 포인트 문구·핵심 메시지·바깥 연결 주소는 모두 '시험용' 가짜 글자다(세율·금액·조문 0).
//  a) 국세 검사 — 저장소 그대로 통과, 위반 파일을 넣으면 실제로 잡고(NT1) 빼면 다시 통과 / 렌더된 공개 HTML에 국세 금액 입력 칸·숫자 입력 0 / /calc/transfer 등 404
//  b) 홈 — 핵심 메시지 1개(설정에서 옴, '50년' 422 + DB 거부, 바꾸면 다음 요청부터) · 4대 분야 카드 정확히 4장(링크 카드·네 허브 200·404 0·360/1280px 같은 크기)
//  c) 포인트 3줄/4줄 경계 — API 3줄 200·4줄 422(lines) + DB 거부, 편집 화면은 4번째 줄을 보내지 않고 막는다
//  d) 감수 전 블록 0 — 초안만 있으면 허브 블록·홈 카드 한 줄 0('준비 중' 0), 편집 책임자 서명 403 + 감사, 감수위원 서명 → 다음 요청부터 허브 블록(3줄·기준일·해설 링크 200)·홈 카드 첫 줄
//  e) 문구 바꾸면 즉시 — 초안 고치면 서명이 지워져 바로 블록 0, 다시 서명하면 바로 새 문구 / 브랜드 관리 담당 403 + 감사 1건
//  f) 국세 배지·바깥 연결 카드 — /calc 양도세·외부 계산기 카드에 '국세', 지방세 카드엔 0 / 상황 페이지의 연결 카드(국세 배지) · 주소를 비우면 카드째 0
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { ROOT, buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";
import { formControlHits } from "../scripts/check-national-tax.mjs";

const ADMIN_EMAIL = "w3-home-points-e2e@example.test";
const SITE = "https://e2e.example.test";
const N = (...p) => p.join("");

let sb, server, staff, db, base, browser;
const u = {};
const fx = {};
let linksSnapshot = [];

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body).slice(0, 600);
async function api(method, p, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const points = (user, body) => api("POST", "/hub-points", user, body);
async function page(p) {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
}
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");
const visible = (html) =>
  decode(html.replace(/<head[\s\S]*?<\/head>/, " ").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
const errorFields = (r) => (r.body.errors ?? []).map((e) => String(e).split(":")[0]);
const auditCount = (action, target) => one("select count(*)::int n from public.audit_logs where action = $1 and target = $2", [action, target]).then((r) => r.n);
const pointBlock = (html) => html.match(/<section data-ui="field-tax-point"[\s\S]*?<\/section>/)?.[0] ?? null;
const fieldCards = (html) => html.match(/<nav aria-label="4대 분야" data-ui="field-cards">[\s\S]*?<\/nav>/)?.[0] ?? "";
const cardText = (html, field) => visible(fieldCards(html).match(new RegExp(`<li[^>]*data-field="${field}"[\\s\\S]*?</li>`))?.[0] ?? "");
async function setFeatures(patch) {
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  const r = await api("PATCH", "/settings/feature_flags", u.admin, { value: { ...cur, ...patch } });
  assert.equal(r.status, 200, show(r));
}
const linkId = async (kind, key) => Number((await one("select id from public.official_links where kind = $1 and key = $2", [kind, key])).id);
const setLink = async (id, patch) => {
  const r = await api("POST", "/official-links", u.editor, { op: "update", id, ...patch });
  assert.equal(r.status, 200, show(r));
};
const draft = (lines, over = {}) => ({ op: "draft", section: "realestate", lines, baseDate: "2026-10-01", links: [{ label: "시험용 지방세 해설 보기", href: "/tax" }], ...over });
const LINES3 = ["시험용 부동산 포인트 첫째 줄", "시험용 부동산 포인트 둘째 줄", "시험용 부동산 포인트 셋째 줄"];

/** 렌더된 공개 HTML의 국세 금액 입력 칸 — 검사 스크립트와 같은 함수 + 숫자 입력 칸 */
function amountInputs(html) {
  const numeric = [...html.matchAll(/<input\b[^>]*>/gi)].filter((m) => /type="number"|inputmode="(numeric|decimal)"/i.test(m[0]));
  return [...formControlHits(html).map((h) => h.note), ...numeric.map((m) => m[0])];
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
  linksSnapshot = (await db.query("select id, url, status, terms_note, active from public.official_links order by id")).rows;
  u.admin = await staff.createUser({ label: "hp-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "hp-editor", roles: ["editor"], person: { name: "포인트 시험 편집자", roles: ["editor"] } });
  u.reviewer = await staff.createUser({ label: "hp-reviewer", roles: ["reviewer"], person: { name: "포인트 시험 감수위원", roles: ["reviewer"] } });
  u.ops = await staff.createUser({ label: "hp-ops", roles: ["brand_ops"] });
  // 감수 전 출발 — 포인트 비움
  await db.query("update public.settings set value = '{}'::jsonb where key = 'hub_tax_points'");
  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
    if (db) {
      for (const s of linksSnapshot) {
        await db.query("update public.official_links set url = $2, status = $3, terms_note = $4, active = $5 where id = $1", [s.id, s.url, s.status, s.terms_note, s.active]);
      }
    }
    await staff?.cleanup();
  } finally {
    server?.stop();
  }
});

test("a) 국세 검사 — 저장소 통과·위반 파일을 실제로 잡음·공개 HTML 국세 금액 입력 0·국세 계산 경로 404", async () => {
  const run = () => spawnSync(process.execPath, [path.join(ROOT, "scripts", "check-national-tax.mjs"), ROOT], { encoding: "utf8" });
  let r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /국세 미산출 검사 통과/);
  const rel = `apps/web/lib/e2e-nt-fixture-${process.pid}.ts`;
  const full = path.join(ROOT, rel);
  try {
    fs.writeFileSync(full, N("export const ", "gift", "TaxRates = [0.1, 0.2];\n"));
    r = run();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(r.stderr.includes(`${rel}:1 NT1`), r.stderr);
  } finally {
    fs.rmSync(full, { force: true });
  }
  assert.equal(run().status, 0, "위반 파일을 빼면 다시 통과");

  for (const p of ["/", "/tax", "/realestate", "/finance", "/local", "/news"]) {
    const { status, html } = await page(p);
    assert.equal(status, 200, p);
    assert.deepEqual(amountInputs(html), [], `${p} 국세 금액 입력 칸 0`);
  }
  for (const p of ["/calc/transfer", "/calc/inheritance-acquisition", "/calc/gift-acquisition"]) assert.equal((await page(p)).status, 404, p);
});

test("b) 홈 — 핵심 메시지 1개(설정·'50년' 거부·바로 반영) · 4대 분야 카드 4장(링크 카드·404 0·같은 크기)", async () => {
  const home = await page("/");
  const core = (await one("select value from public.settings where key = 'home_core_message'")).value;
  assert.equal(visible(home.html).split(core).length - 1, 1, "핵심 메시지 1개");
  const hrefs = [...fieldCards(home.html).matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ["/tax", "/realestate", "/finance", "/local"], "카드 정확히 4장");
  for (const h of hrefs) assert.equal((await page(h)).status, 200, `${h} 404 0`);
  assert.ok(!/<button/.test(fieldCards(home.html)), "카드는 링크 카드 — 버튼 0");

  for (const bad of ["시험용 지방세 50년 메시지", "시험용 ５０년 메시지", "시험용 반세기 메시지"]) {
    const r = await api("PATCH", "/settings/home_core_message", u.admin, { value: bad });
    assert.equal(r.status, 422, `${bad} ${show(r)}`);
  }
  await assert.rejects(db.query("update public.settings set value = to_jsonb('시험용 50년 메시지'::text) where key = 'home_core_message'"), /경력 연수/);
  const next = `시험용 핵심 메시지 ${staff.run}`;
  assert.equal((await api("PATCH", "/settings/home_core_message", u.admin, { value: next })).status, 200);
  const after = visible((await page("/")).html);
  assert.equal(after.split(next).length - 1, 1, "바꾼 문구가 다음 요청부터 1개");
  assert.ok(!after.includes(core), "옛 문구 0");

  // 카드 4장 같은 크기 — 한 분야에만 포인트 한 줄이 있어도 (d에서 서명 뒤 다시 본다)
  for (const width of [360, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${base}/`);
    const boxes = await p.$$eval('[data-ui="field-cards"] li[data-field] > a', (els) => els.map((e) => e.getBoundingClientRect()).map((r) => [Math.round(r.width), Math.round(r.height)]));
    assert.equal(boxes.length, 4);
    assert.equal(new Set(boxes.map((b) => b.join("x"))).size, 1, `${width}px 같은 크기: ${JSON.stringify(boxes)}`);
    await ctx.close();
  }
});

test("c) 포인트 3줄/4줄 경계 — API 4줄 422(lines)·DB 거부, 3줄 200 · 편집 화면은 4번째 줄을 보내지 않는다", async () => {
  const four = await points(u.editor, draft([...LINES3, "시험용 넷째 줄"]));
  assert.equal(four.status, 422, show(four));
  assert.deepEqual(errorFields(four), ["lines"]);
  assert.match(four.body.errors[0], /4번째 줄은 저장하지 않습니다/);
  await assert.rejects(
    db.query("update public.settings set value = $1::jsonb where key = 'hub_tax_points'", [JSON.stringify({ finance: { lines: ["1", "2", "3", "4"], base_date: "2026-10-01", links: [{ label: "x", href: "/tax" }], drafted_by: "user:x" } })]),
    /1~3줄/,
  );
  assert.deepEqual(errorFields(await points(u.editor, draft(LINES3, { baseDate: "" }))), ["baseDate"], "기준일 필수");
  assert.deepEqual(errorFields(await points(u.editor, draft(LINES3, { links: [{ label: "시험용", href: "https://example.test/x" }] }))), ["links[0].href"]);
  assert.deepEqual(errorFields(await points(u.editor, draft(["시험용 300만 원 예시"]))), ["lines[0]"], "세액 표현");

  // 편집 화면 — 4줄이면 요청 0, 3줄이면 저장
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`${base}/admin/login`);
  await p.fill("#login-email", u.editor.email);
  await p.fill("#login-password", u.editor.password);
  await p.getByRole("button", { name: "로그인" }).click();
  await p.waitForURL((url) => url.pathname !== "/admin/login");
  let posts = 0;
  p.on("request", (req) => {
    if (req.method() === "POST" && req.url().endsWith("/api/admin/hub-points")) posts++;
  });
  await p.goto(`${base}/admin/hub-points`);
  const form = p.locator('form[data-section="finance"]');
  await form.getByRole("button", { name: "초안 저장" }).waitFor();
  await p.waitForFunction(() => !document.querySelector('form[data-section="finance"] button[type="submit"]')?.disabled);
  await p.fill("#hp-finance-lines", ["시험용 금융 1", "시험용 금융 2", "시험용 금융 3", "시험용 금융 4"].join("\n"));
  await p.fill("#hp-finance-date", "2026-10-01");
  await p.fill("#hp-finance-links", "시험용 해설 | /tax");
  await form.getByRole("button", { name: "초안 저장" }).click();
  await form.getByText(/4번째 줄은 저장하지 않습니다/).first().waitFor();
  assert.equal(posts, 0, "4줄은 서버로 보내지 않는다");
  await p.fill("#hp-finance-lines", ["시험용 금융 1", "시험용 금융 2", "시험용 금융 3"].join("\n"));
  await form.getByRole("button", { name: "초안 저장" }).click();
  await form.getByText("초안을 저장했습니다").waitFor();
  assert.equal(posts, 1);
  await ctx.close();
  const stored = (await one("select value from public.settings where key = 'hub_tax_points'")).value;
  assert.deepEqual(stored.finance.lines, ["시험용 금융 1", "시험용 금융 2", "시험용 금융 3"]);
  assert.equal(stored.finance.reviewed_by, null);
});

test("d) 감수 전 블록 0 — 초안만이면 허브 블록·홈 한 줄 0, 편집 책임자 서명 403 + 감사, 감수위원 서명 → 바로 블록·홈 첫 줄", async () => {
  const saved = await points(u.editor, draft(LINES3));
  assert.equal(saved.status, 200, show(saved));
  assert.equal(saved.body.state, "draft");
  for (const p of ["/realestate", "/finance"]) {
    const { html } = await page(p);
    assert.equal(pointBlock(html), null, `${p} 감수 전 블록 0`);
    assert.ok(!visible(html).includes("이 분야의 지방세 포인트"), p);
    assert.ok(!visible(html).includes("준비 중"), p);
  }
  assert.ok(!cardText((await page("/")).html, "realestate").includes(LINES3[0]), "홈 카드 한 줄 0");

  const byEditor = await points(u.editor, { op: "review", section: "realestate" });
  assert.equal(byEditor.status, 403, show(byEditor));
  assert.equal(await auditCount("review.tax_review.denied", "hub_points:review:realestate"), 1);
  const signed = await points(u.reviewer, { op: "review", section: "realestate" });
  assert.equal(signed.status, 200, show(signed));
  assert.equal(signed.body.state, "reviewed");
  assert.equal(await auditCount("hub_point.review", "settings:hub_tax_points:realestate"), 1);

  const { html } = await page("/realestate");
  const block = pointBlock(html);
  assert.ok(block, "서명 뒤 블록");
  assert.deepEqual([...block.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => decode(m[1])), LINES3);
  assert.match(visible(block), /기준일 2026-10-01/);
  const links = [...block.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links, ["/tax"]);
  for (const l of links) assert.equal((await page(l)).status, 200, `해설 링크 ${l} 404 0`);
  assert.equal(pointBlock((await page("/finance")).html), null, "서명 안 한 분야는 여전히 0");
  assert.equal(pointBlock((await page("/tax")).html), null, "지방세 허브는 블록 없음");
  const homeHtml = (await page("/")).html;
  assert.ok(cardText(homeHtml, "realestate").includes(LINES3[0]), "홈 카드에 첫 줄");
  assert.ok(!cardText(homeHtml, "realestate").includes(LINES3[1]), "한 줄만");

  for (const width of [360, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${base}/`);
    const boxes = await p.$$eval('[data-ui="field-cards"] li[data-field] > a', (els) => els.map((e) => e.getBoundingClientRect()).map((r) => [Math.round(r.width), Math.round(r.height)]));
    assert.equal(new Set(boxes.map((b) => b.join("x"))).size, 1, `${width}px 한 줄이 있어도 같은 크기: ${JSON.stringify(boxes)}`);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, `${width}px 가로 넘침 0`);
    await ctx.close();
  }
});

test("e) 문구를 바꾸면 즉시 — 초안 고치면 서명이 지워져 바로 블록 0, 다시 서명하면 바로 새 문구 / 브랜드 관리 담당 403 + 감사", async () => {
  const changed = ["시험용 바뀐 부동산 포인트"];
  const r = await points(u.editor, draft(changed));
  assert.equal(r.status, 200, show(r));
  assert.equal(r.body.state, "draft");
  assert.equal(pointBlock((await page("/realestate")).html), null, "고친 직후 감수 전 — 블록 0 (옛 문구도 0)");
  assert.equal((await points(u.reviewer, { op: "review", section: "realestate" })).status, 200);
  const block = pointBlock((await page("/realestate")).html);
  assert.ok(block && visible(block).includes(changed[0]), "다시 서명하면 다음 요청부터 새 문구");
  assert.ok(!visible(block).includes(LINES3[0]));
  assert.ok(cardText((await page("/")).html, "realestate").includes(changed[0]));

  const ops = await points(u.ops, draft(LINES3));
  assert.equal(ops.status, 403, show(ops));
  assert.equal(await auditCount("hub_point.edit.denied", "hub_points:draft:realestate"), 1);
  assert.equal((await api("GET", "/hub-points", u.ops)).status, 403);
  const list = await api("GET", "/hub-points", u.reviewer);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.sections.map((s) => [s.section, s.state]), [["realestate", "reviewed"], ["finance", "draft"], ["local", "none"]]);

  const cleared = await points(u.editor, { op: "clear", section: "realestate" });
  assert.equal(cleared.status, 200);
  assert.equal(pointBlock((await page("/realestate")).html), null, "지우면 바로 블록 0");
});

test("f) 국세 배지·바깥 연결 카드 — /calc 양도세·외부 계산기에 '국세', 지방세 카드 0 / 상황 페이지 연결 카드 / 주소를 비우면 카드 0", async () => {
  const transfer = await linkId("sm_calculator", "transfer");
  const acquisition = await linkId("sm_calculator", "acquisition");
  const ansim = await linkId("external_calculator", "inheritance_gift");
  await setLink(transfer, { url: "https://sm.example.test/sell" });
  await setLink(acquisition, { url: "https://sm.example.test/buy" });
  await setLink(ansim, { url: "https://ansim.example.test/" });
  await setFeatures({ calc: true });
  const calc = await page("/calc");
  assert.equal(calc.status, 200);
  const card = (key) => calc.html.match(new RegExp(`<li data-link-card="${key}"[^>]*>[\\s\\S]*?</li>`))?.[0] ?? "";
  assert.match(card("transfer"), /data-tax-kind="national"/);
  assert.match(visible(card("transfer")), /국세/);
  assert.match(visible(card("transfer")), /국세 금액을 계산하지 않습니다/);
  assert.match(card("inheritance_gift"), /data-tax-kind="national"/);
  assert.match(card("acquisition"), /data-tax-kind="local"/);
  assert.ok(!/data-ui="tax-kind-badge"/.test(card("acquisition")), "지방세 카드엔 국세 배지 0");
  assert.deepEqual(amountInputs(calc.html), [], "/calc 금액 입력 칸 0");

  const sit = await one(
    `insert into public.situations (slug, section, title, subtitle, pictogram, checks, visible, reviewer_id, reviewed_at, updated_by, external_link_id)
     values ($1, 'realestate', '시험용 상속 상황', '시험용 부제', 'home-bought', $2, true, $3, now(), 'user:e2e', $4) returning id, slug`,
    [`e2e-hp-sit-${staff.run}`, JSON.stringify([{ title: "시험용 확인 1" }, { title: "시험용 확인 2" }, { title: "시험용 확인 3" }]), u.reviewer.personId, ansim],
  );
  staff.trackRow("situations", sit.id);
  const situation = await page(`/situations/${sit.slug}`);
  assert.equal(situation.status, 200);
  const ext = situation.html.match(/<section[^>]*data-situation-part="external"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.match(ext, /data-link-card="inheritance_gift"[^>]*data-tax-kind="national"/);
  assert.match(ext, /href="https:\/\/ansim\.example\.test\/" target="_blank" rel="noopener noreferrer"/);
  assert.deepEqual(amountInputs(situation.html), []);

  await setLink(ansim, { url: "" });
  await setLink(transfer, { url: "" });
  const hidden = await page(`/situations/${sit.slug}`);
  assert.ok(!/data-situation-part="external"/.test(hidden.html), "주소를 비우면 연결 카드째 0");
  const calc2 = await page("/calc");
  assert.ok(!/data-link-card="transfer"/.test(calc2.html) && !/data-link-card="inheritance_gift"/.test(calc2.html), "/calc에서도 카드 0");
  assert.ok(!visible(calc2.html).includes("준비 중"));
});
