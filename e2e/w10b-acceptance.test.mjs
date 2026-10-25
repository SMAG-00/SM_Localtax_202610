// W10-b 수용 E2E (docs/dev/W10-b_설계.md - PRD-02 CALC-01·02·04·05·09·11·12·13·14 · FAM-04·07 · WETAX-01 · TX-04)
// standalone 빌드를 로컬 Supabase에 붙이고 Chromium으로 화면을 직접 눌러 본다. 룰셋 값은 저장소의 rules/2026.01.json(SM이 가진 미감수 초안) 그대로이고
// 대조 사례·주소·판정표는 전부 시험용 가짜다(example.test) - 시험은 법령 정답이 아니라 연결(게이트 -> 카드 전환, 입력 -> 결과, 주소 -> 카드)을 본다.
//  a) 게이트 닫힘 - 계산기 라우트 404, /calc는 세목마다 SM 카드 정확히 1장, 자체 카드 0
//  b) 게이트 열림(취득세 기본·상속 묶음, 재산세) - 취득세·재산세 자체 카드로 바뀌고 SM 카드는 빠짐(1장), 종부세·증여 원인은 닫힌 채
//  c) 질문형 - 한 화면 질문 1개(60자 이하, 첫 화면 150자 이하), 첫 선택지에 포커스, 6블록 순서, 총액=명세 합계, 360x740 첫 화면, 계산 중 네트워크 0·저장소 0
//  d) 질문형 = 전체 폼 - 같은 값이면 총액이 같다
//  e) 상속 원인 - 미포함 안내 1개·외부 계산기 카드 1장·주소에 입력값 0·새 창, 증여(공개 전) - 금액 0·안내+SM 카드+외부 카드
//  f) 재산세 - 과세기준일 소유 아니요 -> 납세의무 없음, 종부세(닫힘) 항목 0
//  g) 비교 - 비회원은 가입 안내(이미 입력한 열은 그대로)
//  h) 정확도 화면 - 묶음별 건수는 대조 실행 결과, 증여·종부세는 공개 안 함
//  i) 위택스 - 메뉴 주소 카드 / 메뉴 broken -> 첫 화면 대체 / 첫 화면도 broken -> 안내 문장만
//  j) 링크 점검 - 연속 2회 실패에 broken + 검수 큐 link_error 1건(3회째도 1건), 같은 주 재실행은 건너뜀
//  k) 게이트 닫힘 되돌리기 - 상속 사례 1건 철회 -> 상속 원인만 unsupported, 유상취득은 그대로
// 만든 룰셋·사례·주소·설정은 끝나면 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { LIMITS } from "./lib/screen-rules.mjs";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w10b-acceptance-e2e@example.test";
const CRON = "e2e-w10b-cron-secret";
const SITE = "https://e2e-w10b.example.test";
const FLAGS = ["calc", "sm_calculator", "self_calculator", "calc_acquisition", "calc_holding", "calc_refund", "calc_compare", "calc_accuracy", "wetax_links"];
const PRICE = 100000000;
const ACQ = { ownerType: "INDIVIDUAL", propertyKind: "LAND", price: PRICE };
const HOLD = { ownerType: "INDIVIDUAL", propertyKind: "HOUSE", publishedPrices: [500000000] };

let sb, server, staff, db, browser, base, run, since;
const u = {};
const created = { rulesets: [] };
let originalFlags = null;
const originalLinks = new Map();

const rules = (user, body) => api("POST", "/rules", user, body);
async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const job = (name) => fetch(`${base}/api/jobs/${name}`, { headers: { authorization: `Bearer ${CRON}` } }).then(async (res) => ({ status: res.status, text: await res.text() }));
const html = async (path) => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, text: await res.text() };
};
const count = (text, re) => (text.match(re) ?? []).length;

async function startAll() {
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
    CRON_SECRET: CRON,
  });
  base = server.base;
}
/** 공개 데이터 캐시(30초)를 새로 시작하려고 서버를 다시 띄운다 - 새 배포와 같은 출발점 */
async function restart() {
  await server?.stop?.();
  await startAll();
}

async function setLink(table, keyCol, key, patch) {
  const id = `${table}:${key}`;
  if (!originalLinks.has(id)) originalLinks.set(id, (await db.query(`select * from public.${table} where ${keyCol} = $1`, [key])).rows[0]);
  const cols = Object.keys(patch);
  await db.query(`update public.${table} set ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} where ${keyCol} = $1`, [key, ...cols.map((c) => patch[c])]);
}
const url = (name) => `https://${name}.example.test/start`;

async function seedCases(taxKind, cause, sampleKind, total, from, to) {
  await db.query(
    `insert into public.accuracy_cases (case_key, tax_kind, cause, sample_kind, case_input, official_total, official_basis, entered_by)
     select 'e2e-w10b-' || $1 || '-' || $2 || '-' || coalesce($4::text, 'all') || '-' || $3 || '-' || g, $2, $4::text, $3, $5::jsonb, $6, $7, 'e2e:w10b' from generate_series($8::int, $9::int) g`,
    [run, taxKind, sampleKind, cause, JSON.stringify(taxKind === "acquisition" ? ACQ : HOLD), total, sampleKind === "official" ? "tax_notice" : "reviewer_calc", from, to],
  );
}
async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.accuracy_run_results where case_id in (select id from public.accuracy_cases where case_key like 'e2e-w10b-%')");
    await db.query("delete from public.accuracy_runs where ruleset_id = any($1::bigint[]) or run_at >= $2", [created.rulesets, since]);
    await db.query("delete from public.accuracy_cases where case_key like 'e2e-w10b-%'");
    await db.query("delete from public.rules_audit where target_id = any($1::bigint[]) and kind = 'ruleset'", [created.rulesets]);
    await db.query("delete from public.rulesets where id = any($1::bigint[])", [created.rulesets]);
    await db.query("delete from public.agent_runs where job in ('accuracy-run','link-check') and started_at >= $1", [since]);
    await db.query("delete from public.wetax_link_checks where at >= $1", [since]);
    await db.query("delete from public.official_link_checks where at >= $1", [since]); // 점검 배치는 실행 키(ISO 주)마다 한 벌만 기록한다 - 뒤 시험(tax-links 등)의 첫 실행이 건너뛰어지지 않게 이 시험의 기록을 지운다
    await db.query("delete from public.review_item_events where item_id in (select id from public.review_items where source_key like 'wetax:%')");
    await db.query("delete from public.review_items where source_key like 'wetax:%'");
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  browser = await chromium.launch();
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  since = new Date().toISOString();
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  u.admin = await staff.createUser({ label: "w10b-admin", email: ADMIN_EMAIL });
  u.reviewer = await staff.createUser({ label: "w10b-reviewer", roles: ["reviewer"], person: { name: "시험용 감수위원", roles: ["reviewer"] } });
  await purge();
  // 기능 키 켜기 (끝나면 원래 값으로)
  originalFlags = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0]?.value ?? null;
  const on = Object.fromEntries(FLAGS.map((f) => [f, true]));
  await db.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify(on)]);
  // 바깥 연결 주소 (시험용)
  for (const [key, kind] of [["acquisition", "sm_calculator"], ["property_tax", "sm_calculator"], ["transfer", "sm_calculator"], ["inheritance_gift", "external_calculator"], ["wetax", "fallback"], ["nts", "fallback"]]) {
    await setLink("official_links", "key", key, { url: url(`${kind}-${key}`.replace(/_/g, "-")), status: "ok", active: true });
  }
  await startAll();
});

after(async () => {
  try {
    await purge();
    if (originalFlags) await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify(originalFlags)]);
    for (const [id, row] of originalLinks) {
      const [table, key] = id.split(":");
      if (table === "official_links") await db.query("update public.official_links set url = $2, status = $3, active = $4, checked_at = $5 where key = $1", [key, row.url, row.status, row.active, row.checked_at]);
      else await db.query("update public.wetax_links set url = $2, status = $3, fail_count = $4, checked_at = $5 where key = $1", [key, row.url, row.status, row.fail_count, row.checked_at]);
    }
  } finally {
    await browser?.close();
    await staff?.cleanup();
    await server?.stop?.();
  }
});

test("a) 게이트 닫힘 - 계산기 라우트 404, /calc는 세목마다 SM 카드 정확히 1장, 자체 카드 0", async () => {
  for (const p of ["/calc/acquisition", "/calc/holding", "/calc/refund"]) assert.equal((await html(p)).status, 404, p);
  const hub = await html("/calc");
  assert.equal(hub.status, 200);
  assert.equal(count(hub.text, /data-link-card="acquisition"/g), 1, "취득세 SM 카드 1장");
  assert.equal(count(hub.text, /data-link-card="property_tax"/g), 1, "재산세 SM 카드 1장");
  assert.equal(count(hub.text, /data-link-card="self_/g), 0, "자체 카드 0");
  assert.equal(count(hub.text, /data-link-card="inheritance_gift"/g), 1, "외부 계산기 카드 1장");
  // 국세 계산 경로 0
  for (const p of ["/calc/transfer", "/calc/inheritance", "/calc/gift", "/calc/inheritance-acquisition", "/calc/gift-acquisition"]) assert.equal((await html(p)).status, 404, p);
});

test("b) 게이트 열림 - 취득세(기본·상속)·재산세는 자체 카드, 종부세·증여는 닫힌 채", async () => {
  // 활성 룰셋: 초안 -> 감수 서명 -> 승인 (RPC 경로 그대로)
  const draft = await rules(u.admin, { op: "create", kind: "ruleset", version: "2026.01", source_ref: "시험용 - rules 폴더 초안", basis_note: "시험용 초기 반입", body: fs.readFileSync(new URL("../rules/2026.01.json", import.meta.url), "utf8") });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const id = Number(draft.body.created.id);
  created.rulesets.push(id);
  assert.equal((await rules(u.reviewer, { op: "sign", kind: "ruleset", id, sheet_ref: "시험용 시트" })).status, 200);
  assert.equal((await rules(u.admin, { op: "approve", kind: "ruleset", id })).status, 200);

  // 첫 실행 - probe 사례로 엔진 합계를 얻는다(법령 정답이 아니라 연결을 보는 시험)
  const probes = [["acquisition", "PAID"], ["acquisition", "INHERITANCE"], ["property", null]];
  for (const [tax, cause] of probes) await seedCases(tax, cause, "official", 1, 0, 0);
  const reviewerActor = `user:${u.reviewer.id}`;
  const confirmAll = () => db.query("select public.confirm_accuracy_case(id, $1) from public.accuracy_cases where case_key like $2 and confirmed_at is null and retired_at is null", [reviewerActor, `e2e-w10b-${run}-%`]);
  await confirmAll();
  assert.equal((await job("accuracy-run")).status, 200);
  const totals = {};
  for (const [tax, cause] of probes) {
    const r = await db.query("select r.engine_total from public.accuracy_run_results r join public.accuracy_cases c on c.id = r.case_id where c.case_key = $1 order by r.run_id desc limit 1", [`e2e-w10b-${run}-${tax}-${cause ?? "all"}-official-0`]);
    totals[`${tax}:${cause}`] = Number(r.rows[0]?.engine_total);
  }
  await db.query("update public.accuracy_cases set retired_at = now() where case_key like $1", [`e2e-w10b-${run}-%-official-0`]);
  assert.ok(Object.values(totals).every((n) => Number.isFinite(n)), JSON.stringify(totals));
  u.totals = totals;

  await seedCases("acquisition", "PAID", "official", totals["acquisition:PAID"], 1, 30);
  await seedCases("acquisition", "INHERITANCE", "official", totals["acquisition:INHERITANCE"], 1, 30);
  await seedCases("acquisition", "PAID", "review_sample", totals["acquisition:PAID"], 1, 50);
  await seedCases("property", null, "official", totals["property:null"], 1, 30);
  await seedCases("property", null, "review_sample", totals["property:null"], 1, 50);
  await confirmAll();
  assert.equal((await api("POST", "/accuracy", u.admin, { op: "run" })).status, 200);
  await restart();

  const hub = await html("/calc");
  assert.equal(count(hub.text, /data-link-card="self_acquisition"/g), 1, "취득세 자체 카드 1장");
  assert.equal(count(hub.text, /data-link-card="acquisition"/g), 0, "취득세 SM 카드는 빠짐");
  assert.equal(count(hub.text, /data-link-card="self_property"/g), 1, "재산세·종부세 묶음 자체 카드 1장");
  assert.equal(count(hub.text, /data-link-card="property_tax"/g), 0);
  assert.equal(count(hub.text, /data-link-card="transfer"/g), 1, "양도세는 SM 메뉴 연결 유지");
  assert.equal(count(hub.text, /data-link-card="inheritance_gift"/g), 1, "상속·증여는 외부 카드");
  assert.equal((await html("/calc/acquisition")).status, 200);
  assert.equal((await html("/calc/holding")).status, 200);
  assert.equal((await html("/calc/refund")).status, 404, "서명된 환급 판정표 없음");
});

async function newPage(path, viewport = { width: 360, height: 740 }) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  return page;
}
const pick = (page, name) => page.getByRole("button", { name, exact: true }).click();
async function answerAcquisition(page, cause) {
  await pick(page, "개인");
  await pick(page, "토지");
  await pick(page, cause);
  await page.getByLabel("취득하는 가액은 얼마인가요?").fill(String(PRICE));
  await pick(page, "다음");
}

test("c) 질문형 - 질문 1개·60자·150자·첫 선택지 포커스, 6블록 순서, 총액=명세, 360x740 첫 화면, 네트워크·저장소 0", async () => {
  const page = await newPage("/calc/acquisition");
  assert.equal(await page.locator('[data-part="flow-step"]').count(), 1, "한 화면 질문 1개");
  const question = (await page.locator("h2").first().textContent()) ?? "";
  assert.ok(question.length > 0 && question.length <= 60, question);
  assert.ok(((await page.locator("main").innerText()) ?? "").length <= LIMITS.r1Chars, "첫 화면 150자 이하");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "개인", "첫 선택지에 포커스");
  assert.equal(await page.getByRole("button", { name: "모르겠어요" }).count(), 0, "필수 질문에는 모르겠어요 없음");

  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  const cookiesBefore = await page.context().cookies();
  await answerAcquisition(page, "유상취득(매매)");
  await page.locator('[data-result-block="total"]').waitFor();
  const order = await page.locator("[data-result-block]").evaluateAll((els) => els.map((e) => e.getAttribute("data-result-block")));
  assert.deepEqual(order, ["total", "deadline", "breakdown", "basis", "next"], "감면 판정표가 없으면 감면 블록만 빠지고 순서는 그대로");
  const total = (await page.locator('[data-part="total-amount"]').textContent()) ?? "";
  assert.equal((await page.locator('[data-part="breakdown-total"]').textContent()) ?? "", total, "총액 = 명세서 합계");
  const box = await page.locator('[data-result-block="deadline"]').boundingBox();
  const totalBox = await page.locator('[data-result-block="total"]').boundingBox();
  assert.ok(totalBox && box && box.y + box.height <= 740, "360x740 첫 화면에 총액·기한 줄");
  assert.match(await page.locator('[data-ui="ruleset-label"]').textContent(), /적용 룰셋 2026\.01/);
  assert.deepEqual(requests, [], "계산 중 네트워크 요청 0");
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0, "브라우저 저장소 0");
  assert.deepEqual(await page.context().cookies(), cookiesBefore, "쿠키 변화 0");
  assert.ok(!(await page.content()).includes('href="https://') || !(await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.href))).some((h) => h.includes(String(PRICE))), "주소에 입력값 0");
  // 새로고침하면 답이 복원되지 않는다
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator('[data-result-block="total"]').count(), 0);
  await page.close();
});

test("d) 질문형 = 전체 폼 - 같은 값이면 총액이 같다", async () => {
  const a = await newPage("/calc/acquisition");
  await answerAcquisition(a, "유상취득(매매)");
  const flowTotal = await a.locator('[data-part="total-amount"]').textContent();
  await a.close();

  const b = await newPage("/calc/acquisition", { width: 1024, height: 900 });
  await pick(b, "한 화면에 모두 입력");
  await b.locator('[data-question="ownerType"]').getByRole("button", { name: "개인" }).click();
  await b.locator('[data-question="propertyKind"]').getByRole("button", { name: "토지" }).click();
  await b.locator('[data-question="cause"]').getByRole("button", { name: "유상취득(매매)" }).click();
  await b.getByLabel("취득하는 가액은 얼마인가요?").fill(String(PRICE));
  await pick(b, "계산하기");
  assert.equal(await b.locator('[data-part="total-amount"]').textContent(), flowTotal);
  await b.close();
});

test("e) 상속 원인 - 미포함 안내 1개·외부 카드 1장·입력값 0, 증여(공개 전) - 금액 0·안내+SM 카드+외부 카드", async () => {
  const p = await newPage("/calc/acquisition");
  await answerAcquisition(p, "상속");
  assert.equal(await p.locator('[data-part="national-notice"]').count(), 1, "안내 문장 1개");
  assert.equal(await p.locator('[data-ui="external-calculator-card"]').count(), 1, "외부 계산기 카드 1장");
  const hrefs = await p.locator('[data-ui="external-calculator-card"] a').evaluateAll((as) => as.map((a) => [a.href, a.rel, a.target]));
  assert.equal(hrefs.length, 1);
  assert.ok(!hrefs[0][0].includes(String(PRICE)) && !/[?#]/.test(hrefs[0][0].replace(/^https?:\/\//, "")), "주소에 입력값·쿼리·조각 0");
  assert.match(hrefs[0][1], /noopener/);
  assert.equal(hrefs[0][2], "_blank");
  const text = (await p.locator("main").innerText()) ?? "";
  assert.ok(!/총 납부세액|상속세 포함/.test(text), "금지 문구 0");
  assert.equal(await p.locator('[data-row]').evaluateAll((rs) => rs.some((r) => /상속세|증여세/.test(r.textContent ?? ""))), false, "명세서에 국세 행 0");
  await p.close();

  const g = await newPage("/calc/acquisition");
  await pick(g, "개인");
  await pick(g, "토지");
  await pick(g, "증여");
  assert.equal(await g.locator('[data-part="unsupported"]').count(), 1, "공개 전 원인은 unsupported");
  assert.equal(await g.locator('[data-part="total-amount"]').count(), 0, "금액 줄 0 (0원도 아님)");
  assert.equal(await g.locator('[data-ui="sm-calculator-card"]').count(), 1, "SM 취득세 카드");
  assert.equal(await g.locator('[data-ui="external-calculator-card"]').count(), 1, "외부 계산기 카드");
  await g.close();
});

test("f) 재산세 - 과세기준일 소유 아니요 -> 납세의무 없음, 종부세(닫힘) 항목 0", async () => {
  const no = await newPage("/calc/holding");
  await pick(no, "아니요");
  assert.match((await no.locator('[data-state="not-liable"]').textContent()) ?? "", /올해 재산세는 내지 않아요/);
  await no.close();

  const yes = await newPage("/calc/holding");
  await pick(yes, "예");
  await pick(yes, "개인");
  await yes.getByLabel("주택마다 공시가격은 얼마인가요? 1번째").fill("3000000000");
  await pick(yes, "다음");
  while (await yes.locator('[data-part="flow-step"]').count()) await pick(yes, "모르겠어요");
  await yes.locator('[data-result-block="breakdown"]').waitFor();
  const codes = await yes.locator("[data-row]").evaluateAll((rs) => rs.map((r) => r.getAttribute("data-row")));
  assert.ok(codes.length > 0 && codes.every((c) => !c.startsWith("CRET_")), `종부세 항목 0: ${codes}`);
  await yes.close();
});

test("g) 비교 - 비회원은 가입 안내가 뜨고 이미 입력한 조건은 그대로", async () => {
  const p = await newPage("/calc/compare", { width: 1024, height: 900 });
  await p.locator('[data-column="A"] [data-question], [data-column="A"]').first().waitFor();
  await p.getByLabel("취득하는 가액은 얼마인가요?").fill(String(PRICE));
  await p.locator('[data-part="compare-add"]').click();
  assert.equal(await p.locator('[data-part="compare-join"]').count(), 1);
  assert.equal(await p.getByLabel("취득하는 가액은 얼마인가요?").inputValue(), "100,000,000", "입력한 값 그대로");
  assert.equal(await p.locator("[data-column]").count(), 1, "비회원은 열이 늘지 않는다");
  await p.close();
});

test("h) 정확도 화면 - 묶음별 건수는 대조 실행 결과, 증여·종부세는 공개 안 함", async () => {
  const page = await newPage("/calc/accuracy", { width: 1024, height: 900 });
  const rows = await page.locator("[data-row]").evaluateAll((rs) => rs.map((r) => [r.getAttribute("data-row"), r.getAttribute("data-open"), r.textContent]));
  const by = Object.fromEntries(rows.map(([k, o, t]) => [k, { open: o === "true", text: t }]));
  assert.equal(by.acquisition_other.open, true);
  assert.match(by.acquisition_other.text, /30\/30/);
  assert.equal(by.acquisition_inheritance.open, true);
  assert.equal(by.acquisition_gift.open, false);
  assert.equal(by.comprehensive.open, false);
  assert.equal(by.property.open, true);
  assert.match(by.acquisition_gift.text, /아직 공개하지 않음/);
  await page.close();
});

test("i) 위택스 - 메뉴 주소 카드 / 메뉴 broken -> 첫 화면 대체 / 첫 화면도 broken -> 안내 문장만", async () => {
  const goto = async () => {
    await restart();
    const p = await newPage("/calc/acquisition");
    await answerAcquisition(p, "유상취득(매매)");
    await p.locator('[data-ui="wetax-card"]').waitFor();
    return p;
  };
  await setLink("wetax_links", "key", "wetax_home", { url: url("wetax-home"), status: "ok" });
  await setLink("wetax_links", "key", "wetax_acquisition_filing", { url: url("wetax-filing"), status: "ok" });
  let p = await goto();
  let a = await p.locator('[data-part="wetax-go"]').evaluateAll((as) => as.map((x) => [x.href, x.rel, x.target]));
  assert.deepEqual(a.map((x) => x[0]), [url("wetax-filing")], "메뉴 주소 그대로 - 쿼리·입력값 0");
  assert.match(a[0][1], /noopener/);
  assert.equal(a[0][2], "_blank");
  assert.equal(await p.locator('[data-part="wetax-app"]').count(), 0, "앱 주소가 없으면 앱 안내 0");
  await p.close();

  await setLink("wetax_links", "key", "wetax_acquisition_filing", { status: "broken", fail_count: 2 });
  p = await goto();
  assert.equal(await p.locator('[data-ui="wetax-card"]').getAttribute("data-mode"), "fallback");
  assert.deepEqual(await p.locator('[data-part="wetax-go"]').evaluateAll((as) => as.map((x) => x.href)), [url("wetax-home")]);
  await p.close();

  await setLink("wetax_links", "key", "wetax_home", { status: "broken", fail_count: 2 });
  p = await goto();
  assert.equal(await p.locator('[data-ui="wetax-card"]').getAttribute("data-mode"), "text");
  assert.equal(await p.locator('[data-part="wetax-go"]').count(), 0, "깨진 링크 렌더 0");
  assert.match((await p.locator('[data-part="wetax-text"]').textContent()) ?? "", /직접 찾아 주세요/);
  await p.close();
});

test("j) 링크 점검 - 연속 2회 실패에 broken + 검수 큐 link_error 1건, 3회째도 1건", async () => {
  await setLink("wetax_links", "key", "wetax_vehicle_payment", { url: "https://unreachable-w10b.example.test/x", status: "unchecked", fail_count: 0 });
  const state = async () => (await db.query("select status, fail_count from public.wetax_links where key = 'wetax_vehicle_payment'")).rows[0];
  const items = async () => (await db.query("select count(*)::int n from public.review_items where kind = 'link_error' and source_key = 'wetax:wetax_vehicle_payment'")).rows[0].n;
  const againNextWeek = () => db.query("delete from public.wetax_link_checks where link_key = 'wetax_vehicle_payment'");

  assert.equal((await job("link-check")).status, 200);
  assert.deepEqual(await state(), { status: "unchecked", fail_count: 1 }, "첫 실패는 상태를 바꾸지 않는다");
  assert.equal(await items(), 0);
  assert.equal((await job("link-check")).status, 200);
  assert.deepEqual(await state(), { status: "unchecked", fail_count: 1 }, "같은 주 재실행은 건너뜀(멱등)");

  await againNextWeek();
  assert.equal((await job("link-check")).status, 200);
  assert.deepEqual(await state(), { status: "broken", fail_count: 2 }, "연속 2회 실패 -> broken");
  assert.equal(await items(), 1, "검수 큐 link_error 1건");

  await againNextWeek();
  assert.equal((await job("link-check")).status, 200);
  assert.equal(await items(), 1, "계속 실패해도 검수 항목은 1건");
});

test("k) 상속 사례 1건 철회 -> 상속 원인만 unsupported, 유상취득은 그대로", async () => {
  await db.query("update public.accuracy_cases set retired_at = now() where case_key = $1", [`e2e-w10b-${run}-acquisition-INHERITANCE-official-30`]);
  const retired = (await db.query("select count(*)::int n from public.accuracy_cases where retired_at is not null and case_key = $1", [`e2e-w10b-${run}-acquisition-INHERITANCE-official-30`])).rows[0].n;
  assert.equal(retired, 1);
  await restart();
  const p = await newPage("/calc/acquisition");
  await pick(p, "개인");
  await pick(p, "토지");
  await pick(p, "상속");
  assert.equal(await p.locator('[data-part="unsupported"]').count(), 1, "상속 원인은 닫힘");
  await p.close();
  const q = await newPage("/calc/acquisition");
  await answerAcquisition(q, "유상취득(매매)");
  assert.equal(await q.locator('[data-part="total-amount"]').count(), 1, "유상취득은 그대로");
  await q.close();
});

test("l) 해시 미리 채움·공유 - 기사에서 가져온 값 표시, 요청에 입력값 0, 룰셋이 다르면 안내, 결과 링크는 해시만", async () => {
  const ctxt = await browser.newContext({ viewport: { width: 360, height: 740 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctxt.newPage();
  const urls = [];
  page.on("request", (r) => urls.push(r.url()));
  await page.goto(`${base}/calc/acquisition#t=acquisition&v=2000.01&ownerType=INDIVIDUAL&propertyKind=LAND&cause=PAID&price=${PRICE}`, { waitUntil: "networkidle" });
  assert.equal(await page.locator('[data-part="prefilled"]').count(), 1, "가져온 값은 질문에 표시된다");
  assert.equal(await page.locator('[data-part="ruleset-mismatch"]').count(), 1, "룰셋이 달라요 안내");
  assert.ok(urls.every((u) => !u.includes("ownerType") && !u.includes(String(PRICE))), "해시는 서버로 가지 않는다");
  // 가져온 값을 그대로 확인하며 끝까지 가거나 바꿀 수 있다
  await pick(page, "법인");
  await pick(page, "토지");
  await pick(page, "유상취득(매매)");
  await page.getByLabel("취득하는 가액은 얼마인가요?").fill(String(PRICE));
  await pick(page, "다음");
  await page.locator('[data-part="share-copy"]').click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(link.startsWith(`${base}/calc/acquisition#t=acquisition`), link);
  assert.ok(link.includes(`price=${PRICE}`) && link.includes("ownerType=CORPORATION"), "바꾼 값이 공유 링크에 담긴다");
  assert.equal(await page.locator('[data-part="print"]').count(), 1);
  await ctxt.close();
});

test("m) 홈 계산기 카드 - 취득세·재산세 카드는 세목마다 정확히 1장, 환급 진단은 서명된 판정표가 없어 0장", async () => {
  const home = await html("/");
  assert.equal(home.status, 200);
  assert.equal(count(home.text, /data-tool-card="acquisition"/g), 1);
  assert.equal(count(home.text, /data-tool-card="holding"/g), 1);
  assert.equal(count(home.text, /data-tool-card="refund"/g), 0);
  assert.equal(count(home.text, /data-tool-kind="self"/g), 2);
  assert.ok(home.text.includes('href="/calc/acquisition"') && home.text.includes('href="/calc/holding"'), "카드 주소에 입력값 0");
});
