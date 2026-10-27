// W12-z 수용 E2E - 4단계를 닫는 묶음 (docs/dev/W12-z_설계.md - PRD-04 12장 검증 표 · 14장 완료 기준 중 코드로 판정하는 것)
// 단위별 수용 시험(w12a~h)이 못 덮은 이음매만 본다. 모델은 가짜 HTTP 서버(도구 호출까지 흉내)이고, 글·값은 전부 시험용이다. 실제 모델·네트워크 0.
//  a) 한도 위조 - x-forwarded-for 앞쪽 값·x-real-ip를 바꿔 보내도 비회원 한도는 초기화되지 않는다 (신뢰 머리글은 마지막 x-forwarded-for 값)
//  b) 도구 호출 SSE - 가짜 모델이 run_calculator를 부르면 calc 카드는 문단 뒤에 오고, 금액은 카드에만 있으며 모델 요청·문단에 없다
//  c) 모델이 문단에 금액을 쓰면 재생성되어 나가지 않는다 / 잘못된 판정 입력은 판정 카드 0
//  d) 증여세 금액 질문 - 모델 호출 0 · 금액 0 · 계산기 카드
//  e) 회원 경로 - 세션 소유 · 목록 · 저장 끄기 · 남의 것 삭제 거부 · 본인 삭제 · 두 보존 기한 각각 파기
//  f) 기록 함수 권한 - anon·authenticated는 agent_record_turn·agent_record_results 실행 불가 / 질문당 비용 보고서가 기록 값과 맞음
//  g) 화면 - 새 공개 화면 R1~R3·접근성 95·360px 가로 스크롤 0, 새 관리 화면 360px 가로 스크롤 0, /my/conversations 접근성
//  h) 이식성 - 중계(Caddy) 설정이 응답을 모으지 않고, 클라이언트 IP 머리글을 믿는 설정이 없다 (Docker 첫 status 측정 방법은 설계 문서)
// 만든 행은 끝나면 지우고, 바꾼 설정은 원래 값으로 되돌린다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { A11Y_MIN, accessibility } from "./lib/a11y.mjs";
import { measurePage } from "./lib/screen-rules.mjs";
import { buildWeb, freePort, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";
import { summarizeCost } from "../scripts/ask-cost-report.mjs";

const SITE = "https://e2e-w12z.example.test";
const GUARD = "e2e-w12z-guard-secret";
const CRON = "e2e-w12z-cron";
const ADMIN_EMAIL = "w12z-acceptance-e2e@example.test";
const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = "mois_local_tax_stats";
const KEYS = ["feature_flags", "ask_rollout", "ask_budget", "ask_pricing", "ask_mode_notice", "ask_mode_targets", "ask_limits", "ask_retention", "keyword_map_policy"];
const SEC_KEYS = ["data_location", "encryption", "access_control", "ai_provider_data", "calc_input_not_stored", "conversation_retention", "vulnerability_contact"];
const OK_TEXT = "시험용 요건을 확인하세요. 제3조 기준 금액은 12345원입니다.";
const AMOUNT = "9876543";

let sb, server, staff, db, base, modelServer, saved, run, word, chunkSource, savedSource, savedScopes;
let modelHits = 0;
let modelBodies = [];
let queue = [];
const u = {};
const sessions = [];
const ids = { snapshots: [], docs: [] };
const fx = {};

async function setSetting(key, value) {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    await db.query("update public.settings set value = $1::jsonb where key = $2", [JSON.stringify(value), key]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}
const askRaw = (body, headers = {}) => fetch(`${base}/api/ask`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
async function readSse(res) {
  const text = await res.text();
  const events = text.split("\n\n").filter(Boolean).map((b) => ({ event: /^event: (.+)$/m.exec(b)?.[1], data: JSON.parse(/^data: (.+)$/m.exec(b)?.[1] ?? "{}") }));
  return { events, text };
}
async function api(method, p, user, body) {
  const headers = { origin: base };
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
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
  AGENT_MODEL_ANSWER: "e2e-model-a",
  ANTHROPIC_API_KEY: "e2e-not-a-real-key",
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${modelServer.address().port}`,
});
async function startAll() {
  server = await startServer(serverEnv());
  base = server.base;
}
/** 공개 설정 캐시(30초)를 새로 시작하려고 서버를 다시 띄운다 */
async function restart() {
  await server?.stop?.();
  await startAll();
}
async function setFlags(patch) {
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  await setSetting("feature_flags", { ...cur, ...patch });
  await restart();
}

// ── 가짜 모델 ──
const toolUse = (name, input) => () => ({ content: [{ type: "tool_use", id: "tu1", name, input }], stop_reason: "tool_use", usage: { input_tokens: 1000, output_tokens: 100 } });
const answer = (text) => () => ({
  content: [{ type: "text", text, citations: [{ type: "char_location", document_index: 0, document_title: chunkSource, cited_text: "x" }] }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1000, output_tokens: 500 },
});
const CALC_INPUT = { tax: "acquisition", owner_type: "INDIVIDUAL", property_kind: "HOUSE", cause: "PAID", price: 500_000_000 };

// ── 시험 자료 ──
async function insertChunk() {
  const hash = (await db.query("select encode(sha256($1::bytea), 'hex') h", [`w12z-${run}`])).rows[0].h;
  await db.query(
    `insert into public.chunks (doc_type, source_type, source_id, chunk_no, path, content, token_est, tax_items, valid_from, source_hash, index_version, content_hash, access_tier, rights_status, scope)
     values ('guide', 'guide_version', $1, 0, '시험용법 > 제3조(시험용 제목)', $2, 20, array['acquisition'], '2020-01-01', 'h', 'chunk-v1', $3, 'public', 'confirmed', 'base')`,
    [chunkSource, `${word} 시험용 본문입니다. 기준 수치는 12345원 입니다.`, hash],
  );
}
async function newDoc(no) {
  const snap = await db.query("insert into public.raw_snapshots (source, url, content_hash, payload) values ('w12z-e2e', $1, $2, '시험용 원문') returning id", [`https://example.test/w12z/${run}/${no}`, `h-${run}-${no}`]);
  ids.snapshots.push(snap.rows[0].id);
  const doc = await db.query(
    `insert into public.legal_docs (doc_type, issuer, doc_no, decided_on, tax_kinds, source_url, rights_status, anonymity_check, content_hash, snapshot_id)
     values ('interpretation', '시험용 기관', $1, '2026-03-01', array['취득세'], 'https://example.test/w12z/doc', 'confirmed', 'confirmed', $2, $3) returning id`,
    [`시험용-번호-${run}-${no}`, `ch-${run}-${no}`, snap.rows[0].id],
  );
  ids.docs.push(doc.rows[0].id);
  return { id: doc.rows[0].id, no: `시험용-번호-${run}-${no}` };
}

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    if (sessions.length) await db.query("delete from public.agent_sessions where id = any($1::uuid[])", [sessions]);
    await db.query("delete from public.agent_quota_daily where subject like 'g:%'");
    await db.query("delete from public.chunks where source_id = $1", [chunkSource]);
    await db.query("delete from public.security_audit where (actor like 'admin:%' or actor like 'user:%') and at > now() - interval '1 day' and detail is distinct from 'keep'");
    await db.query("delete from public.security_control_checks where control_key like $1", [`e2e_w12z_${run}%`]);
    await db.query("delete from public.security_self_check_rounds where round_no >= 9100");
    await db.query("delete from public.security_policy_items where body like '시험용%'");
    const t = (await db.query("select id from public.issue_tags where tag_key like $1", [`e2e_w12z_${run}%`])).rows.map((r) => r.id);
    if (t.length) {
      await db.query("delete from public.issue_audit where subject in ('issue_tag', 'case_issue_tag')");
      await db.query("delete from public.case_issue_tags where issue_tag_id = any($1::bigint[])", [t]);
      await db.query("delete from public.issue_tags where id = any($1::bigint[])", [t]);
    }
    if (ids.docs.length) {
      await db.query("delete from public.legal_doc_texts where legal_doc_id = any($1::bigint[])", [ids.docs]);
      await db.query("delete from public.legal_docs where id = any($1::bigint[])", [ids.docs]);
    }
    const rows = (await db.query("select snapshot_id from public.stats_series where series_key like $1", [`e2e_w12z_${run}%`])).rows.map((r) => r.snapshot_id);
    await db.query("delete from public.stats_series where series_key like $1", [`e2e_w12z_${run}%`]);
    await db.query("delete from public.stats_audit where actor like 'user:%' and at > now() - interval '1 day'");
    await db.query("delete from public.stats_audit where actor = 'job:e2e'");
    if (rows.length) await db.query("delete from public.raw_snapshots where id = any($1::bigint[])", [rows]);
    if (ids.snapshots.length) await db.query("delete from public.raw_snapshots where id = any($1::bigint[])", [ids.snapshots]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

before(async () => {
  sb = localSupabase();
  modelServer = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      modelHits += 1;
      modelBodies.push(raw);
      const next = queue.shift();
      if (!next) return res.writeHead(500).end("{}");
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(next()));
    });
  });
  await new Promise((r) => modelServer.listen(0, "127.0.0.1", r));
  buildWeb();
  await startAll();
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  word = `수용시험${run}`;
  chunkSource = `e2e-w12z-${run}`;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  saved = Object.fromEntries((await db.query("select key, value from public.settings where key = any($1::text[])", [KEYS])).rows.map((r) => [r.key, r.value]));
  savedScopes = (await db.query("select value from public.settings where key = 'ask_scope_flags'")).rows[0]?.value;
  savedSource = (await db.query("select terms_status, terms_checked_by, terms_checked_at, contract_verified_by, contract_verified_at from public.data_sources where key = $1", [SRC])).rows[0];
  u.admin = await staff.createUser({ label: "w12z-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w12z-editor", roles: ["editor"], person: { name: "시험용 편집자", roles: ["editor"] } });
  u.member = await staff.createUser({ label: "w12z-member" });
  u.other = await staff.createUser({ label: "w12z-other" });
  await purge();
  await insertChunk();
  // 지방세봇 게이트를 시험 동안만 연다 (끝나면 저장해 둔 값으로 되돌림)
  await setSetting("ask_rollout", { stage: "4c" });
  await setSetting("ask_budget", { monthly_won: 100000 });
  await setSetting("ask_pricing", { answer: { in: 1000, out: 5000, cachedIn: 100 }, utility: { in: 100, out: 500 } });
  await setSetting("ask_mode_notice", { approved: true, version: "e2e-w12z", mode_notice: "시험용 모드 고지", answer_footer: "시험용 하단 고지", privacy_paragraph: "" });
  await setSetting("ask_mode_targets", { guest: true, member: true });
  await setSetting("ask_limits", { ...saved.ask_limits, guest_daily: 1000 });
  await setSetting("ask_retention", { member_days: 30 });
  await setSetting("ask_scope_flags", { trust_redevelopment: false, inheritance: false, gift: false });
  await setFlags({ taxbot: true, search: true });
});

let browserCtx, userDir;
after(async () => {
  try {
    await browserCtx?.close().catch(() => {});
    if (userDir) fs.rmSync(userDir, { recursive: true, force: true });
    for (const k of KEYS) if (saved?.[k] !== undefined) await setSetting(k, saved[k]);
    if (savedScopes) await setSetting("ask_scope_flags", savedScopes);
    await purge();
    if (savedSource) {
      await db.query("update public.data_sources set terms_status = $2, terms_checked_by = $3, terms_checked_at = $4, contract_verified_by = $5, contract_verified_at = $6 where key = $1", [
        SRC, savedSource.terms_status, savedSource.terms_checked_by, savedSource.terms_checked_at, savedSource.contract_verified_by, savedSource.contract_verified_at,
      ]);
    }
  } finally {
    await staff?.cleanup();
    await server?.stop();
    await new Promise((r) => modelServer?.close(r));
  }
});

async function turn(body, headers) {
  const res = await askRaw(body, headers);
  assert.equal(res.status, 200, `ask ${res.status}`);
  if (body.sessionId) sessions.push(body.sessionId);
  return readSse(res);
}

const T0 = () => Date.now();
test("a) 한도 위조 - x-forwarded-for 앞쪽 값·x-real-ip를 바꿔 보내도 비회원 한도는 초기화되지 않는다", async (t) => {
  const t0 = T0();
  await setSetting("ask_limits", { ...saved.ask_limits, guest_daily: 3 });
  await restart();
  t.diagnostic(`restart ${T0() - t0}ms`);
  const send = (headers) => (async () => { const t1 = T0(); const code = await send0(headers); t.diagnostic(`send ${code} ${T0() - t1}ms`); return code; })();
  const send0 = (headers) => askRaw({ message: "시험구역 추천해 주세요", sessionId: crypto.randomUUID() }, headers).then(async (r) => {
    await r.text();
    return r.status;
  });
  const real = "10.12.9.1";
  assert.deepEqual([await send({ "x-forwarded-for": real }), await send({ "x-forwarded-for": real }), await send({ "x-forwarded-for": real })], [200, 200, 200]);
  assert.equal(await send({ "x-forwarded-for": real }), 429, "4번째는 가입 안내");
  assert.equal(await send({ "x-forwarded-for": `1.1.1.${Date.now() % 200}, ${real}` }), 429, "앞에 끼운 값으로는 초기화 안 됨");
  assert.equal(await send({ "x-forwarded-for": real, "x-real-ip": "2.2.2.2" }), 429, "x-real-ip를 바꿔도 초기화 안 됨");
  assert.equal(await send({ "x-forwarded-for": "10.12.9.2" }), 200, "다른 접속 주소는 따로 센다");
  // 다음 시험들은 IP마다 3번 이하로만 보내므로 한도 3을 그대로 둔다 (끝나면 저장해 둔 값으로 되돌림)
});

test("b) 가짜 모델이 run_calculator를 부르는 SSE 턴 - calc 카드는 문단 뒤, 금액은 카드에만 있고 모델 요청·문단에 없다", async () => {
  queue = [toolUse("run_calculator", CALC_INPUT), answer(OK_TEXT)];
  modelBodies = [];
  const sid = crypto.randomUUID();
  const { events } = await turn({ message: word, sessionId: sid }, { "x-forwarded-for": "10.12.9.10" });
  const names = events.map((e) => e.event);
  assert.equal(names[0], "status");
  const paragraphs = events.filter((e) => e.event === "paragraph");
  assert.ok(paragraphs.length >= 1, `문단 0 - 이벤트: ${names.join(",")}`);
  const calc = events.find((e) => e.event === "calc");
  assert.ok(calc, "calc 카드");
  assert.ok(names.lastIndexOf("paragraph") < names.indexOf("calc"), "카드는 문단 뒤");
  assert.equal(modelBodies.length, 2, "모델 호출 2회(도구 호출 + 답변)");
  assert.equal(events.at(-1).data.validation, "passed");
  const total = calc.data.totalWon;
  if (total !== undefined) {
    assert.equal(typeof total, "number");
    assert.ok(!paragraphs.some((p) => String(p.data.text).includes(String(total))), "문단에 금액 0");
    assert.ok(!modelBodies[1].includes(String(total)), "모델에게 돌려준 도구 결과에 금액 0");
  } else assert.ok(["unsupported", "needs_input", "not_liable"].includes(calc.data.status), `금액 없는 상태: ${calc.data.status}`);
  // 입력값(취득가액)은 어떤 기록에도 남지 않는다
  const dump = JSON.stringify((await db.query("select * from public.agent_tool_calls t join public.agent_messages m on m.id = t.message_id where m.session_id = $1", [sid])).rows);
  assert.ok(!dump.includes("500000000"), "도구 호출 기록에 입력값 0");
  const res = (await db.query("select r.tool, r.status from public.agent_results r join public.agent_messages m on m.id = r.message_id where m.session_id = $1 order by r.position", [sid])).rows;
  assert.equal(res[0]?.tool, "run_calculator");
  assert.equal(res[0].status, calc.data.status, "카드와 봉인 기록의 상태가 같다");
});

test("c) 모델이 문단에 금액을 쓰면 재생성되어 나가지 않고, 잘못된 판정 입력은 판정 카드 0", async () => {
  queue = [toolUse("run_calculator", CALC_INPUT), answer(`시험용 설명입니다. 세액은 ${AMOUNT}원입니다.`), answer(OK_TEXT)];
  modelBodies = [];
  const sid = crypto.randomUUID();
  const { events } = await turn({ message: word, sessionId: sid }, { "x-forwarded-for": "10.12.9.11" });
  assert.equal(modelBodies.length, 3, "재생성 1회");
  assert.equal(events.at(-1).data.validation, "regenerated");
  assert.ok(!events.filter((e) => e.event === "paragraph").some((p) => String(p.data.text).includes(AMOUNT)), "모델이 쓴 금액은 문단으로 나가지 않는다");
  const v = (await db.query("select v.regenerated from public.agent_validations v join public.agent_messages m on m.id = v.message_id where m.session_id = $1", [sid])).rows;
  assert.equal(v[0].regenerated, true);

  queue = [toolUse("run_determination", { judgment_type: "zz_not_a_type" }), answer(OK_TEXT)];
  const sid2 = crypto.randomUUID();
  const r2 = await turn({ message: word, sessionId: sid2 }, { "x-forwarded-for": "10.12.9.12" });
  assert.equal(r2.events.some((e) => e.event === "determination"), false);
  const t = (await db.query("select t.tool, t.ok from public.agent_tool_calls t join public.agent_messages m on m.id = t.message_id where m.session_id = $1", [sid2])).rows;
  assert.deepEqual(t.filter((x) => x.tool === "run_determination").map((x) => x.ok), [false]);
});

test("d) 증여세 금액 질문 - 모델 호출 0 · 금액 0 · 계산기 카드, 범위 플래그를 켜도 같다", async () => {
  for (const flags of [{ trust_redevelopment: false, inheritance: false, gift: false }, { trust_redevelopment: false, inheritance: true, gift: true }]) {
    await setSetting("ask_scope_flags", flags);
    await restart();
    queue = [answer(OK_TEXT)];
    const before = modelHits;
    const { events } = await turn({ message: "증여세 공제 금액이 얼마인가요", sessionId: crypto.randomUUID() }, { "x-forwarded-for": "10.12.9.13" });
    const fb = events.find((e) => e.event === "fallback");
    assert.equal(fb.data.reason, "scope");
    assert.equal(fb.data.amount, 0);
    assert.ok(Array.isArray(fb.data.cards) && fb.data.cards.length >= 1, "계산기 카드");
    assert.equal(modelHits, before, "모델 호출 0");
    assert.ok(!events.some((e) => e.event === "paragraph"));
  }
  await setSetting("ask_scope_flags", { trust_redevelopment: false, inheritance: false, gift: false });
  await restart();
});

test("e) 회원 경로 - 세션 소유·목록·저장 끄기·남의 것 삭제 거부·본인 삭제·두 보존 기한 각각 파기", async () => {
  queue = [answer(OK_TEXT)];
  const mine = crypto.randomUUID();
  const r = await turn({ message: word, sessionId: mine }, { authorization: `Bearer ${u.member.token}` });
  assert.ok(r.events.some((e) => e.event === "paragraph"));
  const s = (await db.query("select user_id from public.agent_sessions where id = $1", [mine])).rows[0];
  assert.equal(s.user_id, u.member.id, "세션 소유자 = 로그인 회원");
  const stored = async (id) => (await db.query("select count(*)::int n from public.agent_messages where session_id = $1 and question_masked is not null", [id])).rows[0].n;
  assert.equal(await stored(mine), 1, "회원 보존 일수가 있으면 글 저장");
  const list = (await db.query("select public.agent_my_sessions($1, $2, 50) r", [u.member.id, word])).rows[0].r;
  assert.deepEqual(list.map((x) => x.id), [mine]);
  assert.deepEqual((await db.query("select public.agent_my_sessions($1, null, 50) r", [u.other.id])).rows[0].r, [], "남의 목록에는 없다");

  // 로그인 없이는 거부, 남의 세션 삭제는 ok:false + 행 유지
  assert.equal((await api("POST", "/api/my/conversations", null, { action: "delete", sessionId: mine })).status, 401);
  const foreign = await api("POST", "/api/my/conversations", u.other, { action: "delete", sessionId: mine });
  assert.equal(foreign.body.ok, false);
  assert.equal((await db.query("select count(*)::int n from public.agent_sessions where id = $1", [mine])).rows[0].n, 1);

  // 저장 끄기 - 이 세션의 글이 비고, 이후 새 세션도 글을 남기지 않는다. 켜면 다시 저장
  assert.equal((await api("POST", "/api/my/conversations", u.member, { action: "save_off", sessionId: mine })).body.ok, true);
  assert.equal(await stored(mine), 0, "저장 끄기 -> 서버 사본 0");
  queue = [answer(OK_TEXT)];
  const later = crypto.randomUUID();
  await turn({ message: word, sessionId: later }, { authorization: `Bearer ${u.member.token}` });
  assert.equal(await stored(later), 0, "저장 꺼 둔 회원의 새 세션도 글 0");
  assert.equal((await api("POST", "/api/my/conversations", u.member, { action: "save_on" })).body.ok, true);
  queue = [answer(OK_TEXT)];
  const again = crypto.randomUUID();
  await turn({ message: word, sessionId: again }, { authorization: `Bearer ${u.member.token}` });
  assert.equal(await stored(again), 1);

  // 두 보존 기한을 각각 파기 - 비회원 세션은 11-01, 회원 세션은 12-01
  queue = [answer(OK_TEXT)];
  const guest = crypto.randomUUID();
  await turn({ message: word, sessionId: guest }, { "x-forwarded-for": "10.12.9.14" });
  await db.query("update public.agent_sessions set retain_until = '2026-11-01T00:00:00Z' where id = $1", [guest]);
  await db.query("update public.agent_sessions set retain_until = '2026-12-01T00:00:00Z' where id = $1", [again]);
  await db.query("select public.agent_purge('2026-11-15T00:00:00Z')");
  assert.equal(await stored(guest), 0, "비회원 기한 지남 -> 파기");
  assert.equal(await stored(again), 1, "회원 기한 전 -> 유지");
  await db.query("select public.agent_purge('2026-11-30T23:59:59Z')");
  assert.equal(await stored(again), 1, "기한 1초 전은 유지");
  await db.query("select public.agent_purge('2026-12-01T00:00:00Z')");
  assert.equal(await stored(again), 0, "정각은 만료");

  // 본인 삭제 - 세션과 딸린 기록이 모두 사라진다
  assert.equal((await api("POST", "/api/my/conversations", u.member, { action: "delete", sessionId: mine })).body.ok, true);
  assert.equal((await db.query("select count(*)::int n from public.agent_sessions where id = $1", [mine])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from public.agent_messages where session_id = $1", [mine])).rows[0].n, 0);
});

test("f) 기록 함수는 anon·authenticated가 실행할 수 없고, 질문당 비용 보고서가 기록과 맞는다", async () => {
  for (const fn of ["agent_record_turn", "agent_record_results"]) {
    const grants = (await db.query("select grantee from information_schema.routine_privileges where specific_schema = 'public' and routine_name = $1", [fn])).rows.map((r) => r.grantee);
    assert.ok(grants.includes("service_role"), fn);
    assert.ok(!grants.includes("anon") && !grants.includes("authenticated") && !grants.includes("PUBLIC"), `${fn}: ${grants.join(",")}`);
  }
  const forged = await fetch(`${sb.url}/rest/v1/rpc/agent_record_turn`, {
    method: "POST",
    headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}`, "content-type": "application/json" },
    body: JSON.stringify({ p: { session_id: crypto.randomUUID() } }),
  });
  assert.ok(forged.status >= 400, `anon 기록 위조 ${forged.status}`);

  const rows = (await db.query("select s.mode, m.kind, m.tokens_in, m.tokens_out, m.tokens_cached, m.cost, m.model_calls from public.agent_messages m join public.agent_sessions s on s.id = m.session_id where s.id = any($1::uuid[])", [sessions])).rows;
  const sum = summarizeCost(rows);
  const modelRows = rows.filter((x) => Number(x.model_calls) > 0);
  assert.ok(modelRows.length >= 3, "도구 시나리오 턴 기록");
  const general = sum.general;
  assert.equal(general.modelTurns, modelRows.filter((x) => x.mode === "general").length);
  assert.ok(general.avgCostWon > 0, "단가가 있으면 비용이 0보다 크다");
  // 모델 한 번 호출 = 입력 1000 x 1000 + 출력 500 x 5000 (백만 분의 1) = 3.5. 두 번 부른 턴은 도구 호출 응답까지 더해진다
  const answerOnly = modelRows.find((x) => Number(x.model_calls) === 1);
  assert.equal(Number(answerOnly.cost), 3.5);
  assert.ok(general.maxCostWon >= general.avgCostWon);
});

test("g) 새 화면 - 공개 화면 R1~R3·접근성 95·360px 가로 스크롤 0, 관리 화면 360px 가로 스크롤 0, /my/conversations 접근성", async (t) => {
  // 자료: 통계(/data) · 보안 정책(/security) · 키워드 맵(/cases/keywords)
  await db.query("update public.data_sources set terms_status = 'allowed', terms_checked_by = 'e2e', terms_checked_at = now(), contract_verified_by = 'e2e', contract_verified_at = now() where key = $1", [SRC]);
  const seriesKey = `e2e_w12z_${run}_s`;
  const snap = { url: "https://example.test/w12z/list", payload: `{"시험용":"${seriesKey}"}`, content_hash: `h-${run}-s`, http_status: 200, external_id: `${run}-s` };
  const series = {
    series_key: seriesKey, title: `시험용 시계열 ${seriesKey}`, tax_item: "시험세목", region_code: null, unit: "시험단위",
    points: [{ period: "2021", value: 10 }, { period: "2022", value: 14 }, { period: "2023", value: 12 }],
    source_name: "시험용 출처", source_url: "https://example.test/about", base_year: 2023, checked_at: "2026-10-01",
  };
  const put = (await db.query("select public.stats_series_put($1, $2::jsonb, $3::jsonb, 'job:e2e') r", [SRC, JSON.stringify(snap), JSON.stringify(series)])).rows[0].r;
  assert.equal(put.ok, true, JSON.stringify(put));
  assert.equal((await api("POST", "/api/admin/stats", u.editor, { op: "approve", id: put.id })).status, 200);

  const sec = (body) => api("POST", "/api/admin/security", u.admin, body);
  const items = {};
  for (const k of SEC_KEYS) {
    const r = await sec({ op: "draft", item_key: k, body: `시험용 본문 ${k}`, confirmed_on: "2026-10-01", contract_verified: k === "ai_provider_data" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    items[k] = r.body.created.id;
  }
  for (const k of SEC_KEYS) assert.equal((await sec({ op: "publish", id: items[k] })).status, 200, k);
  const ctl = `e2e_w12z_${run}_ctl`;
  assert.equal((await sec({ op: "check", round_no: 9100, control_key: ctl, control_title: "시험용 통제", result: "gap", checked_on: "2026-10-01", gap_plan: "시험용 조치 계획", due_on: "2026-12-31" })).status, 201);
  assert.equal((await sec({ op: "complete_round", round_no: 9100 })).status, 200);

  await setSetting("keyword_map_policy", { max_nodes: 30, min_docs: 1 });
  const d1 = await newDoc(1);
  const d2 = await newDoc(2);
  const tags = (body) => api("POST", "/api/admin/issue-tags", u.editor, body);
  for (const [s, label] of [["a", "시험용 태그 가"], ["b", "시험용 태그 나"]]) {
    const k = `e2e_w12z_${run}_${s}`;
    const p = await tags({ op: "propose", tag_key: k, label, hub: "trust" });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    fx[s] = p.body.created.id;
    assert.equal((await tags({ op: "approve", id: fx[s] })).status, 200);
  }
  for (const [doc, s] of [[d1, "a"], [d2, "a"], [d1, "b"]]) {
    const a = await tags({ op: "apply", case_id: doc.id, issue_tag_id: fx[s] });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal((await tags({ op: "approve_case", id: a.body.created.id })).status, 200);
  }
  await setFlags({ data_stories: true, security_page: true, keyword_map: true, case_db: true, issue_graph: true, channel_kit: true });

  const publicPaths = ["/data", `/data/${seriesKey}`, "/security", "/cases/keywords?tax=%EC%B7%A8%EB%93%9D%EC%84%B8"];
  for (const p of publicPaths) assert.equal((await page(p)).status, 200, `${p} 열림`);

  const cdpPort = await freePort();
  userDir = fs.mkdtempSync(path.join(os.tmpdir(), "w12z-chrome-"));
  browserCtx = await chromium.launchPersistentContext(userDir, { args: [`--remote-debugging-port=${cdpPort}`], viewport: { width: 360, height: 740 } });
  const shim = { newPage: async (o) => { const pg = await browserCtx.newPage(); await pg.setViewportSize(o.viewport); return pg; } };
  const fails = [];
  // R1(첫 화면 150자)은 짧은 화면에만 강제한다. 항목·표가 줄줄이 나오는 목록형 화면(/security 7항목, 키워드 맵)은 측정값만 남기고 PO 판단 안건으로 넘긴다 (설계 W12-z 3장)
  const R1_LIST_PAGES = ["/security", "/cases/keywords"];

  for (const p of publicPaths) {
    for (const [width, r1] of [[360, true], [1280, false]]) {
      const m = await measurePage(shim, `${base}${p}`, { width, height: width === 360 ? 740 : 800 });
      const r1Enforced = r1 && !R1_LIST_PAGES.some((x) => p.startsWith(x));
      if (r1 && !r1Enforced) t.diagnostic(`R1 측정만 ${p} ${m.r1.chars}자`);
      if ((r1Enforced && !m.r1.pass) || !m.r2.pass || !m.r3.pass) {
        fails.push(`${p} ${m.viewport} R1 ${m.r1.chars}자 R2 ${m.r2.maxPerViewport} R3 ${m.r3.ratio}`);
        const pg = await browserCtx.newPage();
        await pg.setViewportSize({ width, height: 740 });
        await pg.goto(`${base}${p}`, { waitUntil: "networkidle" });
        const seen = await pg.evaluate(() => {
          const out = [];
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            const t = (n.textContent ?? "").trim();
            if (!t || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(n.parentElement?.tagName ?? "")) continue;
            const r = n.parentElement.getBoundingClientRect();
            if (r.width > 0 && r.top < window.innerHeight && r.bottom > 0) out.push(`${n.parentElement.tagName}:${t.replace(/\s+/g, "").length}:${t.slice(0, 30)}`);
          }
          return out;
        });
        await pg.close();
        t.diagnostic(`${p} 첫 화면 글: ${seen.join(" | ")}`);
      }
    }
    const pg = await browserCtx.newPage();
    await pg.setViewportSize({ width: 360, height: 740 });
    await pg.goto(`${base}${p}`, { waitUntil: "networkidle" });
    const overflow = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await pg.close();
    if (overflow > 0) fails.push(`${p} 360px 가로 스크롤 ${overflow}px`);
    const a = await accessibility(`${base}${p}`, cdpPort);
    if (a.score < A11Y_MIN) fails.push(`${p} 접근성 ${Math.round(a.score * 100)} (${a.failing.join(",")})`);
  }

  const login = async (user) => {
    await browserCtx.clearCookies();
    const pg = await browserCtx.newPage();
    await pg.goto(`${base}/login`);
    await pg.fill('input[name="email"]', user.email);
    await pg.fill('input[name="password"]', user.password);
    await Promise.all([pg.waitForURL((x) => !x.pathname.startsWith("/login")), pg.click('button[type="submit"]')]);
    await pg.close();
  };
  await login(u.admin);
  for (const p of ["/admin/quality", "/admin/stats", "/admin/channels", "/admin/eval"]) {
    const pg = await browserCtx.newPage();
    await pg.setViewportSize({ width: 360, height: 740 });
    const res = await pg.goto(`${base}${p}`, { waitUntil: "networkidle" });
    const overflow = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const url = pg.url();
    await pg.close();
    if (res?.status() !== 200 || !url.includes(p)) fails.push(`${p} 열리지 않음 (${res?.status()} ${url})`);
    else if (overflow > 0) fails.push(`${p} 360px 가로 스크롤 ${overflow}px`);
  }

  // /my/conversations - 회원이 로그인한 같은 브라우저에 Lighthouse를 붙인다 (대화가 하나 있는 모습)
  queue = [answer(OK_TEXT)];
  const conv = crypto.randomUUID();
  await turn({ message: word, sessionId: conv }, { authorization: `Bearer ${u.member.token}` });
  await login(u.member);
  const mypg = await browserCtx.newPage();
  await mypg.setViewportSize({ width: 360, height: 740 });
  await mypg.goto(`${base}/my/conversations`, { waitUntil: "networkidle" });
  assert.ok(mypg.url().includes("/my/conversations"), `로그인 쿠키로 열림: ${mypg.url()}`);
  assert.ok((await mypg.locator('[data-testid="conv-list"] li', { hasText: word }).count()) >= 1, "내 대화 목록에 이 질문이 있다");
  const myOverflow = await mypg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await mypg.close();
  if (myOverflow > 0) fails.push(`/my/conversations 360px 가로 스크롤 ${myOverflow}px`);
  const my = await accessibility(`${base}/my/conversations`, cdpPort);
  assert.ok(my.finalUrl?.includes("/my/conversations"), `Lighthouse가 로그인 화면으로 밀리지 않음: ${my.finalUrl}`);
  if (my.score < A11Y_MIN) fails.push(`/my/conversations 접근성 ${Math.round(my.score * 100)} (${my.failing.join(",")})`);

  t.diagnostic(`화면 점검 실패 ${fails.length}건`);
  assert.deepEqual(fails, []);
});

test("h) 이식성 - 중계 설정은 응답을 모으지 않고 클라이언트 IP 머리글을 믿는 설정이 없다", () => {
  const caddy = fs.readFileSync(path.join(ROOT, "deploy", "Caddyfile"), "utf8");
  assert.match(caddy, /flush_interval\s+-1/);
  assert.doesNotMatch(caddy, /^\s*trusted_proxies/m, "trusted_proxies를 넣으면 들어온 x-forwarded-for를 믿게 되어 한도 IP를 속일 수 있다");
  assert.doesNotMatch(caddy, /header_up\s+X-Real-IP/i);
  const service = fs.readFileSync(path.join(ROOT, "apps/web/lib/server/agent/service.ts"), "utf8");
  assert.match(service, /trustedClientIp\(request\.headers\)/);
  assert.doesNotMatch(service, /\bclientIp\(/, "한도 IP는 신뢰 머리글 함수만 쓴다");
});
