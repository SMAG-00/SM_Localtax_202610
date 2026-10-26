// W11-b 수용 E2E (docs/dev/W11-b_설계.md - PRD-03 RE-01~05 · FAM-05) - 작성만 하고 실행은 리드가 한다.
// standalone 빌드를 로컬 Supabase에 붙이고 Chromium으로 화면을 직접 눌러 본다. 룰셋은 저장소의 rules/2026.01.json(미감수 초안) 그대로이고,
// 가이드·판정표·정책 숫자·주소는 전부 시험용 가짜다(example.test, 2099년 날짜) - 시험은 법령 정답이 아니라 연결(서명 -> 공개, 입력 -> 판정/계산, 주소 -> 카드)을 본다.
//  a) 기능 키 꺼짐·자료 없음 - /realestate/tax · /calc/house-count · /calc/total-cost 모두 404, 서명 전 가이드 anon 0·관리자 서명 403
//  b) 세금 전 주기 - 서명·공개 뒤 탭 3개·취득 원인 3칸·상속·증여 칸 안내 링크·세목 배지, 양도 탭은 해설 + 확인 목록 + SM 카드 1장뿐(입력 칸·금액 0), 체크해도 저장·전송 0
//  c) 주택 수 판정 - 상속/증여는 서로 다른 판정표 버전, 모르겠어요(빈 칸) -> 결론 0 + 빠진 항목, 판정 중 네트워크 요청 0·저장소 0·주소 변화 0
//  d) 총비용 - 총액 = 그래프 합계 = 표 합계 = 행 합, 금리 0%·보유 0년 경계, 상한 초과 거부, 모르겠어요 -> 보유세 미포함, 양도 줄·매도가 칸 0, SM 카드 1장, 계산 중 네트워크 0·저장소 0
//  e) 메모리 전달 - 주택 수 판정 결과의 주택 수가 같은 탭 이동으로 총비용 화면에 채워지고, 새로고침하면 사라진다
//  f) FAM-05 - 안내 페이지의 다음에 확인할 것: 공개된 도구 카드만, 주소에 값 0
//  g) 정책 모양 - 잘못된 total_cost_policy는 DB가 거부
// 만든 룰셋·사례·가이드·판정표·설정은 끝나면 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w11b-acceptance-e2e@example.test";
const CRON = "e2e-w11b-cron-secret";
const SITE = "https://e2e-w11b.example.test";
const CALC_FLAGS = ["calc", "sm_calculator", "self_calculator", "calc_acquisition", "calc_holding"];
const NEW_FLAGS = ["tax_lifecycle", "house_count", "total_cost"];
const POLICY = { max_holding_years: 7, max_rate_bp: 2000, max_extra_items: 2, compare_years: [3, 5] };
const CUTOFF = "2099-06-01";
const ACQ = { ownerType: "INDIVIDUAL", propertyKind: "LAND", price: 100000000 };
const HOLD = { ownerType: "INDIVIDUAL", propertyKind: "HOUSE", publishedPrices: [500000000] };

let sb, server, staff, db, browser, base, run, since;
const u = {};
const created = { rulesets: [], tables: [] };
let originalFlags = null;
let originalPolicy = null;
let originalInheritanceFlag = null;
const originalLinks = new Map();

async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const rules = (user, body) => api("POST", "/rules", user, body);
const guides = (user, body) => api("POST", "/guides", user, body);
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
async function setFlags(patch) {
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...patch })]);
}
async function setFlagUnguarded(patch) {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await setFlags(patch);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}
async function setLink(key, patch) {
  if (!originalLinks.has(key)) originalLinks.set(key, (await db.query("select * from public.official_links where key = $1", [key])).rows[0]);
  const cols = Object.keys(patch);
  await db.query(`update public.official_links set ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} where key = $1`, [key, ...cols.map((c) => patch[c])]);
}
async function seedCases(taxKind, cause, sampleKind, total, from, to) {
  await db.query(
    `insert into public.accuracy_cases (case_key, tax_kind, cause, sample_kind, case_input, official_total, official_basis, entered_by)
     select 'e2e-w11b-' || $1 || '-' || $2 || '-' || coalesce($4::text, 'all') || '-' || $3 || '-' || g, $2, $4::text, $3, $5::jsonb, $6, $7, 'e2e:w11b' from generate_series($8::int, $9::int) g`,
    [run, taxKind, sampleKind, cause, JSON.stringify(taxKind === "acquisition" ? ACQ : HOLD), total, sampleKind === "official" ? "tax_notice" : "reviewer_calc", from, to],
  );
}
async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.accuracy_run_results where case_id in (select id from public.accuracy_cases where case_key like 'e2e-w11b-%')");
    await db.query("delete from public.accuracy_runs where ruleset_id = any($1::bigint[]) or run_at >= $2", [created.rulesets, since]);
    await db.query("delete from public.accuracy_cases where case_key like 'e2e-w11b-%'");
    await db.query("delete from public.rules_audit where target_id = any($1::bigint[]) and kind = 'ruleset'", [created.rulesets]);
    await db.query("delete from public.rulesets where id = any($1::bigint[])", [created.rulesets]);
    await db.query("delete from public.rules_audit where target_id = any($1::bigint[]) and kind = 'determination_table'", [created.tables]);
    await db.query("delete from public.determination_tables where id = any($1::bigint[])", [created.tables]);
    await db.query("delete from public.guides_audit where guide_version_id in (select v.id from public.guide_versions v join public.guides g on g.id = v.guide_id where g.topic = 'tax_lifecycle' and g.hub = 'realestate_tax')");
    await db.query("delete from public.guide_versions where guide_id in (select id from public.guides where topic = 'tax_lifecycle' and hub = 'realestate_tax')");
    await db.query("delete from public.guides where topic = 'tax_lifecycle' and hub = 'realestate_tax'");
    await db.query("delete from public.agent_runs where job = 'accuracy-run' and started_at >= $1", [since]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

/** 화면에서 일어난 요청을 모은다 - 로드가 끝난 뒤 시작하고, 입력·판정·계산 동안 새 요청이 0이어야 한다 */
async function quiet(page) {
  await page.waitForLoadState("networkidle");
  const seen = [];
  page.on("request", (r) => seen.push(r.url()));
  return seen;
}
const storageSize = (page) => page.evaluate(() => localStorage.length + sessionStorage.length);

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
  u.admin = await staff.createUser({ label: "w11b-admin", email: ADMIN_EMAIL });
  u.reviewer = await staff.createUser({ label: "w11b-reviewer", roles: ["reviewer"], person: { name: "시험용 감수위원", roles: ["reviewer"] } });
  await purge();
  originalFlags = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0]?.value ?? null;
  originalPolicy = (await db.query("select value from public.settings where key = 'total_cost_policy'")).rows[0]?.value ?? {};
  await db.query("update public.settings set value = '{}'::jsonb where key = 'total_cost_policy'");
  await setFlags({ ...Object.fromEntries(CALC_FLAGS.map((f) => [f, true])), ...Object.fromEntries(NEW_FLAGS.map((f) => [f, false])) });
  for (const key of ["acquisition", "property_tax", "transfer", "inheritance_gift", "wetax", "nts"]) await setLink(key, { url: `https://${key.replace(/_/g, "-")}.example.test/start`, status: "ok", active: true });
  await startAll();
});

after(async () => {
  try {
    await purge();
    if (originalFlags) await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify(originalFlags)]);
    await db.query("update public.settings set value = $1::jsonb where key = 'total_cost_policy'", [JSON.stringify(originalPolicy)]);
    for (const [key, row] of originalLinks) await db.query("update public.official_links set url = $2, status = $3, active = $4, checked_at = $5 where key = $1", [key, row.url, row.status, row.active, row.checked_at]);
  } finally {
    await browser?.close();
    await staff?.cleanup();
    await server?.stop?.();
  }
});

const GUIDE = {
  op: "create",
  hub: "realestate_tax",
  topic: "tax_lifecycle",
  slug: "tax-lifecycle-w11b",
  title: "시험용 세금 전 주기",
  tax_scope: "both",
  as_of: "2026-06-30",
  sections: [
    { heading: "시험용 매매 해설", body: "시험용 매매 본문" },
    { heading: "시험용 상속 해설", body: "시험용 상속 본문" },
    { heading: "시험용 보유 해설", body: "시험용 보유 본문" },
    { heading: "시험용 양도 해설", body: "시험용 양도 본문" },
  ],
  facts: {
    section_map: [
      { index: 0, tab: "acquire", cause: "PAID", tax_kind: "local" },
      { index: 1, tab: "acquire", cause: "INHERITANCE", tax_kind: "national" },
      { index: 2, tab: "hold", tax_kind: "local" },
      { index: 3, tab: "transfer", tax_kind: "national" },
    ],
    transfer_checklist: [
      { id: "a", label: "시험용 확인 항목" },
      { id: "b", label: "시험용 이면 비과세됩니다" },
    ],
  },
  sources: [],
};

const INHERIT = { kind: "house_count_inheritance", version: "2099.01", label: "시험용 상속 후 주택 수", required: [{ id: "cause_date", label: "시험용 취득일" }], rules: [{ id: "r1", when: { op: "lt", field: "cause_date", value: CUTOFF }, conclusion: "시험용 상속-이전" }, { id: "r2", when: { op: "gte", field: "cause_date", value: CUTOFF }, conclusion: "시험용 상속-이후" }] };
const GIFT = { kind: "house_count_gift", version: "2099.02", label: "시험용 증여 후 주택 수", required: [{ id: "cause_date", label: "시험용 취득일" }], rules: [{ id: "g1", when: { op: "lt", field: "cause_date", value: CUTOFF }, conclusion: "시험용 증여-이전" }, { id: "g2", when: { op: "gte", field: "cause_date", value: CUTOFF }, conclusion: "시험용 증여-이후" }] };
const HOUSES = {
  kind: "house_count",
  version: "2099.01",
  label: "시험용 주택 수",
  entry_required: [{ id: "item_kind", label: "시험용 종류" }, { id: "acquired_on", label: "시험용 보유 취득일" }],
  count_when: { op: "all", conds: [{ op: "in", field: "item_kind", values: ["house", "right"] }, { op: "lte", field: "acquired_on", value: CUTOFF }] },
  result_rules: [{ id: "none", op: "eq", value: 0, conclusion: "시험용 무주택" }, { id: "one", op: "eq", value: 1, conclusion: "시험용 1주택" }, { id: "many", op: "gte", value: 2, conclusion: "시험용 다주택" }],
};

test("a) 기능 키 꺼짐·자료 없음 - 세 화면 모두 404, 서명 전 가이드는 공개 0, 관리자는 서명 못 함", async () => {
  for (const p of ["/realestate/tax", "/calc/house-count", "/calc/total-cost"]) assert.equal((await html(p)).status, 404, `${p} 키 꺼짐`);

  const made = await guides(u.admin, { ...GUIDE, op: "create" });
  assert.ok(made.status === 201 || made.status === 200, JSON.stringify(made.body));
  u.guideVersionId = Number(made.body.created?.id ?? made.body.created?.version_id);
  assert.ok(u.guideVersionId > 0, JSON.stringify(made.body));
  assert.equal((await guides(u.admin, { op: "sign", id: u.guideVersionId, sheet_ref: "시험용 시트" })).status, 403, "관리자 서명 시도는 403");

  await setFlags(Object.fromEntries(NEW_FLAGS.map((f) => [f, true])));
  await restart();
  for (const p of ["/realestate/tax", "/calc/house-count", "/calc/total-cost"]) assert.equal((await html(p)).status, 404, `${p} 키는 켜졌지만 서명된 자료가 없음`);
});

test("b) 세금 전 주기 - 탭 3개·원인 3칸·양도 탭은 해설 + 확인 목록 + SM 카드뿐, 체크해도 저장·전송 0", async () => {
  assert.equal((await guides(u.reviewer, { op: "sign", id: u.guideVersionId, sheet_ref: "시험용 시트" })).status, 200);
  assert.equal((await guides(u.admin, { op: "publish", id: u.guideVersionId })).status, 200);

  // 판정표 3종: 초안 -> 감수 서명 -> 승인
  for (const body of [INHERIT, GIFT, HOUSES]) {
    const draft = await rules(u.admin, { op: "create", kind: "determination_table", version: body.version, source_ref: "시험용", basis_note: "시험용 반입", body: JSON.stringify(body) });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    const id = Number(draft.body.created.id);
    created.tables.push(id);
    assert.equal((await rules(u.reviewer, { op: "sign", kind: "determination_table", id, sheet_ref: "시험용 시트" })).status, 200);
    assert.equal((await rules(u.admin, { op: "approve", kind: "determination_table", id })).status, 200);
  }
  // 활성 룰셋 + 취득(매매)·재산세 게이트 열기 (총비용 화면용)
  const draft = await rules(u.admin, { op: "create", kind: "ruleset", version: "2026.01", source_ref: "시험용 - rules 폴더 초안", basis_note: "시험용 초기 반입", body: fs.readFileSync(new URL("../rules/2026.01.json", import.meta.url), "utf8") });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const rid = Number(draft.body.created.id);
  created.rulesets.push(rid);
  assert.equal((await rules(u.reviewer, { op: "sign", kind: "ruleset", id: rid, sheet_ref: "시험용 시트" })).status, 200);
  assert.equal((await rules(u.admin, { op: "approve", kind: "ruleset", id: rid })).status, 200);
  const probes = [["acquisition", "PAID"], ["property", null]];
  for (const [tax, cause] of probes) await seedCases(tax, cause, "official", 1, 0, 0);
  const reviewerActor = `user:${u.reviewer.id}`;
  const confirmAll = () => db.query("select public.confirm_accuracy_case(id, $1) from public.accuracy_cases where case_key like $2 and confirmed_at is null and retired_at is null", [reviewerActor, `e2e-w11b-${run}-%`]);
  await confirmAll();
  assert.equal((await job("accuracy-run")).status, 200);
  const totals = {};
  for (const [tax, cause] of probes) {
    const r = await db.query("select r.engine_total from public.accuracy_run_results r join public.accuracy_cases c on c.id = r.case_id where c.case_key = $1 order by r.run_id desc limit 1", [`e2e-w11b-${run}-${tax}-${cause ?? "all"}-official-0`]);
    totals[`${tax}:${cause}`] = Number(r.rows[0]?.engine_total);
  }
  await db.query("update public.accuracy_cases set retired_at = now() where case_key like $1", [`e2e-w11b-${run}-%-official-0`]);
  assert.ok(Object.values(totals).every((n) => Number.isFinite(n)), JSON.stringify(totals));
  await seedCases("acquisition", "PAID", "official", totals["acquisition:PAID"], 1, 30);
  await seedCases("acquisition", "PAID", "review_sample", totals["acquisition:PAID"], 1, 50);
  await seedCases("property", null, "official", totals["property:null"], 1, 30);
  await seedCases("property", null, "review_sample", totals["property:null"], 1, 50);
  await confirmAll();
  assert.equal((await api("POST", "/accuracy", u.admin, { op: "run" })).status, 200);
  // 총비용 정책 (시험용 숫자)
  await db.query("update public.settings set value = $1::jsonb where key = 'total_cost_policy'", [JSON.stringify(POLICY)]);
  await restart();

  const page = await browser.newPage();
  try {
    await page.goto(`${base}/realestate/tax`);
    assert.equal(await page.locator('[role="tab"]').count(), 3);
    assert.deepEqual(await page.locator('[role="tab"]').allTextContents(), ["취득", "보유", "양도"]);
    assert.equal(await page.locator('[data-part="cause"]').count(), 3, "취득 원인 3칸");
    assert.equal(await page.locator('[data-part="cause-link"][href="/realestate/inheritance-gift"]').count(), 2, "상속·증여 칸 안내 링크");
    assert.equal(await page.locator('[data-part="accordion"][data-tax-kind="national"]').count(), 1);
    assert.equal(await page.locator('[data-part="accordion"][data-tax-kind="local"]').count(), 1);

    await page.click('[role="tab"][data-tab="transfer"]');
    const panel = page.locator('[data-part="panel"][data-tab="transfer"]');
    assert.equal(await panel.locator("input:not([type=checkbox])").count(), 0, "양도 탭에 입력 칸 0 (매도가 칸 0)");
    assert.equal(await panel.locator('[data-part="transfer-checklist"] input[type=checkbox]').count(), 1, "단정 표현 항목은 빠짐");
    assert.equal(await panel.locator('[data-ui="sm-calculator-card"][data-calc="transfer"]').count(), 1, "SM 양도세 카드 1장");
    assert.doesNotMatch(await panel.innerText(), /\d[\d,]*\s*원/, "양도 탭에 금액 0");
    const href = await panel.locator('[data-ui="sm-calculator-card"] a[href]').first().getAttribute("href");
    assert.ok(href && !/[?#]/.test(href), `SM 카드 주소에 값 없음: ${href}`);

    const seen = await quiet(page);
    await panel.locator("input[type=checkbox]").check();
    assert.equal(seen.length, 0, "체크해도 요청 0");
    assert.equal(await storageSize(page), 0, "체크해도 저장소 0");
    assert.equal(page.url(), `${base}/realestate/tax`, "주소 변화 0");
  } finally {
    await page.close();
  }
});

test("c) 주택 수 판정 - 원인별 다른 판정표 버전, 모르겠어요는 결론 0, 판정 중 네트워크·저장소 0", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/calc/house-count`);
    assert.equal(await page.locator("[data-cause]").count(), 3, "서명된 표가 있는 원인 3개");
    const seen = await quiet(page);

    await page.click('[data-cause="INHERITANCE"]');
    let card = page.locator('[data-ui="determination-result"]');
    assert.equal(await card.getAttribute("data-status"), "요건 확인 필요", "입력 전에는 결론 0");
    assert.equal(await card.locator('[data-part="conclusion"]').count(), 0);
    assert.match(await card.innerText(), /시험용 취득일/, "빠진 항목 표시");

    await page.getByLabel("시험용 취득일").fill("2099-05-31");
    assert.equal(await card.getAttribute("data-status"), "결론");
    assert.match(await card.innerText(), /시험용 상속-이전/);
    assert.match(await card.innerText(), /2099\.01/, "상속 판정표 버전");
    await page.getByLabel("시험용 취득일").fill(CUTOFF);
    assert.match(await card.innerText(), /시험용 상속-이후/, "기준일 당일은 다음 규칙");

    await page.click('[data-cause="GIFT"]');
    card = page.locator('[data-ui="determination-result"]');
    await page.getByLabel("시험용 취득일").fill(CUTOFF);
    assert.match(await card.innerText(), /시험용 증여-이후/);
    assert.match(await card.innerText(), /2099\.02/, "증여 판정표 버전은 상속과 다르다");
    assert.doesNotMatch(await card.innerText(), /시험용 상속-/);

    await page.getByLabel("시험용 취득일").fill("모르겠어요");
    assert.equal(await card.getAttribute("data-status"), "요건 확인 필요", "모르겠어요 -> 결론 0");
    assert.equal(await card.locator('[data-part="conclusion"]').count(), 0);

    assert.equal(seen.length, 0, `판정 중 네트워크 요청 0 (실제: ${seen.join(", ")})`);
    assert.equal(await storageSize(page), 0, "저장소 0");
    assert.equal(page.url(), `${base}/calc/house-count`, "주소에 입력값 0");
  } finally {
    await page.close();
  }
});

test("d) 총비용 - 총액 = 그래프 = 표 = 행 합, 금리 0%·보유 0년, 상한, 모르겠어요, 양도 줄 0", async () => {
  const page = await browser.newPage();
  const sumRows = async () => (await page.locator('[data-part="row"]').evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-total"))))).reduce((a, b) => a + b, 0);
  const total = async () => Number(await page.locator('[data-part="total-amount"]').getAttribute("data-total"));
  try {
    await page.goto(`${base}/calc/total-cost`);
    const seen = await quiet(page);
    await page.fill("input[name=price]", "500000000");
    await page.fill("input[name=years]", "3");
    await page.fill("input[name=published]", "300000000");
    await page.fill("input[name=extra1]", "1234567");
    await page.fill("input[name=loan]", "200000000");
    await page.fill("input[name=rate]", "3.5");
    await page.waitForSelector('[data-part="result"]');
    const t = await total();
    assert.ok(t > 0);
    assert.equal(Number(await page.locator('[data-part="chart"]').getAttribute("data-sum")), t, "그래프 합계 = 총액");
    assert.equal(Number(await page.locator('[data-part="table"]').getAttribute("data-sum")), t, "표 합계 = 총액");
    assert.equal(await sumRows(), t, "행 합 = 총액");
    assert.equal(await page.locator('[data-part="row"]').count(), 4, "취득 + 3년차");
    // 연 이자 = 원금 x 3.5% (원 미만 버림)가 보유 해마다 같다
    const interest = await page.locator('[data-part="row"]').evaluateAll((els) => els.map((e) => e.querySelectorAll("td")[3].textContent));
    assert.deepEqual(interest, ["0원", "7,000,000원", "7,000,000원", "7,000,000원"]);

    // 금리 0%
    await page.fill("input[name=rate]", "0");
    const zeroRate = await page.locator('[data-part="row"]').evaluateAll((els) => els.map((e) => e.querySelectorAll("td")[3].textContent));
    assert.deepEqual(zeroRate, ["0원", "0원", "0원", "0원"]);
    assert.equal(await sumRows(), await total());

    // 보유 0년
    await page.fill("input[name=years]", "0");
    assert.equal(await page.locator('[data-part="row"]').count(), 1, "보유 0년이면 취득 행뿐(보유세 0회)");
    assert.equal(await sumRows(), await total());

    // 상한: 7년은 허용, 8년은 거부
    await page.fill("input[name=years]", "7");
    assert.equal(await page.locator('[data-part="row"]').count(), 8);
    await page.fill("input[name=years]", "8");
    assert.equal(await page.locator('[data-part="range-error"]').count(), 1);
    assert.equal(await page.locator('[data-part="result"]').count(), 0, "상한을 넘으면 결과 0");
    await page.fill("input[name=years]", "3");

    // 모르겠어요 - 공시가격
    await page.locator("label", { hasText: "모르겠어요" }).first().locator("input").check();
    const chips = await page.locator('[data-part="result"]').innerText();
    assert.match(chips, /보유세 미포함/);
    assert.equal(await page.locator('[data-part="row"]').count(), 1, "추정으로 채우지 않고 보유세를 뺌");
    await page.locator("label", { hasText: "모르겠어요" }).first().locator("input").uncheck();

    // 양도 단계
    const result = page.locator('[data-part="result"]');
    assert.equal(await result.locator('[data-part="transfer-notice"]').count(), 1, "양도세 미포함 안내 1개");
    assert.equal(await result.locator('[data-ui="sm-calculator-card"][data-calc="transfer"]').count(), 1, "SM 카드 1장");
    // 양도세 미포함 안내와 SM 카드(양도소득세를 계산하지 않는다는 고정 문구)를 뺀 나머지 결과에는 양도 줄·수익 표현이 없어야 한다
    const body = await result.evaluate((el) => {
      const c = el.cloneNode(true);
      c.querySelectorAll('[data-part="transfer-notice"], [data-ui="sm-calculator-card"]').forEach((n) => n.remove());
      return c.innerText ?? c.textContent;
    });
    assert.doesNotMatch(body, /양도소득세|지방소득세|수익률|차익|유리|불리/, "양도 줄·수익 표현 0");
    assert.equal(await page.locator("input[name*=sale], input[name*=sell], input[name*=transfer]").count(), 0, "매도가 입력 칸 0");
    const href = await result.locator('[data-ui="sm-calculator-card"] a[href]').first().getAttribute("href");
    assert.ok(href && !/[?#]/.test(href), `SM 카드 주소에 입력값 0: ${href}`);

    assert.equal(seen.length, 0, `계산 중 네트워크 요청 0 (실제: ${seen.join(", ")})`);
    assert.equal(await storageSize(page), 0, "저장소 0");
    assert.equal(page.url(), `${base}/calc/total-cost`);
  } finally {
    await page.close();
  }
});

test("e) 메모리 전달 - 판정 결과 주택 수가 총비용 화면에 채워지고 새로고침하면 사라진다", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/calc/house-count`);
    await page.locator("input[type=checkbox]").check();
    await page.click('[data-part="add-entry"]');
    await page.getByLabel("시험용 종류").fill("house");
    await page.getByLabel("시험용 보유 취득일").fill("2099-05-31");
    const card = page.locator('[data-ui="determination-result"]');
    assert.match(await card.innerText(), /시험용 1주택/);
    await page.click('[data-part="handoff-total-cost"]');
    await page.waitForURL("**/calc/total-cost");
    assert.equal(page.url(), `${base}/calc/total-cost`, "주소에 값 0");
    assert.equal(await page.locator("input[name=houses]").inputValue(), "1", "메모리로 넘어온 주택 수");
    assert.equal(await storageSize(page), 0);
    await page.reload();
    assert.equal(await page.locator("input[name=houses]").inputValue(), "", "새로고침하면 사라진다");
  } finally {
    await page.close();
  }
});

test("f) FAM-05 - 안내 페이지의 다음에 확인할 것은 공개된 도구 카드만, 주소에 값 0", async () => {
  originalInheritanceFlag = (await db.query("select value -> 'inheritance_gift' as v from public.settings where key = 'feature_flags'")).rows[0]?.v ?? false;
  // 상속·증여 안내 키는 세무 게이트 승인 기록·고지·입문 기사가 있어야 켜진다 - 이 시험 대상이 아니므로 시험 DB에서만 가드 트리거를 건너뛰어 켠다(끝나면 원래 값으로)
  await setFlagUnguarded({ inheritance_gift: true });
  await restart();
  const res = await html("/realestate/inheritance-gift");
  assert.equal(res.status, 200);
  assert.equal(count(res.text, /data-ui="family-next"/g), 1, "묶음 1개");
  assert.equal(count(res.text, /data-card="house_count"/g), 1, "서명된 판정표가 있으니 주택 수 카드 1장");
  assert.equal(count(res.text, /data-card="holding"/g), 1, "재산세 게이트가 열려 있으니 보유세 카드 1장");
  assert.equal(count(res.text, /data-card="transfer"/g), 1, "양도세는 SM 카드 1장");
  for (const m of res.text.matchAll(/data-card="(house_count|holding)"[^>]*>.*?href="([^"]+)"/gs)) assert.doesNotMatch(m[2], /[?#]/, `카드 주소에 값 0: ${m[2]}`);
  // 판정표 서명이 사라지면 주택 수 카드는 자리째 없다 (준비 중 카드 0)
  await db.query("update public.settings set value = value || '{\"house_count\": false}'::jsonb where key = 'feature_flags'");
  await restart();
  const off = await html("/realestate/inheritance-gift");
  assert.equal(count(off.text, /data-card="house_count"/g), 0);
  assert.doesNotMatch(off.text, /준비 중/);
  await setFlagUnguarded({ inheritance_gift: Boolean(originalInheritanceFlag), house_count: true });
});

test("g) 정책 모양 - 잘못된 total_cost_policy는 DB가 거부한다", async () => {
  await assert.rejects(db.query("update public.settings set value = '{\"max_holding_years\": -1}'::jsonb where key = 'total_cost_policy'"), /total_cost_policy/);
  await assert.rejects(db.query("update public.settings set value = $1::jsonb where key = 'total_cost_policy'", [JSON.stringify({ ...POLICY, compare_years: [3, 8] })]), /compare_years/);
});
