#!/usr/bin/env node
// 계산기 시연판 띄우기 (개발용, 이 PC의 시험용 DB 전용)
//   pnpm dev:calc-demo            시연 자료를 만들고 기능 키를 켭니다 (먼저 pnpm dev:local로 사이트를 띄워 두세요)
//   pnpm dev:calc-demo -- --off   기능 키만 다시 끕니다 (자료는 남김)
//   pnpm dev:calc-demo -- --purge 기능 키를 끄고 시연 자료·시험용 감수위원 계정까지 지웁니다 (DB 시험·E2E 돌리기 전에 권장)
//   옵션: --base <주소>  (기본 http://localhost:3001)   --replace-active  (이미 활성인 다른 룰셋을 내려도 좋다고 허락)
// 만드는 것 (모두 '시험용', 값은 실제 세금과 다릅니다):
//  - 시험용 감수위원 계정 1개 (staff_roles reviewer) - 비밀번호는 매번 새로 만들고 어디에도 적지 않습니다
//  - 시험용 룰셋 2090.01 (rules/2026.01.json의 미감수 초안 값) - 기존 W10-a RPC(sign_ruleset -> approve_ruleset)로 서명·승인
//  - 시험용 환급 판정표 2090.01 (지어낸 문진표) - sign_determination_table -> approve_determination_table
//  - 시험용 대조 사례(키 demo-calc-*) 취득세 유상·상속 공식 30건씩 + 표본 50건, 재산세 공식 30건 + 표본 50건 -> 대조 실행 -> 게이트 열림
//  - 홈 바로가기 3개 더: 시험용 기사 3건(부동산재테크) + 이번 주 재테크 포인트 1호 발행 / 시험용 브리핑 1호 승인·발행 / 시험용 전문가 1명 + 고지문·연락 요청 정책(시험용 승인값)
//  - 기능 키 켜기 (settings.feature_flags 일부 키만 건드림)
// 운영 DB에는 닿지 않습니다: 로컬(127.0.0.1/localhost) 주소가 아니면 바로 멈춥니다. .env 파일은 읽지 않습니다.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { publishPolicies } from "../e2e/lib/policy-fixture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_DIR = path.join(ROOT, "packages", "db");
const shell = process.platform === "win32";
const VERSION = "2090.01";
const KEY_PREFIX = "demo-calc-";
const REVIEWER_EMAIL = "calc-demo-reviewer@local.test";
const ENTERED_BY = "시험용:dev-calc-demo";
const FLAGS = ["calc", "sm_calculator", "self_calculator", "calc_acquisition", "calc_holding", "calc_refund", "calc_compare", "calc_accuracy", "wetax_links", "shortcuts", "realestate_weekly", "brief", "brief_regular", "experts", "expert_requests"];
const ACTOR = "demo:dev-calc-demo";
const DEMO_SLUG = "demo-calc-";
const DEMO_BRIEF_NO = 9090;
const DEMO_MARK = "demo-dev-calc-demo";
// 전문가 고지문·연락 요청 정책의 시험용 승인값 (실제 문구 아님) - 이미 승인된 값이 있으면 건드리지 않는다
const NOTICE_DEMO = { version: DEMO_MARK, text: "시험용 고지문입니다. 실제 문구가 아닙니다.", approved: true, reviewed_by: "시험용 검토자", reviewed_on: "2026-10-25" };
const NOTICE_SEED = { version: "", text: "", approved: false, reviewed_by: null, reviewed_on: null };
const POLICY_DEMO = { retention_days: 365, target_business_days: 1, summary_max_chars: 1000, consent_version: DEMO_MARK, intro: ["시험용 안내 문단입니다."], consent_items: ["시험용 동의 항목입니다."], approved: true, reviewed_by: "시험용 검토자", reviewed_on: "2026-10-25", due_diligence_ref: "시험용", legal_review_ref: "시험용" };
const POLICY_SEED = { retention_days: 365, target_business_days: 1, summary_max_chars: 1000, consent_version: "", intro: [], consent_items: [], approved: false, reviewed_by: null, reviewed_on: null, due_diligence_ref: "", legal_review_ref: "" };
const DEMO_BRIEF_CORNERS = [{ key: "demo", title: "시험용 코너", items: [{ id: "demo-1", text: "시험용 항목입니다. 실제 법령·해석이 아닙니다.", origin: "human", reviewed: true }], emptyNote: "" }];
const CLEAN_REPORT = { blocking: 0, warnings: 0, findings: [] };
const ACQ = { ownerType: "INDIVIDUAL", propertyKind: "LAND", price: 100000000 };
const HOLD = { ownerType: "INDIVIDUAL", propertyKind: "HOUSE", publishedPrices: [500000000] };
// [묶음 이름, 세목, 원인, 종류, 개수, 입력]
const GROUPS = [
  ["acq-paid-official", "acquisition", "PAID", "official", 30, ACQ],
  ["acq-inh-official", "acquisition", "INHERITANCE", "official", 30, ACQ],
  ["acq-paid-sample", "acquisition", "PAID", "review_sample", 50, ACQ],
  ["prop-official", "property", null, "official", 30, HOLD],
  ["prop-sample", "property", null, "review_sample", 50, HOLD],
];
// 시험용 환급 판정표 - 지어낸 값 (실제 환급 요건 아님)
const REFUND_TABLE = {
  kind: "refund",
  version: VERSION,
  label: "시험용 환급 판정표 (실제 요건 아님)",
  questions: [
    { field: "paid_twice", text: "시험용: 같은 건을 두 번 냈나요?", kind: "yesno" },
    { field: "wait_days", text: "시험용: 며칠이 지났나요?", kind: "count" },
  ],
  items: [
    { id: "double_pay", label: "시험용 이중 납부", rules: [{ id: "r1", when: { op: "eq", field: "paid_twice", value: true }, likelihood: "높음" }], default: "낮음" },
    { id: "late", label: "시험용 기간", rules: [{ id: "r2", when: { op: "lte", field: "wait_days", value: 10 }, likelihood: "확인 필요" }], default: "낮음" },
  ],
};

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const base = (args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://localhost:3001").replace(/\/$/, "");
const MODE = has("--purge") ? "purge" : has("--off") ? "off" : "on";

const isLocal = (url) => ["127.0.0.1", "localhost", "::1"].includes(new URL(url).hostname);
function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function localSupabase() {
  try {
    const out = execFileSync("supabase", ["status", "-o", "json"], { cwd: DB_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell });
    const j = JSON.parse(out.slice(out.indexOf("{")));
    return { url: j.API_URL, anonKey: j.ANON_KEY, serviceRoleKey: j.SERVICE_ROLE_KEY, dbUrl: j.DB_URL };
  } catch {
    return null;
  }
}

const sb = localSupabase();
if (!sb) fail("시험용 DB(로컬 Supabase)에 연결하지 못했습니다. Docker Desktop을 켜고 pnpm dev:local을 먼저 실행해 주세요.");
if (!isLocal(sb.url) || !isLocal(sb.dbUrl) || !isLocal(base)) fail("이 PC의 시험용 DB와 로컬 사이트(127.0.0.1/localhost)에서만 쓸 수 있습니다. 멈춥니다.");

const db = new pg.Client({ connectionString: sb.dbUrl });
await db.connect();
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

async function auth(pathname, { method = "POST", body, service = false } = {}) {
  const key = service ? sb.serviceRoleKey : sb.anonKey;
  const headers = { apikey: key, "content-type": "application/json", ...(service ? { authorization: `Bearer ${key}` } : {}) };
  const res = await fetch(`${sb.url}/auth/v1${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

async function setFlags(on) {
  // 브리핑 화면은 개인정보처리방침 게시본이 있어야 열린다 — 없으면 시험용 가짜 게시본 (E2E와 같은 도구)
  if (on) await publishPolicies(db, "demo-calc", ["privacy"]);
  const patch = Object.fromEntries(FLAGS.map((f) => [f, on]));
  const r = await db.query("update public.settings set value = value || $1::jsonb, updated_by = $2 where key = 'feature_flags'", [JSON.stringify(patch), "demo:dev-calc-demo"]);
  if (r.rowCount !== 1) fail("settings.feature_flags 행을 찾지 못했습니다. 마이그레이션이 모두 적용됐는지 확인해 주세요.");
  console.log(`기능 키 ${on ? "켬" : "끔"}: ${FLAGS.join(", ")}`);
}

async function reviewerId() {
  return (await one("select id from auth.users where lower(email) = lower($1)", [REVIEWER_EMAIL]))?.id ?? null;
}

async function purge() {
  const rs = (await db.query("select id from public.rulesets where version = $1", [VERSION])).rows.map((r) => Number(r.id));
  const dt = (await db.query("select id from public.determination_tables where version = $1 and kind = 'refund'", [VERSION])).rows.map((r) => Number(r.id));
  const uid = await reviewerId();
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.accuracy_run_results where case_id in (select id from public.accuracy_cases where case_key like $1) or run_id in (select id from public.accuracy_runs where ruleset_id = any($2::bigint[]))", [`${KEY_PREFIX}%`, rs]);
    await db.query("delete from public.accuracy_runs where ruleset_id = any($1::bigint[])", [rs]);
    await db.query("delete from public.accuracy_cases where case_key like $1", [`${KEY_PREFIX}%`]);
    const arts = (await db.query("select id from public.articles where slug like $1", [`${DEMO_SLUG}%`])).rows.map((r) => Number(r.id));
    const issues = (await db.query("select distinct issue_id from public.realestate_weekly_items where article_id = any($1::bigint[])", [arts])).rows.map((r) => Number(r.issue_id));
    await db.query("delete from public.realestate_weekly_audit where issue_id = any($1::bigint[])", [issues]);
    await db.query("delete from public.realestate_weekly_items where issue_id = any($1::bigint[])", [issues]);
    await db.query("delete from public.realestate_weekly_issues where id = any($1::bigint[])", [issues]);
    await db.query("delete from public.articles where id = any($1::bigint[])", [arts]);
    await db.query("delete from public.brief_issues where created_by = $1", [ACTOR]);
    await db.query("delete from public.expert_profiles where slug like $1", [`${DEMO_SLUG}%`]);
    await db.query("update public.settings set value = $1::jsonb, updated_by = $3 where key = 'expert_notice' and value ->> 'version' = $2", [JSON.stringify(NOTICE_SEED), DEMO_MARK, ACTOR]);
    await db.query("update public.settings set value = $1::jsonb, updated_by = $3 where key = 'expert_request_policy' and value ->> 'consent_version' = $2", [JSON.stringify(POLICY_SEED), DEMO_MARK, ACTOR]);
    await db.query("delete from public.rules_audit where (kind = 'ruleset' and target_id = any($1::bigint[])) or (kind = 'determination_table' and target_id = any($2::bigint[]))", [rs, dt]);
    await db.query("delete from public.rulesets where id = any($1::bigint[])", [rs]);
    await db.query("delete from public.determination_tables where id = any($1::bigint[])", [dt]);
    if (uid) await db.query("delete from public.audit_logs where actor = $1 or target = $2", [`user:${uid}`, `staff_roles:${uid}`]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
  if (uid) await auth(`/admin/users/${uid}`, { method: "DELETE", service: true });
  console.log("시연 자료(룰셋·판정표·대조 사례·실행 기록)와 시험용 감수위원 계정을 지웠습니다.");
}

if (MODE !== "on") {
  await setFlags(false);
  if (MODE === "purge") await purge();
  await db.end();
  process.exit(0);
}

// ── 0. 사이트가 떠 있어야 합니다 (대조 실행은 사이트의 엔진으로 돕니다)
try {
  await fetch(`${base}/api/health`);
} catch {
  await db.end();
  fail(`${base} 에 사이트가 없습니다. 다른 터미널에서 pnpm dev:local을 먼저 실행한 뒤 다시 해 주세요.`);
}

// ── 1. 시험용 감수위원 (비밀번호는 매번 새로 만들고 적지 않음)
const password = crypto.randomBytes(18).toString("base64url");
let uid = await reviewerId();
if (!uid) {
  const created = await auth("/admin/users", { service: true, body: { email: REVIEWER_EMAIL, password, email_confirm: true } });
  if (created.status >= 300 || !created.body?.id) fail(`시험용 감수위원 계정을 만들지 못했습니다 (HTTP ${created.status})`);
  uid = created.body.id;
} else {
  const upd = await auth(`/admin/users/${uid}`, { method: "PUT", service: true, body: { password, email_confirm: true } });
  if (upd.status >= 300) fail(`시험용 감수위원 계정을 갱신하지 못했습니다 (HTTP ${upd.status})`);
}
await db.query("insert into public.staff_roles (user_id, role, granted_by) values ($1, 'reviewer', 'admin:dev-calc-demo') on conflict do nothing", [uid]);
const signer = `user:${uid}`;
const approver = "admin:dev-calc-demo";
console.log("시험용 감수위원 계정 준비:", REVIEWER_EMAIL);

// ── 2. 룰셋·판정표: 초안 -> 서명 -> 승인 (RPC 경로 그대로)
async function ensureActive({ table, kind, signFn, approveFn, makeDraft, extraWhere = "" }) {
  let row = await one(`select id, status from public.${table} where version = $1 ${extraWhere}`, [VERSION]);
  if (!row) row = await makeDraft();
  if (row.status === "retired") fail(`${kind} ${VERSION}이(가) 이미 내려가 있습니다(다시 켤 수 없음). pnpm dev:calc-demo -- --purge 후 다시 실행해 주세요.`);
  const id = Number(row.id);
  if (row.status === "draft") {
    const r = (await one(`select public.${signFn}($1, $2, '시험용 시트 (dev-calc-demo)') r`, [id, signer])).r;
    if (!r.ok) fail(`${kind} 서명 거부: ${r.code} ${r.message}`);
    row.status = "reviewed";
  }
  if (row.status === "reviewed") {
    const r = (await one(`select public.${approveFn}($1, $2) r`, [id, approver])).r;
    if (!r.ok) fail(`${kind} 승인 거부: ${r.code} ${r.message}`);
  }
  return id;
}

const activeOther = await one("select version from public.rulesets where status = 'active' and version <> $1", [VERSION]);
if (activeOther && !has("--replace-active")) {
  await db.end();
  fail(`다른 활성 룰셋(${activeOther.version})이 있습니다. 승인하면 그 룰셋이 내려갑니다. 괜찮다면 --replace-active를 붙여 다시 실행해 주세요.`);
}

const body = JSON.parse(fs.readFileSync(path.join(ROOT, "rules", "2026.01.json"), "utf8"));
body.version = VERSION;
await ensureActive({
  table: "rulesets", kind: "룰셋", signFn: "sign_ruleset", approveFn: "approve_ruleset",
  makeDraft: async () =>
    one("insert into public.rulesets (version, body, body_sha256, source_ref, basis_note, created_by) values ($1, $2::jsonb, '', $3, $4, $5) returning id, status", [
      VERSION, JSON.stringify(body), "시험용 - rules/2026.01.json 미감수 초안 값 (실제 세금과 다름)", "시험용 시연 자료 - 실제 세액 아님", "demo:dev-calc-demo",
    ]),
});
await ensureActive({
  table: "determination_tables", kind: "환급 판정표", signFn: "sign_determination_table", approveFn: "approve_determination_table", extraWhere: "and kind = 'refund'",
  makeDraft: async () =>
    one("insert into public.determination_tables (kind, version, body, body_sha256, source_ref, basis_note, created_by) values ('refund', $1, $2::jsonb, '', $3, $4, $5) returning id, status", [
      VERSION, JSON.stringify(REFUND_TABLE), "시험용 - 지어낸 문진표 (실제 요건 아님)", "시험용 시연 자료 - 실제 환급 요건 아님", "demo:dev-calc-demo",
    ]),
});
console.log(`시험용 룰셋·환급 판정표 ${VERSION} 활성`);

// ── 3. 대조 사례 (시험용) 확인 -> 대조 실행 (감수위원 토큰으로 사이트의 관리 API 호출)
const login = await auth("/token?grant_type=password", { body: { email: REVIEWER_EMAIL, password } });
const token = login.body?.access_token;
if (!token) fail(`시험용 감수위원 로그인 실패 (HTTP ${login.status})`);
const runAccuracy = async () => {
  const res = await fetch(`${base}/api/admin/accuracy`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ op: "run" }) });
  if (!res.ok) fail(`대조 실행 실패 (HTTP ${res.status}) - 사이트가 이 DB에 붙어 있는지 확인해 주세요.`);
};
const confirmAll = () =>
  db.query("select public.confirm_accuracy_case(id, $1) from public.accuracy_cases where case_key like $2 and confirmed_at is null and retired_at is null", [signer, `${KEY_PREFIX}%`]);
const seed = (name, tax, cause, kind, input, total, from, to) =>
  db.query(
    `insert into public.accuracy_cases (case_key, tax_kind, cause, sample_kind, case_input, official_total, official_basis, entered_by)
     select $1 || '-' || g, $2, $3::text, $4, $5::jsonb, $6, $7, $8 from generate_series($9::int, $10::int) g on conflict (case_key) do nothing`,
    [`${KEY_PREFIX}${name}`, tax, cause, kind, JSON.stringify(input), total, kind === "official" ? "tax_notice" : "reviewer_calc", ENTERED_BY, from, to],
  );
const existing = async () =>
  Number((await one("select count(*)::int n from public.accuracy_cases where case_key like $1 and case_key not like $2 and retired_at is null", [`${KEY_PREFIX}%`, `${KEY_PREFIX}probe-%`])).n);
const wanted = GROUPS.reduce((s, g) => s + g[4], 0);

if ((await existing()) < wanted) {
  // 엔진이 내는 합계를 시험용 공식 결과로 빌린다 (법령 정답이 아니라 화면 연결을 보려는 자료)
  const stamp = Date.now().toString(36);
  const probes = [["acquisition", "PAID", ACQ], ["acquisition", "INHERITANCE", ACQ], ["property", null, HOLD]];
  for (const [i, [tax, cause, input]] of probes.entries()) await seed(`probe-${stamp}-${i}`, tax, cause, "official", input, 1, 0, 0);
  await confirmAll();
  await runAccuracy();
  const totals = [];
  for (const i of probes.keys()) {
    const r = await one(
      "select r.engine_total from public.accuracy_run_results r join public.accuracy_cases c on c.id = r.case_id where c.case_key = $1 order by r.run_id desc limit 1",
      [`${KEY_PREFIX}probe-${stamp}-${i}-0`],
    );
    if (!r) fail("엔진 합계를 얻지 못했습니다.");
    totals.push(Number(r.engine_total));
  }
  await db.query("update public.accuracy_cases set retired_at = now() where case_key like $1", [`${KEY_PREFIX}probe-%`]);
  const totalOf = (tax, cause) => totals[probes.findIndex((p) => p[0] === tax && p[1] === cause)];
  for (const [name, tax, cause, kind, n, input] of GROUPS) await seed(name, tax, cause, kind, input, totalOf(tax, cause), 1, n);
}
await confirmAll();
await runAccuracy();

const gate = (await db.query("select tax_kind, cause_group, official_cases, official_matched, sample_cases, sample_matched, is_open from public.calc_gate_status order by 1, 2")).rows;
console.table(gate);
const open = (t, c) => gate.find((g) => g.tax_kind === t && g.cause_group === c)?.is_open === true;
if (!open("acquisition", "OTHER") || !open("property", "ALL")) {
  console.error("취득세 또는 재산세 게이트가 열리지 않았습니다. 엔진이 바뀌어 기존 시험용 사례가 어긋났을 수 있습니다: pnpm dev:calc-demo -- --purge 후 다시 실행해 주세요.");
  await db.end();
  process.exit(1);
}

// ── 4. 홈 바로가기 도착 3곳 (재테크 포인트 · 법령 해석 브리핑 · 전문가 상담 요청) - 모두 시험용, 있으면 다시 만들지 않음
const demoArticles = async () => (await db.query("select id from public.articles where slug like $1 and status = 'published' order by slug", [`${DEMO_SLUG}weekly-%`])).rows.map((r) => Number(r.id));
let aids = await demoArticles();
for (let i = aids.length + 1; i <= 3; i++) {
  await db.query(
    "insert into public.articles (slug, title, summary, section, content_type, status, first_published_at) values ($1, $2, $3, 'realestate', 'explainer', 'published', now()) on conflict (slug) do nothing",
    [`${DEMO_SLUG}weekly-${i}`, `시험용 부동산재테크 기사 ${i}`, "시험용 기사입니다. 실제 내용이 아닙니다."],
  );
}
aids = await demoArticles();
if (aids.length < 3) fail("시험용 기사 3건을 만들지 못했습니다.");
if (!(await one("select 1 x from public.realestate_weekly_items where article_id = any($1::bigint[]) limit 1", [aids]))) {
  const week = (await one("select to_char(now() at time zone 'Asia/Seoul', 'IYYY-IW') w")).w;
  const issue = await one("insert into public.realestate_weekly_issues (week, edited_by) values ($1, $2) on conflict (week) do nothing returning id", [week, ACTOR]);
  if (!issue) console.warn(`이번 주(${week}) 재테크 포인트 호가 이미 있어 시험용 호를 만들지 않았습니다.`);
  else {
    for (const [i, id] of aids.entries()) await db.query("insert into public.realestate_weekly_items (issue_id, article_id, rank, tax_items, point) values ($1, $2, $3, array['취득세'], '시험용 항목입니다')", [issue.id, id, i + 1]);
    const r = (await one("select public.publish_realestate_weekly($1, $2) r", [issue.id, ACTOR])).r;
    if (!r.ok) fail(`재테크 포인트 발행 거부: ${r.code} ${r.message}`);
  }
}
let brief = await one("select id, status from public.brief_issues where issue_no = $1", [DEMO_BRIEF_NO]);
if (!brief) {
  brief = await one("insert into public.brief_issues (issue_no, title, publish_at, corners, check_report, created_by) values ($1, '시험용 이번 주 법령·해석', now() - interval '1 hour', $2::jsonb, $3::jsonb, $4) returning id, status", [
    DEMO_BRIEF_NO, JSON.stringify(DEMO_BRIEF_CORNERS), JSON.stringify(CLEAN_REPORT), ACTOR,
  ]);
}
if (brief.status === "draft") await db.query("select public.brief_issue_approve($1, $2)", [brief.id, ACTOR]);
if (brief.status !== "published") await db.query("select public.brief_issue_publish($1)", [brief.id]);
const expertPolicy = async (key, field, demo) => {
  const cur = (await one("select value from public.settings where key = $1", [key]))?.value;
  if (cur?.approved === true) return;
  await db.query("update public.settings set value = $2::jsonb, updated_by = $3 where key = $1", [key, JSON.stringify(demo), ACTOR]);
};
await expertPolicy("expert_notice", "version", NOTICE_DEMO);
await expertPolicy("expert_request_policy", "consent_version", POLICY_DEMO);
if (!(await one("select 1 x from public.expert_profiles where status = 'published' and withdrawn_at is null limit 1"))) {
  await db.query("insert into public.expert_profiles (slug, name, category_codes, office_name, house_relation, intro, edited_by) values ($1, '시험용 전문가', array['tax-accountant'], '시험용 사무소', 'employed', '시험용 소개입니다.', $2) on conflict (slug) do nothing", [`${DEMO_SLUG}expert`, ACTOR]);
  await db.query("update public.expert_profiles set status = 'published', consent_version = 'demo', consent_on = current_date, consent_doc_ref = '시험용', published_by = $2 where slug = $1 and status = 'draft'", [`${DEMO_SLUG}expert`, ACTOR]);
}
console.log("시험용 바로가기 자료 준비: 재테크 포인트 1호 · 브리핑 1호 · 전문가 연락 요청");

// ── 5. 기능 키 켜기
await setFlags(true);
await db.end();
console.log(`\n준비됐습니다. 최대 30초 뒤(공개 데이터 캐시) ${base}/calc 를 열어 보세요. 값은 모두 시험용이며 실제 세금과 다릅니다.`);
console.log("  /calc  /calc/acquisition  /calc/holding  /calc/refund  /calc/compare  /calc/accuracy  /realestate/weekly  /experts/request  /brief/날짜  (홈 바로가기)");
console.log("참고: 바로가기는 메뉴라 shortcuts 키만 켜져 있으면 4개가 늘 보이고, 내용이 없는 도착 화면은 '준비 중'으로 열립니다(브리핑 읽기는 메일 설정 없이도 열림).");
console.log("끄기: pnpm dev:calc-demo -- --off   지우기: pnpm dev:calc-demo -- --purge");
