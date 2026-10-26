// W12-e e1 DB - 평가 표 (마이그레이션 20261026000163, PRD-04 EVAL-01·02, docs/dev/W12-e_설계.md)
//  · 문항: 시험용 표시 일치, 대화 출처 익명화·월간지 권리 확인 필요, 번호·이메일 거부, 교차 유형별 필수 칸, 동결한 판 수정 거부, 새 판 복사
//  · 채점: 첫째·둘째 다른 사람, 갈리면 '미확정', 재확인 기록 없이 3인째 거부, 3인째 확정, 자문자·일자 필수, 'ai:' 채점자 거부, 추가만
//  · 실행: fingerprint는 DB 계산, 끝난 실행 수정 거부
// 모든 시험은 거래 안에서 돌고 되돌린다. 내용은 전부 '시험용' 가짜다 - 실제 법령·세무 문장 없음.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

let seq = 0;
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
    return await fn();
  } finally {
    await client.query("rollback");
  }
}
const uid = () => `user:${crypto.randomUUID()}`;
const newSet = async (scope = "base") => one("insert into public.eval_sets (scope, version, created_by) values ($1, $2, 'admin:test') returning *", [scope, `t${process.pid}_${++seq}`]);
async function newItem(setId, over = {}) {
  const row = {
    set_id: setId, item_key: `K${++seq}`, scope: "base", question: "[시험용] 시험 문항", expected_behavior: "answer", expected_conclusion: "시험용 정답", required_citation_ids: ["S1"],
    is_test: true, created_by: "admin:test", ...over,
  };
  const keys = Object.keys(row);
  return one(`insert into public.eval_items (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => row[k]));
}
async function newRun(setId, over = {}) {
  const run = await one("insert into public.eval_runs (set_id, kind, answer_source, model, prompt_version, index_version, created_by) values ($1, 'single', 'fake', 'fake-model', 'p1', 'i1', 'admin:test') returning *", [setId]);
  return { ...run, ...over };
}
async function newAnswer(runId, itemId, cited = ["S1"]) {
  return one("insert into public.eval_answers (run_id, item_id, answer_text, behavior, cited_ids) values ($1, $2, '[시험용] 답변', 'answer', $3) returning *", [runId, itemId, cited]);
}
const grade = (answerId, slot, grader, over = {}) => {
  const row = { answer_id: answerId, slot, grader, verdict: "correct", citations_supported: 1, ...over };
  const keys = Object.keys(row);
  return attempt(`insert into public.eval_grades (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => row[k]));
};
const status = async (answerId) => (await one("select status, verdict from public.eval_answer_final where answer_id = $1", [answerId]));

test("시험용 문항은 is_test와 질문 머리 [시험용]이 맞아야 한다", () =>
  tx(async () => {
    const s = await newSet();
    assert.equal((await attempt("insert into public.eval_items (set_id, item_key, scope, question, expected_behavior, expected_conclusion, required_citation_ids, is_test, created_by) values ($1, 'A1', 'base', '일반 질문', 'answer', 'x', '{S1}', true, 't')", [s.id])).ok, false);
    assert.equal((await attempt("insert into public.eval_items (set_id, item_key, scope, question, expected_behavior, expected_conclusion, required_citation_ids, is_test, created_by) values ($1, 'A2', 'base', '[시험용] 질문', 'answer', 'x', '{S1}', false, 't')", [s.id])).ok, false);
    assert.ok((await newItem(s.id)).id);
  }));

test("대화 출처는 익명화 기록, 월간지·총람 출처는 권리 확인 기록이 있어야 저장된다", () =>
  tx(async () => {
    const s = await newSet();
    assert.equal((await attempt("insert into public.eval_items (set_id, item_key, scope, question, expected_behavior, expected_conclusion, required_citation_ids, is_test, origin, created_by) values ($1, 'C1', 'base', '[시험용] q', 'answer', 'x', '{S1}', true, 'conversation', 't')", [s.id])).ok, false);
    assert.equal((await attempt("insert into public.eval_items (set_id, item_key, scope, question, expected_behavior, expected_conclusion, required_citation_ids, is_test, origin, created_by) values ($1, 'C2', 'base', '[시험용] q', 'answer', 'x', '{S1}', true, 'casebook', 't')", [s.id])).ok, false);
    assert.equal((await attempt("insert into public.eval_items (set_id, item_key, scope, question, expected_behavior, expected_conclusion, required_citation_ids, is_test, origin, anonymized_by, anonymized_at, created_by) values ($1, 'C3', 'base', '[시험용] q', 'answer', 'x', '{S1}', true, 'conversation', 'admin:t', now(), 't')", [s.id])).ok, true);
  }));

test("질문에 숫자 9자리 이상·이메일 모양이 있으면 거부, 8자리는 통과", () =>
  tx(async () => {
    const s = await newSet();
    assert.equal((await attempt("insert into public.eval_items (set_id, item_key, scope, question, expected_behavior, is_test, created_by) values ($1, 'P1', 'base', '[시험용] 번호 123456789', 'no_answer', true, 't')", [s.id])).ok, false);
    assert.equal((await attempt("insert into public.eval_items (set_id, item_key, scope, question, expected_behavior, is_test, created_by) values ($1, 'P2', 'base', '[시험용] a@example.test', 'no_answer', true, 't')", [s.id])).ok, false);
    assert.equal((await attempt("insert into public.eval_items (set_id, item_key, scope, question, expected_behavior, is_test, created_by) values ($1, 'P3', 'base', '[시험용] 12345678', 'no_answer', true, 't')", [s.id])).ok, true);
  }));

test("역질문 문항은 기대 역질문, 실시간 조회 문항은 색인 제외 목록, 근거 답변은 결론·필수 근거가 필요하다", () =>
  tx(async () => {
    const s = await newSet();
    assert.equal((await attempt("insert into public.eval_items (set_id, item_key, scope, question, cross_types, expected_behavior, is_test, created_by) values ($1, 'X1', 'base', '[시험용] q', '{clarify}', 'no_answer', true, 't')", [s.id])).ok, false);
    assert.equal((await attempt("insert into public.eval_items (set_id, item_key, scope, question, cross_types, expected_behavior, is_test, created_by) values ($1, 'X2', 'base', '[시험용] q', '{live}', 'no_answer', true, 't')", [s.id])).ok, false);
    assert.equal((await attempt("insert into public.eval_items (set_id, item_key, scope, question, expected_behavior, is_test, created_by) values ($1, 'X3', 'base', '[시험용] q', 'answer', true, 't')", [s.id])).ok, false);
  }));

test("투자 추천 평가셋과 국세 금액 분류 문항의 기대 응답은 차단뿐이다", () =>
  tx(async () => {
    const inv = await newSet("investment");
    assert.equal((await attempt("insert into public.eval_items (set_id, item_key, scope, question, expected_behavior, expected_conclusion, required_citation_ids, is_test, created_by) values ($1, 'I1', 'investment', '[시험용] q', 'answer', 'x', '{S1}', true, 't')", [inv.id])).ok, false);
    assert.equal((await attempt("insert into public.eval_items (set_id, item_key, scope, question, expected_behavior, is_test, created_by) values ($1, 'I2', 'investment', '[시험용] q', 'blocked', true, 't')", [inv.id])).ok, true);
    const base = await newSet();
    assert.equal((await attempt("insert into public.eval_items (set_id, item_key, scope, category, question, expected_behavior, expected_conclusion, required_citation_ids, is_test, created_by) values ($1, 'N1', 'base', 'national_tax_amount', '[시험용] q', 'answer', 'x', '{S1}', true, 't')", [base.id])).ok, false);
  }));

test("문항 범위가 평가셋 범위와 다르면 거부", () =>
  tx(async () => {
    const s = await newSet("gift");
    assert.equal((await attempt("insert into public.eval_items (set_id, item_key, scope, question, expected_behavior, is_test, created_by) values ($1, 'S1', 'base', '[시험용] q', 'no_answer', true, 't')", [s.id])).ok, false);
  }));

test("동결한 판은 문항 추가·수정이 거부되고 새 판으로 복사하면 문항이 옮겨진다", () =>
  tx(async () => {
    const s = await newSet();
    const item = await newItem(s.id);
    assert.equal((await one("select public.eval_set_freeze($1, 'admin:t') r", [s.id])).r.ok, true);
    assert.equal((await attempt("update public.eval_items set question = '[시험용] 바꿈' where id = $1", [item.id])).ok, false);
    assert.equal((await attempt("insert into public.eval_items (set_id, item_key, scope, question, expected_behavior, is_test, created_by) values ($1, 'Z', 'base', '[시험용] q', 'no_answer', true, 't')", [s.id])).ok, false);
    assert.equal((await one("select public.eval_set_freeze($1, 'admin:t') r", [s.id])).r.code, "already_frozen");
    const copy = (await one("select public.eval_set_copy($1, $2, 'admin:t') r", [s.id, `c${process.pid}`])).r;
    assert.equal(copy.ok, true);
    assert.equal(copy.item_count, 1);
    assert.equal((await one("select status from public.eval_sets where id = $1", [copy.set_id])).status, "draft");
  }));

test("빈 평가셋은 동결할 수 없다", () =>
  tx(async () => {
    const s = await newSet();
    assert.equal((await one("select public.eval_set_freeze($1, 'admin:t') r", [s.id])).r.code, "empty_set");
  }));

test("실행 fingerprint는 DB가 계산하고 조건이 다르면 값이 달라지며 끝난 실행은 고칠 수 없다", () =>
  tx(async () => {
    const s = await newSet();
    const a = await newRun(s.id);
    assert.match(a.fingerprint, /^[0-9a-f]{64}$/);
    const b = await one("insert into public.eval_runs (set_id, kind, answer_source, model, prompt_version, index_version, created_by) values ($1, 'single', 'fake', 'fake-model', 'p2', 'i1', 'admin:test') returning fingerprint", [s.id]);
    assert.notEqual(a.fingerprint, b.fingerprint);
    assert.equal((await attempt("update public.eval_runs set model = 'other' where id = $1", [a.id])).ok, false);
    assert.equal((await attempt("update public.eval_runs set status = 'done', finished_at = now() where id = $1", [a.id])).ok, true);
    assert.equal((await attempt("update public.eval_runs set report = '{}' where id = $1", [a.id])).ok, false);
  }));

test("두 채점이 같으면 확정, 갈리면 미확정이고 확정 판정이 없다", () =>
  tx(async () => {
    const s = await newSet();
    const it = await newItem(s.id);
    const run = await newRun(s.id);
    const ans = await newAnswer(run.id, it.id);
    const [g1, g2] = [uid(), uid()];
    assert.equal((await status(ans.id)).status, "ungraded");
    assert.equal((await grade(ans.id, "first", g1)).ok, true);
    assert.equal((await status(ans.id)).status, "one_grade");
    assert.equal((await grade(ans.id, "second", g2)).ok, true);
    assert.deepEqual(await status(ans.id), { status: "confirmed", verdict: "correct" });

    const it2 = await newItem(s.id);
    const ans2 = await newAnswer(run.id, it2.id);
    await grade(ans2.id, "first", g1);
    await grade(ans2.id, "second", g2, { verdict: "incorrect" });
    assert.deepEqual(await status(ans2.id), { status: "disputed", verdict: null });
  }));

test("둘째 채점자가 첫째와 같으면 거부, 첫째 없이 둘째 거부, 'ai:' 채점자 거부", () =>
  tx(async () => {
    const s = await newSet();
    const it = await newItem(s.id);
    const ans = await newAnswer((await newRun(s.id)).id, it.id);
    const g1 = uid();
    assert.equal((await grade(ans.id, "second", uid())).ok, false);
    assert.equal((await grade(ans.id, "first", "ai:grader")).ok, false);
    assert.equal((await grade(ans.id, "first", g1)).ok, true);
    assert.equal((await grade(ans.id, "second", g1)).ok, false);
  }));

test("3인째는 재확인 기록 없이 거부되고 기록 뒤 자문자·일자와 함께 받으면 3인째 판정이 확정이다", () =>
  tx(async () => {
    const s = await newSet();
    const it = await newItem(s.id);
    const ans = await newAnswer((await newRun(s.id)).id, it.id);
    const [g1, g2, g3] = [uid(), uid(), uid()];
    await grade(ans.id, "first", g1);
    await grade(ans.id, "second", g2, { verdict: "incorrect" });
    assert.equal((await grade(ans.id, "third", g3, { advisor_name: "시험용 자문자", advised_on: "2099-01-01", verdict: "incorrect" })).ok, false);
    assert.equal((await attempt("insert into public.eval_rechecks (answer_id, rechecked_by, note, recorded_by) values ($1, $2, '시험용 재확인', $3)", [ans.id, [g1, uid()], g1])).ok, false);
    assert.equal((await attempt("insert into public.eval_rechecks (answer_id, rechecked_by, note, recorded_by) values ($1, $2, '시험용 재확인', $3)", [ans.id, [g1, g2], g1])).ok, true);
    assert.equal((await grade(ans.id, "third", g3, { verdict: "incorrect" })).ok, false, "자문자·일자 없이 거부");
    assert.equal((await grade(ans.id, "third", g3, { advisor_name: "시험용 자문자", advised_on: "2099-01-01", verdict: "incorrect" })).ok, true);
    assert.deepEqual(await status(ans.id), { status: "confirmed_third", verdict: "incorrect" });
  }));

test("두 채점이 같은 답변은 재확인도 3인째도 필요 없어 거부", () =>
  tx(async () => {
    const s = await newSet();
    const it = await newItem(s.id);
    const ans = await newAnswer((await newRun(s.id)).id, it.id);
    const [g1, g2] = [uid(), uid()];
    await grade(ans.id, "first", g1);
    await grade(ans.id, "second", g2);
    assert.equal((await attempt("insert into public.eval_rechecks (answer_id, rechecked_by, note, recorded_by) values ($1, $2, 'x', $3)", [ans.id, [g1, g2], g1])).ok, false);
  }));

test("채점은 추가만 되고 치명 오류는 오답에만 붙으며 뒷받침 인용 수는 인용 수를 넘지 못한다", () =>
  tx(async () => {
    const s = await newSet();
    const it = await newItem(s.id);
    const ans = await newAnswer((await newRun(s.id)).id, it.id, ["S1"]);
    const g1 = uid();
    assert.equal((await grade(ans.id, "first", g1, { fatal_error: "deadline_wrong" })).ok, false, "정답 판정에 치명 오류");
    assert.equal((await grade(ans.id, "first", g1, { citations_supported: 2 })).ok, false, "인용 1개인데 2개 뒷받침");
    const ok = await grade(ans.id, "first", g1);
    assert.equal(ok.ok, true);
    assert.equal((await attempt("update public.eval_grades set verdict = 'incorrect' where id = $1", [ok.rows[0].id])).ok, false);
    assert.equal((await attempt("delete from public.eval_grades where id = $1", [ok.rows[0].id])).ok, false);
  }));

test("anon·authenticated는 평가 표를 읽지 못한다", () =>
  tx(async () => {
    for (const t of ["eval_sets", "eval_items", "eval_runs", "eval_answers", "eval_grades", "eval_rechecks", "eval_answer_final"]) {
      for (const role of ["anon", "authenticated"]) {
        await client.query("savepoint r");
        await client.query(`set local role ${role}`);
        let denied = false;
        try {
          await client.query(`select 1 from public.${t} limit 1`);
        } catch {
          denied = true;
        }
        await client.query("rollback to savepoint r");
        await client.query("reset role");
        assert.ok(denied, `${role}가 ${t}를 읽을 수 있다`);
      }
    }
  }));
