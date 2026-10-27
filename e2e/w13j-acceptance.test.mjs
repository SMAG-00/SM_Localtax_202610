// W13-j 수용 E2E - 정보보호 인증 추진 계획 (docs/dev/W13-j_설계.md - PRD-05 SEC-02)
// standalone 빌드를 로컬 Supabase에 붙인다. 계획 값·보안 항목 본문은 전부 시험용 가짜 글이다. 기능 키는 시험 동안만 켠다.
//  a) 권한 - 직원(편집 책임자)은 403, 관리자만 초안·승인·철회
//  b) 초안 검증 - 인증 단정 표현 422 · 필수 칸 빠짐 422 · 종료일이 시작일보다 빠르면 422
//  c) 승인 거부 - 운영 주체 명의·위험 평가일이 없으면 409 (+ 감사에 거부 기록)
//  d) 기관 판매 게이트 - 승인 전 닫힘, 승인 뒤 열림, 철회 뒤 닫힘 (관리 API의 gateOpen)
//  e) /security 표기 - 기능 키 꺼짐 또는 승인 전에는 '추진 중' 0 · 켜고 승인하면 '추진 중' 1 + 범위·비용·담당·명의 노출 0 + 인증 단정 표현 0 · 철회하면 사라짐
//  f) AI SDK import 0 - 이 단위 서버 소스
// 만든 행은 끝나면 지우고 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w13j-acceptance-e2e@example.test";
const SITE = "https://e2e-w13j.example.test";
const CRON = "e2e-w13j-cron";
const GUARD = "e2e-w13j-guard-secret";
const ROOT = path.resolve(import.meta.dirname, "..");
const ITEM_KEYS = ["data_location", "encryption", "access_control", "ai_provider_data", "calc_input_not_stored", "conversation_retention", "vulnerability_contact"];
const SCOPE = "시험용 비공개 범위 문장";
const OWNER = "시험용 비공개 담당자";
const ENTITY = "시험용 비공개 명의";

let sb, server, staff, db, base, saved;
const u = {};

async function api(method, p, user, body) {
  const headers = { origin: base };
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const cert = (user, body) => api("POST", "/api/admin/security-cert", user, body);
const board = (user) => api("GET", "/api/admin/security-cert", user);
const page = async (p) => {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
};
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
/** 공개 데이터 캐시(30초)를 새로 시작하려고 서버를 다시 띄운다 */
async function restart() {
  await server?.stop?.();
  await startAll();
}
async function setFlags(patch) {
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...patch })]);
  if (server) await restart();
}
async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.security_cert_audit where (actor like 'admin:%' or actor like 'user:%') and at > now() - interval '1 day'");
    await db.query("delete from public.security_cert_plans where scope like '시험용%'");
    await db.query("delete from public.security_audit where (actor like 'admin:%' or actor like 'user:%') and at > now() - interval '1 day' and detail is distinct from 'keep'");
    await db.query("delete from public.security_control_checks where control_key like 'e2e_w13j_%'");
    await db.query("delete from public.security_self_check_rounds where round_no >= 9100");
    await db.query("delete from public.security_policy_items where body like '시험용%'");
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}
/** /security를 여는 조건(7개 항목 게시 + 자가 점검 1회)을 DB 함수로 채운다 */
async function openSecurityPage() {
  for (const k of ITEM_KEYS) {
    const d = (await db.query("insert into public.security_policy_items (item_key, body, confirmed_on, contract_verified, drafted_by) values ($1, $2, '2026-10-01', $3, 'e2e') returning id", [k, `시험용 본문 ${k}`, k === "ai_provider_data"])).rows[0];
    const r = (await db.query("select public.security_item_publish($1, 'admin:e2e-w13j') r", [d.id])).rows[0].r;
    assert.equal(r.ok, true, r.message);
  }
  await db.query("insert into public.security_control_checks (round_no, control_key, control_title, result, checked_on, checked_by) values (9100, 'e2e_w13j_ctl', '시험용 통제', 'met', '2026-10-01', 'e2e')");
  assert.equal((await db.query("select public.security_self_check_complete(9100, 'admin:e2e-w13j') r")).rows[0].r.ok, true);
}

const okPlan = { op: "draft", cert_kind: "iso27001", scope: SCOPE, target_start_on: "2026-11-01", target_end_on: "2999-01-01", cost_estimate_krw: "7,000,000", owner_name: OWNER, entity_name: ENTITY, risk_assessed_on: "2026-10-01" };

before(async () => {
  sb = localSupabase();
  buildWeb();
  await startAll();
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  saved = (await db.query("select key, value from public.settings where key = 'feature_flags'")).rows;
  u.admin = await staff.createUser({ label: "w13j-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w13j-editor", roles: ["editor"], person: { name: "시험용 편집자", roles: ["editor"] } });
  await setFlags({ security_page: false, security_cert_plan: false });
  await purge();
});
after(async () => {
  try {
    await purge();
    for (const s of saved ?? []) await db.query("update public.settings set value = $2::jsonb where key = $1", [s.key, JSON.stringify(s.value)]);
  } finally {
    await staff?.cleanup();
    await server?.stop();
  }
});

test("a) 권한 - 편집 책임자 403, 관리자만 통과", async () => {
  assert.equal((await cert(u.editor, okPlan)).status, 403);
  assert.equal((await board(u.editor)).status, 403);
  assert.equal((await board(u.admin)).status, 200);
  assert.equal((await api("POST", "/api/admin/security-cert", undefined, okPlan)).status, 401);
});

test("b) 초안 검증 - 인증 단정 표현·필수 칸·일정 순서", async () => {
  assert.equal((await cert(u.admin, { ...okPlan, scope: "시험용 인증 획득 범위" })).status, 422);
  assert.equal((await cert(u.admin, { ...okPlan, owner_name: "" })).status, 422);
  assert.equal((await cert(u.admin, { ...okPlan, target_end_on: "2026-10-31" })).status, 422);
  assert.equal((await cert(u.admin, { ...okPlan, cost_estimate_krw: "-5" })).status, 422);
  assert.equal((await cert(u.admin, { ...okPlan, op: "nope" })).status, 422);
  assert.equal((await board(u.admin)).body.plans.filter((p) => p.scope.startsWith("시험용")).length, 0, "거부된 초안은 저장되지 않는다");
});

test("c) 승인 거부 - 명의·위험 평가일이 없으면 409 + 감사 기록", async () => {
  const noEntity = await cert(u.admin, { ...okPlan, entity_name: "" });
  assert.equal(noEntity.status, 201, JSON.stringify(noEntity.body));
  const r1 = await cert(u.admin, { op: "approve", id: noEntity.body.created.id });
  assert.equal(r1.status, 409);
  assert.equal(r1.body.code, "entity_missing");
  const noRisk = await cert(u.admin, { ...okPlan, risk_assessed_on: "" });
  const r2 = await cert(u.admin, { op: "approve", id: noRisk.body.created.id });
  assert.equal(r2.status, 409);
  assert.equal(r2.body.code, "risk_missing");
  const b = (await board(u.admin)).body;
  assert.equal(b.gateOpen, false);
  assert.ok(b.audit.filter((a) => a.outcome === "refused").length >= 2);
});

test("d·e) 기관 판매 게이트와 /security 표기 - 승인 전 0, 승인 뒤 '추진 중', 철회 뒤 0", async () => {
  await openSecurityPage();
  await setFlags({ security_page: true, security_cert_plan: true });
  const before = await page("/security");
  assert.equal(before.status, 200);
  assert.equal(before.html.includes('data-part="cert-plan"'), false, "승인 전에는 추진 중 표기 0");

  const draft = await cert(u.admin, okPlan);
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const id = draft.body.created.id;
  assert.equal((await board(u.admin)).body.gateOpen, false, "초안만 있으면 게이트 닫힘");
  assert.equal((await cert(u.admin, { op: "approve", id })).status, 200);
  assert.equal((await board(u.admin)).body.gateOpen, true, "승인 뒤 게이트 열림");

  await restart();
  const open = await page("/security");
  assert.equal(open.status, 200);
  assert.equal((open.html.match(/data-part="cert-plan"/g) ?? []).length, 1);
  assert.ok(open.html.includes("추진 중"));
  assert.ok(open.html.includes("ISO/IEC 27001"));
  for (const secret of [SCOPE, OWNER, ENTITY, "7,000,000", "7000000"]) assert.equal(open.html.includes(secret), false, `공개 화면에 ${secret} 노출 0`);
  assert.equal(/인증\s*(획득|취득|완료|보유)|인증(을|은)?\s*받(은|았|아)|인증된\s*보안/.test(open.html), false, "인증 단정 표현 0");

  await setFlags({ security_cert_plan: false });
  assert.equal((await page("/security")).html.includes('data-part="cert-plan"'), false, "기능 키 꺼짐이면 표기 0");
  await setFlags({ security_cert_plan: true });
  assert.equal((await cert(u.admin, { op: "withdraw", id })).status, 200);
  assert.equal((await board(u.admin)).body.gateOpen, false, "철회 뒤 게이트 닫힘");
  await restart();
  assert.equal((await page("/security")).html.includes('data-part="cert-plan"'), false, "철회 뒤 표기 0");
});

test("f) AI SDK import 0 - 이 단위의 서버 소스", () => {
  const files = ["apps/web/lib/server/security/cert-plan.ts", "apps/web/app/api/admin/security-cert/route.ts", "apps/web/lib/security/cert-plan.ts", "apps/web/lib/server/public/security.ts"];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.equal(/from\s+["'](@anthropic-ai|openai|@google\/genai|@ai-sdk)/.test(src), false, f);
  }
});
