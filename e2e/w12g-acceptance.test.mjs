// W12-g 수용 E2E - 키워드 맵·보안 정책 (docs/dev/W12-g_설계.md - PRD-04 CASE-06 · SEC-01)
// standalone 빌드를 로컬 Supabase에 붙인다. 결정례·태그·보안 항목 본문은 전부 시험용 가짜 글이다. 기능 키와 키워드 맵 정책은 시험 동안만 켠다.
//  a) 키 꺼짐(기본) - /cases/keywords · /security 404
//  b) 키워드 맵 - 정책 비면 404 · 승인 전 태그 노드 0 · 승인 뒤 노드 건수 = 그 노드로 거른 목록 건수 · 두 노드 선택 = AND · URL 상태 · SVG 원 수 = 노드 표 행 수, 선 수 = 연결선 표 행 수
//     · 비회원(로그인 없음) 200 · 노드는 링크라 Tab/Enter 가능(포커스 이동 순수 함수는 단위 시험) · 노드 상한 정책 적용
//  c) 보안 정책 - 직원 아님 403 · 인증 단정 표현 초안 422 · 7개 항목 초안·게시(미래 확인일 거부 409) · 7개 게시 + 자가 점검 전 404 · 점검 완료 뒤 200 + 7항목 모두 확인일 + 인증 단정 표현 0 · AI 제공사 항목은 계약 확인 없으면 409
//  d) AI SDK import 0 - 이 단위 서버 소스
// 만든 행은 끝나면 지우고 운영 설정은 시험 전 값으로 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "w12g-acceptance-e2e@example.test";
const SITE = "https://e2e-w12g.example.test";
const CRON = "e2e-w12g-cron";
const GUARD = "e2e-w12g-guard-secret";
const ROOT = path.resolve(import.meta.dirname, "..");
const KEYS = ["data_location", "encryption", "access_control", "ai_provider_data", "calc_input_not_stored", "conversation_retention", "vulnerability_contact"];

let sb, server, staff, db, base, saved, run;
const u = {};
const ids = { snapshots: [], docs: [] };
const fx = {};

async function api(method, p, user, body) {
  const headers = { origin: base };
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const tags = (user, body) => api("POST", "/api/admin/issue-tags", user, body);
const security = (user, body) => api("POST", "/api/admin/security", user, body);
const page = async (p) => {
  const res = await fetch(`${base}${p}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
};
const count = (html, re) => (html.match(re) ?? []).length;
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
  if (server) await restart();
}
async function setPolicy(value) {
  await db.query("update public.settings set value = $1::jsonb where key = 'keyword_map_policy'", [JSON.stringify(value)]);
  if (server) await restart();
}
async function newDoc(no) {
  const snap = await db.query("insert into public.raw_snapshots (source, url, content_hash, payload) values ('w12g-e2e', $1, $2, '시험용 원문') returning id", [`https://example.test/w12g/${run}/${no}`, `h-${run}-${no}`]);
  ids.snapshots.push(snap.rows[0].id);
  const doc = await db.query(
    `insert into public.legal_docs (doc_type, issuer, doc_no, decided_on, tax_kinds, source_url, rights_status, anonymity_check, content_hash, snapshot_id)
     values ('interpretation', '시험용 기관', $1, '2026-03-01', array['취득세'], 'https://example.test/w12g/doc', 'confirmed', 'confirmed', $2, $3) returning id`,
    [`시험용-번호-${run}-${no}`, `ch-${run}-${no}`, snap.rows[0].id],
  );
  ids.docs.push(doc.rows[0].id);
  return { id: doc.rows[0].id, no: `시험용-번호-${run}-${no}` };
}

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.security_audit where (actor like 'admin:%' or actor like 'user:%') and at > now() - interval '1 day' and detail is distinct from 'keep'");
    await db.query("delete from public.security_control_checks where control_key like $1", [`e2e_w12g_${run}%`]);
    await db.query("delete from public.security_self_check_rounds where round_no >= 9000");
    await db.query("delete from public.security_policy_items where body like '시험용%'");
    const t = (await db.query("select id from public.issue_tags where tag_key like $1", [`e2e_w12g_${run}%`])).rows.map((r) => r.id);
    if (t.length) {
      await db.query("delete from public.issue_audit where subject in ('issue_tag', 'case_issue_tag')");
      await db.query("delete from public.case_issue_tags where issue_tag_id = any($1::bigint[])", [t]);
      await db.query("delete from public.issue_tags where id = any($1::bigint[])", [t]);
    }
    if (ids.docs.length) {
      await db.query("delete from public.legal_doc_texts where legal_doc_id = any($1::bigint[])", [ids.docs]);
      await db.query("delete from public.legal_docs where id = any($1::bigint[])", [ids.docs]);
    }
    if (ids.snapshots.length) await db.query("delete from public.raw_snapshots where id = any($1::bigint[])", [ids.snapshots]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
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
  saved = (await db.query("select key, value from public.settings where key in ('feature_flags', 'keyword_map_policy')")).rows;
  u.admin = await staff.createUser({ label: "w12g-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w12g-editor", roles: ["editor"], person: { name: "시험용 편집자", roles: ["editor"] } });
  await setFlags({ keyword_map: false, security_page: false, case_db: false, issue_graph: false });
  await setPolicy({});
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

test("a) 키 꺼짐(기본) - 키워드 맵·보안 정책 404", async () => {
  assert.equal((await page("/cases/keywords")).status, 404);
  assert.equal((await page("/security")).status, 404);
});

test("b) 키워드 맵 - 정책 비면 404, 승인 전 0, 노드 건수 = 목록 건수, AND, URL 상태, SVG = 표", async () => {
  await setFlags({ keyword_map: true, case_db: true, issue_graph: true });
  assert.equal((await page("/cases/keywords")).status, 404, "정책이 비어 있으면 닫힘");
  await setPolicy({ max_nodes: 30, min_docs: 1 });
  const d1 = await newDoc(1);
  const d2 = await newDoc(2);
  const kA = `e2e_w12g_${run}_a`;
  const kB = `e2e_w12g_${run}_b`;
  for (const [k, label] of [[kA, "시험용 태그 가"], [kB, "시험용 태그 나"]]) {
    const p = await tags(u.editor, { op: "propose", tag_key: k, label, hub: "trust" });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    fx[k] = p.body.created.id;
    assert.equal((await tags(u.editor, { op: "approve", id: fx[k] })).status, 200);
  }
  const link = async (doc, k) => {
    const a = await tags(u.editor, { op: "apply", case_id: doc.id, issue_tag_id: fx[k] });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    return a.body.created.id;
  };
  const l1 = await link(d1, kA);
  assert.equal((await page("/cases/keywords")).status, 404, "승인된 연결이 없으면 노드 0 -> 닫힘");
  for (const [doc, k] of [[d1, kA], [d2, kA], [d1, kB]]) {
    const id = doc === d1 && k === kA ? l1 : await link(doc, k);
    assert.equal((await tags(u.editor, { op: "approve_case", id })).status, 200);
  }
  const p = await page("/cases/keywords?tax=%EC%B7%A8%EB%93%9D%EC%84%B8");
  assert.equal(p.status, 200, "비회원 열람");
  assert.equal(count(p.html, /data-node-row=/g), 2, "노드 표 행 2");
  assert.equal(count(p.html, /<a [^>]*data-node=/g), 2, "SVG 원 = 노드 표 행");
  assert.equal(count(p.html, /data-edge-row=/g), 1);
  assert.equal(count(p.html, /<line [^>]*data-edge=/g), 1, "SVG 선 = 연결선 표 행");
  assert.match(p.html, new RegExp(`data-node-row="${kA}"[^>]*data-count="2"`), "A 노드 2건");
  assert.equal(count(p.html, /data-case="/g), 2, "고르지 않으면 목록은 결정례 2건");
  const onlyA = await page(`/cases/keywords?tax=%EC%B7%A8%EB%93%9D%EC%84%B8&tag=${kA}`);
  assert.equal(count(onlyA.html, /data-case="/g), 2, "A 노드 건수 2 = 목록 건수 2");
  const onlyB = await page(`/cases/keywords?tax=%EC%B7%A8%EB%93%9D%EC%84%B8&tag=${kB}`);
  assert.equal(count(onlyB.html, /data-case="/g), 1, "B 노드 건수 1 = 목록 건수 1");
  assert.equal(onlyB.html.includes(d1.no), true);
  assert.equal(onlyB.html.includes(d2.no), false);
  const both = await page(`/cases/keywords?tax=%EC%B7%A8%EB%93%9D%EC%84%B8&tag=${kA}&tag=${kB}`);
  assert.equal(count(both.html, /data-case="/g), 1, "두 노드 선택 = 모두 붙은 결정례");
  assert.equal(count(both.html, /aria-current="true"/g) >= 2, true, "고른 노드 표시");
  assert.match(both.html, /선택됨/, "색이 아니라 글자로도 표시");
  // 승인 전 태그 0: 제안 상태 태그/연결은 어떤 화면에도 없다
  const kC = `e2e_w12g_${run}_c`;
  const c = await tags(u.editor, { op: "propose", tag_key: kC, label: "시험용 태그 다", hub: "trust" });
  assert.equal(c.status, 201);
  assert.equal((await page("/cases/keywords?tax=%EC%B7%A8%EB%93%9D%EC%84%B8")).html.includes("시험용 태그 다"), false, "승인 전 태그 0");
  // 노드 상한 정책
  await setPolicy({ max_nodes: 1 });
  const capped = await page("/cases/keywords?tax=%EC%B7%A8%EB%93%9D%EC%84%B8");
  assert.equal(count(capped.html, /data-node-row=/g), 1, "상한 1 -> 노드 1");
  // /cases에 키워드 맵 링크
  assert.equal((await page("/cases")).html.includes("/cases/keywords"), true);
  await setFlags({ keyword_map: false });
  assert.equal((await page("/cases/keywords")).status, 404);
  assert.equal((await page("/cases")).html.includes("/cases/keywords"), false);
});

test("c) 보안 정책 - 권한·문구 검사·게시 조건·7항목·확인일·인증 단정 0", async () => {
  await setFlags({ security_page: true });
  assert.equal((await security(u.editor, { op: "draft", item_key: "encryption", body: "시험용 본문", confirmed_on: "2026-10-01" })).status, 403, "편집 책임자도 403 (관리자만)");
  const claim = await security(u.admin, { op: "draft", item_key: "encryption", body: "시험용 인증 획득 문장", confirmed_on: "2026-10-01" });
  assert.equal(claim.status, 422, "인증 단정 표현 거부");
  const items = {};
  for (const k of KEYS) {
    const r = await security(u.admin, { op: "draft", item_key: k, body: `시험용 본문 ${k}`, confirmed_on: "2026-10-01", contract_verified: false });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    items[k] = r.body.created.id;
  }
  assert.equal((await security(u.admin, { op: "publish", id: items.ai_provider_data })).status, 409, "계약 확인 없으면 AI 제공사 항목 게시 거부");
  const reDraft = await security(u.admin, { op: "draft", item_key: "ai_provider_data", body: "시험용 본문 계약 확인됨", confirmed_on: "2026-10-01", contract_verified: true });
  items.ai_provider_data = reDraft.body.created.id;
  const future = await security(u.admin, { op: "draft", item_key: "data_location", body: "시험용 미래 확인일", confirmed_on: "2999-01-01" });
  assert.equal((await security(u.admin, { op: "publish", id: future.body.created.id })).status, 409, "미래 확인일 거부");
  for (const k of KEYS) {
    if (k === "data_location") continue;
    assert.equal((await security(u.admin, { op: "publish", id: items[k] })).status, 200, k);
  }
  assert.equal((await security(u.admin, { op: "publish", id: items.data_location })).status, 200);
  assert.equal((await page("/security")).status, 404, "7개 게시 + 자가 점검 전에는 404 (준비 중 쪽 0)");
  const chk = await security(u.admin, { op: "check", round_no: 9000, control_key: `e2e_w12g_${run}_ctl`, control_title: "시험용 통제", result: "gap", checked_on: "2026-10-01" });
  assert.equal(chk.status, 422, "미흡은 조치 계획·기한 필수");
  const ok = await security(u.admin, { op: "check", round_no: 9000, control_key: `e2e_w12g_${run}_ctl`, control_title: "시험용 통제", result: "gap", checked_on: "2026-10-01", gap_plan: "시험용 조치 계획", due_on: "2026-12-31" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await security(u.admin, { op: "complete_round", round_no: 9000 })).status, 200);
  const view = await page("/security");
  assert.equal(view.status, 200, "비회원 열람");
  assert.equal(count(view.html, /data-item="/g), 7, "7개 항목");
  assert.equal(count(view.html, /data-part="confirmed-on"/g), 7, "항목마다 마지막 확인일");
  assert.equal(/인증\s*(획득|취득|완료|보유)|인증(을|은)?\s*받(은|았|아)|인증된\s*보안/.test(view.html), false, "인증 단정 표현 0");
  await setFlags({ security_page: false });
  assert.equal((await page("/security")).status, 404);
});

test("d) AI SDK import 0 - 이 단위의 서버 소스", () => {
  const files = [
    "apps/web/lib/server/public/keyword-map.ts",
    "apps/web/lib/server/public/security.ts",
    "apps/web/lib/server/security/board.ts",
    "apps/web/app/api/admin/security/route.ts",
    "apps/web/lib/keyword-map/graph.ts",
    "apps/web/lib/security/items.ts",
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.equal(/from\s+["'](@anthropic-ai|openai|@google\/genai|@ai-sdk)/.test(src), false, f);
  }
});
