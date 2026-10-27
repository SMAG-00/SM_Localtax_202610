// W13-e DB - 코파일럿 사용량·실행 기록 (마이그레이션 210·211, PRD-05 RES-05 · RES-03)
//  · 월 한도 n번째 성공 / n+1번째 거부 / 한도 비면 0 / 반환은 0 아래로 내려가지 않음
//  · 표 직접 접근 거부(anon·authenticated·service_role) · 함수는 service_role만
//  · 실행 기록에는 질문·답변 글 칸이 없음 · 요약 권리 필터는 없는 번호·모르는 형식을 빼 줌
// 글은 모두 시험용 가짜다. 모든 시험은 거래 안에서 돌고 되돌린다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { open, helpers } from "./_w10d_helpers.mjs";

let client;
let h;
before(async () => {
  client = await open();
  h = helpers(client);
});
after(async () => client?.end());

const user = async () => (await client.query("insert into auth.users (id) values (gen_random_uuid()) returning id")).rows[0].id;
const consume = async (uid, limit) => (await client.query("select public.copilot_consume($1, $2) as r", [uid, limit])).rows[0].r;

test("월 한도 n - n번째 실행 허용, n+1번째 거부", () =>
  h.tx(async () => {
    const uid = await user();
    const first = await consume(uid, 2);
    assert.deepEqual([first.allowed, first.used], [true, 1]);
    assert.equal((await consume(uid, 2)).allowed, true);
    const over = await consume(uid, 2);
    assert.deepEqual([over.allowed, over.code, over.used, over.limit], [false, "limit_reached", 2, 2]);
    const peek = (await client.query("select public.copilot_peek($1, 2) as r", [uid])).rows[0].r;
    assert.deepEqual([peek.used, peek.limit], [2, 2]);
  }));

test("한도가 비어 있거나 0 이하면 실행 0", () =>
  h.tx(async () => {
    const uid = await user();
    for (const limit of [null, 0, -3]) {
      const r = await consume(uid, limit);
      assert.deepEqual([r.allowed, r.code], [false, "limit_unset"], String(limit));
    }
    assert.equal((await client.query("select count(*)::int c from public.copilot_usage where user_id = $1", [uid])).rows[0].c, 0);
  }));

test("반환은 한 번 되돌리되 0 아래로 내려가지 않고, 되돌린 뒤 다시 허용", () =>
  h.tx(async () => {
    const uid = await user();
    await consume(uid, 1);
    assert.equal((await consume(uid, 1)).allowed, false);
    await client.query("select public.copilot_refund($1)", [uid]);
    assert.equal((await consume(uid, 1)).allowed, true);
    await client.query("select public.copilot_refund($1)", [uid]);
    await client.query("select public.copilot_refund($1)", [uid]);
    assert.equal((await client.query("select runs from public.copilot_usage where user_id = $1", [uid])).rows[0].runs, 0);
  }));

test("회원마다 따로 센다", () =>
  h.tx(async () => {
    const a = await user();
    const b = await user();
    await consume(a, 1);
    assert.equal((await consume(a, 1)).allowed, false);
    assert.equal((await consume(b, 1)).allowed, true);
  }));

test("표 직접 접근은 anon·authenticated·service_role 모두 거부, 함수는 service_role만", () =>
  h.tx(async () => {
    for (const t of ["copilot_usage", "copilot_runs"]) {
      for (const role of ["anon", "authenticated", "service_role"]) assert.equal((await h.attempt(`select * from public.${t}`, [], role)).ok, false, `${t} ${role}`);
    }
    const uid = await user();
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await h.attempt("select public.copilot_consume($1, 5)", [uid], role)).ok, false, `consume ${role}`);
      assert.equal((await h.attempt("select public.copilot_record_run('{}'::jsonb)", [], role)).ok, false, `record ${role}`);
      assert.equal((await h.attempt("select public.copilot_summary_allowed(array['node:1'])", [], role)).ok, false, `summary ${role}`);
    }
    assert.equal((await h.attempt("select public.copilot_consume($1, 5)", [uid], "service_role")).ok, true);
  }));

test("실행 기록 - 허용 칸만 저장하고 질문·답변 글 칸은 표에 없다", () =>
  h.tx(async () => {
    const uid = await user();
    const id = (await client.query("select public.copilot_record_run($1::jsonb) as id", [JSON.stringify({ user_id: uid, kind: "comparison", status: "answer", model: "시험모델", citation_ids: ["a:1", "b:2"], validation: { regenerated: false }, tokens_in: 10, tokens_out: 5, cost: 1.5, question: "저장되면 안 되는 글" })])).rows[0].id;
    const row = (await client.query("select * from public.copilot_runs where id = $1", [id])).rows[0];
    assert.deepEqual(row.citation_ids, ["a:1", "b:2"]);
    assert.equal(row.status, "answer");
    assert.deepEqual(Object.keys(row).filter((k) => /question|answer|body|text|message|note/.test(k)), []);
    assert.equal(JSON.stringify(row).includes("저장되면 안 되는 글"), false);
  }));

test("실행 기록 - 모르는 종류·상태는 거부", () =>
  h.tx(async () => {
    const uid = await user();
    assert.equal((await h.attempt("select public.copilot_record_run($1::jsonb)", [JSON.stringify({ user_id: uid, kind: "x", status: "answer" })])).ok, false);
    assert.equal((await h.attempt("select public.copilot_record_run($1::jsonb)", [JSON.stringify({ user_id: uid, kind: "history", status: "x" })])).ok, false);
  }));

test("요약 권리 필터 - 없는 번호·모르는 형식은 빠진다", () =>
  h.tx(async () => {
    const r = (await client.query("select public.copilot_summary_allowed(array['node:999999999', 'issue_article:999999999', 'lounge:1', 'article:5', '']) as r")).rows[0].r;
    assert.deepEqual(r, []);
    assert.deepEqual((await client.query("select public.copilot_summary_allowed(null) as r")).rows[0].r, []);
  }));
