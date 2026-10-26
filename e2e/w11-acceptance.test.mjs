// W11-z 수용 E2E - 3단계 닫는 묶음 (docs/dev/3단계_설계.md §1 W11-z · PRD-03 9장 - 국세 금액 0, 4단계 독립, 민감 입력 잔존 0, 접근성 95, 화면 규칙 R1~R11, 기능 키)
// W11-a~g가 각자 자기 화면을 닫았다면 이 묶음은 단위를 가로질러 같은 규칙이 모든 새 화면에 같이 걸리는지 대표 화면으로 본다.
// standalone 빌드를 로컬 Supabase에 붙인다. 가이드·판정표·룰셋·쟁점 지도는 전부 시험용 가짜다 (룰셋은 저장소 초안 값을 시험 버전 번호로 넣은 것 - 실제 감수 서명이 아니다).
//  a) 기능 키 꺼짐(기본) - 3단계 새 화면 전부 404 (준비 중·진입 버튼 0), 양도 경로는 늘 404
//  b) 대표 화면 자료 준비 - 서명·승인·공개를 거쳐 새 화면을 연다 (세금 전 주기·주택 수·총비용·세금 가이드·신탁 판정·쟁점 지도·증여세 계산·기관 구독)
//  c) 국세 금액 - 증여세 계산 화면 말고는 상속세·증여세·양도세 금액 렌더 0, 증여세 화면에도 양도세 금액 0, 상속 화면은 게이트가 닫혀 404, 양도 경로는 모든 키가 켜져도 404
//  d) 4단계 독립 - [이 쟁점에 대해 묻기]·[이 단계에 대해 묻기] 렌더 0, 도우미 서버 소스에 igt-engine import 0
//  e) 민감 입력 - 주택 수·총비용·판정·증여세 계산 중 새 요청 0, 주소·저장소·쿠키·이벤트·서버 로그에 입력 0
//  f) 쟁점 지도 - SVG 상자·연결선 수 = 표 행 수
//  g) 접근성 95점 이상 · 화면 규칙 R1~R3 (대표 새 화면, 폭 360·1024)
//  h) 기능 키를 다시 끄면 새 화면이 다시 404, /calc 의 자체 증여 카드 0·외부 카드 복귀
// 만든 행은 끝나면 지우고 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0). 설정·행을 바꾼 뒤에는 서버를 다시 띄운다 (공개 데이터 캐시 30초).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { measurePage } from "./lib/screen-rules.mjs";
import { importSource } from "./lib/ts-source.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w11z-acceptance-e2e@example.test";
const SITE = "https://e2e-w11z.example.test";
const CRON = "e2e-w11z-cron";
const GUARD = "e2e-w11z-guard-secret";
const ROOT = path.resolve(import.meta.dirname, "..");
const root = new URL("../", import.meta.url);
const DRAFT = JSON.parse(fs.readFileSync(new URL("rules-igt/2026.07.json", root), "utf8"));
const IGT_VERSION = "2098.11";
const SOURCE = JSON.parse(fs.readFileSync(new URL("packages/igt-engine/SOURCE.json", root), "utf8"));
// 앱의 엔진 해시와 같은 방식 - SOURCE.json engineFiles 를 정렬해 다시 해시
const ENGINE_HASH = crypto.createHash("sha256").update(JSON.stringify(SOURCE.engineFiles.map((f) => [f.copy, f.copySha256]).sort((a, b) => (a[0] < b[0] ? -1 : 1)))).digest("hex");

const CALC_FLAGS = ["calc", "sm_calculator", "self_calculator", "calc_acquisition", "calc_holding"];
const NEW_FLAGS = [
  "tax_lifecycle", "house_count", "total_cost", "trust_tax_guide", "finance_tax_guide", "redevelopment_tax", "tax_determination", "issue_graph",
  "law_viewer", "case_db", "premium_reports", "institution_subscription", "institution_inquiry", "calc_igt_gift", "calc_igt_inheritance",
];
const POLICY = { max_holding_years: 7, max_rate_bp: 2000, max_extra_items: 2, compare_years: [3, 5] };
const CUTOFF = "2099-06-01";
const ACQ = { ownerType: "INDIVIDUAL", propertyKind: "LAND", price: 100000000 };
const HOLD = { ownerType: "INDIVIDUAL", propertyKind: "HOUSE", publishedPrices: [500000000] };

let sb, server, staff, db, base, browser, debugPort, run, since, engine, reviewerId;
const u = {};
const created = { rulesets: [], tables: [], laws: [], versions: [], articles: [], snapshots: [] };
let savedSettings = [];
const originalLinks = new Map();

async function api(method, p, user, body) {
  const headers = { origin: base };
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const admin = (p, user, body) => api("POST", `/api/admin${p}`, user, body);
const get = async (p) => {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: (await res.text()).replace(/<!-- -->/g, "") };
};
const plain = (html) => html.replace(/<(script|style)[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const count = (text, re) => (text.match(re) ?? []).length;
const cardsOf = (html) => [...html.matchAll(/data-link-card="([^"]+)"/g)].map((m) => m[1]);

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
/** 공개 데이터 캐시(30초)를 새로 시작하려고 서버를 다시 띄운다 - 새 배포와 같은 출발점 */
async function restart() {
  await server?.stop?.();
  await startAll();
}
async function setFlags(patch) {
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...patch })]);
}
async function setLink(key, patch) {
  if (!originalLinks.has(key)) originalLinks.set(key, (await db.query("select * from public.official_links where key = $1", [key])).rows[0]);
  const cols = Object.keys(patch);
  await db.query(`update public.official_links set ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} where key = $1`, [key, ...cols.map((c) => patch[c])]);
}

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    // 총비용 게이트용 룰셋·사례
    await db.query("delete from public.accuracy_run_results where case_id in (select id from public.accuracy_cases where case_key like 'e2e-w11z-%')");
    await db.query("delete from public.accuracy_run_results where run_id in (select id from public.accuracy_runs where triggered_by = 'e2e-w11z')");
    await db.query("delete from public.accuracy_runs where triggered_by = 'e2e-w11z' or ruleset_id = any($1::bigint[]) or run_at >= $2", [created.rulesets, since]);
    await db.query("delete from public.accuracy_cases where case_key like 'e2e-w11z-%'");
    await db.query("delete from public.rules_audit where target_id = any($1::bigint[]) and kind = 'ruleset'", [created.rulesets]);
    await db.query("delete from public.rulesets where id = any($1::bigint[])", [created.rulesets]);
    await db.query("delete from public.rules_audit where target_id = any($1::bigint[]) and kind = 'determination_table'", [created.tables]);
    await db.query("delete from public.determination_tables where id = any($1::bigint[])", [created.tables]);
    await db.query("delete from public.agent_runs where job = 'accuracy-run' and started_at >= $1", [since]);
    // 상속·증여 룰셋
    await db.query("delete from public.rules_audit where kind = 'igt_ruleset' and version = $1", [IGT_VERSION]);
    await db.query("delete from public.igt_rulesets where version = $1", [IGT_VERSION]);
    // 가이드
    const gv = (await db.query("select v.id from public.guide_versions v join public.guides g on g.id = v.guide_id where g.slug like 'e2e-w11z-%'")).rows.map((r) => r.id);
    await db.query("delete from public.guide_placements where guide_id in (select id from public.guides where slug like 'e2e-w11z-%')");
    if (gv.length) await db.query("delete from public.guides_audit where guide_version_id = any($1::bigint[])", [gv]);
    await db.query("delete from public.guide_versions where guide_id in (select id from public.guides where slug like 'e2e-w11z-%')");
    await db.query("delete from public.guides where slug like 'e2e-w11z-%'");
    // 쟁점 지도
    const g = (await db.query("select id from public.issue_graphs where slug like 'e2e-w11z-%'")).rows.map((r) => r.id);
    if (g.length) {
      await db.query("delete from public.issue_graph_signals where graph_id = any($1::bigint[])", [g]);
      await db.query("delete from public.issue_audit where subject = 'issue_graph' and target_id = any($1::bigint[])", [g]);
    }
    await db.query("delete from public.issue_graphs where slug like 'e2e-w11z-%'");
    await db.query("delete from public.law_articles where id = any($1::bigint[])", [created.articles]);
    await db.query("delete from public.law_versions where id = any($1::bigint[])", [created.versions]);
    await db.query("delete from public.laws where id = any($1::bigint[])", [created.laws]);
    await db.query("delete from public.raw_snapshots where id = any($1::bigint[])", [created.snapshots]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

before(async () => {
  engine = await importSource(new URL("packages/igt-engine/src/index.ts", root).href);
  sb = localSupabase();
  buildWeb();
  debugPort = await freePort();
  browser = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] });
  await startAll();
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  since = new Date().toISOString();
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  savedSettings = (await db.query("select key, value from public.settings where key in ('feature_flags', 'total_cost_policy', 'finance_tax_guide_review', 'institution_inquiry_policy')")).rows;
  u.admin = await staff.createUser({ label: "w11z-admin", email: ADMIN_EMAIL });
  u.reviewer = await staff.createUser({ label: "w11z-reviewer", roles: ["reviewer"], person: { name: "시험용 감수위원", roles: ["reviewer"] } });
  u.editor = await staff.createUser({ label: "w11z-editor", roles: ["editor"], person: { name: "시험용 편집자", roles: ["editor"] } });
  reviewerId = u.reviewer.id;
  await purge();
  assert.equal((await db.query("select 1 from public.igt_rulesets where status = 'active'")).rowCount, 0, "시험 전 활성 상속·증여 룰셋이 없어야 합니다");
  await db.query("update public.settings set value = '{}'::jsonb where key = 'total_cost_policy'");
  await db.query("update public.settings set value = '{}'::jsonb where key = 'finance_tax_guide_review'");
  await setFlags({ ...Object.fromEntries(CALC_FLAGS.map((f) => [f, true])), ...Object.fromEntries(NEW_FLAGS.map((f) => [f, false])) });
  for (const key of ["acquisition", "property_tax", "transfer", "inheritance_gift", "wetax", "nts"]) await setLink(key, { url: `https://${key.replace(/_/g, "-")}.example.test/start`, status: "ok", active: true });
  await restart();
});

after(async () => {
  try {
    await purge();
    for (const s of savedSettings) await db.query("update public.settings set value = $2::jsonb where key = $1", [s.key, JSON.stringify(s.value)]);
    for (const [key, row] of originalLinks) await db.query("update public.official_links set url = $2, status = $3, active = $4, checked_at = $5 where key = $1", [key, row.url, row.status, row.active, row.checked_at]);
  } finally {
    await browser?.close();
    await staff?.cleanup();
    await server?.stop?.();
  }
});

// 3단계에서 새로 생긴 공개 경로 (자료가 없거나 키가 꺼지면 404)
const SLUG = () => `e2e-w11z-${run}-map`;
const NEW_ROUTES = () => [
  "/realestate/tax", "/calc/house-count", "/calc/total-cost", "/calc/trust-taxpayer", "/calc/project-tax?type=trust_holding", "/calc/redevelopment-right",
  "/finance/tax-guide", "/finance/tax-guide/e2etopic", "/realestate/issues", `/realestate/issues/${SLUG()}`, "/realestate/issues/cases/trust",
  "/calc/gift-tax", "/calc/inheritance-tax", "/store/institution", "/finance/reports", "/finance/reports/e2e-nothing",
];
// 양도세 계산 경로는 이 사이트에 없다 (양도세는 SM 플랫폼으로 연결만)
const TRANSFER_ROUTES = ["/calc/transfer", "/calc/transfer-tax", "/calc/capital-gains", "/calc/capital-gains-tax", "/calc/cgt", "/calc/yangdo", "/calc/yangdo-tax", "/calc/sale", "/calc/transfer-income-tax"];

test("a) 기능 키 꺼짐(기본) - 3단계 새 화면 전부 404, 양도 경로도 404", async () => {
  for (const p of NEW_ROUTES()) assert.equal((await get(p)).status, 404, `${p} 키 꺼짐`);
  for (const p of TRANSFER_ROUTES) assert.equal((await get(p)).status, 404, `${p} 양도 경로`);
  const hub = await get("/calc");
  assert.equal(hub.status, 200);
  const cards = cardsOf(hub.html);
  assert.equal(cards.filter((c) => c.startsWith("self_gift") || c.startsWith("self_inheritance")).length, 0, "자체 상속·증여 카드 0");
  assert.equal(cards.filter((c) => c === "inheritance_gift").length, 1, "외부 상속·증여 카드 1장");
});

// ── 자료 준비 (서명 -> 승인 -> 공개) ────────────────────────────

const GUIDE = {
  op: "create", hub: "realestate_tax", topic: "tax_lifecycle", slug: "e2e-w11z-life", title: "시험용 세금 전 주기", tax_scope: "both", as_of: "2026-06-30",
  sections: [{ heading: "시험용 매매 해설", body: "시험용 매매 본문" }, { heading: "시험용 상속 해설", body: "시험용 상속 본문" }, { heading: "시험용 보유 해설", body: "시험용 보유 본문" }, { heading: "시험용 양도 해설", body: "시험용 양도 본문" }],
  facts: {
    section_map: [{ index: 0, tab: "acquire", cause: "PAID", tax_kind: "local" }, { index: 1, tab: "acquire", cause: "INHERITANCE", tax_kind: "national" }, { index: 2, tab: "hold", tax_kind: "local" }, { index: 3, tab: "transfer", tax_kind: "national" }],
    transfer_checklist: [{ id: "a", label: "시험용 확인 항목" }],
  },
  sources: [],
};
const TRUST_GUIDE = {
  op: "create", hub: "trust", topic: `t_${"x"}`, slug: "e2e-w11z-trust", title: "시험용 신탁 세금 가이드", tax_scope: "both", as_of: "2099-01-01",
  sections: [{ heading: "시험용 절 하나", body: "시험용 본문 하나" }], sources: [{ label: "시험용 근거 칩" }],
};
const tables = {
  inherit: { kind: "house_count_inheritance", version: "2099.11", label: "시험용 상속 후 주택 수", required: [{ id: "cause_date", label: "시험용 취득일" }], rules: [{ id: "r1", when: { op: "lt", field: "cause_date", value: CUTOFF }, conclusion: "시험용 상속-이전" }, { id: "r2", when: { op: "gte", field: "cause_date", value: CUTOFF }, conclusion: "시험용 상속-이후" }] },
  gift: { kind: "house_count_gift", version: "2099.12", label: "시험용 증여 후 주택 수", required: [{ id: "cause_date", label: "시험용 취득일" }], rules: [{ id: "g1", when: { op: "lt", field: "cause_date", value: CUTOFF }, conclusion: "시험용 증여-이전" }, { id: "g2", when: { op: "gte", field: "cause_date", value: CUTOFF }, conclusion: "시험용 증여-이후" }] },
  houses: { kind: "house_count", version: "2099.11", label: "시험용 주택 수", entry_required: [{ id: "item_kind", label: "시험용 종류" }, { id: "acquired_on", label: "시험용 보유 취득일" }], count_when: { op: "all", conds: [{ op: "in", field: "item_kind", values: ["house", "right"] }, { op: "lte", field: "acquired_on", value: CUTOFF }] }, result_rules: [{ id: "none", op: "eq", value: 0, conclusion: "시험용 무주택" }, { id: "one", op: "eq", value: 1, conclusion: "시험용 1주택" }, { id: "many", op: "gte", value: 2, conclusion: "시험용 다주택" }] },
  trust: { kind: "trust_taxpayer", version: "2099.11", label: "시험용 신탁 판정표", required: [{ id: "fact_a", label: "시험용 사실 A" }], rules: [{ id: "rule_one", when: { op: "eq", field: "fact_a", value: "yes" }, conclusion: "시험용 결론 갑", basis: "시험용 근거 조문" }], fallback: "시험용 해당 없음" },
};

async function seedCases(taxKind, cause, sampleKind, total, from, to) {
  await db.query(
    `insert into public.accuracy_cases (case_key, tax_kind, cause, sample_kind, case_input, official_total, official_basis, entered_by)
     select 'e2e-w11z-' || $1 || '-' || $2 || '-' || coalesce($4::text, 'all') || '-' || $3 || '-' || g, $2, $4::text, $3, $5::jsonb, $6, $7, 'e2e:w11z' from generate_series($8::int, $9::int) g`,
    [run, taxKind, sampleKind, cause, JSON.stringify(taxKind === "acquisition" ? ACQ : HOLD), total, sampleKind === "official" ? "tax_notice" : "reviewer_calc", from, to],
  );
}
const giftInput = (i) => ({ gift_date: "2026-08-10", donor_relationship: i % 2 ? "lineal_ascendant" : "spouse", recipient_is_resident: true, gift_value: 100_000_000 + i * 37_000_000 });
async function seedGift() {
  const rs = { ...DRAFT, version: IGT_VERSION };
  const rid = (await db.query("insert into public.igt_rulesets (version, body, body_sha256, source_ref, basis_note, created_by) values ($1, $2, 'x', 'e2e 시험용', 'e2e 시험 반입', 'e2e') returning id", [IGT_VERSION, JSON.stringify(rs)])).rows[0].id;
  assert.equal((await db.query("select public.sign_igt_ruleset($1, $2, 'e2e 시험 시트') r", [rid, `user:${reviewerId}`])).rows[0].r.ok, true);
  assert.equal((await db.query("select public.approve_igt_ruleset($1, 'admin:e2e@example.test') r", [rid])).rows[0].r.ok, true);
  for (let i = 0; i < 80; i++) {
    const input = giftInput(i);
    const calc = engine.calcGift(input, rs);
    const c = (await db.query(
      "insert into public.accuracy_cases (case_key, tax_kind, sample_kind, case_input, official_total, official_basis, entered_by) values ($1, 'gift', $2, $3, $4, $5, 'e2e') returning id",
      [`e2e-w11z-${run}-gift-${i}`, i < 30 ? "official" : "review_sample", JSON.stringify(input), calc.final_tax, i < 30 ? "tax_notice" : "reviewer_calc"],
    )).rows[0];
    await db.query("select public.confirm_accuracy_case($1, $2)", [c.id, `user:${reviewerId}`]);
  }
  const rows = (await db.query("select id, official_total from public.accuracy_cases where case_key like $1 and tax_kind = 'gift' and retired_at is null and confirmed_at is not null order by id", [`e2e-w11z-${run}-gift-%`])).rows;
  return { rid, rows };
}

test("b) 자료 준비 - 서명·승인·공개를 거쳐 대표 새 화면이 열린다", async () => {
  // 가이드 (세금 전 주기 + 신탁 세금 가이드) - 관리자 서명 403, 감수위원 서명 -> 공개
  for (const g of [GUIDE, { ...TRUST_GUIDE, topic: `t_${run}`.slice(0, 40) }]) {
    const made = await admin("/guides", u.admin, g);
    assert.ok(made.status === 201 || made.status === 200, JSON.stringify(made.body));
    const id = Number(made.body.created?.id ?? made.body.created?.version_id);
    assert.equal((await admin("/guides", u.admin, { op: "sign", id, sheet_ref: "시험용 시트" })).status, 403, "관리자 서명 시도는 403");
    assert.equal((await admin("/guides", u.reviewer, { op: "sign", id, sheet_ref: "시험용 시트" })).status, 200);
    assert.equal((await admin("/guides", u.admin, { op: "publish", id })).status, 200);
    if (g.hub === "trust") {
      const gid = (await db.query("select id from public.guides where slug = 'e2e-w11z-trust'")).rows[0].id;
      assert.equal((await admin("/guides/placements", u.admin, { op: "add", guide_id: gid, surface: "finance_tax_hub", target_key: "e2etopic" })).status, 201);
    }
  }
  const rec = { reviewer: "시험 검토자", reviewed_on: "2099-01-01", conclusion: "approved", ref: `시험용 기록 ${run}` };
  await db.query("update public.settings set value = $1::jsonb where key = 'finance_tax_guide_review'", [JSON.stringify(rec)]);

  // 판정표 4종
  for (const body of Object.values(tables)) {
    const draft = await admin("/rules", u.admin, { op: "create", kind: "determination_table", version: body.version, source_ref: "시험용", basis_note: "시험용 반입", body: JSON.stringify(body) });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    const id = Number(draft.body.created.id);
    created.tables.push(id);
    assert.equal((await admin("/rules", u.reviewer, { op: "sign", kind: "determination_table", id, sheet_ref: "시험용 시트" })).status, 200);
    assert.equal((await admin("/rules", u.admin, { op: "approve", kind: "determination_table", id })).status, 200);
  }

  // 총비용 화면용 활성 룰셋 + 취득(매매)·재산세 게이트
  const draft = await admin("/rules", u.admin, { op: "create", kind: "ruleset", version: "2026.01", source_ref: "시험용 - rules 폴더 초안", basis_note: "시험용 초기 반입", body: fs.readFileSync(new URL("rules/2026.01.json", root), "utf8") });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const rid = Number(draft.body.created.id);
  created.rulesets.push(rid);
  assert.equal((await admin("/rules", u.reviewer, { op: "sign", kind: "ruleset", id: rid, sheet_ref: "시험용 시트" })).status, 200);
  assert.equal((await admin("/rules", u.admin, { op: "approve", kind: "ruleset", id: rid })).status, 200);
  const probes = [["acquisition", "PAID"], ["property", null]];
  for (const [tax, cause] of probes) await seedCases(tax, cause, "official", 1, 0, 0);
  const confirmAll = () => db.query("select public.confirm_accuracy_case(id, $1) from public.accuracy_cases where case_key like $2 and tax_kind in ('acquisition', 'property') and confirmed_at is null and retired_at is null", [`user:${u.reviewer.id}`, `e2e-w11z-${run}-%`]);
  await confirmAll();
  assert.equal((await fetch(`${base}/api/jobs/accuracy-run`, { headers: { authorization: `Bearer ${CRON}` } })).status, 200);
  const totals = {};
  for (const [tax, cause] of probes) {
    const r = await db.query("select r.engine_total from public.accuracy_run_results r join public.accuracy_cases c on c.id = r.case_id where c.case_key = $1 order by r.run_id desc limit 1", [`e2e-w11z-${run}-${tax}-${cause ?? "all"}-official-0`]);
    totals[`${tax}:${cause}`] = Number(r.rows[0]?.engine_total);
  }
  await db.query("update public.accuracy_cases set retired_at = now() where case_key like $1", [`e2e-w11z-${run}-%-official-0`]);
  assert.ok(Object.values(totals).every((n) => Number.isFinite(n)), JSON.stringify(totals));
  await seedCases("acquisition", "PAID", "official", totals["acquisition:PAID"], 1, 30);
  await seedCases("acquisition", "PAID", "review_sample", totals["acquisition:PAID"], 1, 50);
  await seedCases("property", null, "official", totals["property:null"], 1, 30);
  await seedCases("property", null, "review_sample", totals["property:null"], 1, 50);
  await confirmAll();
  assert.equal((await admin("/accuracy", u.admin, { op: "run" })).status, 200);
  await db.query("update public.settings set value = $1::jsonb where key = 'total_cost_policy'", [JSON.stringify(POLICY)]);

  // 쟁점 지도 (법령 2조문, 연결 1개)
  const snap = (await db.query("insert into public.raw_snapshots (source, url, content_hash, payload) values ('w11z-e2e', $1, $2, '시험용 원문') returning id", [`https://example.test/w11z/${run}`, `h-${run}`])).rows[0].id;
  created.snapshots.push(snap);
  const law = (await db.query("insert into public.laws (name, tier, scope) values ($1, 'statute', 'related') returning id", [`시험용 쟁점법 ${run}`])).rows[0].id;
  created.laws.push(law);
  const ver = (await db.query("insert into public.law_versions (law_id, promulgation_no, promulgated_on, effective_on, body_hash, snapshot_id) values ($1, $2, '2026-01-01', '2026-01-01', $3, $4) returning id", [law, `시험용-${run}`, `bh-${run}`, snap])).rows[0].id;
  created.versions.push(ver);
  const a1 = (await db.query("insert into public.law_articles (version_id, article_no, branch_no, body) values ($1, 1, 0, '① 시험용 조문 글 하나') returning id", [ver])).rows[0].id;
  const a2 = (await db.query("insert into public.law_articles (version_id, article_no, branch_no, body) values ($1, 2, 0, '① 시험용 조문 글 둘') returning id", [ver])).rows[0].id;
  created.articles.push(a1, a2);
  const made = await admin("/issues", u.editor, {
    op: "create", slug: SLUG(), hub: "trust", title: "시험용 쟁점", summary: "시험용 요약", as_of: "2026-06-30",
    nodes: [{ node_id: "n1", kind: "law_article", ref_id: Number(a1) }, { node_id: "n2", kind: "law_article", ref_id: Number(a2) }],
    edges: [{ from: "n1", to: "n2", relation: "delegation", note: "시험용 관계" }],
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const gid = made.body.created.id;
  assert.equal((await admin("/issues", u.editor, { op: "submit", id: gid })).status, 200);
  assert.equal((await admin("/issues", u.admin, { op: "sign", id: gid, sheet_ref: "시험용 감수 시트" })).status, 403, "관리자도 서명 못 한다");
  assert.equal((await admin("/issues", u.reviewer, { op: "sign", id: gid, sheet_ref: "시험용 감수 시트" })).status, 200);
  assert.equal((await admin("/issues", u.editor, { op: "publish", id: gid })).status, 200);

  // 증여세 자체 계산 - 룰셋 서명·승인 + 공식 30 + 표본 50 + 대조 실행
  const { rid: igtId, rows } = await seedGift();
  const results = rows.map((r) => ({ case_id: r.id, engine_total: Number(r.official_total) }));
  await db.query("select public.record_accuracy_run_igt($1, $2, 'e2e-w11z', $3::jsonb)", [igtId, ENGINE_HASH, JSON.stringify(results)]);

  await setFlags({ ...Object.fromEntries(NEW_FLAGS.map((f) => [f, true])), calc_igt_inheritance: false });
  await restart();

  const open = ["/realestate/tax", "/calc/house-count", "/calc/total-cost", "/calc/trust-taxpayer", "/calc/project-tax?type=trust_holding", "/finance/tax-guide", "/finance/tax-guide/e2etopic", "/realestate/issues", `/realestate/issues/${SLUG()}`, "/calc/gift-tax", "/store/institution"];
  for (const p of open) assert.equal((await get(p)).status, 200, p);
  assert.equal((await get("/calc/inheritance-tax")).status, 404, "상속 키가 꺼져 있고 게이트가 닫혀 있으면 404");
});

const OPEN = () => ["/realestate/tax", "/calc/house-count", "/calc/total-cost", "/calc/trust-taxpayer", "/calc/project-tax?type=trust_holding", "/finance/tax-guide", "/finance/tax-guide/e2etopic", "/realestate/issues", `/realestate/issues/${SLUG()}`, "/calc/gift-tax", "/store/institution"];

test("c) 국세 금액 - 증여세 계산 화면 말고는 렌더 0, 증여세 화면에도 양도세 금액 0, 양도 경로는 키를 다 켜도 404", async () => {
  const NATIONAL = /(양도소득세|양도세|상속세|증여세|지방소득세)[^0-9.。]{0,14}\d[\d,]{2,}\s*원/;
  const TRANSFER = /(양도소득세|양도세|지방소득세)[^0-9.。]{0,14}\d[\d,]{2,}\s*원/;
  for (const p of OPEN()) {
    const { html } = await get(p);
    const text = plain(html);
    if (p === "/calc/gift-tax") assert.doesNotMatch(text, TRANSFER, `${p}: 양도세 금액`);
    else assert.doesNotMatch(text, NATIONAL, `${p}: 국세 금액`);
  }
  for (const p of TRANSFER_ROUTES) assert.equal((await get(p)).status, 404, `${p} 키가 모두 켜져도 양도 경로`);
  // 총비용 결과: 양도 줄·상속세·증여세 줄 0 (양도세 미포함 안내·SM 카드의 고정 문구는 뺀다)
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/calc/total-cost`);
    await page.fill("input[name=price]", "500000000");
    await page.fill("input[name=years]", "3");
    await page.fill("input[name=published]", "300000000");
    await page.waitForSelector('[data-part="result"]');
    const body = await page.locator('[data-part="result"]').evaluate((el) => {
      const c = el.cloneNode(true);
      c.querySelectorAll('[data-part="transfer-notice"], [data-ui="sm-calculator-card"]').forEach((n) => n.remove());
      return c.innerText ?? c.textContent;
    });
    assert.doesNotMatch(body, /양도소득세|지방소득세|상속세|증여세/, "총비용 결과에 국세 줄 0");
  } finally {
    await page.close();
  }
  // 증여세 자체 계산 화면: 국세 배지 · 지방세와 한 줄 합계 0
  const ctx = await browser.newContext();
  try {
    const gp = await ctx.newPage();
    await gp.goto(`${base}/calc/gift-tax`);
    await gp.fill('input[type="date"]', "2026-08-10");
    await gp.getByLabel("증여재산가액(원)").fill("500,000,000");
    await gp.getByRole("button", { name: "계산하기" }).click();
    await gp.waitForSelector('[data-part="igt-result"]');
    assert.equal(await gp.locator('[data-part="national-badge"]').count(), 1);
    assert.doesNotMatch((await gp.content()).replace(/이 금액은 지방세 금액과 합산하지 않습니다/g, ""), /지방세 금액|합계 세액|양도소득세/);
  } finally {
    await ctx.close();
  }
});

const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", "dist"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js|json)$/.test(e.name)) out.push(p);
  }
  return out;
};

test("d) 4단계 독립 - [이 쟁점·단계에 대해 묻기] 렌더 0, 도우미 서버 소스에 igt-engine import 0", async () => {
  for (const p of OPEN()) {
    const { html } = await get(p);
    assert.doesNotMatch(plain(html), /이 (쟁점|단계)에 대해 묻기/, `${p}: 4단계 진입 버튼`);
    assert.doesNotMatch(html, /data-ask-scope|data-action="ask-issue"|data-action="ask-stage"/, `${p}: 4단계 진입 표식`);
  }
  const dirs = [
    "packages/assistant", "packages/agent", "workflows/src", "apps/web/lib/assistant", "apps/web/app/api/assistant", "apps/web/app/api/admin/assistant",
  ].map((d) => path.join(ROOT, d));
  const files = [...dirs.flatMap((d) => walk(d)), ...["AssistantChat", "AssistantMount", "AssistantWidget"].map((n) => path.join(ROOT, `apps/web/components/site/${n}.tsx`))].filter((f) => fs.existsSync(f));
  assert.ok(files.length >= 3, "도우미 소스를 찾지 못했습니다");
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /igt-engine|lib\/igt\b/, `${path.relative(ROOT, f)}에 상속·증여세 엔진 import`);
  for (const pkg of ["packages/assistant/package.json", "packages/agent/package.json", "workflows/package.json"]) {
    const f = path.join(ROOT, pkg);
    if (fs.existsSync(f)) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /igt-engine/, pkg);
  }
});

/** 입력하는 동안 새 요청 0 · 주소·저장소·쿠키 변화 0, 그리고 마지막에 입력값이 이벤트·서버 로그에 없는지 본다 */
async function sensitive(p, steps, sentinels) {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(`${base}${p}`);
    await page.waitForLoadState("networkidle");
    const seen = [];
    const beacons = [];
    // 판정·계산 완료 측정 이벤트(입력값 없는 이름·종류만)는 허용 - 그 밖의 요청은 0
    page.on("request", (r) => (new URL(r.url()).pathname === "/api/events" ? beacons : seen).push(`${r.method()} ${r.url()} ${r.postData() ?? ""}`));
    await steps(page);
    await page.waitForTimeout(600);
    assert.deepEqual(seen, [], `${p}: 입력·계산 중 새 요청 0`);
    for (const b of beacons) for (const s of sentinels) assert.ok(!b.includes(s), `${p}: 측정 이벤트에 입력값 ${s}`);
    assert.equal(page.url(), `${base}${p}`, `${p}: 주소에 입력 0`);
    const store = await page.evaluate(() => JSON.stringify([...Object.entries(localStorage), ...Object.entries(sessionStorage)]));
    assert.equal(store, "[]", `${p}: 브라우저 저장소 0`);
    // 측정 이벤트가 익명 방문자 쿠키를 새로 줄 수 있다 - 쿠키 값에 입력값이 없는지를 본다
    const cookies = JSON.stringify(await ctx.cookies());
    for (const s of sentinels) assert.ok(!cookies.includes(s), `${p}: 쿠키에 입력값 ${s}`);
    const log = server.log();
    const events = JSON.stringify((await db.query("select * from public.analytics_events where occurred_at >= $1", [since])).rows);
    for (const s of sentinels) {
      assert.ok(!events.includes(s), `${p}: 이벤트에 입력값 ${s}`);
      assert.ok(!log.includes(s), `${p}: 서버 로그에 입력값 ${s}`);
    }
  } finally {
    await ctx.close();
  }
}

test("e) 민감 입력 - 주택 수·총비용·판정·증여세 계산 모두 요청·주소·저장소·쿠키·이벤트·서버 로그에 입력 0", async () => {
  await sensitive("/calc/house-count", async (page) => {
    await page.click('[data-cause="INHERITANCE"]');
    await page.getByLabel("시험용 취득일").fill("2099-05-31");
    assert.match(await page.locator('[data-ui="determination-result"]').innerText(), /시험용 상속-이전/);
  }, ["2099-05-31"]);
  await sensitive("/calc/total-cost", async (page) => {
    await page.fill("input[name=price]", "987654321");
    await page.fill("input[name=years]", "3");
    await page.fill("input[name=published]", "312345678");
    await page.fill("input[name=extra1]", "7654321");
    await page.fill("input[name=loan]", "223456789");
    await page.fill("input[name=rate]", "3.5");
    await page.waitForSelector('[data-part="result"]');
  }, ["987654321", "312345678", "7654321", "223456789"]);
  await sensitive("/calc/trust-taxpayer", async (page) => {
    await page.fill('[data-field="fact_a"]', "zzsentinelzz");
    await page.click('[data-action="determine"]');
    await page.waitForSelector('[data-part="determination-result"]');
  }, ["zzsentinelzz"]);
  await sensitive("/calc/gift-tax", async (page) => {
    await page.fill('input[type="date"]', "2026-08-10");
    await page.getByLabel("증여재산가액(원)").fill("345,678,901");
    await page.getByRole("button", { name: "계산하기" }).click();
    await page.waitForSelector('[data-part="igt-result"]');
  }, ["345678901", "345,678,901"]);
});

test("f) 쟁점 지도 - SVG 상자·연결선 수 = 표 행 수, 고정 문구", async () => {
  const { status, html } = await get(`/realestate/issues/${SLUG()}`);
  assert.equal(status, 200);
  const boxes = count(html, /data-node="n\d+"/g);
  const edges = count(html, /data-edge="n\d+(?:>|&gt;)n\d+"/g);
  assert.equal(boxes, 2);
  assert.equal(edges, 1);
  assert.equal(count(html, /data-node-row="n\d+"/g), boxes, "노드 표 행 수");
  assert.equal(count(html, /data-edge-row="\d+"/g), edges, "연결선 표 행 수");
  assert.ok(html.includes("이 지도는 조문 사이의 관계를 보여 주는 참고 자료입니다. 개별 사안은 원문과 전문가 확인이 필요합니다."), "고정 문구");
});

const SCREENS = () => [
  ["세금 전 주기", "/realestate/tax"], ["주택 수 판정", "/calc/house-count"], ["총비용", "/calc/total-cost"], ["세금 가이드", "/finance/tax-guide/e2etopic"],
  ["신탁 판정", "/calc/trust-taxpayer"], ["쟁점 지도", `/realestate/issues/${SLUG()}`], ["증여세 계산", "/calc/gift-tax"], ["기관 구독", "/store/institution"],
];

test("g) 접근성 95점 이상 - 대표 새 화면", async () => {
  for (const [name, p] of SCREENS()) {
    const r = await accessibility(`${base}${p}`, debugPort);
    assert.ok(r.score >= A11Y_MIN, `${name} ${p}: ${r.score} - 실패 항목 ${r.failing.join(", ")}`);
  }
});

test("g2) 화면 규칙 R1~R3 - 대표 새 화면, 폭 360(R1 포함)·1024", async () => {
  for (const [name, p] of SCREENS()) {
    for (const width of [360, 1024]) {
      const r = await measurePage(browser, `${base}${p}`, { width, height: 740 });
      if (width !== 360) r.r1 = { ...r.r1, pass: true }; // R1은 360x740 첫 화면 규칙
      assert.ok(r.r1.pass, `${name} ${width}px R1 ${r.r1.chars}자 > 150`);
      assert.ok(r.r2.pass, `${name} ${width}px R2 주 버튼 ${r.r2.maxPerViewport}개`);
      assert.ok(r.r3.pass, `${name} ${width}px R3 오렌지 ${r.r3.ratio}`);
    }
  }
});

test("h) 기능 키를 다시 끄면 새 화면이 404, 자체 증여 카드 0·외부 카드 복귀", async () => {
  await setFlags(Object.fromEntries(NEW_FLAGS.map((f) => [f, false])));
  await restart();
  for (const p of NEW_ROUTES()) assert.equal((await get(p)).status, 404, `${p} 키를 다시 끔`);
  const cards = cardsOf((await get("/calc")).html);
  assert.equal(cards.filter((c) => c.startsWith("self_gift") || c.startsWith("self_inheritance")).length, 0);
  assert.equal(cards.filter((c) => c === "inheritance_gift").length, 1);
});

test("시험 동안 예상 못 한 서버 오류가 없었다", () => {
  assert.doesNotMatch(server.log(), /\[api\] 처리 중 오류|\[public\]|⨯/);
});
