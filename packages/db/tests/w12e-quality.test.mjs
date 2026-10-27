// W12-e e5 DB - 품질 콘솔 (마이그레이션 20261026000165, PRD-04 QUAL-01~04, docs/dev/W12-e_설계.md)
//  · 차단율: 5분 창에서 20% 초과일 때만 경보, 정확히 20%·표본 부족은 0, 두 번 불러도 1건(멱등), 확인 전 새 경보 0
//  · 예산: 79%/80%/99%/100% 경계, 예산 값이 없으면 경보 0, 달마다 각 1건
//  · 표본 감수: 4c 승인 감사 전 0, 끝난 날 중 50건 미만인 날마다 1건
//  · 판정: 사람만, 같은 판정자 두 번째 거부, 개인정보 모양 메모 거부, 추가만, 익명·로그인 사용자 접근 0
// 모든 시험은 거래 안에서 돌고 되돌린다. 날짜는 먼 미래(2031년)로 잡아 이미 있는 기록과 섞이지 않게 한다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

const one = async (sql, params) => (await client.query(sql, params)).rows[0];
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
    await client.query("delete from public.quality_alerts");
    return await fn();
  } finally {
    await client.query("rollback");
  }
}
const uid = () => `user:${crypto.randomUUID()}`;
const NOW = "2031-01-01T03:00:00Z";

async function prompt() {
  return (await one("select public.agent_register_prompt('agent_answer', 'vq', $1) id", [`시험용 지시문 ${crypto.randomUUID()}`])).id;
}
let sessionId;
async function session() {
  sessionId = crypto.randomUUID();
  await client.query("insert into public.agent_sessions (id, mode, as_of_date, retain_until) values ($1, 'general', '2031-01-01', '2032-01-01')", [sessionId]);
}
let turnNo = 0;
/** 답변 기록 하나 + 검증 기록 (ok=false면 V1 실패). 검증 시각은 NOW 기준 minutesAgo */
async function turn({ ok, minutesAgo = 1, kind = "answer", pv }) {
  const m = await one(
    "insert into public.agent_messages (session_id, turn, kind, scope, tier, model, prompt_version_id, question_masked, answer_masked) values ($1, $2, $3, 'base', 'guest', 'test-model', $4, '[시험용] 질문', '[시험용] 답변') returning id",
    [sessionId, ++turnNo, kind, pv],
  );
  await client.query("insert into public.agent_validations (message_id, v1, v2, v3, v4, v5, v6, created_at) values ($1, $2, true, true, true, true, true, $3::timestamptz - make_interval(mins => $4))", [m.id, ok, NOW, minutesAgo]);
  return m.id;
}
const blockAlerts = async () => (await client.query("select * from public.quality_alerts where kind = 'block_rate' and alert_key like 'block_rate:20310101%'")).rows;

test("차단율 - 10건 중 2건(정확히 20%)은 경보 0, 3건(30%)은 경보 1건", () =>
  tx(async () => {
    await session();
    const pv = await prompt();
    for (let i = 0; i < 8; i++) await turn({ ok: true, pv });
    for (let i = 0; i < 2; i++) await turn({ ok: false, pv });
    const r20 = (await one("select public.quality_check_block_rate($1) r", [NOW])).r;
    assert.deepEqual([r20.total, r20.blocked, r20.alert_created], [10, 2, false]);
    assert.equal((await blockAlerts()).length, 0);
    await turn({ ok: false, pv });
    const r = (await one("select public.quality_check_block_rate($1) r", [NOW])).r;
    assert.equal(r.alert_created, true);
    const rows = await blockAlerts();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].detail.blocked, 3);
    assert.equal(rows[0].detail.total, 11);
  }));

test("차단율 - 같은 상황에서 여러 번 불러도 경보 1건(멱등), 확인하면 다음 창에서 다시 만들 수 있다", () =>
  tx(async () => {
    await session();
    const pv = await prompt();
    for (let i = 0; i < 5; i++) await turn({ ok: false, pv });
    for (const t of [NOW, NOW, "2031-01-01T03:00:30Z"]) await client.query("select public.quality_check_block_rate($1)", [t]);
    assert.equal((await blockAlerts()).length, 1);
    const id = (await blockAlerts())[0].id;
    assert.equal((await one("select public.quality_alert_ack($1, 'user:x') ok", [id])).ok, true);
    assert.equal((await one("select public.quality_alert_ack($1, 'user:x') ok", [id])).ok, false, "두 번째 확인은 거부");
    assert.equal((await one("select public.quality_alert_ack($1, '') ok", [id])).ok, false);
  }));

test("차단율 - 표본이 최소 수(기본 5) 미만이면 전부 차단이어도 경보 0, 5분 밖 기록은 세지 않는다", () =>
  tx(async () => {
    await session();
    const pv = await prompt();
    for (let i = 0; i < 4; i++) await turn({ ok: false, pv });
    assert.equal((await one("select public.quality_check_block_rate($1) r", [NOW])).r.alert_created, false);
    for (let i = 0; i < 6; i++) await turn({ ok: false, pv, minutesAgo: 6 });
    const r = (await one("select public.quality_check_block_rate($1) r", [NOW])).r;
    assert.deepEqual([r.total, r.alert_created], [4, false], "6분 전 기록은 창 밖");
    assert.equal((await blockAlerts()).length, 0);
  }));

test("차단율 - 검증 기록을 쓰면 트리거가 실제 5분 창으로 계산해 경보 1건을 만든다", () =>
  tx(async () => {
    await session();
    const pv = await prompt();
    for (let i = 0; i < 6; i++) {
      const m = await one("insert into public.agent_messages (session_id, turn, kind, scope, tier, model, prompt_version_id) values ($1, $2, 'answer', 'base', 'guest', 'm', $3) returning id", [sessionId, ++turnNo, pv]);
      await client.query("insert into public.agent_validations (message_id, v1, v2, v3, v4, v5, v6) values ($1, false, true, true, true, true, true)", [m.id]);
    }
    assert.equal((await client.query("select 1 from public.quality_alerts where kind = 'block_rate'")).rows.length, 1);
  }));

async function setBudget(value) {
  await client.query("delete from public.settings where key = 'ask_budget'");
  if (value !== null) await client.query("insert into public.settings (key, value) values ('ask_budget', $1::jsonb)", [JSON.stringify(value)]);
}
async function spend(cost) {
  await client.query("delete from public.agent_usage_daily where day >= '2031-03-01' and day <= '2031-03-31'");
  if (cost > 0) await client.query("insert into public.agent_usage_daily (day, tier, turns, cost) values ('2031-03-10', 'guest', 10, $1)", [cost]);
  await client.query("delete from public.quality_alerts");
}
const NOW_MAR = "2031-03-15T03:00:00Z";
const budgetKinds = async () => (await client.query("select kind from public.quality_alerts where alert_key like '%2031-03' order by kind")).rows.map((r) => r.kind);

test("예산 - 79.99%는 경보 0, 80%는 경고 1건, 99.99%도 경고뿐, 100%는 경고+초과", () =>
  tx(async () => {
    await setBudget({ monthly_won: 10000 });
    await spend(7999);
    assert.equal((await one("select public.quality_check_budget($1) r", [NOW_MAR])).r.level, "ok");
    assert.deepEqual(await budgetKinds(), []);
    await spend(8000);
    assert.equal((await one("select public.quality_check_budget($1) r", [NOW_MAR])).r.level, "warn");
    assert.deepEqual(await budgetKinds(), ["budget_warn"]);
    await spend(9999);
    await client.query("select public.quality_check_budget($1)", [NOW_MAR]);
    assert.deepEqual(await budgetKinds(), ["budget_warn"]);
    await spend(10000);
    assert.equal((await one("select public.quality_check_budget($1) r", [NOW_MAR])).r.level, "over");
    assert.deepEqual(await budgetKinds(), ["budget_over", "budget_warn"]);
  }));

test("예산 - 같은 달에 여러 번 불러도 종류마다 1건(멱등), 다음 달은 새로 센다", () =>
  tx(async () => {
    await setBudget({ monthly_won: 10000 });
    await spend(12000);
    for (let i = 0; i < 3; i++) await client.query("select public.quality_check_budget($1)", [NOW_MAR]);
    assert.deepEqual(await budgetKinds(), ["budget_over", "budget_warn"]);
    const apr = (await one("select public.quality_check_budget('2031-04-15T03:00:00Z') r")).r;
    assert.equal(apr.level, "ok", "4월은 사용 0 - 3월 비용을 이월하지 않는다");
  }));

test("예산 - 예산 값이 없거나 0·음수·문자열이면 비용이 커도 경보 0 (기본 꺼짐)", () =>
  tx(async () => {
    for (const v of [null, {}, { monthly_won: 0 }, { monthly_won: -1 }, { monthly_won: "10000" }]) {
      await setBudget(v);
      await spend(999999);
      const r = (await one("select public.quality_check_budget($1) r", [NOW_MAR])).r;
      assert.equal(r.level, "unset", JSON.stringify(v));
      assert.deepEqual(await budgetKinds(), [], JSON.stringify(v));
    }
  }));

test("표본 감수 - 4c 승인 전에는 0, 승인 뒤 끝난 날 중 50건 미만인 날마다 경보 1건 (오늘은 제외)", () =>
  tx(async () => {
    assert.equal((await one("select public.quality_sample_check($1) r", ["2031-01-05T03:00:00Z"])).r.started, false);
    await session();
    const pv = await prompt();
    const msg = await turn({ ok: true, pv });
    await client.query("insert into public.eval_audit (action, outcome, code, actor, target, at) values ('rollout', 'ok', 'ok', 'admin:test@example.test', '4c', '2031-01-01T03:00:00Z')");
    // 1일(한국)에 50건 판정 - 한 답변에 판정자 50명
    for (let i = 0; i < 50; i++) await client.query("insert into public.quality_judgments (message_id, judge, verdict, judged_at) values ($1, $2, 'good', '2031-01-01T05:00:00Z')", [msg, uid()]);
    const r = (await one("select public.quality_sample_check($1) r", ["2031-01-04T03:00:00Z"])).r;
    assert.deepEqual([r.started, r.short_days], [true, 2], "2일·3일이 부족(1일은 50건, 4일은 오늘이라 제외)");
    const keys = (await client.query("select alert_key from public.quality_alerts where kind = 'sample_short' order by alert_key")).rows.map((x) => x.alert_key);
    assert.deepEqual(keys, ["sample_short:2031-01-02", "sample_short:2031-01-03"]);
    await client.query("select public.quality_sample_check($1)", ["2031-01-04T03:00:00Z"]);
    assert.equal((await client.query("select 1 from public.quality_alerts where kind = 'sample_short'")).rows.length, 2, "다시 불러도 중복 0");
  }));

test("표본 판정 - 사람(user:uuid)만, 같은 판정자 두 번째 거부, 개인정보 모양 메모·잘못된 판정 거부, 답변이 아닌 기록은 없는 것으로", () =>
  tx(async () => {
    await session();
    const pv = await prompt();
    const msg = await turn({ ok: true, pv });
    const fb = await turn({ ok: true, pv, kind: "fallback" });
    const j = uid();
    const call = async (m, judge, verdict, note = null, cand = false) => (await one("select public.quality_judge($1, $2, $3, $4, $5) r", [m, judge, verdict, note, cand])).r;
    assert.equal((await call(msg, j, "good", "메모 [시험용]", true)).ok, true);
    assert.equal((await call(msg, j, "wrong")).code, "already_judged");
    assert.equal((await call(msg, uid(), "wrong")).ok, true, "다른 판정자는 가능");
    assert.equal((await call(msg, "ai:model", "good")).code, "judge_not_human");
    assert.equal((await call(msg, "admin:x", "good")).code, "judge_not_human");
    assert.equal((await call(fb, uid(), "good")).code, "message_not_found");
    assert.equal((await call(999999999, uid(), "good")).code, "message_not_found");
    assert.equal((await call(msg, uid(), "great")).code, "invalid");
    assert.equal((await call(msg, uid(), "good", "연락 010123456789")).code, "invalid");
    assert.equal((await call(msg, uid(), "good", "a@b.co")).code, "invalid");
    const saved = await one("select verdict, note, eval_candidate from public.quality_judgments where judge = $1", [j]);
    assert.deepEqual(saved, { verdict: "good", note: "메모 [시험용]", eval_candidate: true });
  }));

test("표본 판정·경보는 추가만 - 판정 수정·삭제 거부, 경보 직접 쓰기·함수 실행은 익명·로그인 사용자에게 0", () =>
  tx(async () => {
    await session();
    const pv = await prompt();
    const msg = await turn({ ok: true, pv });
    await client.query("select public.quality_judge($1, $2, 'good', null, false)", [msg, uid()]);
    assert.equal((await attempt("update public.quality_judgments set verdict = 'wrong'")).ok, false);
    assert.equal((await attempt("delete from public.quality_judgments")).ok, false);
    assert.equal((await attempt("truncate public.quality_judgments")).ok, false);
    for (const role of ["anon", "authenticated"]) {
      for (const t of ["quality_judgments", "quality_alerts", "quality_blocked_log", "quality_live_log", "quality_cost_daily", "quality_sample_candidates"]) {
        assert.equal((await one("select has_table_privilege($1, $2, 'select') p", [role, `public.${t}`])).p, false, `${role} ${t}`);
      }
      for (const f of ["quality_judge(bigint, text, text, text, boolean)", "quality_check_block_rate(timestamptz)", "quality_check_budget(timestamptz)", "quality_daily_run(timestamptz)", "quality_alert_ack(bigint, text)"]) {
        assert.equal((await one("select has_function_privilege($1, $2, 'execute') p", [role, `public.${f}`])).p, false, `${role} ${f}`);
      }
    }
    assert.equal((await one("select has_table_privilege('service_role', 'public.quality_alerts', 'select') p")).p, true);
    assert.equal((await one("select has_table_privilege('service_role', 'public.quality_alerts', 'insert') p")).p, false);
  }));

test("콘솔 뷰 - 차단 로그는 검증 실패 답변만, 실시간 조회 기록은 공식 자료 도구만, 비용은 질문당 평균, 표본 후보는 답변만", () =>
  tx(async () => {
    await session();
    const pv = await prompt();
    const bad = await turn({ ok: false, pv });
    const good = await turn({ ok: true, pv });
    await turn({ ok: true, pv, kind: "fallback" });
    const blocked = (await client.query("select message_id from public.quality_blocked_log where message_id in ($1, $2)", [bad, good])).rows.map((r) => Number(r.message_id));
    assert.deepEqual(blocked, [Number(bad)]);
    await client.query("insert into public.agent_tool_calls (message_id, tool, ok, latency_ms) values ($1, 'fetch_official_source', true, 120), ($1, 'search_corpus', true, 10)", [good]);
    const live = (await client.query("select tool from public.quality_live_log where message_id = $1", [good])).rows;
    assert.deepEqual(live.map((r) => r.tool), ["fetch_official_source"]);
    await client.query("delete from public.agent_usage_daily where day = '2031-05-01'");
    await client.query("insert into public.agent_usage_daily (day, tier, turns, cost) values ('2031-05-01', 'guest', 4, 10), ('2031-05-01', 'member', 0, 0)");
    const cost = (await client.query("select tier, cost_per_turn from public.quality_cost_daily where day = '2031-05-01' order by tier")).rows;
    assert.deepEqual(cost.map((r) => [r.tier, Number(r.cost_per_turn)]), [["guest", 2.5], ["member", 0]]);
    const kinds = (await client.query("select count(*)::int n from public.quality_sample_candidates c join public.agent_messages m on m.id = c.message_id where m.kind <> 'answer'")).rows[0].n;
    assert.equal(kinds, 0);
  }));
