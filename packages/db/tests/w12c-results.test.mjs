// W12-c DB - 계산·감면·판정 결과 요약 봉인 (마이그레이션 160·161, docs/dev/W12-c_설계.md - PRD-04 ASK-05·18·22 · 6.11)
//  · agent_results: 입력값 칸 0 · 금액을 낸 계산은 기준일·룰셋 버전 필수 · 판정·감면은 판정표 버전 필수 · 금액 칸은 계산기만
//  · agent_record_results: 서버(service_role) 전용 · 같은 (턴, 순서)는 한 번만 · 기록된 턴이 없으면 0 · 봉인 해시는 DB가 계산
//  · agent_tool_calls: 도구 3종 허용, 국세 계산 도구 이름은 거부
//  · chunk_scope_counts: 내부 전용, 상속·증여 허브 지도·연관/국세 법령은 색인 원천에 없다
// 모든 시험은 거래 안에서 돌고 되돌린다. 글은 시험용 가짜다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { open, helpers } from "./_w10c_helpers.mjs";

let client;
let h;
before(async () => {
  client = await open();
  h = helpers(client);
});
after(async () => client?.end());

async function seedTurn() {
  const pid = (await h.attempt("select public.agent_register_prompt('agent_answer', 'w12c-test', $1) as id", [`시험용 지시문 ${randomUUID()}`])).rows[0].id;
  const session = randomUUID();
  const p = {
    session_id: session, mode: "general", kind: "answer", scope: "base", model: "test-model", prompt_version_id: pid, as_of_date: "2026-10-27",
    question_masked: "시험용 질문", answer_masked: "시험용 답변", tokens_in: 1, tokens_out: 1, tokens_cached: 0, cost: 0, model_calls: 1,
    citations: [], tool_calls: [{ tool: "run_calculator", input_summary: "run_calculator", latency_ms: 3, ok: true }],
    validation: { v1: true, v2: true, v3: true, v4: true, v5: true, v6: true, regenerated: false, failure_codes: [] },
  };
  const r = await h.attempt("select public.agent_record_turn($1::jsonb) as id", [JSON.stringify(p)]);
  assert.equal(r.ok, true, r.message);
  return { session, messageId: r.rows[0].id };
}
const CALC = { tool: "run_calculator", subject: "acquisition", status: "calculated", total_won: 1234567, as_of: "2026-10-27", ruleset_version: "2026.01", laws: ["시험용 조문 제1조"], item_count: 2 };
const BEN = { tool: "check_benefits", subject: "reduction", status: "found", table_version: "2099.01", laws: [], item_count: 1 };
const DET = { tool: "run_determination", subject: "trust_holding", status: "conclusion", table_version: "2099.02", laws: [], item_count: 1 };
const record = (session, turn, arr, role) => h.attempt("select public.agent_record_results($1::uuid, $2::int, $3::jsonb) as n", [session, turn, JSON.stringify(arr)], role);

test("결과 요약 기록: 계산·감면·판정 3줄이 순서대로 쓰이고 봉인 해시는 요약 칸으로 DB가 계산한다", () =>
  h.tx(async () => {
    const { session, messageId } = await seedTurn();
    const r = await record(session, 1, [CALC, BEN, DET]);
    assert.equal(r.ok, true, r.message);
    assert.equal(Number(r.rows[0].n), 3);
    const rows = (await client.query("select * from public.agent_results where message_id = $1 order by position", [messageId])).rows;
    assert.deepEqual(rows.map((x) => [x.position, x.tool, x.status]), [[0, "run_calculator", "calculated"], [1, "check_benefits", "found"], [2, "run_determination", "conclusion"]]);
    assert.equal(Number(rows[0].total_won), 1234567);
    assert.equal(rows[0].ruleset_version, "2026.01");
    const expected = createHash("sha256").update("run_calculator|acquisition|calculated|1234567|2026-10-27|2026.01||시험용 조문 제1조").digest("hex");
    assert.equal(rows[0].result_hash, expected);
  }));

test("같은 (턴, 순서)는 한 번만 - 두 번째 호출은 0행, 기록된 턴이 없으면 0행", () =>
  h.tx(async () => {
    const { session } = await seedTurn();
    assert.equal(Number((await record(session, 1, [CALC])).rows[0].n), 1);
    assert.equal(Number((await record(session, 1, [CALC])).rows[0].n), 0);
    assert.equal(Number((await record(session, 2, [CALC])).rows[0].n), 0);
    assert.equal(Number((await record(randomUUID(), 1, [CALC])).rows[0].n), 0);
  }));

test("서버(service_role) 전용 - anon·로그인 사용자는 실행할 수 없다", () =>
  h.tx(async () => {
    const { session } = await seedTurn();
    for (const role of ["anon", "authenticated"]) {
      const r = await record(session, 1, [CALC], role);
      assert.equal(r.ok, false, role);
      assert.match(r.message, /permission denied/);
    }
    const direct = await h.attempt("select * from public.agent_results", [], "anon");
    assert.equal(direct.ok, false);
  }));

test("입력값을 담는 칸이 없다 (도구 입력 구조체 저장 0)", async () => {
  const cols = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'agent_results'")).rows.map((r) => r.column_name);
  assert.deepEqual(cols.filter((c) => /input|facts|answer|form|question|price|owner|house|prompt/i.test(c)), []);
});

test("봉인 제약: 계산은 기준일·룰셋 버전 필수 · 판정·감면은 판정표 버전 필수 · 금액 칸은 계산기만 · 모양 오류 거부", () =>
  h.tx(async () => {
    const { session } = await seedTurn();
    const bad = async (row, why) => {
      await client.query("savepoint s");
      const r = await record(session, 1, [row]);
      assert.equal(r.ok, false, why);
      await client.query("rollback to savepoint s");
    };
    await bad({ ...CALC, as_of: null }, "기준일 없는 계산");
    await bad({ ...CALC, ruleset_version: null }, "룰셋 버전 없는 계산");
    await bad({ ...CALC, total_won: null }, "금액 없는 calculated");
    await bad({ ...CALC, total_won: -1 }, "음수 금액");
    await bad({ ...BEN, table_version: null }, "판정표 버전 없는 감면");
    await bad({ ...DET, table_version: null }, "판정표 버전 없는 판정");
    await bad({ ...DET, total_won: 5 }, "판정에 금액");
    await bad({ ...CALC, tool: "run_transfer" }, "모르는 도구");
    await bad({ ...CALC, subject: "Transfer Tax" }, "주제 모양");
    await bad({ ...CALC, ruleset_version: "v1" }, "룰셋 버전 모양");
    const many = await record(session, 1, Array.from({ length: 21 }, () => CALC));
    assert.equal(many.ok, false);
  }));

test("not_liable·unsupported·needs_input은 금액 없이 기록된다 (경계: 금액 0원 계산은 허용)", () =>
  h.tx(async () => {
    const { session, messageId } = await seedTurn();
    const r = await record(session, 1, [
      { tool: "run_calculator", subject: "holding", status: "unsupported" },
      { tool: "run_calculator", subject: "holding", status: "needs_input" },
      { tool: "run_calculator", subject: "holding", status: "not_liable" },
      { ...CALC, total_won: 0 },
    ]);
    assert.equal(r.ok, true, r.message);
    assert.equal(Number((await client.query("select count(*)::int as n from public.agent_results where message_id = $1", [messageId])).rows[0].n), 4);
  }));

test("도구 호출 허용 목록: 계산·감면·판정 3종 허용, 국세 계산 도구 이름은 거부", () =>
  h.tx(async () => {
    const { messageId } = await seedTurn();
    for (const tool of ["run_calculator", "check_benefits", "run_determination"]) {
      const r = await h.attempt("insert into public.agent_tool_calls (message_id, tool, ok) values ($1, $2, true)", [messageId, tool]);
      assert.equal(r.ok, true, `${tool}: ${r.message}`);
    }
    for (const tool of ["run_transfer_tax", "run_inheritance_tax", "run_gift_tax"]) {
      await client.query("savepoint s");
      const r = await h.attempt("insert into public.agent_tool_calls (message_id, tool, ok) values ($1, $2, true)", [messageId, tool]);
      assert.equal(r.ok, false, tool);
      await client.query("rollback to savepoint s");
    }
  }));

test("범위 태그 현황 뷰: 내부 전용이고, 상속·증여 허브 지도와 국세 법령은 색인 원천에 없다", () =>
  h.tx(async () => {
    const anon = await h.attempt("select * from public.chunk_scope_counts", [], "anon");
    assert.equal(anon.ok, false);
    const rows = (await client.query("select source_type, scope from public.chunk_scope_counts")).rows;
    assert.ok(rows.every((r) => ["base", "trust_redevelopment", "inheritance", "gift"].includes(r.scope)));
    assert.deepEqual(rows.filter((r) => r.source_type === "issue_graph_version" && r.scope !== "trust_redevelopment"), []);
    const igt = await client.query("select count(*)::int as n from public.chunk_sources where source_type = 'issue_graph_version' and source_id in (select id::text from public.issue_graphs where hub = 'inheritance_gift')");
    assert.equal(igt.rows[0].n, 0);
    const laws = await client.query("select count(*)::int as n from public.chunk_sources where source_type = 'law_article' and (tax_items && array['national_igt', 'related'])");
    assert.equal(laws.rows[0].n, 0);
  }));
