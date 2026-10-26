// W11-g 수용 E2E - 상속·증여세 자체 계산 (docs/dev/W11-g_설계.md - PRD-03 FAM-10~14, PRD_최종 §11.1 W11 (W11-g) 동일 출력·게이트)
// standalone 빌드를 로컬 Supabase에 붙인다. 룰셋·대조 사례·사용자는 전부 시험용이다 (룰셋은 rules-igt 초안 값을 시험 버전 번호로 넣은 것 - 실제 감수 서명이 아니다).
//  a) 키 꺼짐(기본) - /calc/gift-tax·/calc/inheritance-tax 모두 404, /calc 에는 외부 계산기 카드 1장
//  b) 키 켜짐 + 활성 룰셋 없음(게이트 닫힘) - 두 경로 404, 외부 카드 유지, 자체 카드 0
//  c) 서명·승인된 룰셋 + 증여 대조 사례(공식 30 + 표본 50) 전부 일치 실행 - 증여만 200, 상속 404, /calc 에 증여 자체 카드 + 외부 카드(상속) 유지
//  d) 브라우저 계산 - 입력 -> 결과가 엔진 출력과 같고, 계산 중 새 요청 0, 주소·저장소·쿠키에 입력 0, 새로고침하면 입력·결과 사라짐, 국세 배지·각인
//  e) 엔진 해시가 다른 실행이 최신이면 다시 닫힘(404), 같은 해시로 다시 실행하면 열림
//  f) 상속 - 공식 29건이면 404, 30건이면 200, 둘 다 열리면 /calc 의 외부 카드가 빠진다
//  g) 감시 법령·첫 검수 항목 - laws national_igt 3행, 미반영 개정 검수 항목 3건
// 만든 행은 끝나면 지우고 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { importSource } from "./lib/ts-source.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w11g-acceptance-e2e@example.test";
const SITE = "https://e2e-w11g.example.test";
const CRON = "e2e-w11g-cron";
const GUARD = "e2e-w11g-guard-secret";
const root = new URL("../", import.meta.url);
const DRAFT = JSON.parse(fs.readFileSync(new URL("rules-igt/2026.07.json", root), "utf8"));
const SOURCE = JSON.parse(fs.readFileSync(new URL("packages/igt-engine/SOURCE.json", root), "utf8"));
// 앱의 엔진 해시와 같은 방식 - SOURCE.json engineFiles 를 정렬해 다시 해시
const ENGINE_HASH = crypto.createHash("sha256").update(JSON.stringify(SOURCE.engineFiles.map((f) => [f.copy, f.copySha256]).sort((a, b) => (a[0] < b[0] ? -1 : 1)))).digest("hex");

let sb, server, staff, db, base, browser, run, saved, engine, rulesetId, reviewerId;
const u = {};
const caseKeys = [];

async function setFlags(patch) {
  dirty = true;
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...patch })]);
}
const api = async (method, p, user, body) => {
  const headers = { origin: base };
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const get = async (p) => {
  await fresh();
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
};
async function bodyHtmlAdmin(p) {
  await fresh();
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(`${base}/login`);
    await page.fill('input[name="email"]', u.admin.email);
    await page.fill('input[name="password"]', u.admin.password);
    await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/login")), page.click('button[type="submit"]')]);
    const res = await page.goto(`${base}${p}`);
    return { status: res.status(), html: await page.content() };
  } finally {
    await ctx.close();
  }
}
const cardsOf = (html) => [...html.matchAll(/data-link-card="([^"]+)"/g)].map((m) => m[1]);

const giftInput = (i) => ({ gift_date: "2026-08-10", donor_relationship: i % 2 ? "lineal_ascendant" : "spouse", recipient_is_resident: true, gift_value: 100_000_000 + i * 37_000_000 });
const inhInput = (i) => ({ death_date: "2026-03-15", decedent_resident: true, assets: { real_estate: 1_000_000_000 + i * 91_000_000 }, heirs: { spouse_exists: i % 2 === 0, children_count: i % 4 } });

async function addCases(kind, official, sample) {
  dirty = true;
  const rs = { ...DRAFT, version: "2098.01" };
  const ids = [];
  for (let i = 0; i < official + sample; i++) {
    const input = kind === "gift" ? giftInput(i) : inhInput(i);
    const calc = kind === "gift" ? engine.calcGift(input, rs) : engine.calcInheritance(input, rs);
    const key = `e2e-w11g-${run}-${kind}-${caseKeys.length}`;
    caseKeys.push(key);
    const c = (await db.query(
      "insert into public.accuracy_cases (case_key, tax_kind, sample_kind, case_input, official_total, official_basis, entered_by) values ($1, $2, $3, $4, $5, $6, 'e2e') returning id",
      [key, kind, i < official ? "official" : "review_sample", JSON.stringify(input), calc.final_tax, i < official ? "tax_notice" : "reviewer_calc"],
    )).rows[0];
    await db.query("select public.confirm_accuracy_case($1, $2)", [c.id, `user:${reviewerId}`]);
    ids.push(c.id);
  }
  return ids;
}
async function recordRun(hash = ENGINE_HASH) {
  dirty = true;
  const rows = (await db.query("select id, official_total from public.accuracy_cases where case_key like $1 and tax_kind in ('gift','inheritance') and retired_at is null and confirmed_at is not null order by id", [`e2e-w11g-${run}-%`])).rows;
  const results = rows.map((r) => ({ case_id: r.id, engine_total: Number(r.official_total) }));
  return (await db.query("select public.record_accuracy_run_igt($1, $2, 'e2e', $3::jsonb) id", [rulesetId, hash, JSON.stringify(results)])).rows[0].id;
}

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.accuracy_run_results where run_id in (select id from public.accuracy_runs where triggered_by = 'e2e')");
    await db.query("delete from public.accuracy_runs where triggered_by = 'e2e'");
    await db.query("delete from public.accuracy_cases where case_key like $1", [`e2e-w11g-${run}-%`]);
    await db.query("delete from public.rules_audit where kind = 'igt_ruleset' and version like '2098.0_'");
    await db.query("delete from public.igt_rulesets where version like '2098.0_'");
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

const serverEnv = () => ({
  NEXT_PUBLIC_SUPABASE_URL: sb.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
  ADMIN_EMAILS: ADMIN_EMAIL,
  NEXT_PUBLIC_SITE_URL: SITE,
  CRON_SECRET: CRON,
  GUARD_SECRET: GUARD,
});
async function startAll() {
  server = await startServer(serverEnv());
  base = server.base;
}
/** 공개 데이터 캐시(30초)를 새로 시작하려고 서버를 다시 띄운다 - 설정·행을 바꾼 뒤 처음 읽을 때 한 번 */
let dirty = true;
async function fresh() {
  if (!dirty) return;
  dirty = false;
  await server?.stop?.();
  await startAll();
}
let savedLink = null;

before(async () => {
  engine = await importSource(new URL("packages/igt-engine/src/index.ts", root).href);
  sb = localSupabase();
  buildWeb();
  await startAll();
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  saved = (await db.query("select key, value from public.settings where key = 'feature_flags'")).rows;
  u.admin = await staff.createUser({ label: "w11g-admin", email: ADMIN_EMAIL });
  u.reviewer = await staff.createUser({ label: "w11g-reviewer", roles: ["reviewer"] });
  reviewerId = u.reviewer.id;
  await purge();
  assert.equal((await db.query("select 1 from public.igt_rulesets where status = 'active'")).rowCount, 0, "시험 전 활성 상속·증여 룰셋이 없어야 합니다");
  savedLink = (await db.query("select * from public.official_links where key = 'inheritance_gift'")).rows[0];
  await db.query("update public.official_links set url = 'https://inheritance-gift.example.test/start', status = 'ok', active = true where key = 'inheritance_gift'");
  await setFlags({ calc: true, self_calculator: true, calc_igt_gift: false, calc_igt_inheritance: false });
  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
    await purge();
    if (savedLink) await db.query("update public.official_links set url = $2, status = $3, active = $4, checked_at = $5 where key = $1", [savedLink.key, savedLink.url, savedLink.status, savedLink.active, savedLink.checked_at]);
    for (const s of saved ?? []) await db.query("update public.settings set value = $2::jsonb where key = $1", [s.key, JSON.stringify(s.value)]);
  } finally {
    await staff?.cleanup();
    server?.stop();
  }
});

test("a) 키 꺼짐(기본) - 두 경로 404, /calc 외부 계산기 카드 1장, 자체 카드 0", async () => {
  for (const p of ["/calc/gift-tax", "/calc/inheritance-tax"]) assert.equal((await get(p)).status, 404, p);
  const hub = await get("/calc");
  assert.equal(hub.status, 200);
  assert.equal(cardsOf(hub.html).filter((c) => c === "inheritance_gift").length, 1);
  assert.equal(cardsOf(hub.html).filter((c) => c.startsWith("self_gift") || c.startsWith("self_inheritance")).length, 0);
});

test("b) 키 켜짐 + 활성 룰셋 없음 - 게이트 닫힘이라 404, 외부 카드 유지", async () => {
  await setFlags({ calc_igt_gift: true, calc_igt_inheritance: true });
  for (const p of ["/calc/gift-tax", "/calc/inheritance-tax"]) assert.equal((await get(p)).status, 404, p);
  assert.equal(cardsOf((await get("/calc")).html).filter((c) => c === "inheritance_gift").length, 1);
});

test("c) 서명·승인 룰셋 + 증여 대조 전부 일치 - 증여만 열리고 상속은 404, 외부 카드(상속) 유지", async () => {
  const body = { ...DRAFT, version: "2098.01" };
  rulesetId = (await db.query("insert into public.igt_rulesets (version, body, body_sha256, source_ref, basis_note, created_by) values ('2098.01', $1, 'x', 'e2e 시험용', 'e2e 시험 반입', 'e2e') returning id", [JSON.stringify(body)])).rows[0].id;
  assert.equal((await db.query("select public.sign_igt_ruleset($1, $2, 'e2e 시험 시트') r", [rulesetId, `user:${reviewerId}`])).rows[0].r.ok, true);
  assert.equal((await db.query("select public.approve_igt_ruleset($1, 'admin:e2e@example.test') r", [rulesetId])).rows[0].r.ok, true);
  dirty = true;
  await addCases("gift", 30, 50);
  await recordRun();
  const gift = await get("/calc/gift-tax");
  assert.equal(gift.status, 200);
  assert.match(gift.html, /data-part="igt-calculator"/);
  assert.equal((await get("/calc/inheritance-tax")).status, 404, "상속 게이트는 따로");
  const cards = cardsOf((await get("/calc")).html);
  assert.ok(cards.includes("self_gift"), "증여 자체 카드");
  assert.ok(!cards.includes("self_inheritance"));
  assert.ok(cards.includes("inheritance_gift"), "상속이 닫혀 있으면 외부 카드 유지");
});

test("d) 브라우저 계산 - 엔진 출력과 같은 결과, 계산 중 새 요청 0, 주소·저장소·쿠키에 입력 0, 새로고침하면 사라짐", async () => {
  await fresh();
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(`${base}/calc/gift-tax`);
    const cookiesBefore = JSON.stringify(await ctx.cookies());
    await page.fill('input[type="date"]', "2026-08-10");
    await page.getByLabel("증여재산가액(원)").fill("500,000,000");
    const requests = [];
    page.on("request", (r) => requests.push(`${r.method()} ${r.url()}`));
    await page.getByRole("button", { name: "계산하기" }).click();
    await page.waitForSelector('[data-part="igt-result"]');
    const expected = engine.calcGift({ gift_date: "2026-08-10", donor_relationship: "lineal_ascendant", recipient_is_resident: true, gift_value: 500_000_000 }, { ...DRAFT, version: "2098.01" }).final_tax;
    assert.match(await page.locator('[data-part="igt-final"]').innerText(), new RegExp(expected.toLocaleString("ko-KR")));
    assert.deepEqual(requests, [], "계산 중 새 요청 0");
    assert.equal(await page.locator('[data-part="national-badge"]').count(), 1, "국세 배지");
    assert.match(await page.locator('[data-part="igt-stamp"]').innerText(), new RegExp(`2098\\.01 · 계산 엔진 ${ENGINE_HASH.slice(0, 8)}`));
    assert.equal(new URL(page.url()).search + new URL(page.url()).hash, "", "주소에 입력 0");
    const stores = await page.evaluate(() => ({ l: localStorage.length, s: sessionStorage.length }));
    assert.deepEqual(stores, { l: 0, s: 0 });
    assert.equal(JSON.stringify(await ctx.cookies()), cookiesBefore, "쿠키 변화 0");
    // 고정 문구 "이 금액은 지방세 금액과 합산하지 않습니다"는 허용(필수 고지) - 그 문장을 뺀 나머지에는 지방세 금액·합계 세액 표현이 없어야 한다
    assert.doesNotMatch((await page.content()).replace(/이 금액은 지방세 금액과 합산하지 않습니다/g, ""), /지방세 금액|합계 세액/);
    await page.reload();
    assert.equal(await page.locator('[data-part="igt-result"]').count(), 0, "새로고침 뒤 결과 0");
    assert.equal(await page.getByLabel("증여재산가액(원)").inputValue(), "", "새로고침 뒤 입력 0");
  } finally {
    await ctx.close();
  }
});

test("e) 엔진 해시가 다른 실행이 최신이면 다시 닫히고, 같은 해시로 다시 실행하면 열린다", async () => {
  await recordRun("d".repeat(64));
  assert.equal((await get("/calc/gift-tax")).status, 404);
  await recordRun();
  assert.equal((await get("/calc/gift-tax")).status, 200);
});

test("f) 상속 - 공식 29건 + 표본 50건이면 404, 30건이면 200, 둘 다 열리면 외부 카드가 빠진다", async () => {
  await addCases("inheritance", 29, 50);
  await recordRun();
  assert.equal((await get("/calc/inheritance-tax")).status, 404);
  await addCases("inheritance", 1, 0);
  assert.equal((await get("/calc/inheritance-tax")).status, 404, "사례를 더한 뒤 실행 전에는 닫힘");
  await recordRun();
  assert.equal((await get("/calc/inheritance-tax")).status, 200);
  const cards = cardsOf((await get("/calc")).html);
  assert.ok(cards.includes("self_gift") && cards.includes("self_inheritance"));
  assert.ok(!cards.includes("inheritance_gift"), "둘 다 열리면 외부 카드 0");
  await setFlags({ calc_igt_inheritance: false });
  assert.equal((await get("/calc/inheritance-tax")).status, 404, "키를 끄면 게이트가 열려 있어도 404");
  assert.ok(cardsOf((await get("/calc")).html).includes("inheritance_gift"), "키를 끄면 외부 카드 복귀");
});

test("g) 감시 법령 3행과 미반영 개정 첫 검수 항목 3건", async () => {
  const laws = (await db.query("select name from public.laws where scope = 'national_igt'")).rows;
  assert.equal(laws.length, 3);
  const items = (await db.query("select kind, title from public.review_items where source_key like 'igt-unreflected-20261008-%'")).rows;
  assert.equal(items.length, 3);
  for (const it of items) assert.doesNotMatch(it.title, /시험용/);
});

test("h) 관리 API - 초안은 관리자만, 서명은 감수위원만(관리자 403 + 거부 감사), 승인은 관리자만, 사례 개인정보 422, 기자·비로그인 거부", async () => {
  const body = JSON.stringify({ ...DRAFT, version: "2098.02" });
  const create = { op: "create", version: "2098.02", source_ref: "e2e 시험용", basis_note: "e2e 시험 반입", body };
  assert.equal((await api("POST", "/api/admin/igt", null, create)).status, 401, "비로그인");
  assert.equal((await api("POST", "/api/admin/igt", u.reviewer, create)).status, 403, "감수위원은 초안 만들기 불가");
  const made = await api("POST", "/api/admin/igt", u.admin, create);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const id = made.body.created.id;
  assert.equal((await api("POST", "/api/admin/igt", u.admin, { op: "create", ...create, body: JSON.stringify({ ...DRAFT, version: "2098.03", status: "active" }), version: "2098.03" })).status, 422, "활성 상태로 만들기 거부");
  const adminSign = await api("POST", "/api/admin/igt", u.admin, { op: "sign", id, sheet_ref: "e2e 시트" });
  assert.equal(adminSign.status, 403, "관리자 서명 403");
  assert.equal((await db.query("select status from public.igt_rulesets where id = $1", [id])).rows[0].status, "draft");
  const early = await api("POST", "/api/admin/igt", u.admin, { op: "approve", id });
  assert.equal(early.status, 409, "서명 없는 승인 거부");
  assert.equal(early.body.code, "not_signed");
  assert.equal((await db.query("select count(*)::int c from public.rules_audit where kind = 'igt_ruleset' and target_id = $1 and outcome = 'refused'", [id])).rows[0].c, 1, "거부 감사 1행");
  assert.equal((await api("POST", "/api/admin/igt", u.reviewer, { op: "sign", id, sheet_ref: "e2e 시트" })).status, 200);
  assert.equal((await api("POST", "/api/admin/igt", u.reviewer, { op: "approve", id })).status, 403, "감수위원은 승인 불가");
  assert.equal((await api("POST", "/api/admin/igt", u.admin, { op: "approve", id })).status, 200);
  assert.equal((await db.query("select status from public.igt_rulesets where id = $1", [id])).rows[0].status, "active");
  const pii = await api("POST", "/api/admin/igt", u.admin, { op: "case_add", case_key: `e2e-w11g-${run}-pii`, tax_kind: "gift", sample_kind: "official", official_basis: "tax_notice", official_total: "1", case_input: JSON.stringify({ donor_name: "x" }) });
  assert.equal(pii.status, 422);
  assert.equal((await api("POST", "/api/admin/igt", u.admin, { op: "case_add", case_key: `e2e-w11g-${run}-ok`, tax_kind: "acquisition", sample_kind: "official", official_basis: "tax_notice", official_total: "1", case_input: "{}" })).status, 422, "지방세 세목은 이 API로 못 넣음");
  const page = await bodyHtmlAdmin("/admin/igt");
  assert.equal(page.status, 200);
  assert.match(page.html, /data-gate="gift"/);
});
