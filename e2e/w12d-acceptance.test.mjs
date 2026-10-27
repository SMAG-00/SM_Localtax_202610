// W12-d 수용 E2E - 도우미 창 모드 전환·진입점·한도·기록·고지 (docs/dev/W12-d_설계.md, PRD-04 CHAT-15 · HOME-10 · ASK-10~13 · COMPLY-01~03)
//  a) 모드 고지 미승인이면 모드 탭·진입점 렌더 0 · /api/ask·피드백 404
//  b) 열면 /search 진입점이 렌더되고 진입(화면 열기)만으로 하루 한도 차감 0
//  c) 비회원 3번째 질문까지 허용 · 4번째는 가입 안내(429) · 화면 문구에 '무제한' 0
//  d) 질문형 검색어로 /search를 열어도 모델 서버 호출 0
//  e) 피드백 저장 · 사유 목록 밖 거부
//  f) 저장 끔 세션은 글 칸 0 · 파기 함수는 정각 경계에서 비운다
// 모델 서버는 500만 돌려주는 가짜다 (모델 호출은 0이거나 장애 폴백). 글은 시험용이다. 실행은 리드가 db-e2e.sh로 한다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e-w12d.example.test";
const KEYS = ["feature_flags", "ask_rollout", "ask_budget", "ask_pricing", "ask_mode_notice", "ask_mode_targets", "ask_limits"];
const ip = (n) => `10.12.4.${n}`;

let sb, server, staff, db, base, modelServer, modelHits, saved;
const sessions = [];

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
const ask = (body, n) => fetch(`${base}/api/ask`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip(n) }, body: JSON.stringify(body) });
const drain = async (res) => (res.body ? await res.text() : "");
const page = async (p) => (await fetch(`${base}${p}`)).text();

async function startAll() {
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    NEXT_PUBLIC_SITE_URL: SITE,
    GUARD_SECRET: "e2e-w12d-guard-secret",
    AGENT_MODEL_ANSWER: "e2e-model-a",
    ANTHROPIC_API_KEY: "e2e-not-a-real-key",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${modelServer.address().port}`,
  });
  base = server.base;
}
/** 공개 설정 캐시(30초)를 새로 시작하려고 서버를 다시 띄운다 */
async function restart() {
  await server?.stop?.();
  await startAll();
}

before(async () => {
  sb = localSupabase();
  modelHits = 0;
  modelServer = http.createServer((_req, res) => {
    modelHits += 1;
    res.writeHead(500).end("{}");
  });
  await new Promise((r) => modelServer.listen(0, "127.0.0.1", r));
  buildWeb();
  await startAll();
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  saved = Object.fromEntries((await db.query("select key, value from public.settings where key = any($1::text[])", [KEYS])).rows.map((r) => [r.key, r.value]));
});

after(async () => {
  try {
    for (const k of KEYS) if (saved?.[k] !== undefined) await setSetting(k, saved[k]);
    await db.query("begin");
    await db.query("set local session_replication_role = replica");
    if (sessions.length) await db.query("delete from public.agent_sessions where id = any($1::uuid[])", [sessions]);
    await db.query("delete from public.agent_quota_daily where subject like 'g:%'");
    await db.query("commit");
  } finally {
    await staff?.cleanup();
    await server?.stop();
    await new Promise((r) => modelServer?.close(r));
  }
});

async function openGate() {
  await setSetting("feature_flags", { ...saved.feature_flags, taxbot: true, search: true });
  await setSetting("ask_rollout", { stage: "4c" });
  await setSetting("ask_budget", { monthly_won: 100000 });
  await setSetting("ask_mode_notice", { approved: true, version: "e2e-w12d", mode_notice: "시험용 모드 고지", answer_footer: "시험용 하단 고지", privacy_paragraph: "" });
  await setSetting("ask_mode_targets", { guest: true, member: true });
  await restart();
}

test("a) 모드 고지가 승인되지 않으면 진입점·모드 탭 렌더 0, /api/ask·피드백은 404", async () => {
  await setSetting("feature_flags", { ...saved.feature_flags, taxbot: true, search: true });
  await setSetting("ask_rollout", { stage: "4c" });
  await setSetting("ask_mode_targets", { guest: true, member: true });
  await restart();
  const search = await page("/search?q=%EC%B7%A8%EB%93%9D%EC%84%B8");
  assert.doesNotMatch(search, /data-agent-entry/);
  assert.equal((await ask({ message: "시험용 질문" }, 1)).status, 404);
  const fb = await fetch(`${base}/api/ask/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: crypto.randomUUID(), turn: 1, kind: "helpful" }) });
  assert.equal(fb.status, 404);
  assert.equal(modelHits, 0);
});

test("b) 열면 /search 진입점이 렌더되고, 화면을 열기만 해서는 한도가 차감되지 않는다", async () => {
  await openGate();
  const before = (await db.query("select coalesce(sum(used),0)::int as n from public.agent_quota_daily")).rows[0].n;
  const html = await page("/search?q=%EC%B7%A8%EB%93%9D%EC%84%B8");
  assert.match(html, /data-agent-entry="search_results"/);
  assert.equal((await db.query("select coalesce(sum(used),0)::int as n from public.agent_quota_daily")).rows[0].n, before);
});

test("c) 비회원 3번째 질문까지 허용, 4번째는 가입 안내(429). 화면에 '무제한'이 없다", async () => {
  await openGate();
  const sid = crypto.randomUUID();
  sessions.push(sid);
  const codes = [];
  for (let i = 0; i < 4; i++) {
    const res = await ask({ message: `시험용 질문 ${i + 1}`, sessionId: sid }, 20);
    codes.push(res.status);
    if (res.status === 429) {
      const body = JSON.parse(await res.text());
      assert.equal(body.code, "limit");
      assert.equal(body.next, "signup");
    } else await drain(res);
  }
  assert.deepEqual(codes, [200, 200, 200, 429]);
  const html = await page("/search?q=%EC%B7%A8%EB%93%9D%EC%84%B8");
  assert.doesNotMatch(html, /무제한/);
});

test("d) 질문형 검색어로 검색 결과를 열어도 모델 서버 호출은 0", async () => {
  await openGate();
  const before = modelHits;
  const html = await page(`/search?q=${encodeURIComponent("아파트 7억에 사면 취득세?")}`);
  assert.match(html, /data-agent-entry="search_results"/, "진입점 카드는 있으나 자동 전송은 없다");
  assert.equal(modelHits, before);
});

test("e) 피드백 저장 · 사유 목록 밖 거부", async () => {
  await openGate();
  const sid = crypto.randomUUID();
  sessions.push(sid);
  await drain(await ask({ message: "시험용 피드백 질문", sessionId: sid }, 30));
  const send = (b) => fetch(`${base}/api/ask/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: sid, ...b }) });
  assert.equal((await send({ turn: 1, kind: "not_helpful", reason: "wrong" })).status, 200);
  assert.equal((await send({ turn: 1, kind: "not_helpful", reason: "임의" })).status, 400);
  const row = (await db.query("select kind, reason, status from public.agent_feedback where session_id = $1", [sid])).rows;
  assert.deepEqual(row, [{ kind: "not_helpful", reason: "wrong", status: "received" }]);
});

test("f) 저장 끔 세션은 글 칸 0, 파기 함수는 기한 정각에 글을 비운다", async () => {
  await openGate();
  const off = crypto.randomUUID();
  const on = crypto.randomUUID();
  sessions.push(off, on);
  await drain(await ask({ message: "시험용 저장 끔 질문", sessionId: off, saveOff: true }, 40));
  await drain(await ask({ message: "시험용 저장 질문", sessionId: on }, 41));
  const text = async (s) => (await db.query("select count(*)::int as n from public.agent_messages where session_id = $1 and question_masked is not null", [s])).rows[0].n;
  assert.equal(await text(off), 0);
  assert.equal(await text(on), 1);
  await db.query("update public.agent_sessions set retain_until = '2026-11-01T00:00:00Z' where id = $1", [on]);
  await db.query("select public.agent_purge('2026-10-31T23:59:59Z')");
  assert.equal(await text(on), 1, "기한 1초 전은 유지");
  await db.query("select public.agent_purge('2026-11-01T00:00:00Z')");
  assert.equal(await text(on), 0, "정각은 만료");
});
