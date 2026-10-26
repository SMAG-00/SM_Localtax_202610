// W12-e e3 DB - 게이트 값 · 리포트 · 승인 RPC (마이그레이션 20261026000164, PRD-04 EVAL-04 · 9장, docs/dev/W12-e_설계.md)
//  · 게이트 값: 4c 기준보다 낮은 값 저장 거부, 0이어야 하는 지표 0 초과 거부, 문항 수 하한 거부, 씨앗은 PRD 9장 값
//  · 승인 RPC: 리포트 없이 단계 올리기·범위 켜기 실패 + 감사 1행, 시험용 문항 리포트 거부, 한 칸씩만, 내리기는 리포트 없이, 상속만 켜면 증여 그대로
//  · 설정 직접 쓰기 거부(ask_rollout·ask_scope_flags), 공개 판정 함수는 단계·플래그만
//  · 지표: 미확정은 집계에서 빠지고 통과를 막는다, 경계값
// 모든 시험은 거래 안에서 돌고 되돌린다. 문항 수가 많아 반복문으로 시험용 문항을 만든다 - 내용은 전부 '시험용' 가짜.
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
const ADMIN = "admin:test@example.test";
const thresholds = async () => (await one("select value from public.settings where key = 'eval_gate_thresholds'")).value;
const setThresholds = (v) => attempt("update public.settings set value = $1::jsonb where key = 'eval_gate_thresholds'", [JSON.stringify(v)]);
const auditCount = async () => Number((await one("select count(*) c from public.eval_audit")).c);
const rollout = async () => (await one("select value->>'stage' s from public.settings where key = 'ask_rollout'")).s;
const flags = async () => (await one("select value from public.settings where key = 'ask_scope_flags'")).value;

/** 동결한 판 + 문항 n개(정답 1개씩 인용) + 끝난 실행 + 두 채점자 일치 채점. opts.test = 시험용 문항 여부 */
async function fullRun({ scope = "base", n = 2, source = "fake", wrongAt = -1, dispute = false, extraCats = [] } = {}) {
  const set = await one("insert into public.eval_sets (scope, version, created_by) values ($1, $2, 'admin:t') returning id", [scope, `g${process.pid}_${++seq}`]);
  const q = "[시험용] q";
  const itemIds = [];
  for (let i = 0; i < n; i++) {
    const cat = extraCats[i] ?? null;
    const behavior = cat === "national_tax_amount" ? "blocked" : "answer";
    const it = await one(
      `insert into public.eval_items (set_id, item_key, scope, category, question, expected_behavior, expected_conclusion, required_citation_ids, is_test, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, true, 't') returning id`,
      [set.id, `K${i}`, scope, cat, q, behavior, behavior === "answer" ? "x" : null, behavior === "answer" ? ["S1"] : []],
    );
    itemIds.push(it.id);
  }
  await client.query("select public.eval_set_freeze($1, 'admin:t')", [set.id]);
  const run = await one("insert into public.eval_runs (set_id, kind, answer_source, model, prompt_version, index_version, created_by) values ($1, 'gate', $2, 'm', 'p', 'i', 't') returning id, fingerprint", [set.id, source]);
  const g1 = uid();
  const g2 = uid();
  const answers = [];
  for (let i = 0; i < itemIds.length; i++) {
    const blocked = extraCats[i] === "national_tax_amount";
    const a = await one("insert into public.eval_answers (run_id, item_id, answer_text, behavior, cited_ids) values ($1, $2, '[시험용] a', $3, $4) returning id", [run.id, itemIds[i], blocked ? "blocked" : "answer", blocked ? [] : ["S1"]]);
    answers.push(a.id);
    const verdict = i === wrongAt ? "incorrect" : "correct";
    await client.query("insert into public.eval_grades (answer_id, slot, grader, verdict, citations_supported) values ($1, 'first', $2, $3, $4)", [a.id, g1, verdict, blocked ? 0 : 1]);
    const v2 = dispute && i === 0 ? "incorrect" : verdict;
    await client.query("insert into public.eval_grades (answer_id, slot, grader, verdict, citations_supported) values ($1, 'second', $2, $3, $4)", [a.id, g2, v2, blocked ? 0 : 1]);
  }
  await client.query("update public.eval_runs set status = 'done', finished_at = now() where id = $1", [run.id]);
  return { set, run, answers, itemIds };
}

test("게이트 값 씨앗은 PRD 9장 값이고 하한 검사를 통과해 들어 있다", async () => {
  const v = await thresholds();
  assert.equal(Number(v.stages["4c"].accuracy_min), 0.9);
  assert.equal(Number(v.stages["4c"].citation_precision_min), 0.98);
  assert.equal(Number(v.stages["4c"].recall_min), 0.85);
  assert.equal(Number(v.stages["4c"].clarify_omission_max), 0.05);
  assert.equal(Number(v.stages["4a"].fatal_max), 2);
  assert.equal(Number(v.stages["4b"].fatal_max), 0);
  assert.equal(Number(v.scopes.inheritance.national_block_min), 1);
});

test("4c 기준보다 낮은 게이트 값은 저장 거부, 같은 값은 통과", () =>
  tx(async () => {
    const v = await thresholds();
    const low = structuredClone(v);
    low.stages["4c"].accuracy_min = 0.89;
    assert.equal((await setThresholds(low)).ok, false);
    const lowCite = structuredClone(v);
    lowCite.scopes.gift.citation_precision_min = 0.97;
    assert.equal((await setThresholds(lowCite)).ok, false);
    const lowOmit = structuredClone(v);
    lowOmit.stages["4c"].clarify_omission_max = 0.06;
    assert.equal((await setThresholds(lowOmit)).ok, false);
    assert.equal((await setThresholds(v)).ok, true);
  }));

test("지어낸 답 허용 1, 4b 치명 오류 허용 1, 문항 수 299는 저장 거부", () =>
  tx(async () => {
    const v = await thresholds();
    for (const edit of [(x) => (x.stages["4a"].invented_max = 1), (x) => (x.stages["4b"].fatal_max = 1), (x) => (x.stages["4a"].min_items = 299), (x) => (x.scopes.trust_redevelopment.min_items = 99)]) {
      const c = structuredClone(v);
      edit(c);
      assert.equal((await setThresholds(c)).ok, false);
    }
  }));

test("공개 단계·범위 플래그·게이트 값은 일반 설정 쓰기로 바꿀 수 없고 지울 수도 없다", () =>
  tx(async () => {
    assert.equal((await attempt("update public.settings set value = '{\"stage\": \"4c\"}'::jsonb where key = 'ask_rollout'")).ok, false);
    assert.equal((await attempt("update public.settings set value = '{\"trust_redevelopment\": true, \"inheritance\": false, \"gift\": false}'::jsonb where key = 'ask_scope_flags'")).ok, false);
    assert.equal((await attempt("delete from public.settings where key = 'ask_rollout'")).ok, false);
    assert.equal(await rollout(), "none");
  }));

test("리포트 없이 공개 단계를 올리면 실패하고 감사 1행이 남는다", () =>
  tx(async () => {
    const before = await auditCount();
    const r = (await one("select public.ask_rollout_approve('4a', null, $1) r", [ADMIN])).r;
    assert.deepEqual([r.ok, r.code], [false, "report_required"]);
    assert.equal(await auditCount(), before + 1);
    const a = await one("select action, outcome, code from public.eval_audit order by id desc limit 1");
    assert.deepEqual(a, { action: "rollout", outcome: "refused", code: "report_required" });
    assert.equal(await rollout(), "none");
  }));

test("리포트 없이 범위 플래그를 켜면 실패하고 감사 1행이 남으며 플래그는 그대로다", () =>
  tx(async () => {
    const before = await auditCount();
    const r = (await one("select public.ask_scope_approve('inheritance', true, null, $1) r", [ADMIN])).r;
    assert.deepEqual([r.ok, r.code], [false, "report_required"]);
    assert.equal(await auditCount(), before + 1);
    assert.deepEqual(await flags(), { trust_redevelopment: false, inheritance: false, gift: false });
  }));

test("지문(fingerprint) 없이 올리거나 켜면 fingerprint_required로 거부되고 감사 1행이 남는다", () =>
  tx(async () => {
    const before = await auditCount();
    const r = (await one("select public.ask_rollout_approve('4a', 1, $1) r", [ADMIN])).r;
    assert.deepEqual([r.ok, r.code], [false, "fingerprint_required"]);
    const s = (await one("select public.ask_scope_approve('gift', true, 1, $1) r", [ADMIN])).r;
    assert.deepEqual([s.ok, s.code], [false, "fingerprint_required"]);
    assert.equal(await auditCount(), before + 2);
    const a = await one("select action, outcome, code from public.eval_audit order by id desc limit 1");
    assert.deepEqual(a, { action: "scope", outcome: "refused", code: "fingerprint_required" });
    assert.equal(await rollout(), "none");
    assert.equal((await flags()).gift, false);
  }));

test("한 칸 건너뛰기(none -> 4c)와 알 수 없는 단계·범위는 거부, 거부마다 감사 1행", () =>
  tx(async () => {
    const before = await auditCount();
    assert.equal((await one("select public.ask_rollout_approve('4c', 1, $1) r", [ADMIN])).r.code, "stage_skip");
    assert.equal((await one("select public.ask_rollout_approve('9z', 1, $1) r", [ADMIN])).r.code, "stage_invalid");
    assert.equal((await one("select public.ask_scope_approve('tourism', true, 1, $1) r", [ADMIN])).r.code, "scope_invalid");
    assert.equal((await one("select public.ask_rollout_approve('4a', 1, 'nobody') r")).r.code, "actor_invalid");
    assert.equal(await auditCount(), before + 4);
  }));

test("시험용 문항이 든 평가셋의 리포트는 만들어지지만 확정되지 않고 공개 단계 승인도 거부된다", () =>
  tx(async () => {
    const { run } = await fullRun({ scope: "gift", n: 2, extraCats: [null, "national_tax_amount"] });
    const rep = (await one("select public.eval_gate_report_compile('scope', null, 'gift', $1, null, $2) r", [run.id, ADMIN])).r;
    assert.equal(rep.ok, true);
    assert.equal(rep.passed, false);
    const row = await one("select includes_test_items, passed from public.eval_gate_reports where id = $1", [rep.report_id]);
    assert.equal(row.includes_test_items, true);
    const conf = (await one("select public.eval_gate_report_confirm($1, $2) r", [rep.report_id, ADMIN])).r;
    assert.deepEqual([conf.ok, conf.code], [false, "test_items_in_report"]);
    const sc = (await one("select public.ask_scope_approve('gift', true, $1, $2, $3) r", [rep.report_id, ADMIN, run.fingerprint])).r;
    assert.deepEqual([sc.ok, sc.code], [false, "test_items_in_report"]);
    assert.equal((await flags()).gift, false);
    assert.equal((await attempt("update public.eval_gate_reports set confirmed_by = 'x', confirmed_at = now() where id = $1", [rep.report_id])).ok, false, "직접 확정 거부");
  }));

test("리포트는 컴파일 함수로만 만들 수 있다 (통과 칸 직접 입력 거부)", () =>
  tx(async () => {
    const { run } = await fullRun();
    const r = await attempt(
      `insert into public.eval_gate_reports (kind, stage, run_id, fingerprint, thresholds, metrics, evaluation, passed, live_ok, includes_test_items, created_by)
       values ('stage', '4a', $1, $2, '{}', '{}', '{}', true, true, false, 'x')`,
      [run.id, run.fingerprint],
    );
    assert.equal(r.ok, false);
  }));

test("동결하지 않은 판·끝나지 않은 실행·범위가 다른 실행은 리포트 거부", () =>
  tx(async () => {
    const { run } = await fullRun({ scope: "base" });
    assert.equal((await one("select public.eval_gate_report_compile('scope', null, 'gift', $1, null, $2) r", [run.id, ADMIN])).r.code, "scope_mismatch");
    assert.equal((await one("select public.eval_gate_report_compile('stage', '4a', null, 999999999, null, $1) r", [ADMIN])).r.code, "run_not_found");
    const set = await one("insert into public.eval_sets (scope, version, created_by) values ('base', $1, 't') returning id", [`d${process.pid}_${++seq}`]);
    const r2 = await one("insert into public.eval_runs (set_id, kind, answer_source, model, prompt_version, index_version, created_by) values ($1, 'gate', 'fake', 'm', 'p', 'i', 't') returning id", [set.id]);
    assert.equal((await one("select public.eval_gate_report_compile('stage', '4a', null, $1, null, $2) r", [r2.id, ADMIN])).r.code, "run_not_done");
  }));

test("지표: 2인이 갈린 답변은 미확정으로 집계에서 빠지고 리포트 통과를 막는다", () =>
  tx(async () => {
    const { run } = await fullRun({ n: 3, dispute: true });
    const m = await one("select public.eval_run_metrics($1) m", [run.id]);
    assert.equal(Number(m.m.unconfirmed), 1);
    assert.equal(Number(m.m.confirmed), 2);
    assert.equal(Number(m.m.accuracy), 1);
    const ev = await one("select public.eval_gate_evaluate($1::jsonb, (select value #> '{stages,4a}' from public.settings where key = 'eval_gate_thresholds')) e", [JSON.stringify(m.m)]);
    assert.equal(ev.e.passed, false);
    assert.ok(ev.e.shortfalls.includes("unconfirmed"));
  }));

test("지표: 오답 1건이면 정답률이 계산되고, 3인째 판정이 미확정을 확정으로 바꾼다", () =>
  tx(async () => {
    const r = await fullRun({ n: 4, wrongAt: 3 });
    const m = (await one("select public.eval_run_metrics($1) m", [r.run.id])).m;
    assert.equal(Number(m.accuracy), 0.75);
    assert.equal(Number(m.citation_precision), 1);
    const d = await fullRun({ n: 2, dispute: true });
    const [a] = d.answers;
    const g = await client.query("select grader from public.eval_grades where answer_id = $1 order by slot", [a]);
    await client.query("insert into public.eval_rechecks (answer_id, rechecked_by, note, recorded_by) values ($1, $2, '시험용', $3)", [a, g.rows.map((x) => x.grader), g.rows[0].grader]);
    await client.query("insert into public.eval_grades (answer_id, slot, grader, advisor_name, advised_on, verdict, citations_supported) values ($1, 'third', $2, '시험용 자문자', '2099-01-01', 'correct', 1)", [a, uid()]);
    const m2 = (await one("select public.eval_run_metrics($1) m", [d.run.id])).m;
    assert.equal(Number(m2.unconfirmed), 0);
    assert.equal(Number(m2.confirmed), 2);
  }));

test("공개 판정 함수는 단계와 범위 플래그만 돌려준다", () =>
  tx(async () => {
    const g = (await one("select public.public_ask_gate() g")).g;
    assert.deepEqual(Object.keys(g).sort(), ["scopes", "stage"]);
    assert.equal(g.stage, "none");
    assert.deepEqual(g.scopes, { trust_redevelopment: false, inheritance: false, gift: false });
  }));

test("eval_audit는 추가만 되고 anon은 공개 판정 함수만 실행할 수 있다", () =>
  tx(async () => {
    await client.query("select public.ask_rollout_approve('4a', null, $1)", [ADMIN]);
    assert.equal((await attempt("update public.eval_audit set code = 'x'")).ok, false);
    assert.equal((await attempt("delete from public.eval_audit")).ok, false);
    await client.query("savepoint r");
    await client.query("set local role anon");
    const pub = await attempt("select public.public_ask_gate()");
    const rpc = await attempt("select public.ask_rollout_approve('4a', null, 'admin:x')");
    await client.query("reset role");
    await client.query("rollback to savepoint r");
    assert.equal(pub.ok, true);
    assert.equal(rpc.ok, false);
  }));
