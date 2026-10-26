// W11-c 수용 E2E - 신탁·정비·금융 구조 세금 가이드와 판정 (docs/dev/W11-c_설계.md 4장 - PRD-03 TRU-01·02·03 · RDV-01~04·09 · PR-12 · DF-08)
// standalone 빌드를 로컬 Supabase에 붙인다. 가이드·판정표는 전부 시험용 가짜다 - 실제 법령·세율·요건 문장 없음.
//  a) 키 꺼짐(기본) - 금융 구조별 세금 가이드·판정 화면 4개가 모두 404 (진입 버튼·"준비 중" 0)
//  b) DF-08 관문 - 자본시장법 검토 기록 없이 finance_tax_guide 켜기 거부, approved + ref 뒤 켜기 성공
//  c) 배치 API - 기자 403 · 편집 책임자급(관리자) 201 · 같은 배치 409 · finance_tax 허브의 신탁 주제 배치 422(같은 해설이 두 경로에 없음)
//  d) 서명 전 가이드 404 -> 서명만 해도 404 -> 공개 뒤 200, 금지 낱말이 든 절은 그리지 않음, 배지·감수일·국세 안내, TRU-02 = DF-08 같은 버전·본문 해시
//  e) 판정 - 판정표 서명 전 404 -> 서명 + 승인 뒤 200 / 모르겠어요 -> 결론 0 + "요건 확인 필요" / 답하면 결론 + 판정표 버전 + "판정은 참고용"
//     / /calc/trust-taxpayer 와 /calc/project-tax 의 신탁 보유세 판정은 같은 사실 -> 같은 결론·같은 버전 / 답한 값이 요청·저장소에 실리지 않음
//  f) 화면 문구 - 열린 화면에 금지 사전·금액 표현 0
// 만든 행은 끝나면 지우고 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w11c-acceptance-e2e@example.test";
const SITE = "https://e2e-w11c.example.test";
const CRON = "e2e-w11c-cron";
const GUARD = "e2e-w11c-guard-secret";
const FORBIDDEN = ["유망 구역", "예상 수익", "분담금 계산", "사업성", "유리합니다", "불리합니다", "추천합니다"];
const TABLE_VERSION = "2099.01";

let sb, server, staff, db, base, browser, run, saved;
const u = {};
const fx = { slugs: [] };

const show = (r) => JSON.stringify(r.body).slice(0, 500);
async function api(method, path, user, body) {
  const headers = {};
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  headers.origin = base;
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const guidesApi = (user, body) => api("POST", "/api/admin/guides", user, body);
const placeApi = (user, body) => api("POST", "/api/admin/guides/placements", user, body);
async function setFlags(patch) {
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...patch })]);
}
const get = async (p) => {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
};
const attr = (html, name) => new RegExp(`${name}="([^"]*)"`).exec(html)?.[1] ?? null;

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    const ids = (await db.query("select v.id from public.guide_versions v join public.guides g on g.id = v.guide_id where g.slug like $1", ["e2e-w11c-%"])).rows.map((r) => r.id);
    await db.query("delete from public.guide_placements where guide_id in (select id from public.guides where slug like $1)", ["e2e-w11c-%"]);
    if (ids.length) await db.query("delete from public.guides_audit where guide_version_id = any($1::bigint[])", [ids]);
    await db.query("delete from public.guide_versions where guide_id in (select id from public.guides where slug like $1)", ["e2e-w11c-%"]);
    await db.query("delete from public.guides where slug like $1", ["e2e-w11c-%"]);
    const tids = (await db.query("select id from public.determination_tables where kind = 'trust_taxpayer' and version = $1", [TABLE_VERSION])).rows.map((r) => r.id);
    if (tids.length) {
      await db.query("delete from public.rules_audit where target_id = any($1::bigint[]) and kind = 'determination_table'", [tids]);
      await db.query("delete from public.determination_tables where id = any($1::bigint[])", [tids]);
    }
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

const SERVER_ENV = () => ({
  NEXT_PUBLIC_SUPABASE_URL: sb.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
  ADMIN_EMAILS: ADMIN_EMAIL,
  NEXT_PUBLIC_SITE_URL: SITE,
  CRON_SECRET: CRON,
  GUARD_SECRET: GUARD,
});
async function startAll() {
  server = await startServer(SERVER_ENV());
  base = server.base;
}
/** 공개 데이터 캐시(30초)를 새로 시작하려고 서버를 다시 띄운다 - 기능 키·행을 바꾼 뒤 */
async function restart() {
  await server?.stop?.();
  await startAll();
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  await startAll();
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  saved = (await db.query("select key, value from public.settings where key in ('feature_flags', 'finance_tax_guide_review')")).rows;
  u.admin = await staff.createUser({ label: "w11c-admin", email: ADMIN_EMAIL });
  u.reporter = await staff.createUser({ label: "w11c-reporter", roles: ["reporter"], person: { name: "시험용 기자", roles: ["reporter"] } });
  u.reviewer = await staff.createUser({ label: "w11c-reviewer", roles: ["reviewer"], person: { name: "시험용 감수위원", roles: ["reviewer"] } });
  await setFlags({ trust_tax_guide: false, finance_tax_guide: false, redevelopment_tax: false, tax_determination: false, tax_lifecycle: false });
  await db.query("update public.settings set value = '{}'::jsonb where key = 'finance_tax_guide_review'");
  await purge();
  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
    await purge();
    for (const s of saved ?? []) await db.query("update public.settings set value = $2::jsonb where key = $1", [s.key, JSON.stringify(s.value)]);
  } finally {
    await staff?.cleanup();
    server?.stop();
  }
});

test("a) 키 꺼짐(기본) - 세금 가이드·판정 화면이 모두 404", async () => {
  for (const p of ["/finance/tax-guide", "/finance/tax-guide/e2etopic", "/calc/trust-taxpayer", "/calc/project-tax", "/calc/redevelopment-right", "/realestate/development-methods/redevelopment/steps/test_stage"]) {
    assert.equal((await get(p)).status, 404, p);
  }
});

test("b) DF-08 관문 - 검토 기록 없이 finance_tax_guide 켜기 거부, approved + ref 뒤 켜기 성공", async () => {
  await assert.rejects(setFlags({ finance_tax_guide: true }), /자본시장법 검토 기록/);
  const rec = { reviewer: "시험 검토자", reviewed_on: "2099-01-01", conclusion: "approved", ref: `시험용 기록 ${run}` };
  await db.query("update public.settings set value = $1::jsonb where key = 'finance_tax_guide_review'", [JSON.stringify(rec)]);
  await setFlags({ finance_tax_guide: true, trust_tax_guide: true, tax_determination: true });
  const flags = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  assert.equal(flags.finance_tax_guide, true);
});

test("c) 배치 API - 기자 403 · 관리자 201 · 같은 배치 409 · finance_tax 허브의 신탁 주제 배치 422", async () => {
  const trust = await guidesApi(u.admin, {
    op: "create", hub: "trust", topic: `t_${run}`.slice(0, 40), slug: `e2e-w11c-${run}-trust`, title: "시험용 신탁 세금 가이드", tax_scope: "both", as_of: "2099-01-01",
    sections: [{ heading: "시험용 절 하나", body: "시험용 본문 하나" }, { heading: "시험용 걸리는 절", body: "이 구역은 사업성이 높습니다" }],
    sources: [{ label: "시험용 근거 칩" }],
  });
  assert.equal(trust.status, 201, show(trust));
  fx.trustVersion = trust.body.created.id;
  fx.trustId = (await db.query("select id from public.guides where slug = $1", [`e2e-w11c-${run}-trust`])).rows[0].id;

  const dup = await guidesApi(u.admin, { op: "create", hub: "finance_tax", topic: "trust", slug: `e2e-w11c-${run}-dup`, title: "시험용 중복 가이드", tax_scope: "local", sections: [{ heading: "시험용", body: "시험용" }] });
  if (dup.status === 201) fx.dupId = (await db.query("select id from public.guides where slug = $1", [`e2e-w11c-${run}-dup`])).rows[0]?.id;

  const body = { op: "add", guide_id: fx.trustId, surface: "trust_type", target_key: "e2e-structure" };
  assert.equal((await placeApi(u.reporter, body)).status, 403);
  assert.equal((await placeApi(u.admin, body)).status, 201);
  assert.equal((await placeApi(u.admin, body)).status, 409);
  assert.equal((await placeApi(u.admin, { ...body, surface: "finance_tax_hub", target_key: "e2etopic" })).status, 201);
  assert.equal((await placeApi(u.admin, { ...body, surface: "dev_method" })).status, 422, "신탁 가이드는 개발방법 화면에 못 붙는다");
  if (fx.dupId) assert.equal((await placeApi(u.admin, { op: "add", guide_id: fx.dupId, surface: "finance_tax_hub", target_key: "trust" })).status, 422);
});

test("d) 서명 전 404 -> 서명만 해도 404 -> 공개 뒤 200 / 걸리는 절 미표시 / 배지·감수일 / TRU-02 = DF-08 같은 버전·해시", async () => {
  assert.equal((await get("/finance/tax-guide/e2etopic")).status, 404, "초안");
  assert.equal((await get("/finance/tax-guide")).status, 404, "초안 허브");
  const signed = await guidesApi(u.reviewer, { op: "sign", id: fx.trustVersion, sheet_ref: "시험용 감수 시트" });
  assert.equal(signed.status, 200, show(signed));
  assert.equal((await get("/finance/tax-guide/e2etopic")).status, 404, "서명만 된 상태");
  const published = await guidesApi(u.admin, { op: "publish", id: fx.trustVersion });
  assert.equal(published.status, 200, show(published));

  const page = await get("/finance/tax-guide/e2etopic");
  assert.equal(page.status, 200);
  assert.match(page.html, /시험용 본문 하나/);
  assert.ok(!page.html.includes("사업성"), "금지 낱말이 든 절은 그리지 않는다");
  assert.match(page.html, /시험용 근거 칩/);
  assert.match(page.html, /국세·지방세/);
  assert.match(page.html, /최종 감수일/);
  assert.match(page.html, /금액을 계산하지 않습니다/);
  assert.equal((await get("/finance/tax-guide")).status, 200);

  const dbRow = (await db.query("select version, body_sha256 from public.public_guides where slug = $1", [`e2e-w11c-${run}-trust`])).rows[0];
  assert.equal(attr(page.html, "data-guide-hash"), dbRow.body_sha256);
  assert.equal(attr(page.html, "data-guide-version"), String(dbRow.version));
  const rows = (await db.query("select surface, version, body_sha256 from public.public_guide_placements where slug = $1 order by surface", [`e2e-w11c-${run}-trust`])).rows;
  assert.deepEqual(rows.map((r) => r.surface), ["finance_tax_hub", "trust_type"]);
  assert.equal(rows[0].version, rows[1].version);
  assert.equal(rows[0].body_sha256, rows[1].body_sha256);

  await setFlags({ finance_tax_guide: false });
  await restart();
  assert.equal((await get("/finance/tax-guide/e2etopic")).status, 404, "허브 키를 끄면 다시 404");
  await setFlags({ finance_tax_guide: true });
  await restart();
});

async function judge(page, path, answer) {
  await page.goto(`${base}${path}`);
  const seen = [];
  page.on("request", (r) => seen.push({ url: r.url(), body: r.postData() ?? "" }));
  await page.click('[data-action="determine"]');
  const first = await page.locator('[data-part="determination-result"]').innerText();
  let second = null;
  if (answer) {
    await page.fill('[data-field="fact_a"]', answer);
    await page.click('[data-action="determine"]');
    second = await page.locator('[data-part="determination-result"]').innerText();
  }
  const stored = await page.evaluate(() => JSON.stringify([...Object.entries(localStorage), ...Object.entries(sessionStorage)]));
  return { first, second, seen, stored, url: page.url() };
}

test("e) 판정 - 서명 전 404, 서명 + 승인 뒤 열림, 모르겠어요 -> 결론 0, 답하면 결론·버전·고지, 두 화면 같은 결론, 입력 잔존 0", async () => {
  assert.equal((await get("/calc/trust-taxpayer")).status, 404, "판정표 없음");
  const body = {
    kind: "trust_taxpayer", version: TABLE_VERSION, label: "시험용 신탁 판정표",
    required: [{ id: "fact_a", label: "시험용 사실 A" }],
    rules: [{ id: "rule_one", when: { op: "eq", field: "fact_a", value: "yes" }, conclusion: "시험용 결론 갑", basis: "시험용 근거 조문" }],
    fallback: "시험용 해당 없음",
  };
  const ins = await db.query("insert into public.determination_tables (kind, version, body, source_ref, basis_note, created_by) values ('trust_taxpayer', $1, $2::jsonb, '시험용 출처', '시험용 근거', 'admin:e2e-setup') returning id", [TABLE_VERSION, JSON.stringify(body)]);
  const id = ins.rows[0].id;
  assert.equal((await get("/calc/trust-taxpayer")).status, 404, "초안 판정표");
  const sign = (await db.query("select public.sign_determination_table($1, $2, '시험용 감수 시트') r", [id, `user:${u.reviewer.id}`])).rows[0].r;
  assert.equal(sign.ok, true, JSON.stringify(sign));
  assert.equal((await get("/calc/trust-taxpayer")).status, 404, "서명만 된 판정표");
  const appr = (await db.query("select public.approve_determination_table($1, 'admin:e2e@example.test') r", [id])).rows[0].r;
  assert.equal(appr.ok, true, JSON.stringify(appr));

  await restart();
  assert.equal((await get("/calc/trust-taxpayer")).status, 200);
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    const a = await judge(page, "/calc/trust-taxpayer", "yes");
    assert.match(a.first, /요건 확인 필요/);
    assert.match(a.first, /시험용 사실 A/);
    assert.ok(!a.first.includes("시험용 결론 갑"), "모르겠어요 -> 결론 0");
    assert.match(a.second, /시험용 결론 갑/);
    assert.match(a.second, new RegExp(TABLE_VERSION.replace(".", "\\.")));
    assert.match(a.second, /판정은 참고용/);
    assert.ok(a.seen.every((r) => !r.url.includes("fact_a") && !r.url.includes("yes") && !r.body.includes("yes") && !r.body.includes("fact_a")), "답한 값이 요청에 실리지 않는다");
    assert.ok(!a.stored.includes("yes"), "브라우저 저장소에 답이 남지 않는다");
    assert.ok(!a.url.includes("yes"), "주소에 답이 남지 않는다");

    const other = await judge(await ctx.newPage(), "/calc/project-tax?type=trust_holding", "yes");
    assert.match(other.second, /시험용 결론 갑/);
    assert.match(other.second, new RegExp(TABLE_VERSION.replace(".", "\\.")));
    assert.equal((await get("/calc/redevelopment-right")).status, 404, "그 종류의 판정표가 없으면 404");
  } finally {
    await ctx.close();
  }
});

test("f) 화면 문구 - 열린 화면에 금지 사전 0", async () => {
  for (const p of ["/finance/tax-guide", "/finance/tax-guide/e2etopic", "/calc/trust-taxpayer", "/calc/project-tax"]) {
    const { status, html } = await get(p);
    assert.equal(status, 200, p);
    const text = html.replace(/<[^>]+>/g, " ");
    for (const w of FORBIDDEN) assert.ok(!text.includes(w), `${p}: ${w}`);
  }
});
