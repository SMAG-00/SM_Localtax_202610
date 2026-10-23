// W7b DB — AI 도우미 (docs/dev/W7b_설계.md 1장 1단계 · 2장, 마이그레이션 20261024000070 · PRD-01C CHAT-03 · 08 · 09 · 10 · 11 · 12 · 13 · 14)
//  · 씨앗 — 설정 2개(고지 미승인·단가 0) · 표 행 0 · 공개 준비 false
//  · 기록 — 질문 원문 칸 없음 · 숫자 9자리 이상/이메일 모양 저장 거부 · 모델·프롬프트 버전 필수 · 폴백 사유와 모드 일치
//  · 권한 — anon·assistant_reader는 표 직접 읽기/쓰기 거부, 배치·집계 함수 실행 거부 (CHAT-03 · CHAT-11)
//  · 속도 — n번째 허용, n+1 차단, 키 독립, 키 모양 검사 (CHAT-10)
//  · 예산 — 일일 사용량 누적 · 런타임 오늘 토큰 · 폴백 사유별 건수 (CHAT-10)
//  · 보관 — retain_until 기준 파기(경계 · 7일 설정 · 멱등) (CHAT-09)
//  · 프롬프트 — 같은 본문 한 줄 · 평가 실행 없이 active 거부 (CHAT-12)
//  · 평가 — 통과 기록은 리포트 기준을 채울 때만 · 공개 준비는 통과 + 고지 승인 · 대화 출처 문항은 익명화 검토 (CHAT-09 · CHAT-14)
//  · 측정 — 해결률 6/10 · 비용 합계 (CHAT-13)
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0). 내용은 시험용 가짜다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

async function attempt(sql, params = []) {
  await client.query("savepoint t");
  try {
    const res = await client.query(sql, params);
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, message: err.message, code: err.code };
  }
}
async function tx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const all = async (sql, params) => (await client.query(sql, params)).rows;
/** 역할을 바꿔 한 문장을 시도한다 (savepoint 안, 끝나면 원래 역할로) */
async function asRole(role, sql, params = []) {
  await client.query("savepoint r");
  try {
    await client.query(`set local role ${role}`);
    const res = await client.query(sql, params);
    await client.query("reset role");
    await client.query("release savepoint r");
    return { ok: true, rows: res.rows };
  } catch (err) {
    await client.query("rollback to savepoint r");
    // 역할 전환 자체가 막힌 것을 '권한 거부'로 착각하지 않는다
    assert.ok(!/set role/i.test(err.message), `역할 전환 실패: ${err.message}`);
    return { ok: false, message: err.message, code: err.code };
  }
}

async function promptId(suffix = "") {
  return (await one("select public.assistant_register_prompt('answer', 'v-test', $1) as id", [`시험용 지시문 ${suffix || randomUUID()}`])).id;
}
const turn = (over = {}) => ({
  session_id: randomUUID(),
  question_masked: "감면 해설 어디 있어요",
  answer_masked: "관련 글을 안내합니다",
  intent: "navigate",
  mode: "ai",
  model: "test-answer-1",
  router_model: "test-router-1",
  retention_days: 30,
  tokens_in: 100,
  tokens_out: 50,
  cost: 0.5,
  ...over,
});
const record = async (over) => (await one("select public.assistant_record_turn($1::jsonb) as id", [JSON.stringify(turn(over))])).id;
const tryRecord = (over) => attempt("select public.assistant_record_turn($1::jsonb) as id", [JSON.stringify(turn(over))]);
const goodReport = { decline_total: 30, decline_pass: 30, forbidden_url: 0, fabricated: 0, pii_leak: 0, injection_total: 30, injection_pass: 30, mask_total: 20, mask_leak: 0, graders: 2 };

test("씨앗 — 설정 2개(고지 미승인·단가 0), 표 행 0, 공개 준비 false", () =>
  tx(async () => {
    const notice = (await one("select value from public.settings where key = 'assistant_notice'")).value;
    assert.equal(notice.approved, false);
    assert.equal(notice.first_use.length, 5);
    const pricing = (await one("select value from public.settings where key = 'assistant_pricing'")).value;
    assert.deepEqual(pricing, { answer: { in: 0, out: 0 }, router: { in: 0, out: 0 } });
    for (const t of ["assistant_eval_items", "assistant_eval_runs", "assistant_eval_grades"]) {
      assert.equal((await one(`select count(*)::int as n from public.${t}`)).n, 0, `${t} 씨앗 0행`);
    }
    const rt = (await one("select public.assistant_runtime() as r")).r;
    assert.equal(rt.public_ready, false);
    assert.equal(rt.notice.approved, false);
  }));

test("기록 표에 질문 원문 칸이 없다 — 마스킹본 칸만 (CHAT-09)", async () => {
  const cols = (await all("select column_name from information_schema.columns where table_schema = 'public' and table_name in ('assistant_messages', 'assistant_sessions')")).map((r) => r.column_name);
  assert.ok(cols.includes("question_masked") && cols.includes("answer_masked"));
  assert.deepEqual(cols.filter((c) => /(^|_)(raw|original|ip|email|phone|user_id)(_|$)/.test(c)), []);
});

test("기록 — 정상 한 턴, 모델·프롬프트 버전이 남는다", () =>
  tx(async () => {
    const pv = await promptId();
    const id = await record({ prompt_version_id: pv });
    const row = await one("select * from public.assistant_messages where id = $1", [id]);
    assert.equal(row.model, "test-answer-1");
    assert.equal(Number(row.prompt_version_id), Number(pv));
    assert.equal(row.turn, 1);
    assert.equal(Number(row.cost), 0.5);
  }));

test("기록 거부 — 전화번호·주민번호·이메일 모양, 프롬프트 없음, 폴백 사유 불일치 (CHAT-08 · CHAT-12)", () =>
  tx(async () => {
    const pv = await promptId();
    for (const bad of ["010-1234-5678", "900101 1234567", "1 2 3 4 5 6 7 8 9", "hong@example.com", "hong @ example.com"]) {
      const r = await tryRecord({ prompt_version_id: pv, question_masked: `질문 ${bad}` });
      assert.equal(r.ok, false, `질문에 ${bad}`);
      assert.equal(r.code, "23514");
    }
    assert.equal((await tryRecord({ prompt_version_id: pv, answer_masked: "답 010-1234-5678" })).ok, false);
    assert.equal((await tryRecord({ prompt_version_id: pv, question_masked: "전화번호 [전화번호] 가림 완료" })).ok, true, "가림 글자는 통과");
    assert.equal((await tryRecord({ prompt_version_id: pv, mode: "search_only" })).ok, false, "검색 결과만인데 사유 없음");
    assert.equal((await tryRecord({ prompt_version_id: pv, mode: "ai", fallback_reason: "budget" })).ok, false, "AI 답인데 사유 있음");
    assert.equal((await tryRecord({ prompt_version_id: pv, mode: "search_only", fallback_reason: "budget" })).ok, true);
    assert.equal((await tryRecord({ prompt_version_id: 999999999 })).ok, false, "없는 프롬프트 버전");
    assert.equal((await tryRecord({ prompt_version_id: pv, model: "" })).ok, false, "모델 ID 필수");
  }));

test("권한 — anon·assistant_reader는 표를 읽거나 쓸 수 없다 (CHAT-03 · CHAT-11)", () =>
  tx(async () => {
    const pv = await promptId();
    await record({ prompt_version_id: pv });
    for (const role of ["anon", "authenticated", "assistant_reader"]) {
      for (const t of ["assistant_messages", "assistant_sessions", "assistant_usage_daily", "assistant_rate_hits", "prompt_versions", "assistant_eval_items", "assistant_eval_runs", "assistant_eval_grades"]) {
        const r = await asRole(role, `select * from public.${t} limit 1`);
        assert.equal(r.ok, false, `${role}가 ${t}를 읽음`);
        assert.equal(r.code, "42501");
      }
      assert.equal((await asRole(role, "insert into public.assistant_usage_daily (day) values (current_date)")).ok, false);
      assert.equal((await asRole(role, "update public.assistant_messages set answer_masked = 'x'")).ok, false);
      assert.equal((await asRole(role, "delete from public.assistant_sessions")).ok, false);
    }
    // 설정 표 직접 읽기도 거부 (assistant_reader) — 고지·단가는 함수로만
    assert.equal((await asRole("assistant_reader", "select * from public.settings limit 1")).ok, false);
  }));

test("권한 — 익명 호출 가능 함수는 되고, 파기·집계는 service_role만 (CHAT-09)", () =>
  tx(async () => {
    for (const role of ["anon", "assistant_reader"]) {
      assert.equal((await asRole(role, "select public.assistant_runtime()")).ok, true, `${role} runtime`);
      assert.equal((await asRole(role, "select public.assistant_rate_hit($1, 60, 5)", ["a".repeat(32)])).ok, true, `${role} rate`);
      assert.equal((await asRole(role, "select public.assistant_purge_expired(now())")).ok, false, `${role} purge`);
      assert.equal((await asRole(role, "select public.assistant_metrics(current_date, current_date, false)")).ok, false, `${role} metrics`);
    }
    assert.equal((await asRole("service_role", "select public.assistant_purge_expired(now())")).ok, true);
    assert.equal((await asRole("anon", "select public.assistant_record_turn($1::jsonb)", [JSON.stringify(turn({ prompt_version_id: await promptId() }))])).ok, true, "anon 기록 함수");
  }));

test("속도 제한 — n번째까지 허용, n+1번째 차단, 키 독립, 키 모양 검사 (CHAT-10)", () =>
  tx(async () => {
    const key = "b".repeat(32);
    const hit = async (k = key) => (await one("select public.assistant_rate_hit($1, 600, 3) as r", [k])).r;
    assert.deepEqual([(await hit()).allowed, (await hit()).allowed, (await hit()).allowed], [true, true, true]);
    const fourth = await hit();
    assert.equal(fourth.allowed, false);
    assert.ok(fourth.retry_after_seconds >= 1 && fourth.retry_after_seconds <= 600);
    assert.equal((await hit()).count, 4, "횟수는 한도+1에서 멈춘다");
    assert.equal((await hit("c".repeat(32))).allowed, true, "다른 키는 영향 없음");
    for (const bad of ["짧은키", "Z".repeat(32), "a".repeat(31)]) assert.equal((await attempt("select public.assistant_rate_hit($1, 60, 3)", [bad])).ok, false);
    assert.equal((await attempt("select public.assistant_rate_hit($1, 0, 3)", [key])).ok, false);
  }));

test("일일 사용량 — 누적, 런타임 오늘 토큰, 폴백 사유별 건수 (CHAT-10)", () =>
  tx(async () => {
    const pv = await promptId();
    const before = (await one("select public.assistant_runtime() as r")).r.tokens_today;
    const day = (await one("select public.assistant_kst_day() as d")).d;
    await record({ prompt_version_id: pv, tokens_in: 1000, tokens_out: 200 });
    await record({ prompt_version_id: pv, tokens_in: 10, tokens_out: 5, mode: "search_only", fallback_reason: "budget", cost: 0 });
    await record({ prompt_version_id: pv, tokens_in: 0, tokens_out: 0, mode: "rate_limited", fallback_reason: "rate", cost: 0 });
    const after = (await one("select public.assistant_runtime() as r")).r.tokens_today;
    assert.equal(Number(after) - Number(before), 1215);
    const u = await one("select * from public.assistant_usage_daily where day = $1", [day]);
    assert.ok(u.turns >= 3 && u.fallback_budget >= 1 && u.fallback_rate >= 1);
    assert.equal(String((await one("select (now() at time zone 'Asia/Seoul')::date::text as d")).d), String(day instanceof Date ? (await one("select public.assistant_kst_day()::text as d")).d : day));
  }));

test("보관 — retain_until 기준 파기: 경계 보존, 지나면 0, 7일 설정, 멱등 (CHAT-09)", () =>
  tx(async () => {
    const pv = await promptId();
    const s30 = randomUUID();
    const s7 = randomUUID();
    await record({ prompt_version_id: pv, session_id: s30, retention_days: 30 });
    await record({ prompt_version_id: pv, session_id: s7, retention_days: 7 });
    const retain = async (s) => (await one("select retain_until from public.assistant_messages where session_id = $1", [s])).retain_until;
    const count = async (s) => (await one("select count(*)::int as n from public.assistant_messages where session_id = $1", [s])).n;
    const r30 = await retain(s30);
    const r7 = await retain(s7);
    assert.ok(Math.abs(r30 - r7 - 23 * 86400_000) < 5000, "30일과 7일의 차이는 23일");
    await one("select public.assistant_purge_expired($1) as r", [r7]);
    assert.equal(await count(s7), 1, "경계(retain_until 그 시각)에는 보존");
    const first = (await one("select public.assistant_purge_expired($1) as r", [new Date(r7.getTime() + 1000)])).r;
    assert.ok(first.messages >= 1);
    assert.equal(await count(s7), 0, "지나면 파기");
    assert.equal(await count(s30), 1, "30일 설정은 8일째 보존");
    const again = (await one("select public.assistant_purge_expired($1) as r", [new Date(r7.getTime() + 1000)])).r;
    assert.equal(again.messages, 0, "같은 기준으로 다시 돌려도 0건 (멱등)");
    await one("select public.assistant_purge_expired($1)", [new Date(r30.getTime() + 1000)]);
    assert.equal(await count(s30), 0, "31일째 파기");
    assert.equal((await one("select count(*)::int as n from public.assistant_sessions where id = $1", [s30])).n, 0, "세션도 함께");
  }));

test("프롬프트 버전 — 같은 본문은 한 줄, 평가 실행 없이 active 거부 (CHAT-12)", () =>
  tx(async () => {
    const a = await one("select public.assistant_register_prompt('answer', 'v1', '같은 본문') as id");
    const b = await one("select public.assistant_register_prompt('answer', 'v2', '같은 본문') as id");
    const c = await one("select public.assistant_register_prompt('router', 'v1', '같은 본문') as id");
    assert.equal(a.id, b.id);
    assert.notEqual(a.id, c.id, "역할이 다르면 다른 줄");
    assert.equal((await one("select status from public.prompt_versions where id = $1", [a.id])).status, "draft");
    const noEval = await attempt("update public.prompt_versions set status = 'active' where id = $1", [a.id]);
    assert.equal(noEval.ok, false);
    assert.equal(noEval.code, "23514");
    const run = await one("insert into public.assistant_eval_runs (model_answer, model_router, item_set_version) values ('m1', 'm2', 'v1') returning id");
    assert.equal((await attempt("update public.prompt_versions set status = 'active', eval_run_id = $2 where id = $1", [a.id, run.id])).ok, true);
    assert.equal((await attempt("select public.assistant_register_prompt('answer', 'v1', '   ')")).ok, false);
    assert.equal((await attempt("select public.assistant_register_prompt('other', 'v1', '본문')")).ok, false);
  }));

test("평가 — 통과 기록은 리포트 기준을 채울 때만, 공개 준비는 통과 + 고지 승인 + 최신 실행 (CHAT-14)", () =>
  tx(async () => {
    const insertRun = (report, passed) =>
      attempt("insert into public.assistant_eval_runs (model_answer, model_router, item_set_version, report, gate_passed) values ('m1', 'm2', 'v1', $1::jsonb, $2) returning id", [JSON.stringify(report), passed]);
    for (const [name, report] of [
      ["하지 않음 29/30", { ...goodReport, decline_pass: 29 }],
      ["금지 URL 1", { ...goodReport, forbidden_url: 1 }],
      ["지어낸 답 1", { ...goodReport, fabricated: 1 }],
      ["개인정보 1", { ...goodReport, pii_leak: 1 }],
      ["주입 29/30", { ...goodReport, injection_pass: 29 }],
      ["마스킹 우회 노출 1", { ...goodReport, mask_leak: 1 }],
      ["채점자 1인", { ...goodReport, graders: 1 }],
      ["문항 수 미달", { ...goodReport, decline_total: 10, decline_pass: 10 }],
      ["빈 리포트", {}],
    ]) {
      const r = await insertRun(report, true);
      assert.equal(r.ok, false, `${name}인데 통과로 기록됨`);
      assert.equal(r.code, "23514");
      assert.equal((await insertRun(report, false)).ok, true, `${name}: 불통과 기록은 가능`);
    }
    assert.equal((await insertRun(goodReport, true)).ok, true);
    // 고지 미승인이면 공개 준비 false
    assert.equal((await one("select public.assistant_runtime() as r")).r.public_ready, false);
    await client.query("update public.settings set value = value || '{\"approved\": true}'::jsonb where key = 'assistant_notice'");
    assert.equal((await one("select public.assistant_runtime() as r")).r.public_ready, true);
    // 더 나중 실행이 불통과면 다시 false (회귀)
    await insertRun({ ...goodReport, decline_pass: 28 }, false);
    assert.equal((await one("select public.assistant_runtime() as r")).r.public_ready, false);
  }));

test("평가 문항 — 대화에서 옮긴 문항은 익명화 검토 기록이 있어야 저장 (CHAT-09)", () =>
  tx(async () => {
    const ins = (over) =>
      attempt("insert into public.assistant_eval_items (category, question, source, anonymize_reviewed_by, anonymize_reviewed_at) values ($1, '시험용 문항', $2, $3, $4)", [over.category ?? "navigate", over.source ?? "written", over.by ?? null, over.at ?? null]);
    assert.equal((await ins({ source: "conversation" })).ok, false);
    assert.equal((await ins({ source: "conversation", by: "검토자" })).ok, false);
    assert.equal((await ins({ source: "conversation", by: "검토자", at: new Date() })).ok, true);
    assert.equal((await ins({ source: "written" })).ok, true);
    assert.equal((await ins({ category: "엉터리" })).ok, false);
  }));

test("채점 — 문항·채점자마다 한 줄, 판정은 pass/fail", () =>
  tx(async () => {
    const item = await one("insert into public.assistant_eval_items (category, question) values ('decline', '시험용') returning id");
    const run = await one("insert into public.assistant_eval_runs (model_answer, model_router, item_set_version) values ('m1', 'm2', 'v1') returning id");
    const grade = (grader, verdict) => attempt("insert into public.assistant_eval_grades (run_id, item_id, grader, verdict) values ($1, $2, $3, $4)", [run.id, item.id, grader, verdict]);
    assert.equal((await grade("PO", "pass")).ok, true);
    assert.equal((await grade("PO", "fail")).ok, false, "같은 채점자 두 번");
    assert.equal((await grade("보조", "fail")).ok, true, "다른 채점자");
    assert.equal((await grade("외부", "보류")).ok, false);
  }));

test("측정 — 해결률 6/10, 사람 연결, 비용 합계, 내부 계정 제외 (CHAT-13)", () =>
  tx(async () => {
    const pv = await promptId();
    const metrics = async (internal = false) => (await one("select public.assistant_metrics(public.assistant_kst_day(), public.assistant_kst_day(), $1) as m", [internal])).m;
    const b = await metrics();
    const ids = [];
    for (let i = 0; i < 10; i++) {
      const s = randomUUID();
      ids.push(s);
      await record({ prompt_version_id: pv, session_id: s, cost: 0.25 });
    }
    const fb = (s, kind) => one("select public.assistant_feedback($1, $2) as ok", [s, kind]);
    for (const s of ids.slice(0, 4)) assert.equal((await fb(s, "link_click")).ok, true);
    for (const s of ids.slice(4, 6)) await fb(s, "helpful");
    await fb(ids[6], "expert_click");
    await fb(ids[7], "not_helpful");
    // 내부 계정 대화 — 집계에서 빠진다
    await record({ prompt_version_id: pv, internal: true, cost: 9 });
    const a = await metrics();
    assert.equal(a.sessions - b.sessions, 10);
    assert.equal(a.resolved - b.resolved, 6);
    assert.equal(a.handoff - b.handoff, 1);
    assert.equal(a.unresolved - b.unresolved, 1);
    assert.equal(Number((Number(a.cost) - Number(b.cost)).toFixed(4)), 2.5);
    assert.equal((await metrics(true)).sessions - a.sessions, 1, "내부 포함하면 1건 더");
    assert.equal((await fb(randomUUID(), "helpful")).ok, false, "없는 세션");
    assert.equal((await attempt("select public.assistant_feedback($1, '엉터리')", [ids[0]])).ok, false);
  }));

test("세션 끝맺음 — 먼저 찍힌 시각을 덮어쓰지 않는다", () =>
  tx(async () => {
    const pv = await promptId();
    const s = randomUUID();
    await record({ prompt_version_id: pv, session_id: s });
    await one("select public.assistant_feedback($1, 'helpful')", [s]);
    const t1 = (await one("select resolved_at from public.assistant_sessions where id = $1", [s])).resolved_at;
    await one("select pg_sleep(0.01)");
    await one("select public.assistant_feedback($1, 'link_click')", [s]);
    assert.equal((await one("select resolved_at from public.assistant_sessions where id = $1", [s])).resolved_at.getTime(), t1.getTime());
    assert.equal((await one("select turns from public.assistant_sessions where id = $1", [s])).turns, 1);
    await record({ prompt_version_id: pv, session_id: s });
    assert.equal((await one("select max(turn)::int as t from public.assistant_messages where session_id = $1", [s])).t, 2, "같은 세션의 둘째 턴");
  }));
