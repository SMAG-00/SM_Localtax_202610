// W12-b DB - 지방세봇 기록 표 · 함수 (마이그레이션 156·157, docs/dev/W12-b_설계.md - PRD-04 6.11 · ASK-12 기초 · 4단계 설계 3장 b행)
//  · 지시문 등록: 역할 값 2개만, 같은 본문은 같은 id, 평가 실행 없이 active 불가
//  · 한 턴 기록: 세션·메시지·인용·도구 호출·검증·일일 사용량이 한 번에 쓰이고, 턴 수·역질문 라운드가 오른다
//  · 개인정보 모양(숫자 9자리 이상·이메일)은 표 check가 거부 · 실시간 인용은 스냅샷 필수 · 모양이 틀린 입력 거부
//  · 직접 읽기 0 (anon·authenticated) · 원문 칸 없음
//  · agent_runtime: 기능 키·공개 단계·범위 플래그·한도·이번 달 사용액 (값만)
// 모든 시험은 거래 안에서 돌고 되돌린다. 글은 시험용 가짜다. 회원(로그인) 경로는 Auth 사용자가 필요해 E2E에서 확인한다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { open, helpers } from "./_w10c_helpers.mjs";

let client;
let h;
before(async () => {
  client = await open();
  h = helpers(client);
});
after(async () => client?.end());

const prompt = async (body = `시험용 지시문 ${randomUUID()}`) => (await h.attempt("select public.agent_register_prompt('agent_answer', 'w12b-test', $1) as id", [body], "anon"));
// 169(W12-d)부터 기록 함수는 service_role 전용이다 - 서버만 기록한다
async function turn(over = {}, role = "service_role") {
  const pid = (await prompt()).rows[0].id;
  const p = {
    session_id: randomUUID(), mode: "general", kind: "answer", scope: "base", model: "test-model", prompt_version_id: pid, as_of_date: "2026-10-27",
    question_masked: "시험용 질문", answer_masked: "시험용 답변", tokens_in: 100, tokens_out: 50, tokens_cached: 10, cost: 5, model_calls: 1,
    citations: [{ source_id: "100", source_type: "law_article", chunk_id: null, is_live: false, snapshot_id: null }],
    tool_calls: [{ tool: "search_corpus", input_summary: "시험용", latency_ms: 12, ok: true }],
    validation: { v1: true, v2: true, v3: true, v4: true, v5: true, v6: false, regenerated: true, failure_codes: ["V6"] },
    ...over,
  };
  const r = await h.attempt("select public.agent_record_turn($1::jsonb) as id", [JSON.stringify(p)], role);
  return { p, r };
}

test("지시문 등록: 역할 2개만 · 같은 본문 같은 id · 평가 없이 active 불가", () =>
  h.tx(async () => {
    const a = await prompt("시험용 같은 본문");
    const b = await prompt("시험용 같은 본문");
    assert.equal(a.ok, true, a.message);
    assert.equal(a.rows[0].id, b.rows[0].id);
    const bad = await h.attempt("select public.agent_register_prompt('answer', 'v', '시험용')", [], "anon");
    assert.equal(bad.ok, false);
    assert.match(bad.message, /지시문 역할/);
    const empty = await h.attempt("select public.agent_register_prompt('agent_answer', 'v', '  ')", [], "anon");
    assert.equal(empty.ok, false);
    const active = await h.attempt("update public.prompt_versions set status = 'active' where id = $1", [a.rows[0].id]);
    assert.equal(active.ok, false);
    assert.match(active.message, /prompt_versions_active_needs_eval/);
  }));

test("한 턴 기록: 메시지·인용·도구 호출·검증·사용량이 쓰이고 세션 턴 수가 오른다", () =>
  h.tx(async () => {
    const { p, r } = await turn();
    assert.equal(r.ok, true, r.message);
    const msg = await h.one("select * from public.agent_messages where id = $1", [r.rows[0].id]);
    assert.equal(msg.tier, "guest");
    assert.equal(msg.turn, 1);
    assert.equal(msg.question_masked, "시험용 질문");
    assert.equal(Number(msg.cost), 5);
    assert.equal((await h.one("select count(*)::int n from public.agent_citations where message_id = $1", [msg.id])).n, 1);
    assert.equal((await h.one("select count(*)::int n from public.agent_tool_calls where message_id = $1", [msg.id])).n, 1);
    const v = await h.one("select * from public.agent_validations where message_id = $1", [msg.id]);
    assert.equal(v.v6, false);
    assert.equal(v.v1, true);
    assert.equal(v.regenerated, true);
    assert.deepEqual(v.failure_codes, ["V6"]);
    const day = await h.one("select turns, tokens_in from public.agent_usage_daily where tier = 'guest' and day = (now() at time zone 'Asia/Seoul')::date");
    assert.ok(day.turns >= 1 && Number(day.tokens_in) >= 100);

    // 같은 세션 두 번째 턴 - 역질문이면 라운드가 오른다
    const second = await turn({ session_id: p.session_id, kind: "clarify", answer_masked: null });
    assert.equal(second.r.ok, true, second.r.message);
    const state = await h.one("select public.agent_session_state($1) as s", [p.session_id]);
    assert.deepEqual(state.s, { turns: 2, clarify_rounds: 1 });
    const none = await h.one("select public.agent_session_state($1) as s", [randomUUID()]);
    assert.deepEqual(none.s, { turns: 0, clarify_rounds: 0 });
  }));

test("비회원 보존 일수는 서버가 넘긴 값을 따른다", () =>
  h.tx(async () => {
    const { p, r } = await turn({ retention_days: 7 });
    assert.equal(r.ok, true, r.message);
    const s = await h.one("select extract(epoch from (retain_until - now()))/86400 as d from public.agent_sessions where id = $1", [p.session_id]);
    assert.ok(Number(s.d) > 6.9 && Number(s.d) < 7.1);
  }));

test("개인정보 모양(숫자 9자리 이상·이메일)이 들어간 글은 거부된다", () =>
  h.tx(async () => {
    for (const bad of [{ question_masked: "시험용 123456789 번호" }, { answer_masked: "시험용 a@b.test 메일" }]) {
      const { r } = await turn(bad);
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.match(r.message, /agent_messages_(question|answer)_masked_check/);
    }
    const tool = await turn({ tool_calls: [{ tool: "search_corpus", input_summary: "01012345678", latency_ms: 1, ok: true }] });
    assert.equal(tool.r.ok, false);
  }));

test("스냅샷 없는 실시간 인용은 거부, 스냅샷이 있으면 기록된다", () =>
  h.tx(async () => {
    const live = (snapshot_id) => [{ source_id: "snap:1", source_type: "live_snapshot", chunk_id: null, is_live: true, snapshot_id }];
    const bad = await turn({ citations: live(null) });
    assert.equal(bad.r.ok, false);
    assert.match(bad.r.message, /agent_citations_live_needs_snapshot/);
    const snap = await h.snapshot();
    const good = await turn({ citations: live(snap), tool_calls: [{ tool: "fetch_official_source", input_summary: "시험용", latency_ms: 3, ok: true, target_type: "law", snapshot_id: snap }] });
    assert.equal(good.r.ok, true, good.r.message);
  }));

test("모양이 틀린 입력은 거부", () =>
  h.tx(async () => {
    assert.equal((await turn({ mode: "x" })).r.ok, false);
    assert.equal((await turn({ kind: "x" })).r.ok, false);
    assert.equal((await turn({ citations: "x" })).r.ok, false);
    assert.equal((await turn({ tool_calls: [{ tool: "drop_everything", ok: true }] })).r.ok, false, "허용 목록에 없는 도구 이름은 거부");
    assert.equal((await turn({ prompt_version_id: 999999999 })).r.ok, false);
    assert.equal((await turn({ fallback_reason: "임의" })).r.ok, false);
    const notObj = await h.attempt("select public.agent_record_turn('[]'::jsonb)", [], "service_role");
    assert.equal(notObj.ok, false);
  }));

test("anon·authenticated는 기록 표를 읽지 못하고 service_role은 읽는다. 원문 칸이 없다", () =>
  h.tx(async () => {
    for (const t of ["agent_sessions", "agent_messages", "agent_citations", "agent_tool_calls", "agent_validations", "agent_usage_daily"]) {
      for (const role of ["anon", "authenticated"]) {
        const r = await h.attempt(`select count(*) from public.${t}`, [], role);
        assert.equal(r.ok, false, `${role} ${t}`);
      }
      const ok = await h.attempt(`select count(*) from public.${t}`, [], "service_role");
      assert.equal(ok.ok, true, `service_role ${t}`);
      const w = await h.attempt(`delete from public.${t}`, [], "service_role");
      assert.equal(w.ok, false, `service_role 쓰기 ${t}`);
    }
    const cols = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name like 'agent\\_%'")).rows.map((r) => r.column_name);
    for (const c of cols) assert.doesNotMatch(c, /^(question|answer|content|raw|input|payload|message_text)$/, c);
    assert.ok(!cols.some((c) => /estate|family|gift_history|asset/.test(c)), "상속재산·가족관계·증여 이력 칸 0");
  }));

test("agent_runtime: 기능 키 꺼짐 · 공개 단계 none · 범위 모두 꺼짐 · 한도 · 이번 달 사용액", () =>
  h.tx(async () => {
    const r0 = await h.attempt("select public.agent_runtime() as r", [], "anon");
    assert.equal(r0.ok, true, r0.message);
    const rt = r0.rows[0].r;
    assert.equal(rt.taxbot, false);
    assert.equal(rt.stage, "none");
    assert.deepEqual(rt.scopes, { trust_redevelopment: false, inheritance: false, gift: false });
    assert.equal(rt.limits.clarify_rounds, 2);
    assert.equal(rt.limits.clarify_per_round, 3);
    assert.equal(rt.live_policy.max_calls, 3);
    assert.deepEqual(rt.official_search, { enabled: false });
    assert.deepEqual(rt.budget, {});
    const before = Number(rt.spent_month_won);
    const { r } = await turn({ cost: 12.5 });
    assert.equal(r.ok, true, r.message);
    const after2 = (await h.one("select public.agent_runtime() as r")).r;
    assert.equal(Number(after2.spent_month_won), before + 12.5);
  }));
