// W12-b 수용 E2E - 지방세봇 코어 (docs/dev/W12-b_설계.md - PRD-04 ASK-01 · ASK-04 · ASK-15 · ASK-20 · 6.13)
// standalone 빌드를 로컬 Supabase에 붙인다. 모델은 가짜 HTTP 서버(호출 횟수만 센다)이고, 글은 전부 시험용이다. 실제 모델·네트워크 0.
//  a) 게이트 전 - 기능 키 꺼짐 · 공개 단계 none이면 /api/ask 404 (모델 서버 호출 0)
//  b) 게이트를 임시로 열면(트리거를 끈 세션으로 설정 값만 바꾸고 끝나면 되돌림) SSE로 응답한다 - 첫 status 1초 이내 · 표준 SSE 머리글 · 이벤트 순서
//     예산·단가가 비면 모델 호출 0 + 근거 목록(검색 모드) / 예산이 있으면 근거가 없어 근거 부족 응답 / 투자 추천은 범위 안내 / 모델 서버 호출 0
//  c) 기록 - 턴마다 agent_messages·agent_validations가 쓰이고 질문 원문 칸이 없으며, anon 키로 기록 표를 읽을 수 없다
//  d) 경계 - AI 코드가 상속·증여 엔진·AI SDK를 불러오지 않고 모델 ID가 코드에 없다
// 만든 행은 끝나면 지우고, 바꾼 설정은 원래 값으로 되돌린다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e-w12b.example.test";
const GUARD = "e2e-w12b-guard-secret";
const ROOT = path.resolve(import.meta.dirname, "..");
const KEYS = ["feature_flags", "ask_rollout", "ask_budget", "ask_pricing"];

let sb, server, staff, db, base, modelServer, modelHits, saved;
const sessions = [];

async function setSetting(key, value) {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica"); // 공개 단계는 승인 RPC만 바꾸게 막혀 있다 - 시험에서만 트리거를 끈다
    await db.query("update public.settings set value = $1::jsonb where key = $2", [JSON.stringify(value), key]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}
const ask = (body) => fetch(`${base}/api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function readSse(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const started = Date.now();
  let firstAt = null;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstAt === null) firstAt = Date.now() - started;
    text += dec.decode(value, { stream: true });
  }
  const events = text.split("\n\n").filter(Boolean).map((b) => ({ event: /^event: (.+)$/m.exec(b)?.[1], data: JSON.parse(/^data: (.+)$/m.exec(b)?.[1] ?? "{}") }));
  return { events, firstAt, text };
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
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    NEXT_PUBLIC_SITE_URL: SITE,
    GUARD_SECRET: GUARD,
    AGENT_MODEL_ANSWER: "e2e-model-a",
    ANTHROPIC_API_KEY: "e2e-not-a-real-key",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${modelServer.address().port}`,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  saved = Object.fromEntries((await db.query("select key, value from public.settings where key = any($1::text[])", [KEYS])).rows.map((r) => [r.key, r.value]));
});

after(async () => {
  try {
    for (const k of KEYS) if (saved?.[k] !== undefined) await setSetting(k, saved[k]);
    if (sessions.length) {
      await db.query("begin");
      await db.query("set local session_replication_role = replica");
      await db.query("delete from public.agent_sessions where id = any($1::uuid[])", [sessions]);
      await db.query("commit");
    }
  } finally {
    await staff?.cleanup();
    await server?.stop();
    await new Promise((r) => modelServer?.close(r));
  }
});

test("a) 기능 키 꺼짐 · 공개 단계 none이면 /api/ask는 404이고 모델 서버를 부르지 않는다", async () => {
  const closed = await ask({ message: "시험용 질문" });
  assert.equal(closed.status, 404);
  // 기능 키만 켜도 공개 단계가 none이면 계속 404
  await setSetting("feature_flags", { ...saved.feature_flags, taxbot: true });
  assert.equal((await ask({ message: "시험용 질문" })).status, 404);
  assert.equal(modelHits, 0);
});

test("b) 게이트를 열면 SSE로 응답한다 - 첫 status 1초 이내, 표준 머리글, 예산 미설정이면 모델 호출 0 + 근거 목록", async () => {
  await setSetting("ask_rollout", { stage: "4c" });
  const sessionId = crypto.randomUUID();
  sessions.push(sessionId);
  const res = await ask({ message: "시험용 취득세 질문입니다", sessionId });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/event-stream/);
  assert.equal(res.headers.get("x-accel-buffering"), "no");
  assert.match(res.headers.get("cache-control"), /no-store/);
  const { events, firstAt } = await readSse(res);
  assert.ok(firstAt !== null && firstAt <= 1000, `첫 이벤트 ${firstAt}ms`);
  assert.equal(events[0].event, "status");
  assert.equal(events[0].data.phase, "searching");
  assert.equal(events.at(-1).event, "done");
  const fb = events.find((e) => e.event === "fallback");
  assert.equal(fb.data.reason, "budget");
  assert.equal(fb.data.kind, "evidence_list");
  assert.deepEqual(fb.data.peopleButtons, { find: true, request: true });
  assert.equal(events.some((e) => e.event === "paragraph"), false, "지어낸 문단 0");
  assert.equal(modelHits, 0);
});

test("b2) 예산·단가가 있어도 근거가 없으면 모델 호출 없이 근거 부족 응답", async () => {
  await setSetting("ask_budget", { monthly_won: 100000 });
  await setSetting("ask_pricing", { answer: { in: 1000, out: 5000 } });
  const sessionId = crypto.randomUUID();
  sessions.push(sessionId);
  const { events } = await readSse(await ask({ message: "시험용엔없는질문 ".repeat(3), sessionId }));
  const fb = events.find((e) => e.event === "fallback");
  assert.equal(fb.data.reason, "no_evidence");
  assert.equal(modelHits, 0);
});

test("b3) 투자 추천은 범위 안내로 끝나고 모델·검색을 부르지 않는다 (ASK-20)", async () => {
  const sessionId = crypto.randomUUID();
  sessions.push(sessionId);
  const { events } = await readSse(await ask({ message: "시험구역 추천해 주세요", sessionId }));
  const fb = events.find((e) => e.event === "fallback");
  assert.deepEqual([fb.data.reason, fb.data.kind], ["scope", "scope_guide"]);
  assert.equal(events.some((e) => e.event === "paragraph"), false);
  assert.equal(modelHits, 0);
});

test("b4) 잘못된 요청은 400, 너무 긴 본문은 413", async () => {
  assert.equal((await ask({ message: "q", calcInput: {} })).status, 400);
  assert.equal((await ask({ message: "" })).status, 400);
  const big = await fetch(`${base}/api/ask`, { method: "POST", body: "x".repeat(9000) });
  assert.equal(big.status, 413);
});

test("c) 턴마다 기록이 쓰이고(질문 원문 칸 없음), anon 키로는 기록 표를 읽을 수 없다", async () => {
  const id = sessions[0];
  const msgs = (await db.query("select m.kind, m.fallback_reason, m.question_masked, v.v1 from public.agent_messages m join public.agent_validations v on v.message_id = m.id where m.session_id = $1", [id])).rows;
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].kind, "fallback");
  assert.equal(msgs[0].fallback_reason, "budget");
  assert.equal(msgs[0].question_masked, "시험용 취득세 질문입니다");
  for (const t of ["agent_messages", "agent_sessions", "agent_citations", "agent_validations"]) {
    const r = await fetch(`${sb.url}/rest/v1/${t}?select=*`, { headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}` } });
    assert.ok([401, 403, 404].includes(r.status) || (r.status === 200 && (await r.json()).length === 0), `${t} ${r.status}`);
  }
});

test("d) AI 코드는 상속·증여 엔진·AI SDK를 불러오지 않고 모델 ID가 코드에 없다", () => {
  for (const dir of ["apps/web/lib/agent", "apps/web/lib/server/agent"]) {
    for (const f of fs.readdirSync(path.join(ROOT, dir)).filter((n) => /\.tsx?$/.test(n) && !/\.test\./.test(n))) {
      const src = fs.readFileSync(path.join(ROOT, dir, f), "utf8");
      assert.doesNotMatch(src, new RegExp(["igt", "engine"].join("-") + "|@anthropic-ai/sdk"), f);
      assert.doesNotMatch(src, /claude-(opus|sonnet|haiku)-\d/i, `${f} 모델 ID 하드코딩`);
    }
  }
});
