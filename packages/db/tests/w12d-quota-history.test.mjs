// W12-d DB - 하루 한도 · 피드백 · 대화 기록 파기 (마이그레이션 168·169, docs/dev/W12-d_설계.md - ASK-10 · ASK-11 · ASK-12 · COMPLY-03)
//  · agent_quota_consume: 한도 3이면 3번째 허용 · 4번째 거절 · 한도 값이 없으면 닫힘 · 반환은 0 아래로 내려가지 않음 · anon 실행 거부
//  · agent_feedback_submit: 사유 목록 밖·도움이 됐다+사유·없는 세션 거부
//  · agent_purge: 비회원 기한과 회원 기한을 각자 판정(정각 포함), 글만 비우고 수치는 남음
//  · agent_record_turn: anon 실행 거부(service_role 전용) · 저장 끔 세션은 글 칸 0
//  · public_ask_mode: 기본값은 모두 닫힘
// 모든 시험은 거래 안에서 돌고 되돌린다. 글은 시험용 가짜다.
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

const prompt = async () => (await h.attempt("select public.agent_register_prompt('agent_answer', 'w12d-test', $1) as id", [`시험용 지시문 ${randomUUID()}`], "service_role")).rows[0].id;
async function turn(session, over = {}) {
  const p = {
    session_id: session, mode: "general", kind: "answer", scope: "base", model: "test-model", prompt_version_id: await prompt(), as_of_date: "2026-10-27",
    question_masked: "시험용 질문", answer_masked: "시험용 답변", tool_calls: [{ tool: "search_corpus", input_summary: "시험용", ok: true }], ...over,
  };
  return h.attempt("select public.agent_record_turn($1::jsonb) as id", [JSON.stringify(p)], "service_role");
}
const open_ = (session, over = {}) =>
  h.attempt("select public.agent_session_open($1, $2, 'general', null, false, $3, $4) as r", [session, over.user ?? null, over.days ?? 30, over.save ?? true], "service_role");

test("하루 한도 3: 1~3번째 허용, 4번째 거절, 반환은 0 아래로 내려가지 않는다", () =>
  h.tx(async () => {
    const subject = `g:${randomUUID().replaceAll("-", "")}`;
    const got = [];
    for (let i = 0; i < 4; i++) got.push((await h.attempt("select public.agent_quota_consume($1, 'guest') as r", [subject], "service_role")).rows[0].r);
    assert.deepEqual(got.map((r) => r.allowed), [true, true, true, false]);
    assert.equal(got[3].code, "limit");
    assert.equal(got[3].used, 3);
    for (let i = 0; i < 5; i++) await h.attempt("select public.agent_quota_refund($1)", [subject], "service_role");
    assert.equal((await h.attempt("select public.agent_quota_peek($1, 'guest') as r", [subject], "service_role")).rows[0].r.used, 0);
  }));

test("한도 값이 설정에 없으면 닫힘(limit_missing) · anon은 한도 함수를 부르지 못한다", () =>
  h.tx(async () => {
    await client.query(`update public.settings set value = value - 'guest_daily' where key = 'ask_limits'`);
    const r = (await h.attempt("select public.agent_quota_consume('g:abcdefgh12345678', 'guest') as r", [], "service_role")).rows[0].r;
    assert.equal(r.allowed, false);
    assert.equal(r.code, "limit_missing");
    assert.equal((await h.attempt("select public.agent_quota_consume('g:abcdefgh12345678', 'guest')", [], "anon")).ok, false);
  }));

test("모드 판정 기본값은 모두 닫힘", () =>
  h.tx(async () => {
    const r = (await h.attempt("select public.public_ask_mode() as r", [], "anon")).rows[0].r;
    assert.equal(r.notice_approved, false);
    assert.deepEqual(r.targets, { guest: false, member: false });
  }));

test("피드백: 정상 저장 · 사유 목록 밖 · 도움이 됐다+사유 · 없는 세션 거부", () =>
  h.tx(async () => {
    const s = randomUUID();
    assert.equal((await turn(s)).ok, true);
    const send = (turnNo, kind, reason) => h.attempt("select public.agent_feedback_submit($1, $2, $3, $4) as r", [s, turnNo, kind, reason], "anon");
    assert.equal((await send(1, "not_helpful", "wrong")).rows[0].r, true);
    assert.equal((await send(1, "error_report", "other")).rows[0].r, true);
    assert.equal((await send(1, "not_helpful", "임의")).ok, false);
    assert.equal((await send(1, "helpful", "wrong")).ok, false);
    assert.equal((await send(2, "helpful", null)).rows[0].r, false, "없는 턴");
    const none = await h.attempt("select public.agent_feedback_submit($1, 1, 'helpful', null) as r", [randomUUID()], "anon");
    assert.equal(none.rows[0].r, false);
  }));

test("agent_record_turn은 anon·authenticated가 부르지 못한다 (기록 위조 차단)", () =>
  h.tx(async () => {
    const p = JSON.stringify({ session_id: randomUUID(), mode: "general", kind: "answer", model: "m", prompt_version_id: 1 });
    for (const role of ["anon", "authenticated"]) assert.equal((await h.attempt("select public.agent_record_turn($1::jsonb)", [p], role)).ok, false, role);
  }));

test("저장 끔 세션은 질문·답변·도구 입력 글이 0이고 수치는 남는다", () =>
  h.tx(async () => {
    const s = randomUUID();
    assert.equal((await open_(s, { save: false })).ok, true);
    assert.equal((await turn(s)).ok, true);
    const m = (await client.query("select question_masked, answer_masked, tokens_in from public.agent_messages where session_id = $1", [s])).rows[0];
    assert.equal(m.question_masked, null);
    assert.equal(m.answer_masked, null);
    const t = (await client.query("select input_summary from public.agent_tool_calls where message_id in (select id from public.agent_messages where session_id = $1)", [s])).rows[0];
    assert.equal(t.input_summary, null);
  }));

test("저장 끄기 호출은 이미 쌓인 글을 바로 비운다", () =>
  h.tx(async () => {
    const s = randomUUID();
    assert.equal((await turn(s)).ok, true);
    assert.equal((await h.attempt("select public.agent_session_save_off($1, null, false) as r", [s], "service_role")).rows[0].r, true);
    assert.equal((await client.query("select count(*)::int as n from public.agent_messages where session_id = $1 and (question_masked is not null or answer_masked is not null)", [s])).rows[0].n, 0);
  }));

test("파기: 비회원·회원 기한을 각자 판정하고 정각 경계는 만료, 1초 전은 유지", () =>
  h.tx(async () => {
    const a = randomUUID();
    const b = randomUUID();
    const c = randomUUID();
    for (const s of [a, b, c]) assert.equal((await turn(s)).ok, true);
    await client.query("update public.agent_sessions set retain_until = '2026-11-01T00:00:00Z' where id = $1", [a]);
    await client.query("update public.agent_sessions set retain_until = '2026-11-01T00:00:01Z' where id = $1", [b]);
    await client.query("update public.agent_sessions set retain_until = '2026-12-01T00:00:00Z' where id = $1", [c]);
    const r = (await h.attempt("select public.agent_purge('2026-11-01T00:00:00Z') as r", [], "service_role")).rows[0].r;
    assert.equal(r.guest_messages >= 1, true);
    const left = async (s) => (await client.query("select count(*)::int as n from public.agent_messages where session_id = $1 and question_masked is not null", [s])).rows[0].n;
    assert.equal(await left(a), 0, "정각 만료");
    assert.equal(await left(b), 1, "1초 전은 유지");
    assert.equal(await left(c), 1);
    assert.equal((await client.query("select count(*)::int as n from public.agent_messages where session_id = $1", [a])).rows[0].n, 1, "수치 행은 남는다");
  }));
