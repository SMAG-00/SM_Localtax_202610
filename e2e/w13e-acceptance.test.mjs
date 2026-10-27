// W13-e 수용 E2E - 리서치 코파일럿 (docs/dev/W13-e_설계.md, PRD-05 RES-01~05). 모델은 가짜 HTTP 서버이고 글·값은 전부 시험용입니다. 실제 모델·네트워크 0.
//  a) 게이트가 닫히면(기능 키 꺼짐 / 공개 단계 none / 월 한도 빈 값) API는 404이고 가짜 모델 호출 0
//  b) 4c에서 copilot 권한이 없는 회원은 403, 모델 호출 0
//  c) 결정례 1건·9건은 서버가 422로 거부하고 모델 호출 0
//  d) 월 한도 1: 첫 실행은 문단+인용+실행 ID 머리글, 둘째는 429(n+1 거부), 기록 표에는 질문·답변 글 칸이 없음
//  e) 출판물 요약은 요약 권리가 확인되지 않으면 422이고 모델 호출 0
//  f) 서비스 함수는 anon·authenticated가 부를 수 없음
// 만든 행은 끝나면 지우고, 바꾼 설정은 원래 값으로 되돌립니다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e-w13e.example.test";
const GUARD = "e2e-w13e-guard-secret";
const KEYS = ["feature_flags", "ask_rollout", "ask_budget", "ask_pricing", "ask_limits", "copilot_monthly_limit"];
const OK_TEXT = "시험용 요건을 확인하세요. 제3조 기준 금액은 12345원입니다.";

let sb, server, staff, db, base, modelServer, saved, run, word;
let modelHits = 0;
const u = {};
const sources = [];
const snapshotIds = [];

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
const answer = () => ({
  content: [{ type: "text", text: OK_TEXT, citations: [{ type: "char_location", document_index: 0, document_title: sources[0], cited_text: "x" }] }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1000, output_tokens: 500 },
});
async function copilot(user, body) {
  const headers = { origin: base, "content-type": "application/json" };
  if (user) headers.authorization = `Bearer ${user.token}`;
  const res = await fetch(`${base}/api/copilot`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text, runId: res.headers.get("x-copilot-run"), json: () => { try { return JSON.parse(text); } catch { return {}; } } };
}
const serverEnv = () => ({
  NEXT_PUBLIC_SUPABASE_URL: sb.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
  NEXT_PUBLIC_SITE_URL: SITE,
  GUARD_SECRET: GUARD,
  AGENT_MODEL_COPILOT: "e2e-model-copilot",
  AGENT_EFFORT_COPILOT: "high",
  ANTHROPIC_API_KEY: "e2e-not-a-real-key",
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${modelServer.address().port}`,
});
/** 공개 설정 캐시를 새로 시작하려고 서버를 다시 띄운다 */
async function restart() {
  await server?.stop?.();
  server = await startServer(serverEnv());
  base = server.base;
}
async function setGate({ flag, stage, limit }) {
  const cur = (await db.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  await setSetting("feature_flags", { ...cur, research_copilot: flag });
  await setSetting("ask_rollout", { stage });
  await setSetting("copilot_monthly_limit", limit);
  await restart();
}
async function grant(userId, key) {
  await db.query("insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until) values ($1, $2, 'manual', $3, now() - interval '1 day', now() + interval '1 day')", [userId, key, `e2e-w13e-${run}-${key}`]);
}
async function insertDecision(no) {
  const sid = `e2e-w13e-${run}-${no}`;
  const hash = (await db.query("select encode(sha256($1::bytea), 'hex') h", [sid])).rows[0].h;
  // 결정례 조각은 원문 스냅샷이 필수(chunks_snapshot_required)
  const snap = (await db.query("insert into public.raw_snapshots (source, url, content_hash, payload) values ('w13e-e2e', $1, $2, '시험용 원문') returning id", [`https://example.test/w13e/${sid}`, hash])).rows[0].id;
  snapshotIds.push(snap);
  await db.query(
    `insert into public.chunks (doc_type, source_type, source_id, chunk_no, path, content, token_est, tax_items, valid_from, source_hash, index_version, content_hash, access_tier, rights_status, scope, snapshot_id)
     values ('tribunal', 'case_decision', $1, 0, '시험용심판원 > 제3조(시험용 제목)', $2, 20, array['acquisition'], '2020-01-01', 'h', 'chunk-v1', $3, 'public', 'confirmed', 'base', $4)`,
    [sid, `${sid} ${word} 시험용 본문입니다. 기준 수치는 12345원 입니다.`, hash, snap],
  );
  sources.push(sid);
}

before(async () => {
  sb = localSupabase();
  modelServer = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      modelHits += 1;
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer()));
    });
  });
  await new Promise((r) => modelServer.listen(0, "127.0.0.1", r));
  buildWeb();
  server = await startServer(serverEnv());
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  run = staff.run.toLowerCase().replace(/[^a-z0-9]/g, "");
  word = `코파일럿시험${run}`;
  saved = Object.fromEntries((await db.query("select key, value from public.settings where key = any($1::text[])", [KEYS])).rows.map((r) => [r.key, r.value]));
  u.entitled = await staff.createUser({ label: "w13e-entitled" });
  u.plain = await staff.createUser({ label: "w13e-plain" });
  await grant(u.entitled.id, "copilot");
  await insertDecision(1);
  await insertDecision(2);
  await setSetting("ask_budget", { monthly_won: 100000 });
  await setSetting("ask_pricing", { answer: { in: 1000, out: 5000, cachedIn: 100 }, utility: { in: 100, out: 500 } });
});

after(async () => {
  try {
    for (const k of KEYS) if (saved?.[k] !== undefined) await setSetting(k, saved[k]);
    // 색인 조각은 지울 수 없게 막혀 있어서(retired_at 규칙) 정리만 트리거를 끈 세션으로 한다
    await db.query("begin");
    await db.query("set local session_replication_role = replica");
    await db.query("delete from public.chunks where source_id = any($1::text[])", [sources]);
    await db.query("delete from public.raw_snapshots where id = any($1::bigint[])", [snapshotIds]);
    await db.query("commit");
    await db.query("delete from public.entitlements where source_ref like $1", [`e2e-w13e-${run}-%`]);
    await db.query("delete from public.copilot_runs where user_id = any($1::uuid[])", [[u.entitled.id, u.plain.id]]);
    await db.query("delete from public.copilot_usage where user_id = any($1::uuid[])", [[u.entitled.id, u.plain.id]]);
  } finally {
    await server?.stop?.();
    modelServer?.close();
    await staff?.cleanup?.();
  }
});

const two = () => ({ kind: "comparison", ids: sources });

test("a) 기능 키 꺼짐 / 공개 단계 none / 월 한도 빈 값이면 404이고 모델 호출 0", async () => {
  const before = modelHits;
  await setGate({ flag: false, stage: "4c", limit: 5 });
  assert.equal((await copilot(u.entitled, two())).status, 404, "기능 키 꺼짐");
  await setGate({ flag: true, stage: "none", limit: 5 });
  assert.equal((await copilot(u.entitled, two())).status, 404, "공개 단계 none");
  await setGate({ flag: true, stage: "4c", limit: {} });
  assert.equal((await copilot(u.entitled, two())).status, 404, "한도 빈 값");
  assert.equal(modelHits, before);
});

test("b) 4c에서 copilot 권한이 없는 회원은 403이고 모델 호출 0", async () => {
  const before = modelHits;
  await setGate({ flag: true, stage: "4c", limit: 5 });
  assert.equal((await copilot(u.plain, two())).status, 403);
  assert.equal((await copilot(null, two())).status, 404);
  assert.equal(modelHits, before);
});

test("c) 결정례 1건·9건은 422, 모델 호출 0", async () => {
  const before = modelHits;
  await setGate({ flag: true, stage: "4c", limit: 5 });
  assert.equal((await copilot(u.entitled, { kind: "comparison", ids: [sources[0]] })).status, 422);
  assert.equal((await copilot(u.entitled, { kind: "comparison", ids: Array.from({ length: 9 }, (_, i) => `x:${i}`) })).status, 422);
  assert.equal(modelHits, before);
});

test("d) 월 한도 1 - 첫 실행 문단+인용+실행 ID, 둘째 429, 기록에 글 칸 없음", async () => {
  await setGate({ flag: true, stage: "4c", limit: 1 });
  const first = await copilot(u.entitled, two());
  assert.equal(first.status, 200, first.text.slice(0, 200));
  assert.match(first.text, /event: paragraph/);
  assert.match(first.runId ?? "", /^[0-9a-f-]{36}$/);
  const second = await copilot(u.entitled, two());
  assert.equal(second.status, 429);
  assert.equal(second.json().code, "limit_reached");
  const runs = (await db.query("select * from public.copilot_runs where user_id = $1", [u.entitled.id])).rows;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, "answer");
  assert.deepEqual(Object.keys(runs[0]).filter((k) => /question|answer|body|text|message|note/.test(k)), [], "글 칸 없음");
  assert.ok(runs[0].citation_ids.length >= 1);
  assert.equal((await db.query("select runs from public.copilot_usage where user_id = $1", [u.entitled.id])).rows[0].runs, 1);
});

test("e) 요약 권리 확인된 출판물이 없으면 422이고 모델 호출 0", async () => {
  const before = modelHits;
  await setGate({ flag: true, stage: "4c", limit: 5 });
  const r = await copilot(u.entitled, { kind: "publications", ref: word });
  assert.equal(r.status, 422);
  assert.equal(r.json().error, "no_summarizable_publication");
  assert.equal(modelHits, before);
});

test("f) 서비스 함수는 anon·authenticated가 부를 수 없다", async () => {
  for (const [fn, args] of [["copilot_consume", { p_user: u.plain.id, p_limit: 99 }], ["copilot_summary_allowed", { p_source_ids: ["node:1"] }]]) {
    const res = await fetch(`${sb.url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: sb.anonKey, authorization: `Bearer ${u.plain.token}`, "content-type": "application/json" }, body: JSON.stringify(args) });
    assert.ok([401, 403, 404].includes(res.status), `${fn} ${res.status}`);
  }
});
