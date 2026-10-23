// W7b 수용 E2E (docs/dev/W7b_설계.md 1장 5단계 - PRD-01C CHAT-01 · 03~06 · 08~14 · 16, PRD_최종 §11.1 W7b "주입 방어·마스킹·예산·공개 게이트")
// standalone 빌드를 로컬 Supabase에 붙이고, Anthropic 주소(ANTHROPIC_BASE_URL)를 이 파일이 띄운 가짜 모델 서버로 돌린다 - 실제 API는 부르지 않는다.
// 질문·기사·응답은 전부 시험용 가짜다.
//  a) 꺼짐 기본값 - ASSISTANT_ENABLED 없음 → /api/assistant 404 · 화면에 런처 0
//  b) 공개 게이트 - 켜짐 + ASSISTANT_PUBLIC이어도 평가 통과·고지 승인 전에는 비내부 요청 404·런처 0, 직원(Bearer)만 / 통과 + 승인 뒤 일반 방문자에게 열림 + 런처(닫힘·data-nosnippet) / 나중 실행이 불통과면 다시 닫힘
//  c) 정상 답 - 인용 출처·AI 답변 표시(aiBadge)·기록은 마스킹본·모델 ID·프롬프트 버전·색인 금지 머리글
//  d) 마스킹 - 전화번호·주민번호가 가짜 모델 요청 본문과 DB 어디에도 없음
//  e) 하지 않음 - 취득세 얼마 → 금액 없는 고정 안내 · 가짜 모델 호출 0 · SM 계산기 링크 · aiBadge 없음
//  f) 요청 스키마 - 모르는 칸 400 · 쿼리가 붙은 경로는 맥락에서 빠짐 · 고지 버전 불일치 409
//  g) 장애·검증 실패 - 503 → 재시도 1회 뒤 검색 결과만(사유 error) · 세액 문장 → 재생성 1회 뒤 검색 결과만(사유 verify) · 오류 화면 0
//  h) 주입 - 모델이 허용 밖 주소를 써도 응답에 그 주소 0
//  i) 속도 제한 - 3/600 → 3번째 허용 · 4번째 429 + Retry-After
//  j) 예산 - 예산 이하면 모델 호출 0 + 검색 결과만(사유 budget)
//  k) 끝맺음 - feedback이 해결 시각을 남김 · 잘못된 종류 400
//  l) 금지 모델·모델 누락 - 직원도 404 (도우미 꺼짐)
//  m) 관리 현황 API - 관리자 200 · 편집자 403 · 비로그인 401
// 만든 계정·기사·도우미 기록은 끝나면 지운다 (평가 실행·고지 승인은 시작 상태로 되돌린다).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const SITE = "https://e2e.example.test";
const TITLE = "시험용 입문 기사 w7b";
const ADMIN_EMAIL = "admin-w7b-e2e@example.test";
const GOOD_REPORT = { decline_total: 30, decline_pass: 30, forbidden_url: 0, fabricated: 0, pii_leak: 0, injection_total: 30, injection_pass: 30, mask_total: 20, mask_leak: 0, graders: 2 };

let sb, staff, db, fake, main, tight, tiny, bad;
const u = {};
const sessions = [];
let usageSnapshot, noticeSnapshot;

// ── 가짜 모델 서버 ────────────────────────────────────────────
function startFake() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      const role = body.model === "e2e-router-1" ? "router" : "answer";
      calls.push({ role, body, raw, key: req.headers["x-api-key"] });
      const send = (status, json) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      };
      if (role === "router") return send(200, { content: [{ type: "text", text: '{"intent":"navigate"}' }], usage: { input_tokens: 20, output_tokens: 5 } });
      const user = body.messages?.[0]?.content ?? [];
      const results = user.filter((b) => b.type === "search_result");
      const question = user.filter((b) => b.type === "text").map((b) => b.text).join(" ");
      if (question.includes("FAKE_503")) return send(503, { error: "overloaded" });
      const source = results[0]?.source ?? "/none";
      const cite = [{ type: "search_result_location", source, title: results[0]?.title ?? "x", search_result_index: 0 }];
      let text = "관련 해설은 이 글에서 확인할 수 있습니다 라고 안내합니다.";
      if (question.includes("FAKE_BAD_TAX")) text = "이 경우 취득세는 3,000,000원입니다.";
      if (question.includes("FAKE_EVIL")) text = "참고 https://evil.example.com/x 라고 안내합니다. 관련 해설은 이 글에서 확인할 수 있습니다.";
      send(200, { content: [{ type: "text", text, citations: cite }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 } });
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ calls, url: `http://127.0.0.1:${server.address().port}`, stop: () => server.close(), answers: () => calls.filter((c) => c.role === "answer").length })),
  );
}

const baseEnv = () => ({
  NEXT_PUBLIC_SUPABASE_URL: sb.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
  NEXT_PUBLIC_SITE_URL: SITE,
  ANTHROPIC_API_KEY: "e2e-fake-key",
  ANTHROPIC_BASE_URL: fake.url,
  ANTHROPIC_MODEL_ANSWER: "e2e-answer-1",
  ANTHROPIC_MODEL_ROUTER: "e2e-router-1",
  ADMIN_EMAILS: ADMIN_EMAIL,
});
const enabledEnv = (over = {}) => ({ ...baseEnv(), ASSISTANT_ENABLED: "on", ASSISTANT_PUBLIC: "on", ASSISTANT_RATE_LIMIT: "100/600", ...over });

async function ask(server, body, user) {
  const headers = { "content-type": "application/json" };
  if (user) headers.authorization = `Bearer ${user.token}`;
  const res = await fetch(`${server.base}/api/assistant`, { method: "POST", headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (json.sessionId) sessions.push(json.sessionId);
  return { status: res.status, headers: res.headers, body: json };
}
const q = async (server, message, extra = {}, user = u.editor) => ask(server, { message, noticeVersion: await noticeVersion(), ...extra }, user);
let cachedVersion;
async function noticeVersion() {
  cachedVersion ??= (await db.query("select value->>'version' v from public.settings where key = 'assistant_notice'")).rows[0].v;
  return cachedVersion;
}
const html = async (server, path) => (await fetch(`${server.base}${path}`)).text();
const launcher = (page) => /data-ui="assistant-launcher"/.test(page);
const msgRow = async (session) => (await db.query("select * from public.assistant_messages where session_id = $1 order by turn desc limit 1", [session])).rows[0];

async function purge() {
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    if (sessions.length) await db.query("delete from public.assistant_sessions where id = any($1::uuid[])", [sessions]);
    await db.query("delete from public.assistant_eval_runs where item_set_version = 'e2e-w7b'");
    await db.query("delete from public.prompt_versions where created_by = 'server' and id not in (select prompt_version_id from public.assistant_messages)");
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

before(async () => {
  sb = localSupabase();
  buildWeb();
  fake = await startFake();
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  u.admin = await staff.createUser({ label: "w7b-admin", email: ADMIN_EMAIL });
  u.editor = await staff.createUser({ label: "w7b-editor", roles: ["editor"], person: { name: "도우미 시험 편집자", roles: ["editor"] } });
  await staff.makeIntroArticle("w7b");
  usageSnapshot = (await db.query("select * from public.assistant_usage_daily where day = public.assistant_kst_day()")).rows[0] ?? null;
  noticeSnapshot = (await db.query("select value from public.settings where key = 'assistant_notice'")).rows[0].value;
  // 시작 상태 - 고지 미승인 · 평가 실행 없음
  await db.query("update public.settings set value = value || '{\"approved\": false}'::jsonb where key = 'assistant_notice'");
  main = await startServer(enabledEnv());
});

after(async () => {
  for (const s of [main, tight, tiny, bad]) s?.stop();
  fake?.stop();
  try {
    await purge();
    await db?.query("update public.settings set value = $1::jsonb where key = 'assistant_notice'", [JSON.stringify(noticeSnapshot)]);
    await db?.query("delete from public.assistant_usage_daily where day = public.assistant_kst_day()");
    if (usageSnapshot) {
      const k = Object.keys(usageSnapshot);
      await db.query(`insert into public.assistant_usage_daily (${k.join(", ")}) values (${k.map((_, i) => `$${i + 1}`).join(", ")})`, k.map((c) => usageSnapshot[c]));
    }
  } finally {
    await staff?.cleanup();
  }
});

test("a) 꺼짐 기본값 - ASSISTANT_ENABLED 없음이면 API 404 · 런처 0", async () => {
  const off = await startServer(baseEnv());
  try {
    const res = await fetch(`${off.base}/api/assistant`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "안녕", noticeVersion: "x" }) });
    assert.equal(res.status, 404);
    assert.equal(launcher(await (await fetch(`${off.base}/`)).text()), false);
    assert.equal(fake.calls.length, 0, "모델 호출 0");
  } finally {
    off.stop();
  }
});

test("b) 공개 게이트 - 평가 통과 + 고지 승인 전에는 직원만, 뒤에는 일반 방문자에게 열림, 나중 실행이 불통과면 다시 닫힘", async () => {
  const anon = await ask(main, { message: TITLE, noticeVersion: await noticeVersion() });
  assert.equal(anon.status, 404, "비내부 요청 404");
  assert.equal(launcher(await html(main, "/")), false, "비내부 방문자 런처 0");
  const staffReply = await q(main, TITLE);
  assert.equal(staffReply.status, 200, JSON.stringify(staffReply.body).slice(0, 300));

  await db.query("insert into public.assistant_eval_runs (model_answer, model_router, item_set_version, report, gate_passed) values ('e2e-answer-1', 'e2e-router-1', 'e2e-w7b', $1::jsonb, true)", [JSON.stringify(GOOD_REPORT)]);
  assert.equal((await ask(main, { message: TITLE, noticeVersion: await noticeVersion() })).status, 404, "고지 미승인이면 통과해도 닫힘");
  await db.query("update public.settings set value = value || '{\"approved\": true}'::jsonb where key = 'assistant_notice'");
  const open = await ask(main, { message: TITLE, noticeVersion: await noticeVersion() });
  assert.equal(open.status, 200);
  const page = await html(main, "/");
  assert.equal(launcher(page), true, "공개 뒤 런처 1");
  assert.match(page, /data-ui="assistant-launcher"[^>]*aria-expanded="false"|aria-expanded="false"[^>]*data-ui="assistant-launcher"/);
  assert.match(page, /data-nosnippet/);
  assert.equal(launcher(await html(main, "/admin")), false, "관리 화면에는 런처 0");

  await db.query("insert into public.assistant_eval_runs (model_answer, model_router, item_set_version, report, gate_passed) values ('e2e-answer-1', 'e2e-router-1', 'e2e-w7b', $1::jsonb, false)", [JSON.stringify({ ...GOOD_REPORT, decline_pass: 28 })]);
  assert.equal((await ask(main, { message: TITLE, noticeVersion: await noticeVersion() })).status, 404, "회귀 실행이 불통과면 다시 닫힘");
  assert.equal(launcher(await html(main, "/")), false);
  // 이후 시험은 열린 상태에서 - 통과 실행을 하나 더 넣는다
  await db.query("insert into public.assistant_eval_runs (model_answer, model_router, item_set_version, report, gate_passed) values ('e2e-answer-1', 'e2e-router-1', 'e2e-w7b', $1::jsonb, true)", [JSON.stringify(GOOD_REPORT)]);
});

test("c) 정상 답 - 출처 링크 · AI 답변 표시 · 마스킹본 기록 · 모델 ID · 프롬프트 버전 · 색인 금지", async () => {
  const before = fake.answers();
  const r = await q(main, TITLE, { context: { path: "/news", title: "시험", field: "tax" } });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  assert.equal(r.body.mode, "ai");
  assert.equal(r.body.aiBadge, true);
  assert.ok(r.body.paragraphs.length >= 1);
  assert.ok(r.body.sources.length >= 1 && r.body.sources.every((s) => s.href.startsWith("/")), "출처는 사이트 안 주소");
  assert.equal(fake.answers() - before, 1);
  assert.match(r.headers.get("x-robots-tag") ?? "", /noindex/);
  assert.match(r.headers.get("cache-control") ?? "", /no-store/);
  const row = await msgRow(r.body.sessionId);
  assert.equal(row.model, "e2e-answer-1");
  assert.ok(Number(row.prompt_version_id) > 0);
  assert.equal(row.mode, "ai");
  assert.ok(row.citation_urls.length >= 1);
  assert.equal(row.tokens_in, 120);
  assert.equal(row.tokens_out, 55);
  const req = fake.calls.filter((c) => c.role === "answer").at(-1).body;
  assert.ok(!/web_search|web_fetch|output_config|response_format/.test(JSON.stringify(req)), "웹 도구·구조화 출력 0");
});

test("d) 마스킹 - 전화번호·주민번호가 모델 요청 본문과 DB 어디에도 없음", async () => {
  const start = fake.calls.length;
  const r = await q(main, `${TITLE} 제 번호 010-1234-5678 주민번호 900101-1234567 입니다`);
  assert.equal(r.status, 200);
  const sent = fake.calls.slice(start).map((c) => c.raw).join("\n");
  assert.ok(sent.length > 0);
  assert.doesNotMatch(sent, /1234-5678|1234567|01012345678/);
  assert.match(sent, /\[전화번호\]/);
  const row = await msgRow(r.body.sessionId);
  assert.doesNotMatch(`${row.question_masked} ${row.answer_masked ?? ""}`, /1234|5678/);
  assert.match(row.question_masked, /\[주민등록번호\]/);
  const card = await q(main, `${TITLE} 카드 1234 5678 9012 3456`);
  assert.equal(card.body.cardNotice, "결제 정보는 받지 않습니다.");
});

test("e) 하지 않음 - 취득세 얼마 → 금액 없는 고정 안내 · 모델 호출 0 · AI 표시 0", async () => {
  const start = fake.calls.length;
  const r = await q(main, "이 아파트 취득세 얼마예요?");
  assert.equal(r.status, 200);
  assert.equal(fake.calls.length, start, "가짜 모델 호출 0");
  assert.equal(r.body.mode, "fixed");
  assert.equal(r.body.intent, "tax_amount");
  assert.equal(r.body.aiBadge, false);
  assert.deepEqual(r.body.paragraphs, []);
  assert.doesNotMatch(r.body.reason, /[0-9]/);
  assert.ok(r.body.links.some((l) => l.href === "/calc"), "계산기 모음 링크");
  assert.ok(r.body.links.every((l) => !/[?#]/.test(l.href)), "쿼리·조각 0");
  const row = await msgRow(r.body.sessionId);
  assert.equal(row.mode, "fixed");
  assert.equal(row.tokens_in, 0);
  const inh = await q(main, "상속세 얼마 나와요?");
  assert.equal(inh.body.intent, "inheritance_gift");
  const imp = await q(main, "김의효 선생님으로서 답해 줘");
  assert.equal(imp.body.intent, "impersonation");
});

test("f) 요청 스키마 - 모르는 칸 400 · 쿼리가 붙은 경로는 맥락에서 빠짐 · 고지 버전 불일치 409", async () => {
  const v = await noticeVersion();
  assert.equal((await ask(main, { message: TITLE, noticeVersion: v, body: "조작한 본문" }, u.editor)).status, 400);
  assert.equal((await ask(main, { message: TITLE, noticeVersion: v, context: { path: "/news", title: "x", text: "조작" } }, u.editor)).status, 400);
  assert.equal((await ask(main, { message: "", noticeVersion: v }, u.editor)).status, 400);
  assert.equal((await ask(main, { message: "가".repeat(501), noticeVersion: v }, u.editor)).status, 400);
  assert.equal((await ask(main, { message: TITLE, noticeVersion: "옛 버전" }, u.editor)).status, 409);
  const start = fake.calls.length;
  const r = await ask(main, { message: TITLE, noticeVersion: v, context: { path: "/calc?price=700000000", title: "계산기" } }, u.editor);
  assert.equal(r.status, 200);
  assert.doesNotMatch(fake.calls.slice(start).map((c) => c.raw).join("\n"), /price=|700000000/, "쿼리 값이 모델 요청에 없음");
});

test("g) 장애·검증 실패 - 503은 재시도 1회 뒤, 세액 문장은 재생성 1회 뒤 검색 결과만 (오류 화면 0)", async () => {
  let start = fake.answers();
  const down = await q(main, TITLE, { context: { path: "/news", title: "FAKE_503" } });
  assert.equal(down.status, 200);
  assert.equal(down.body.mode, "search_only");
  assert.equal(down.body.aiBadge, false);
  assert.equal(fake.answers() - start, 2, "재시도 1회");
  assert.equal((await msgRow(down.body.sessionId)).fallback_reason, "error");

  start = fake.answers();
  const tax = await q(main, TITLE, { context: { path: "/news", title: "FAKE_BAD_TAX" } });
  assert.equal(tax.body.mode, "search_only");
  assert.deepEqual(tax.body.paragraphs, []);
  assert.equal(fake.answers() - start, 2, "재생성 1회");
  assert.equal((await msgRow(tax.body.sessionId)).fallback_reason, "verify");
});

test("h) 주입 - 모델이 허용 밖 주소를 써도 응답에 0", async () => {
  const r = await q(main, TITLE, { context: { path: "/news", title: "FAKE_EVIL" } });
  assert.equal(r.status, 200);
  assert.doesNotMatch(JSON.stringify(r.body), /evil\.example\.com/);
  assert.equal(r.body.mode, "ai");
});

test("i) 속도 제한 - 3/600 → 3번째 허용 · 4번째 429 + Retry-After", async () => {
  tight = await startServer(enabledEnv({ ASSISTANT_RATE_LIMIT: "3/600" }));
  const codes = [];
  let last;
  for (let i = 0; i < 4; i++) {
    last = await q(tight, "이 아파트 취득세 얼마예요?", {}, u.editor);
    codes.push(last.status);
  }
  assert.deepEqual(codes, [200, 200, 200, 429]);
  assert.ok(Number(last.headers.get("retry-after")) >= 1);
  assert.equal(last.body.mode, "rate_limited");
  assert.equal((await msgRow(last.body.sessionId)).fallback_reason, "rate");
});

test("j) 예산 - 예산을 넘으면 모델 호출 0 + 검색 결과만 (사유 budget)", async () => {
  tiny = await startServer(enabledEnv({ ASSISTANT_DAILY_TOKEN_BUDGET: "1" }));
  const start = fake.calls.length;
  const r = await q(tiny, TITLE);
  assert.equal(r.status, 200);
  assert.equal(r.body.mode, "search_only");
  assert.equal(r.body.aiBadge, false);
  assert.equal(fake.calls.length, start);
  assert.equal((await msgRow(r.body.sessionId)).fallback_reason, "budget");
});

test("k) 끝맺음 - 도움됨이 해결 시각을 남김 · 잘못된 종류·모르는 칸 400", async () => {
  const r = await q(main, TITLE);
  const post = (body) => fetch(`${main.base}/api/assistant/feedback`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${u.editor.token}` }, body: JSON.stringify(body) });
  assert.equal((await post({ sessionId: r.body.sessionId, kind: "helpful" })).status, 200);
  assert.ok((await db.query("select resolved_at from public.assistant_sessions where id = $1", [r.body.sessionId])).rows[0].resolved_at);
  assert.equal((await post({ sessionId: r.body.sessionId, kind: "엉터리" })).status, 400);
  assert.equal((await post({ sessionId: r.body.sessionId, kind: "helpful", text: "원문" })).status, 400);
});

test("l) 금지 모델·모델 누락 - 직원도 404 (도우미 꺼짐)", async () => {
  bad = await startServer(enabledEnv({ ANTHROPIC_MODEL_ANSWER: "e2e-fable-9" }));
  assert.equal((await q(bad, TITLE)).status, 404);
  assert.equal(launcher(await html(bad, "/")), false);
  assert.match(bad.log(), /model_forbidden/);
  bad.stop();
  bad = await startServer(enabledEnv({ ANTHROPIC_MODEL_ROUTER: "" }));
  assert.equal((await q(bad, TITLE)).status, 404);
});

test("m) 관리 현황 API - 관리자 200 · 편집자 403(측정 지표는 관리자만) · 비로그인 401", async () => {
  const denied = await fetch(`${main.base}/api/admin/assistant`, { headers: { authorization: `Bearer ${u.editor.token}` } });
  assert.equal(denied.status, 403);
  const ok = await fetch(`${main.base}/api/admin/assistant`, { headers: { authorization: `Bearer ${u.admin.token}` } });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.config.enabled, true);
  assert.ok("last_30_days" in body && Array.isArray(body.eval_runs));
  assert.equal(JSON.stringify(body).includes("question"), false, "질문 원문 칸 0");
  assert.equal((await fetch(`${main.base}/api/admin/assistant`)).status, 401);
});
