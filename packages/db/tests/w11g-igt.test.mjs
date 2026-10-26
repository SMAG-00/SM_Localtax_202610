// W11-g DB - 상속·증여세 룰셋 표 · 서명/승인 · 대조 사례/실행/게이트 묶음 · 감시 법령/첫 검수 항목 · 공개 뷰 · 기능 키
// (마이그레이션 20261025000136~138, PRD-03 FAM-12·13, docs/dev/W11-g_설계.md)
//  · 틀: igt_rulesets RLS·권한, 초안으로만 생성, 본문 해시, 허용 밖 최상위 칸·묶음 빠짐·버전 불일치·다른 세목 낱말 거부, 본문 불변, 삭제 0
//  · 서명/승인: 감수위원만 서명(관리자·일반 사용자 거부 + 감사), 서명 없이 승인 거부 + 감사, 승인하면 이전 활성본 retired, 활성 1행
//  · 지방세 rulesets 의 국세 낱말 거부 트리거는 그대로
//  · 게이트: 증여 29건 닫힘 / 30건 + 표본 50건 열림, 증여·상속 따로, 사례를 더하면 다시 닫힘, 지방세 5줄은 그대로, 거주 여부 칸 이름은 개인정보 검사 통과·이름 칸은 거부
//  · laws: scope national_igt 3행, 다른 scope 에서는 상속·증여 이름 거부 유지, 첫 검수 항목 3건(제목에 시험용 없음)
//  · 공개 뷰: 활성 행만 anon 이 읽는다 / 표·함수는 anon 호출 0 / 기능 키 두 개 꺼짐
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0). 내용은 룰셋 초안(rules-igt)에서 읽은 값이며 실제 사례가 아니다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const j = (...p) => p.join(""); // 금지 낱말은 조각으로 적는다 (CI 낱말 검사 대상 파일)
const DRAFT = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../rules-igt/2026.07.json"), "utf8"));

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
  await client.query("lock table public.amendment_events in row share mode");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}
const user = async () => (await one("insert into auth.users (id) values (gen_random_uuid()) returning id")).id;
async function reviewer() {
  const id = await user();
  await client.query("insert into public.staff_roles (user_id, role, granted_by) values ($1, 'reviewer', 'test')", [id]);
  return `user:${id}`;
}
let verSeq = 0;
const bodyFor = (version, over = {}) => ({ ...DRAFT, version, ...over });
async function igt(over = {}) {
  const version = over.version ?? `2${String(100 + (++verSeq % 899)).padStart(3, "0")}.01`;
  const row = { version, body: bodyFor(version), source_ref: "시험용", basis_note: "시험용 초기 반입", created_by: "test", ...over };
  const keys = Object.keys(row);
  return one(`insert into public.igt_rulesets (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => (k === "body" ? JSON.stringify(row[k]) : row[k])));
}
const sign = async (id, signer, sheet = "시험용 감수 시트") => (await one("select public.sign_igt_ruleset($1, $2, $3) r", [id, signer, sheet])).r;
const approve = async (id, who = "admin:test@example.test") => (await one("select public.approve_igt_ruleset($1, $2) r", [id, who])).r;
const audit = async (id) => (await client.query("select * from public.rules_audit where kind = 'igt_ruleset' and target_id = $1 order by id", [id])).rows;
const HASH = "c".repeat(64);
async function activeRuleset() {
  const rev = await reviewer();
  const r = await igt();
  assert.equal((await sign(r.id, rev)).ok, true);
  assert.equal((await approve(r.id)).ok, true);
  return { r, rev };
}
async function addCases(taxKind, official, sample, rev, tag) {
  const ids = [];
  for (let i = 0; i < official + sample; i++) {
    const isOfficial = i < official;
    const input = taxKind === "gift"
      ? { gift_date: "2026-08-10", donor_relationship: "lineal_ascendant", recipient_is_resident: true, gift_value: 100_000_000 + i * 1_000_000 }
      : { death_date: "2026-03-15", decedent_resident: true, assets: { real_estate: 1_000_000_000 + i * 1_000_000 }, heirs: { spouse_exists: false, children_count: 1 } };
    const c = await one(
      "insert into public.accuracy_cases (case_key, tax_kind, sample_kind, case_input, official_total, official_basis, entered_by) values ($1, $2, $3, $4, $5, $6, 'test') returning id",
      [uniq(`${tag}-${taxKind}`), taxKind, isOfficial ? "official" : "review_sample", JSON.stringify(input), 1000 + i, isOfficial ? "tax_notice" : "reviewer_calc"],
    );
    assert.equal((await one("select public.confirm_accuracy_case($1, $2) r", [c.id, rev])).r.ok, true);
    ids.push(c.id);
  }
  return ids;
}
async function run(igtRulesetId, ids, hash = HASH, wrongFirst = false) {
  const rows = (await client.query("select id, official_total from public.accuracy_cases where id = any($1) order by id", [ids])).rows;
  const results = rows.map((r, i) => ({ case_id: r.id, engine_total: wrongFirst && i === 0 ? Number(r.official_total) + 1 : Number(r.official_total) }));
  return one("select public.record_accuracy_run_igt($1, $2, 'test', $3::jsonb) id", [igtRulesetId, hash, JSON.stringify(results)]);
}
const gate = async (kind) => one("select * from public.calc_gate_status where tax_kind = $1 and cause_group = 'ALL'", [kind]);

test("igt_rulesets - RLS 켜짐, anon·authenticated 권한 0, service_role 은 읽기+초안 추가만(수정·삭제 0), 씨앗 0행", () =>
  tx(async () => {
    const rls = await one("select relrowsecurity rls from pg_class where oid = 'public.igt_rulesets'::regclass");
    assert.equal(rls.rls, true);
    for (const role of ["anon", "authenticated"]) assert.equal((await attempt("select 1 from public.igt_rulesets limit 1", [], role)).ok, false, role);
    assert.ok((await attempt("select 1 from public.igt_rulesets limit 1", [], "service_role")).ok);
    assert.equal((await attempt("update public.igt_rulesets set source_ref = 'x'", [], "service_role")).ok, false);
    assert.equal((await attempt("delete from public.igt_rulesets", [], "service_role")).ok, false);
    assert.equal((await client.query("select 1 from public.igt_rulesets")).rowCount, 0, "씨앗 0행");
  }));

test("생성 - 초안으로만, 본문 해시는 DB가 계산, 활성·서명 상태로 만들기 거부", () =>
  tx(async () => {
    const r = await igt();
    assert.equal(r.status, "draft");
    assert.equal(r.body_sha256, (await one("select encode(sha256(convert_to(body::text, 'UTF8')), 'hex') h from public.igt_rulesets where id = $1", [r.id])).h);
    const v = "2098.07";
    assert.equal((await attempt("insert into public.igt_rulesets (version, status, body, body_sha256, source_ref, basis_note, created_by) values ($1, 'reviewed', $2, 'x', 's', 'n', 'c')", [v, JSON.stringify(bodyFor(v))])).ok, false);
  }));

test("본문 검사 - 허용 밖 최상위 칸 · 묶음 빠짐 · 버전 불일치 · 다른 세목 낱말 · 영문 낱말 · 근거 없음 거부", () =>
  tx(async () => {
    const bad = async (over) => (await attempt("insert into public.igt_rulesets (version, body, body_sha256, source_ref, basis_note, created_by) values ($1, $2, 'x', 's', $3, 'c')", [over.version ?? "2098.10", JSON.stringify(over.body ?? bodyFor(over.version ?? "2098.10")), over.basis ?? "시험용"])).ok;
    assert.equal(await bad({ body: bodyFor("2098.10", { extra_section: {} }) }), false, "허용 밖 최상위 칸");
    const { payment, ...noPayment } = bodyFor("2098.10");
    assert.equal(await bad({ body: noPayment }), false, "묶음 빠짐");
    assert.equal(await bad({ body: bodyFor("2098.11") }), false, "버전 불일치");
    assert.equal(await bad({ version: "2098-10" }), false, "버전 모양");
    assert.equal(await bad({ body: bodyFor("2098.10", { source: { note: `시험용 ${j("양", "도")}소득 문구` } }) }), false, "다른 세목 낱말(한글)");
    assert.equal(await bad({ body: bodyFor("2098.10", { source: { note: j("oner", "ous") } }) }), false, "다른 세목 낱말(영문)");
    assert.equal(await bad({ basis: "  " }), false, "근거 없음");
    assert.equal(await bad({}), true, "정상");
  }));

test("본문·버전·근거는 만든 뒤 바꾸지 못하고 상태는 함수 밖에서 바뀌지 않는다", () =>
  tx(async () => {
    const r = await igt();
    for (const set of ["body = '{}'::jsonb", "version = '2097.01'", "source_ref = 'x'", "status = 'active'", "signed_by = 'user:x'"]) {
      assert.equal((await attempt(`update public.igt_rulesets set ${set} where id = $1`, [r.id])).ok, false, set);
    }
  }));

test("서명 - 감수위원만, 초안만, 시트 필수 - 거부도 감사 1행(kind igt_ruleset)", () =>
  tx(async () => {
    const r = await igt();
    const admin = `user:${await user()}`;
    assert.equal((await sign(r.id, admin)).code, "signer_not_reviewer");
    assert.equal((await sign(r.id, await reviewer(), "  ")).code, "sheet_missing");
    const a = await audit(r.id);
    assert.deepEqual(a.map((x) => [x.action, x.outcome, x.code]), [["sign", "refused", "signer_not_reviewer"], ["sign", "refused", "sheet_missing"]]);
    const rev = await reviewer();
    assert.equal((await sign(r.id, rev)).ok, true);
    assert.equal((await sign(r.id, rev)).code, "not_draft");
    assert.equal((await one("select status from public.igt_rulesets where id = $1", [r.id])).status, "reviewed");
  }));

test("승인 - 서명 없이 거부 + 감사, 서명 뒤 활성, 새 활성본이 오면 이전 활성본은 retired, 활성은 1행", () =>
  tx(async () => {
    const r1 = await igt();
    assert.equal((await approve(r1.id)).code, "not_signed");
    assert.equal((await audit(r1.id))[0].code, "not_signed");
    const rev = await reviewer();
    assert.equal((await sign(r1.id, rev)).ok, true);
    assert.equal((await approve(r1.id, "nobody")).code, "approver_invalid");
    assert.equal((await approve(r1.id)).ok, true);
    const r2 = await igt();
    await sign(r2.id, rev);
    assert.equal((await approve(r2.id)).ok, true);
    const rows = (await client.query("select id, status from public.igt_rulesets where id = any($1) order by id", [[r1.id, r2.id]])).rows;
    assert.deepEqual(rows.map((x) => x.status), ["retired", "active"]);
    assert.equal((await client.query("select 1 from public.igt_rulesets where status = 'active'")).rowCount, 1);
    assert.equal((await approve(r1.id)).code, "retired");
  }));

test("지방세 rulesets 의 국세 낱말 거부 트리거는 그대로", () =>
  tx(async () => {
    const body = { version: "2098.20", status: "draft", effective_from: "2098-01-01", source_laws: [{ note: `시험용 ${j("상속", "세")} 문구` }], acquisition: {}, holding: {}, oligopoly: {} };
    const r = await attempt("insert into public.rulesets (version, body, body_sha256, source_ref, basis_note, created_by) values ('2098.20', $1, 'x', 's', 'n', 'c')", [JSON.stringify(body)]);
    assert.equal(r.ok, false);
  }));

test("공개 뷰 - 활성 행만 anon 이 읽고 초안은 보이지 않는다", () =>
  tx(async () => {
    const draft = await igt();
    assert.equal((await attempt("select 1 from public.public_igt_active_ruleset", [], "anon")).rows.length, 0);
    const rev = await reviewer();
    await sign(draft.id, rev);
    await approve(draft.id);
    const seen = await attempt("select version, body from public.public_igt_active_ruleset", [], "anon");
    assert.equal(seen.ok, true);
    assert.deepEqual(seen.rows.map((x) => x.version), [draft.version]);
    const cols = (await client.query("select column_name from information_schema.columns where table_name = 'public_igt_active_ruleset' order by 1")).rows.map((x) => x.column_name);
    assert.deepEqual(cols, ["activated_at", "body", "body_sha256", "signed_at", "version"]);
  }));

test("함수 권한 - anon·authenticated 는 서명·승인·실행 기록 함수를 못 부른다", () =>
  tx(async () => {
    for (const call of ["select public.sign_igt_ruleset(1, 'user:x', 's')", "select public.approve_igt_ruleset(1, 'admin:t')", "select public.record_accuracy_run_igt(1, 'h', 't', '[]'::jsonb)"]) {
      for (const role of ["anon", "authenticated"]) assert.equal((await attempt(call, [], role)).ok, false, `${role} ${call}`);
    }
  }));

test("게이트 - 증여 29건 닫힘, 30건 + 표본 50건 열림, 상속은 따로, 사례를 더하면 다시 닫힘, 지방세 줄은 그대로", () =>
  tx(async () => {
    const localBefore = (await client.query("select tax_kind, cause_group from public.calc_gate_status where tax_kind in ('acquisition','property','comprehensive') order by 1, 2")).rows;
    assert.equal(localBefore.length, 5);
    assert.equal((await gate("gift")).is_open, false, "활성 룰셋 없음");
    const { r, rev } = await activeRuleset();
    const ids29 = await addCases("gift", 29, 50, rev, "g29");
    await run(r.id, ids29);
    const g29 = await gate("gift");
    assert.equal(g29.is_open, false);
    assert.equal(Number(g29.official_cases), 29);
    assert.equal(g29.ruleset_version, r.version);
    const more = await addCases("gift", 1, 0, rev, "g30");
    const all = [...ids29, ...more];
    assert.equal((await gate("gift")).is_open, false, "실행 뒤 사례를 더하면 닫힘");
    await run(r.id, all);
    const g30 = await gate("gift");
    assert.equal(g30.is_open, true);
    assert.equal(g30.engine_hash, HASH);
    assert.equal((await gate("inheritance")).is_open, false, "상속은 따로 판정");
    const rows = (await client.query("select tax_kind, cause_group from public.calc_gate_status order by 1, 2")).rows;
    assert.equal(rows.length, 7);
    assert.deepEqual(rows.filter((x) => ["acquisition", "property", "comprehensive"].includes(x.tax_kind)), localBefore);
    // 불일치 한 건이면 닫힘
    assert.ok((await run(r.id, all, HASH, true)).id);
    assert.equal((await gate("gift")).is_open, false);
  }));

test("실행 기록 - 증여·상속 사례가 아닌 사례나 미확인 사례는 거부, ruleset_id 와 igt_ruleset_id 는 정확히 하나", () =>
  tx(async () => {
    const { r, rev } = await activeRuleset();
    const unconfirmed = await one(
      "insert into public.accuracy_cases (case_key, tax_kind, sample_kind, case_input, official_total, official_basis, entered_by) values ($1, 'gift', 'official', '{}'::jsonb, 1, 'tax_notice', 'test') returning id",
      [uniq("unc")],
    );
    assert.equal((await attempt("select public.record_accuracy_run_igt($1, $2, 't', $3::jsonb)", [r.id, HASH, JSON.stringify([{ case_id: unconfirmed.id, engine_total: 1 }])])).ok, false);
    const local = await one(
      "insert into public.accuracy_cases (case_key, tax_kind, cause, sample_kind, case_input, official_total, official_basis, entered_by) values ($1, 'property', null, 'official', '{}'::jsonb, 1, 'tax_notice', 'test') returning id",
      [uniq("loc")],
    );
    await client.query("select public.confirm_accuracy_case($1, $2)", [local.id, rev]);
    assert.equal((await attempt("select public.record_accuracy_run_igt($1, $2, 't', $3::jsonb)", [r.id, HASH, JSON.stringify([{ case_id: local.id, engine_total: 1 }])])).ok, false);
    assert.equal((await attempt("insert into public.accuracy_runs (engine_hash, ruleset_version, triggered_by, case_count, matched_count) values ($1, 'x', 't', 0, 0)", [HASH])).ok, false, "둘 다 비면 거부");
  }));

test("대조 사례 개인정보 검사 - 거주 여부 칸은 통과, 이름·주소 칸·문장 값은 거부", () =>
  tx(async () => {
    const add = async (input) => (await attempt("insert into public.accuracy_cases (case_key, tax_kind, sample_kind, case_input, official_total, official_basis, entered_by) values ($1, 'gift', 'official', $2, 1, 'tax_notice', 'test')", [uniq("pii"), JSON.stringify(input)])).ok;
    assert.equal(await add({ recipient_is_resident: true, donor_relationship: "spouse", gift_date: "2026-08-10" }), true);
    assert.equal(await add({ donor_name: "x" }), false, "이름 칸");
    assert.equal(await add({ resident_no: "x" }), false, "주민 칸");
    assert.equal(await add({ memo: "홍길동 서울시 어딘가" }), false, "문장 값");
    assert.equal((await attempt("insert into public.accuracy_cases (case_key, tax_kind, sample_kind, case_input, official_total, official_basis, entered_by) values ($1, 'wealth', 'official', '{}'::jsonb, 1, 'tax_notice', 'test')", [uniq("tk")])).ok, false, "알 수 없는 세목");
  }));

test("laws - national_igt 3행, 다른 scope 의 상속·증여 이름 거부 유지, national_igt 이름 규칙", () =>
  tx(async () => {
    const rows = (await client.query("select name, tier from public.laws where scope = 'national_igt' order by tier")).rows;
    assert.deepEqual(rows.map((x) => [x.name, x.tier]).sort(), [["상속세 및 증여세법", "statute"], ["상속세 및 증여세법 시행규칙", "rule"], ["상속세 및 증여세법 시행령", "decree"]].sort());
    assert.equal((await attempt("insert into public.laws (name, tier, scope) values ($1, 'statute', 'local')", [`${j("상속", "세")}법 시험`])).ok, false, "다른 scope");
    assert.equal((await attempt("insert into public.laws (name, tier, scope) values ($1, 'statute', 'national_igt')", ["다른 법"])).ok, false, "national_igt 이름 규칙");
    assert.ok((await attempt("insert into public.laws (name, tier, scope) values ('시험 법령', 'statute', 'related')")).ok, "기존 scope 유지");
    assert.equal((await attempt("insert into public.laws (name, tier, scope) values ('시험 법령 둘', 'statute', 'nowhere')")).ok, false);
  }));

test("첫 검수 항목 - 미반영 개정 3건, 제목에 시험용 없음, 본문 없음", () =>
  tx(async () => {
    const rows = (await client.query("select kind, source_key, title, payload, status from public.review_items where source_key like 'igt-unreflected-20261008-%' order by source_key")).rows;
    assert.equal(rows.length, 3);
    for (const x of rows) {
      assert.equal(x.kind, "law_change");
      assert.doesNotMatch(x.title, /시험용/);
      assert.equal(x.payload.reflected, false);
      assert.deepEqual(Object.keys(x.payload).sort(), ["action", "origin", "reflected", "scope"]);
    }
  }));

test("기능 키 둘은 꺼짐으로 시작한다", () =>
  tx(async () => {
    const f = (await one("select value from public.settings where key = 'feature_flags'")).value;
    assert.equal(f.calc_igt_gift, false);
    assert.equal(f.calc_igt_inheritance, false);
  }));
