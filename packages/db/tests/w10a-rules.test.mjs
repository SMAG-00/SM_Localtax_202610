// W10-a DB - 룰셋·판정표·달력 생애, 서명·승인 함수, 대조 사례, 실행 기록, 공개 게이트 뷰 (마이그레이션 20261025000081~83, PRD-02 RULE-01~04 · TX-05 · CALC-14 · FAM-07)
//  · 틀: 세 표 RLS·권한(service_role 읽기+초안 추가만, 수정·삭제 0), 초안으로만 생성, 본문 해시, 본문 불변, 국세 낱말·허용 밖 최상위 칸 거부
//  · 서명: 감수위원만 / 초안만 / 감수 시트 필수 - 거부도 감사 1행
//  · 승인: 서명 없이 거부 / 근거 개정이 공포·시행일 때만 / 정정으로 대체·해당 없음 근거 거부 / 근거 없으면 사유 글 / 이전 활성본 retired / 활성 1행 / 거부도 감사 1행
//  · 사례: 개인정보 흔적 거부, 입력·공식 결과 불변, 확인은 감수위원만
//  · 게이트 뷰: 29/30/30(+표본 50) 경계, 원인별 독립, 확인 안 된 사례·지어낸 사례(synthetic)는 세지 않음, 실행 뒤 사례를 더하면 닫힘, 활성 룰셋 없으면 닫힘
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0). 내용은 시험용 가짜다 - 실제 세율·한도·법령 문장 없음.
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
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
async function attempt(sql, params = [], role = null) {
  await client.query("savepoint t");
  try {
    if (role) await client.query(`set local role ${role}`);
    const res = await client.query(sql, params);
    if (role) await client.query("reset role");
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
const num = (v) => Number(v);
const user = async () => (await one("insert into auth.users (id) values (gen_random_uuid()) returning id")).id;
async function reviewer() {
  const id = await user();
  await client.query("insert into public.staff_roles (user_id, role, granted_by) values ($1, 'reviewer', 'test')", [id]);
  return `user:${id}`;
}
const BODY = { version: "2099.01", status: "draft", effective_from: "2099-01-01", source_laws: [{ note: "시험용" }], acquisition: { note: "시험용" }, holding: { note: "시험용" }, oligopoly: { note: "시험용" } };
async function ruleset(over = {}) {
  const row = { version: `2${String(100 + (++seq % 899)).padStart(3, "0")}.01`, body: BODY, source_ref: "시험용", basis_note: "시험용 초기 반입", created_by: "test", ...over };
  const keys = Object.keys(row);
  return one(`insert into public.rulesets (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => (k === "body" ? JSON.stringify(row[k]) : row[k])));
}
const sign = async (kind, id, signer, sheet = "시험용 감수 시트") => (await one("select public.rule_sign($1, $2, $3, $4) r", [kind, id, signer, sheet])).r;
const approve = async (kind, id, who = "admin:test@example.test") => (await one("select public.rule_approve($1, $2, $3) r", [kind, id, who])).r;
const auditRows = async (kind, id) => (await client.query("select * from public.rules_audit where kind = $1 and target_id = $2 order by id", [kind, id])).rows;
async function amendmentEvent(stage, over = {}) {
  const am = (await one("insert into public.amendments (slug, title) values ($1, '시험용 개정안') returning id", [uniq("am")])).id;
  const snap = (await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('mois', 'https://example.test/s', $1, '시험용') returning id", [uniq("h")])).id;
  return (await one(
    "insert into public.amendment_events (amendment_id, stage, occurred_on, source_url, snapshot_id, recorded_by) values ($1, $2, '2099-01-01', 'https://example.test/s', $3, 'test') returning id",
    [am, stage, snap],
  )).id;
}

test("세 표와 감사·사례·실행 표 - RLS 켜짐, anon·authenticated 권한 0, service_role은 읽기+추가만(수정·삭제 0)", () =>
  tx(async () => {
    for (const t of ["rulesets", "determination_tables", "tax_calendar", "rules_audit", "accuracy_cases", "accuracy_runs", "accuracy_run_results"]) {
      const r = await one("select relrowsecurity rls from pg_class where oid = ('public.' || $1)::regclass", [t]);
      assert.equal(r.rls, true, t);
      for (const role of ["anon", "authenticated"]) assert.equal((await attempt(`select 1 from public.${t} limit 1`, [], role)).ok, false, `${role} ${t}`);
      assert.ok((await attempt(`select 1 from public.${t} limit 1`, [], "service_role")).ok, `service_role 읽기 ${t}`);
    }
    for (const t of ["rulesets", "determination_tables", "tax_calendar"]) {
      assert.equal((await attempt(`update public.${t} set source_ref = 'x'`, [], "service_role")).ok, false, `service_role 수정 ${t}`);
      assert.equal((await attempt(`delete from public.${t}`, [], "service_role")).ok, false, `service_role 삭제 ${t}`);
    }
    assert.equal((await attempt("update public.rules_audit set detail = 'x'", [], "service_role")).ok, false);
    assert.equal((await attempt("select * from public.calc_gate_status", [], "anon")).ok, false, "게이트 뷰 anon 거부");
    assert.ok((await attempt("select * from public.calc_gate_status", [], "service_role")).ok);
    assert.equal((await client.query("select 1 from public.rulesets")).rowCount, 0, "씨앗 0행");
  }));

test("룰셋 생성 - 초안으로만, 본문 해시는 DB가 계산, 활성 상태로 만들기 거부", () =>
  tx(async () => {
    const r = await ruleset();
    assert.equal(r.status, "draft");
    assert.match(r.body_sha256, /^[0-9a-f]{64}$/);
    assert.equal(r.body_sha256, (await one("select encode(sha256(convert_to(body::text, 'UTF8')), 'hex') h from public.rulesets where id = $1", [r.id])).h);
    const active = await attempt("insert into public.rulesets (version, status, body, body_sha256, source_ref, basis_note, created_by, signed_by, signed_at, sheet_ref, signed_body_sha256, activated_by, activated_at) values ('2099.77', 'active', $1, 'x', 's', 'n', 'c', 'u', now(), 's', 'x', 'a', now())", [JSON.stringify(BODY)]);
    assert.equal(active.ok, false);
    assert.equal((await attempt("insert into public.rulesets (version, status, body, body_sha256, source_ref, basis_note, created_by) values ('2099.78', 'reviewed', $1, 'x', 's', 'n', 'c')", [JSON.stringify(BODY)])).ok, false);
  }));

test("룰셋 본문 검사 - 허용 밖 최상위 칸·국세 낱말·버전 모양·근거 없음 거부", () =>
  tx(async () => {
    assert.equal((await attempt("select 1 where false")).ok, true);
    const bad = async (over) => (await attempt("insert into public.rulesets (version, body, body_sha256, source_ref, basis_note, created_by) values ($1, $2, 'x', 's', $3, 'c')", [over.version ?? "2099.50", JSON.stringify(over.body ?? BODY), over.basis ?? "n"])).ok;
    assert.equal(await bad({ body: { ...BODY, extra_section: {} } }), false, "허용 밖 최상위 칸");
    assert.equal(await bad({ body: { ...BODY, acquisition: { note: "시험용 " + "상속" + "세 문구" } } }), false, "국세 낱말");
    assert.equal(await bad({ body: { ...BODY, acquisition: { note: "inheritance_" + "tax" } } }), false, "영문 국세 낱말");
    assert.equal(await bad({ version: "2099-01" }), false, "버전 모양");
    assert.equal(await bad({ basis: "  " }), false, "근거 개정도 사유 글도 없음");
    assert.equal(await bad({}), true, "정상");
  }));

test("본문·버전·근거는 고칠 수 없고 상태·서명 칸은 함수 밖에서 바꿀 수 없다 (RULE-01·02)", () =>
  tx(async () => {
    const r = await ruleset();
    for (const set of ["body = '{}'::jsonb", "version = '2099.99'", "source_ref = 'x'", "basis_note = 'x'", "body_sha256 = 'x'"]) {
      assert.equal((await attempt(`update public.rulesets set ${set} where id = $1`, [r.id])).ok, false, set);
    }
    const direct = await attempt("update public.rulesets set status = 'reviewed', signed_by = 'u', signed_at = now(), sheet_ref = 's', signed_body_sha256 = body_sha256 where id = $1", [r.id]);
    assert.equal(direct.ok, false);
    assert.match(direct.message, /sign_\*\/approve_\* 함수로만/);
    assert.equal((await attempt("delete from public.rulesets where id = $1", [r.id])).ok, false);
    assert.equal((await attempt("truncate public.rulesets")).ok, false);
  }));

test("서명 - 감수위원만, 초안만, 감수 시트 필수. 성공·거부 모두 감사 1행 (RULE-03·04)", () =>
  tx(async () => {
    const rev = await reviewer();
    const nobody = `user:${await user()}`;
    const r = await ruleset();
    const notReviewer = await sign("ruleset", r.id, nobody);
    assert.deepEqual([notReviewer.ok, notReviewer.code], [false, "signer_not_reviewer"]);
    assert.equal((await sign("ruleset", r.id, "admin:test@example.test")).code, "signer_not_reviewer", "관리자 표시로는 서명 불가");
    assert.equal((await sign("ruleset", r.id, rev, "  ")).code, "sheet_missing");
    assert.equal((await sign("ruleset", 999999999, rev)).code, "not_found");
    assert.deepEqual((await auditRows("ruleset", r.id)).map((a) => [a.action, a.outcome, a.code]), [["sign", "refused", "signer_not_reviewer"], ["sign", "refused", "signer_not_reviewer"], ["sign", "refused", "sheet_missing"]]);
    const ok = await sign("ruleset", r.id, rev, "시험용 시트 A1");
    assert.deepEqual([ok.ok, ok.code], [true, "ok"]);
    const row = await one("select * from public.rulesets where id = $1", [r.id]);
    assert.equal(row.status, "reviewed");
    assert.equal(row.signed_by, rev);
    assert.equal(row.signed_body_sha256, row.body_sha256);
    assert.equal((await sign("ruleset", r.id, rev)).code, "not_draft", "두 번 서명 거부");
    assert.equal((await auditRows("ruleset", r.id)).length, 5);
  }));

test("승인 - 서명 없는 승인 거부(상태 변화 0), 서명 뒤 승인되고 이전 활성본은 retired, 활성은 1행 (RULE-02)", () =>
  tx(async () => {
    const rev = await reviewer();
    const a = await ruleset();
    const unsigned = await approve("ruleset", a.id);
    assert.deepEqual([unsigned.ok, unsigned.code], [false, "not_signed"]);
    assert.equal((await one("select status from public.rulesets where id = $1", [a.id])).status, "draft");
    assert.equal((await approve("ruleset", a.id, "nobody")).code, "approver_invalid");
    await sign("ruleset", a.id, rev);
    const ok = await approve("ruleset", a.id);
    assert.equal(ok.ok, true);
    assert.equal((await one("select status, activated_by from public.rulesets where id = $1", [a.id])).activated_by, "admin:test@example.test");
    assert.equal((await approve("ruleset", a.id)).code, "already_active");
    const b = await ruleset();
    await sign("ruleset", b.id, rev);
    assert.equal((await approve("ruleset", b.id)).ok, true);
    const rows = (await client.query("select id, status, retired_at from public.rulesets where id in ($1, $2) order by id", [a.id, b.id])).rows;
    assert.deepEqual(rows.map((x) => x.status), ["retired", "active"]);
    assert.ok(rows[0].retired_at);
    assert.equal((await client.query("select 1 from public.rulesets where status = 'active'")).rowCount, 1);
    assert.equal((await approve("ruleset", a.id)).code, "retired", "내려간 버전 재활성 거부");
    assert.deepEqual((await auditRows("ruleset", a.id)).map((x) => `${x.action}:${x.outcome}:${x.code}`), ["approve:refused:not_signed", "approve:refused:approver_invalid", "sign:ok:ok", "approve:ok:ok", "approve:refused:already_active", "approve:refused:retired"]);
  }));

test("승인 - 근거 개정 단계 검사: 공포·시행만 통과, 입법예고·국회 제출 등은 거부(TX-05), 거부도 감사에 근거 번호와 함께 남는다", () =>
  tx(async () => {
    const rev = await reviewer();
    for (const stage of ["announced", "pre_notice", "submitted", "passed"]) {
      const ev = await amendmentEvent(stage);
      const r = await ruleset({ basis_event_id: ev, basis_note: null });
      await sign("ruleset", r.id, rev);
      const res = await approve("ruleset", r.id);
      assert.deepEqual([res.ok, res.code], [false, "basis_stage"], stage);
      assert.equal((await one("select status from public.rulesets where id = $1", [r.id])).status, "reviewed", "상태 변화 0");
      const audit = (await auditRows("ruleset", r.id)).at(-1);
      assert.deepEqual([audit.outcome, audit.code, num(audit.basis_event_id)], ["refused", "basis_stage", num(ev)]);
    }
    for (const stage of ["promulgated", "effective"]) {
      const ev = await amendmentEvent(stage);
      const r = await ruleset({ basis_event_id: ev, basis_note: null });
      await sign("ruleset", r.id, rev);
      assert.equal((await approve("ruleset", r.id)).ok, true, stage);
      assert.equal(num((await auditRows("ruleset", r.id)).at(-1).basis_event_id), num(ev));
    }
  }));

test("승인 - 정정으로 대체된 근거·'해당 없음' 근거 거부, 개정과 무관한 정정은 사유 글로 승인 가능 (TX-05)", () =>
  tx(async () => {
    const rev = await reviewer();
    const original = await amendmentEvent("promulgated");
    const am = (await one("select amendment_id from public.amendment_events where id = $1", [original])).amendment_id;
    const snap = (await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('mois', 'https://example.test/c', $1, '시험용') returning id", [uniq("h")])).id;
    await client.query(
      "insert into public.amendment_events (amendment_id, stage, occurred_on, source_url, snapshot_id, correction_of, reason, recorded_by) values ($1, 'promulgated', '2099-01-02', 'https://example.test/c', $2, $3, '시험용 정정', 'test')",
      [am, snap, original],
    );
    const r1 = await ruleset({ basis_event_id: original, basis_note: null });
    await sign("ruleset", r1.id, rev);
    assert.equal((await approve("ruleset", r1.id)).code, "basis_corrected");
    const am2 = (await one("insert into public.amendments (slug, title) values ($1, '시험용') returning id", [uniq("am")])).id;
    const skipped = (await one("insert into public.amendment_events (amendment_id, stage, skipped, skip_reason, recorded_by) values ($1, 'passed', true, '시험용', 'test') returning id", [am2])).id;
    const r2 = await ruleset({ basis_event_id: skipped, basis_note: null });
    await sign("ruleset", r2.id, rev);
    assert.equal((await approve("ruleset", r2.id)).code, "basis_skipped");
    const r3 = await ruleset({ basis_note: "시험용 감수 정정 - 개정과 무관" });
    await sign("ruleset", r3.id, rev);
    assert.equal((await approve("ruleset", r3.id)).ok, true);
  }));

test("판정표(종류별 활성 1행)·달력(활성 1행)도 같은 경로 - 서명 없는 승인 거부, 다른 종류의 활성본은 그대로", () =>
  tx(async () => {
    const rev = await reviewer();
    const mk = async (kind, version) => one("insert into public.determination_tables (kind, version, body, body_sha256, source_ref, basis_note, created_by) values ($1, $2, '{\"시험용\": true}', 'x', 's', 'n', 'c') returning id", [kind, version]);
    const refund = await mk("refund", "2099.01");
    const reduction = await mk("reduction", "2099.01");
    assert.equal((await one("select public.approve_determination_table($1, 'admin:t') r", [refund.id])).r.code, "not_signed");
    assert.equal((await one("select public.sign_determination_table($1, $2, '시트') r", [refund.id, rev])).r.ok, true);
    assert.equal((await one("select public.sign_determination_table($1, $2, '시트') r", [reduction.id, rev])).r.ok, true);
    assert.equal((await one("select public.approve_determination_table($1, 'admin:t') r", [refund.id])).r.ok, true);
    assert.equal((await one("select public.approve_determination_table($1, 'admin:t') r", [reduction.id])).r.ok, true);
    assert.deepEqual((await client.query("select kind, status from public.determination_tables order by kind")).rows.map((x) => `${x.kind}:${x.status}`), ["reduction:active", "refund:active"]);
    const refund2 = await mk("refund", "2099.02");
    await client.query("select public.sign_determination_table($1, $2, '시트')", [refund2.id, rev]);
    await client.query("select public.approve_determination_table($1, 'admin:t')", [refund2.id]);
    assert.deepEqual((await client.query("select version, status from public.determination_tables where kind = 'refund' order by version")).rows.map((x) => `${x.version}:${x.status}`), ["2099.01:retired", "2099.02:active"]);
    assert.equal((await one("select status from public.determination_tables where kind = 'reduction'")).status, "active");
    const cal = (await one("insert into public.tax_calendar (version, body, body_sha256, source_ref, basis_note, created_by) values ('2099.01', '{\"시험용\": true}', 'x', 's', 'n', 'c') returning id")).id;
    assert.equal((await one("select public.approve_tax_calendar($1, 'admin:t') r", [cal])).r.code, "not_signed");
    await client.query("select public.sign_tax_calendar($1, $2, '시트')", [cal, rev]);
    assert.equal((await one("select public.approve_tax_calendar($1, 'admin:t') r", [cal])).r.ok, true);
  }));

test("함수 권한 - anon·authenticated는 서명·승인·기록 함수를 부를 수 없다", () =>
  tx(async () => {
    for (const call of ["select public.approve_ruleset(1, 'admin:t')", "select public.sign_ruleset(1, 'user:x', 's')", "select public.rule_approve('ruleset', 1, 'admin:t')", "select public.record_accuracy_run(1, 'x', 't', '[]')", "select public.confirm_accuracy_case(1, 'user:x')"]) {
      for (const role of ["anon", "authenticated"]) assert.equal((await attempt(call, [], role)).ok, false, `${role} ${call}`);
    }
  }));

// ── 대조 사례 · 게이트 ────────────────────────────────────────
let caseSeq = 0;
async function addCase(over = {}) {
  const row = { case_key: uniq("c"), tax_kind: "property", cause: null, sample_kind: "official", case_input: { propertyKind: "HOUSE", price: 100 + ++caseSeq }, official_total: 1000, official_basis: "tax_notice", entered_by: "test", ...over };
  if (row.sample_kind === "review_sample") row.official_basis = "reviewer_calc";
  const keys = Object.keys(row);
  return one(`insert into public.accuracy_cases (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, keys.map((k) => (k === "case_input" ? JSON.stringify(row[k]) : row[k])));
}
async function confirmAll(rev) {
  const ids = (await client.query("select id from public.accuracy_cases where confirmed_at is null and retired_at is null and not synthetic")).rows;
  for (const { id } of ids) await client.query("select public.confirm_accuracy_case($1, $2)", [id, rev]);
}
async function activeRuleset(rev) {
  const r = await ruleset();
  await sign("ruleset", r.id, rev);
  await approve("ruleset", r.id);
  return r.id;
}
const HASH = "a".repeat(64);
async function runAll(rulesetId, mismatchIds = []) {
  const rows = (await client.query("select id, official_total from public.accuracy_cases where confirmed_at is not null and retired_at is null")).rows;
  const results = rows.map((c) => ({ case_id: num(c.id), engine_total: num(c.official_total) + (mismatchIds.includes(num(c.id)) ? 1 : 0) }));
  return num((await one("select public.record_accuracy_run($1, $2, 'test', $3::jsonb) id", [rulesetId, HASH, JSON.stringify(results)])).id);
}
const gate = async (tax, group) => one("select * from public.calc_gate_status where tax_kind = $1 and cause_group = $2", [tax, group]);

test("사례 입력 - 개인정보 흔적 거부(칸 이름·한글 문장·긴 숫자·이메일), 엔진 입력 칸 이름(ownerType 등)은 통과", () =>
  tx(async () => {
    for (const input of [{ ownerName: "abc" }, { address: "x" }, { phone: "x" }, { note: "홍길동 소유" }, { memo: "서울시 강남구" }, { ref: "1234567890" }, { ref: "a@example.test" }, { nested: { 주소: "x" } }, { list: [{ email: "x" }] }, { s: "a".repeat(41) }]) {
      const res = await attempt("insert into public.accuracy_cases (case_key, tax_kind, sample_kind, case_input, official_total, official_basis, entered_by) values ($1, 'property', 'official', $2, 1, 'tax_notice', 't')", [uniq("c"), JSON.stringify(input)]);
      assert.equal(res.ok, false, JSON.stringify(input));
    }
    const okInput = { ownerType: "INDIVIDUAL", propertyKind: "HOUSE", acquiredOn: "2099-01-01", price: 123456789, flags: [true, false], ownerAge: 60 };
    assert.ok((await attempt("insert into public.accuracy_cases (case_key, tax_kind, sample_kind, case_input, official_total, official_basis, entered_by) values ($1, 'property', 'official', $2, 1, 'tax_notice', 't')", [uniq("c"), JSON.stringify(okInput)])).ok);
    assert.equal((await attempt("insert into public.accuracy_cases (case_key, tax_kind, sample_kind, case_input, official_total, official_basis, entered_by, mismatch_note) values ($1, 'property', 'official', '{}', 1, 'tax_notice', 't', '연락처 010-1234-5678 9876543210')", [uniq("c")])).ok, false, "메모 번호");
    // 세목 값 목록 - 국세 세목은 넣을 수 없다. 취득세만 원인 필수
    assert.equal((await attempt("insert into public.accuracy_cases (case_key, tax_kind, sample_kind, case_input, official_total, official_basis, entered_by) values ($1, 'other_tax', 'official', '{}', 1, 'tax_notice', 't')", [uniq("c")])).ok, false);
    assert.equal((await attempt("insert into public.accuracy_cases (case_key, tax_kind, sample_kind, case_input, official_total, official_basis, entered_by) values ($1, 'acquisition', 'official', '{}', 1, 'tax_notice', 't')", [uniq("c")])).ok, false, "취득세는 원인 필수");
    assert.equal((await attempt("insert into public.accuracy_cases (case_key, tax_kind, cause, sample_kind, case_input, official_total, official_basis, entered_by) values ($1, 'property', 'GIFT', 'official', '{}', 1, 'tax_notice', 't')", [uniq("c")])).ok, false, "취득세 아닌데 원인");
    assert.equal((await attempt("insert into public.accuracy_cases (case_key, tax_kind, cause, sample_kind, case_input, official_total, official_basis, entered_by) values ($1, 'acquisition', 'SWAP', 'official', '{}', 1, 'tax_notice', 't')", [uniq("c")])).ok, false, "원인 4종 밖");
  }));

test("사례 변경 - 입력·공식 결과 불변, 삭제 0, 확인은 감수위원 함수로만(직접 수정·비감수위원 거부), 철회는 retired_at", () =>
  tx(async () => {
    const rev = await reviewer();
    const c = await addCase();
    for (const set of ["official_total = 1", "case_input = '{}'::jsonb", "tax_kind = 'comprehensive'", "synthetic = true"]) assert.equal((await attempt(`update public.accuracy_cases set ${set} where id = $1`, [c.id])).ok, false, set);
    assert.equal((await attempt("update public.accuracy_cases set confirmed_by = 'u', confirmed_at = now() where id = $1", [c.id])).ok, false, "직접 확인 거부");
    assert.equal((await attempt("delete from public.accuracy_cases where id = $1", [c.id])).ok, false);
    assert.equal((await one("select public.confirm_accuracy_case($1, $2) r", [c.id, `user:${await user()}`])).r.code, "actor_not_reviewer");
    assert.equal((await one("select public.confirm_accuracy_case($1, $2) r", [c.id, rev])).r.ok, true);
    assert.equal((await one("select public.confirm_accuracy_case($1, $2) r", [c.id, rev])).r.code, "already_confirmed");
    assert.ok((await attempt("update public.accuracy_cases set retired_at = now() where id = $1", [c.id], "service_role")).ok, "철회");
    assert.equal((await one("select public.confirm_accuracy_case($1, $2) r", [c.id, rev])).r.code, "retired");
  }));

test("실행 기록 - 추가만, matched는 함수가 계산, 미확인·철회 사례가 섞이면 거부", () =>
  tx(async () => {
    const rev = await reviewer();
    const rs = await activeRuleset(rev);
    const a = await addCase({ official_total: 500 });
    const b = await addCase({ official_total: 700 });
    await client.query("select public.confirm_accuracy_case($1, $2)", [a.id, rev]);
    const unconfirmed = await attempt("select public.record_accuracy_run($1, $2, 't', $3::jsonb)", [rs, HASH, JSON.stringify([{ case_id: num(b.id), engine_total: 700 }])]);
    assert.equal(unconfirmed.ok, false);
    const runId = num((await one("select public.record_accuracy_run($1, $2, 't', $3::jsonb) id", [rs, HASH, JSON.stringify([{ case_id: num(a.id), engine_total: 501 }])])).id);
    const res = await one("select matched, engine_total from public.accuracy_run_results where run_id = $1", [runId]);
    assert.deepEqual([res.matched, num(res.engine_total)], [false, 501], "1원 차이도 불일치");
    const run = await one("select case_count, matched_count from public.accuracy_runs where id = $1", [runId]);
    assert.deepEqual([run.case_count, run.matched_count], [1, 0]);
    assert.equal((await attempt("update public.accuracy_runs set matched_count = 1 where id = $1", [runId])).ok, false);
    assert.equal((await attempt("delete from public.accuracy_run_results where run_id = $1", [runId])).ok, false);
    assert.equal((await attempt("select public.record_accuracy_run(999999999, $1, 't', '[]')", [HASH])).ok, false, "없는 룰셋");
    assert.equal((await attempt("select public.record_accuracy_run($1, 'short', 't', '[]')", [rs])).ok, false, "엔진 해시 모양");
  }));

async function seedGroup({ tax = "property", cause = null, official, samples, rev }) {
  for (let i = 0; i < official; i++) await addCase({ tax_kind: tax, cause });
  for (let i = 0; i < samples; i++) await addCase({ tax_kind: tax, cause, sample_kind: "review_sample" });
  await confirmAll(rev);
}

test("게이트 경계 - 공식 29건 전부 일치+표본 50 -> 닫힘 / 30건 전부 일치+표본 50 -> 열림 / 30건 중 1건 불일치 -> 닫힘 (CALC-14)", () =>
  tx(async () => {
    const rev = await reviewer();
    const rs = await activeRuleset(rev);
    await seedGroup({ official: 29, samples: 50, rev });
    await runAll(rs);
    let g = await gate("property", "ALL");
    assert.deepEqual([num(g.official_cases), num(g.official_matched), num(g.sample_cases), num(g.sample_matched), g.is_open], [29, 29, 50, 50, false], "29건");
    await addCase({}); // 30번째
    await confirmAll(rev);
    assert.equal((await gate("property", "ALL")).is_open, false, "30번째를 더한 뒤 실행 전에는 닫힘(실행이 사례를 다 덮지 못함)");
    await runAll(rs);
    g = await gate("property", "ALL");
    assert.deepEqual([num(g.official_cases), num(g.official_matched), g.is_open], [30, 30, true], "30건 + 표본 50");
    assert.equal(g.ruleset_version.length, 7);
    assert.equal(g.engine_hash, HASH);
    const firstOfficial = num((await one("select id from public.accuracy_cases where sample_kind = 'official' order by id limit 1")).id);
    await runAll(rs, [firstOfficial]);
    g = await gate("property", "ALL");
    assert.deepEqual([num(g.official_matched), g.is_open], [29, false], "30건 중 1건 불일치");
    assert.equal((await gate("comprehensive", "ALL")).is_open, false, "다른 세목은 그대로 닫힘");
  }));

test("게이트 경계 - 표본 49건이면 닫힘, 표본 1건 불일치도 닫힘, 표본은 세목 안에서 원인 묶음 합산", () =>
  tx(async () => {
    const rev = await reviewer();
    const rs = await activeRuleset(rev);
    await seedGroup({ official: 30, samples: 49, rev });
    await runAll(rs);
    assert.deepEqual([num((await gate("property", "ALL")).sample_cases), (await gate("property", "ALL")).is_open], [49, false]);
    await addCase({ sample_kind: "review_sample" });
    await confirmAll(rev);
    const sampleId = num((await one("select id from public.accuracy_cases where sample_kind = 'review_sample' order by id desc limit 1")).id);
    await runAll(rs, [sampleId]);
    let g = await gate("property", "ALL");
    assert.deepEqual([num(g.sample_cases), num(g.sample_matched), g.is_open], [50, 49, false]);
    await runAll(rs);
    assert.equal((await gate("property", "ALL")).is_open, true);
    // 취득세 - 표본 50은 원인 묶음 합산 (상속 25 + 증여 25), 공식 30은 묶음마다
    for (const c of ["INHERITANCE", "GIFT"]) {
      for (let i = 0; i < 30; i++) await addCase({ tax_kind: "acquisition", cause: c });
      for (let i = 0; i < 25; i++) await addCase({ tax_kind: "acquisition", cause: c, sample_kind: "review_sample" });
    }
    await confirmAll(rev);
    await runAll(rs);
    assert.deepEqual([(await gate("acquisition", "INHERITANCE")).is_open, (await gate("acquisition", "GIFT")).is_open, (await gate("acquisition", "OTHER")).is_open], [true, true, false], "OTHER는 공식 0건이라 닫힘");
  }));

test("게이트 - 원인별 독립(FAM-07): 상속 29건 전부 일치는 닫힘, 증여 30건 전부 일치는 열림, 상속 미통과가 증여·유상취득 묶음에 영향 0", () =>
  tx(async () => {
    const rev = await reviewer();
    const rs = await activeRuleset(rev);
    for (let i = 0; i < 29; i++) await addCase({ tax_kind: "acquisition", cause: "INHERITANCE" });
    for (let i = 0; i < 30; i++) await addCase({ tax_kind: "acquisition", cause: "GIFT" });
    for (let i = 0; i < 30; i++) await addCase({ tax_kind: "acquisition", cause: i % 2 ? "PAID" : "ORIGINAL" });
    for (let i = 0; i < 50; i++) await addCase({ tax_kind: "acquisition", cause: "PAID", sample_kind: "review_sample" });
    await confirmAll(rev);
    await runAll(rs);
    const by = Object.fromEntries((await client.query("select cause_group, is_open, official_cases from public.calc_gate_status where tax_kind = 'acquisition'")).rows.map((x) => [x.cause_group, [x.is_open, num(x.official_cases)]]));
    assert.deepEqual(by, { INHERITANCE: [false, 29], GIFT: [true, 30], OTHER: [true, 30] });
  }));

test("게이트 - 확인 안 된 사례·지어낸(synthetic) 사례·철회 사례는 세지 않고, 활성 룰셋이 없거나 룰셋이 바뀌면 닫힌다", () =>
  tx(async () => {
    const rev = await reviewer();
    const rs = await activeRuleset(rev);
    await seedGroup({ official: 30, samples: 50, rev });
    await runAll(rs);
    assert.equal((await gate("property", "ALL")).is_open, true);
    // 확인 안 된 사례 추가 - 센 숫자에 안 들어가므로 계속 열림 / synthetic도 같다
    await addCase();
    await addCase({ synthetic: true });
    assert.equal((await gate("property", "ALL")).is_open, true);
    assert.equal(num((await gate("property", "ALL")).official_cases), 30);
    // 철회하면 센 숫자가 29로 줄어 닫힘
    const id = num((await one("select id from public.accuracy_cases where sample_kind = 'official' and confirmed_at is not null order by id limit 1")).id);
    await client.query("update public.accuracy_cases set retired_at = now() where id = $1", [id]);
    assert.deepEqual([num((await gate("property", "ALL")).official_cases), (await gate("property", "ALL")).is_open], [29, false]);
    await client.query("update public.accuracy_cases set retired_at = null where id = $1", [id]);
    assert.equal((await gate("property", "ALL")).is_open, true);
    // 새 룰셋을 활성화하면 그 룰셋의 실행이 있어야 열린다
    const next = await ruleset();
    await sign("ruleset", next.id, rev);
    await approve("ruleset", next.id);
    assert.deepEqual([(await gate("property", "ALL")).is_open, (await gate("property", "ALL")).last_run_id], [false, null]);
    await runAll(num(next.id));
    assert.equal((await gate("property", "ALL")).is_open, true);
    // 활성 룰셋이 없으면 (초안만) 닫힘
    await client.query("set local ltr.rules_gate = 'rpc'");
    await client.query("update public.rulesets set status = 'retired', retired_at = now() where status = 'active'");
    assert.equal((await gate("property", "ALL")).is_open, false);
  }));

test("게이트 뷰에는 설정·수동 칸이 없다 - 열림 여부는 뷰 정의가 계산하고, 칸 목록에 override·manual이 없다", () =>
  tx(async () => {
    const cols = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'calc_gate_status' order by ordinal_position")).rows.map((r) => r.column_name);
    assert.deepEqual(cols, ["tax_kind", "cause_group", "ruleset_version", "last_run_id", "run_at", "engine_hash", "official_cases", "official_matched", "sample_cases", "sample_matched", "is_open"]);
    const def = (await one("select pg_get_viewdef('public.calc_gate_status'::regclass) d")).d;
    assert.ok(!/settings/i.test(def), "settings를 읽지 않는다");
    const rows = (await client.query("select tax_kind, cause_group from public.calc_gate_status order by 1, 2")).rows.map((r) => `${r.tax_kind}:${r.cause_group}`);
    assert.deepEqual(rows, ["acquisition:GIFT", "acquisition:INHERITANCE", "acquisition:OTHER", "comprehensive:ALL", "property:ALL"], "국세 세목 묶음 없음");
  }));
