// W11-a DB - 판정표 종류 +7 · 상속/증여 행 분리 · 요건 사전 · 공개 뷰 (마이그레이션 20261025000112 · 113, PRD-03 6·7장 · FAM-05, docs/dev/W11-a_설계.md 3·4장)
//  · 종류 제약: 새 7종 + 기존 2종은 저장되고 모르는 종류는 거부 (종류 목록은 tax-engine W11_DETERMINATION_KINDS와 같다)
//  · 상속·증여: 같은 행(조건·결론, id·라벨 제외)을 한쪽에 이미 둔 뒤 다른 쪽에 두면 저장 거부, 다른 행이면 저장
//  · 요건 사전: 초안 -> 서명(감수위원만) -> 승인, 서명 없는 승인 거부 + 감사, 주제별 활성 1행, as_of·fields 없는 본문 거부
//  · 공개 뷰: 초안·서명만 된 표는 anon 0행, 승인(active) 뒤에만 보인다
// 모든 시험은 거래 안에서 돌고 되돌린다. 내용은 시험용 가짜다 - 실제 요건·세율·법령 문장 없음.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

const KINDS_IN_ENGINE = (() => {
  const src = fs.readFileSync(path.join(ROOT, "packages", "tax-engine", "src", "determination.ts"), "utf8");
  const m = src.match(/W11_DETERMINATION_KINDS = \[([^\]]+)\]/);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
})();

let seq = 0;
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
  // 다른 시험 파일이 amendment_events를 truncate하면 외래키로 이어진 표까지 잠그려 한다 - 같은 순서로 먼저 잠가 교착을 피한다
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
const nextVersion = () => `2${String(100 + (++seq % 899)).padStart(3, "0")}.01`;
const rule = (id, conclusion, extra = {}) => ({ id, when: { op: "eq", field: "fixture_field", value: conclusion }, conclusion, ...extra });
function tableBody(kind, rules) {
  return { kind, version: "2099.01", label: "시험용 판정표", required: [{ id: "fixture_field", label: "시험용 사실" }], rules };
}
async function determination(kind, rules, version = nextVersion()) {
  return one(
    "insert into public.determination_tables (kind, version, body, source_ref, basis_note, created_by) values ($1, $2, $3::jsonb, '시험용', '시험용 반입', 'test') returning *",
    [kind, version, JSON.stringify(tableBody(kind, rules))],
  );
}
async function dictionary(topic, over = {}) {
  const body = over.body ?? { as_of: "2099-01-01", fields: [{ id: "fixture_field", label: "시험용 질문", required: true }] };
  return one(
    "insert into public.requirement_dictionary (topic, version, body, source_ref, basis_note, created_by) values ($1, $2, $3::jsonb, '시험용', '시험용 반입', 'test') returning *",
    [topic, over.version ?? nextVersion(), JSON.stringify(body)],
  );
}
const sign = async (kind, id, signer) => (await one("select public.rule_sign($1, $2, $3, '시험용 감수 시트') r", [kind, id, signer])).r;
const approve = async (kind, id) => (await one("select public.rule_approve($1, $2, 'admin:test@example.test') r", [kind, id])).r;

test("판정표 종류 - 새 7종과 기존 2종은 저장되고 tax-engine 목록과 같으며, 모르는 종류는 거부된다", () =>
  tx(async () => {
    assert.equal(KINDS_IN_ENGINE.length, 7);
    for (const kind of [...KINDS_IN_ENGINE, "refund", "reduction"]) {
      const row = await determination(kind, [rule(`r_${kind}`.slice(0, 40), kind)]);
      assert.equal(row.kind, kind);
      assert.equal(row.status, "draft");
    }
    for (const bad of ["house_count_inherit", "House_Count", "", "trust"]) {
      const r = await attempt("insert into public.determination_tables (kind, version, body, source_ref, basis_note, created_by) values ($1, $2, '{}'::jsonb, 's', 'n', 't')", [bad, nextVersion()]);
      assert.equal(r.code, "23514", `종류 '${bad}'`);
    }
  }));

test("상속·증여 판정표 - 같은 행(조건·결론)을 id만 바꿔 다른 쪽에 두면 거부되고, 다른 행이면 저장된다", () =>
  tx(async () => {
    await determination("house_count_inheritance", [rule("inh_1", "시험용 결론 A")]);
    const dup = await attempt("insert into public.determination_tables (kind, version, body, source_ref, basis_note, created_by) values ('house_count_gift', $1, $2::jsonb, 's', 'n', 't')", [
      nextVersion(),
      JSON.stringify(tableBody("house_count_gift", [rule("gift_copy", "시험용 결론 A", { label: "다른 라벨" })])),
    ]);
    assert.equal(dup.ok, false);
    assert.equal(dup.code, "23514");
    const ok = await determination("house_count_gift", [rule("gift_1", "시험용 결론 B")]);
    assert.equal(ok.kind, "house_count_gift");
    // 반대 방향도 같다 - 증여에 있는 행을 상속에 두면 거부
    const rev = await attempt("insert into public.determination_tables (kind, version, body, source_ref, basis_note, created_by) values ('house_count_inheritance', $1, $2::jsonb, 's', 'n', 't')", [
      nextVersion(),
      JSON.stringify(tableBody("house_count_inheritance", [rule("inh_copy", "시험용 결론 B")])),
    ]);
    assert.equal(rev.code, "23514");
    // 같은 종류 안의 새 차수는 같은 행을 이어받아도 된다
    assert.equal((await determination("house_count_inheritance", [rule("inh_1", "시험용 결론 A")])).kind, "house_count_inheritance");
  }));

test("판정표 공개 뷰 - 초안·서명만 된 표는 anon 0행, 승인(active) 뒤에만 보이고 서명 칸은 없다", () =>
  tx(async () => {
    const row = await determination("trust_taxpayer", [rule("t1", "시험용 결론")], "2099.07");
    const q = () => attempt("select * from public.public_determination_tables where kind = 'trust_taxpayer'", [], "anon");
    assert.equal((await q()).rows.length, 0);
    assert.equal((await approve("determination_table", row.id)).code, "not_signed");
    assert.equal((await sign("determination_table", row.id, await reviewer())).ok, true);
    assert.equal((await q()).rows.length, 0, "서명만으로는 공개 아님");
    assert.equal((await approve("determination_table", row.id)).ok, true);
    const seen = (await q()).rows;
    assert.equal(seen.length, 1);
    assert.equal(seen[0].version, "2099.07");
    assert.equal(seen[0].body.rules[0].conclusion, "시험용 결론");
    for (const hidden of ["signed_by", "sheet_ref", "activated_by", "created_by"]) assert.equal(hidden in seen[0], false, hidden);
  }));

test("요건 사전 - 서명은 감수위원만, 서명 없는 승인은 거부 + 감사, 주제마다 활성 1행이고 다른 주제는 건드리지 않는다", () =>
  tx(async () => {
    const a1 = await dictionary("fixture_topic_a", { version: "2099.01" });
    const b1 = await dictionary("fixture_topic_b", { version: "2099.01" });
    assert.equal((await approve("requirement_dictionary", a1.id)).code, "not_signed");
    assert.deepEqual(
      (await client.query("select action, outcome, code from public.rules_audit where kind = 'requirement_dictionary' and target_id = $1", [a1.id])).rows,
      [{ action: "approve", outcome: "refused", code: "not_signed" }],
    );
    const stranger = `user:${await user()}`;
    assert.equal((await sign("requirement_dictionary", a1.id, stranger)).code, "signer_not_reviewer");
    const rev = await reviewer();
    for (const id of [a1.id, b1.id]) {
      assert.equal((await sign("requirement_dictionary", id, rev)).ok, true);
      assert.equal((await approve("requirement_dictionary", id)).ok, true);
    }
    const a2 = await dictionary("fixture_topic_a", { version: "2099.02" });
    await sign("requirement_dictionary", a2.id, rev);
    assert.equal((await approve("requirement_dictionary", a2.id)).ok, true);
    const states = (await client.query("select topic, version, status from public.requirement_dictionary where topic like 'fixture_topic_%' order by topic, version")).rows;
    assert.deepEqual(states, [
      { topic: "fixture_topic_a", version: "2099.01", status: "retired" },
      { topic: "fixture_topic_a", version: "2099.02", status: "active" },
      { topic: "fixture_topic_b", version: "2099.01", status: "active" },
    ]);
    const seen = (await attempt("select topic, version from public.public_requirement_dictionary where topic like 'fixture_topic_%' order by topic", [], "anon")).rows;
    assert.deepEqual(seen, [{ topic: "fixture_topic_a", version: "2099.02" }, { topic: "fixture_topic_b", version: "2099.01" }]);
  }));

test("요건 사전 - 기준일(as_of)·필드 목록이 없는 본문, 같은 주제·버전 중복, 직접 활성화, 삭제는 거부된다", () =>
  tx(async () => {
    for (const body of [{ fields: [] }, { as_of: "2099-01-01" }, { as_of: "2099-01-01", fields: {} }]) {
      const r = await attempt("insert into public.requirement_dictionary (topic, version, body, source_ref, basis_note, created_by) values ('fixture_topic_c', $1, $2::jsonb, 's', 'n', 't')", [nextVersion(), JSON.stringify(body)]);
      assert.equal(r.code, "23514", JSON.stringify(body));
    }
    const d = await dictionary("fixture_topic_c", { version: "2099.01" });
    assert.equal((await attempt("insert into public.requirement_dictionary (topic, version, body, source_ref, basis_note, created_by) values ('fixture_topic_c', '2099.01', '{\"as_of\":\"x\",\"fields\":[]}'::jsonb, 's', 'n', 't')")).code, "23505");
    assert.equal((await attempt("update public.requirement_dictionary set status = 'active' where id = $1", [d.id])).ok, false);
    assert.equal((await attempt("delete from public.requirement_dictionary where id = $1", [d.id])).ok, false);
  }));
