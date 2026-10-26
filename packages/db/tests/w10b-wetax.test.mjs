// W10-b DB - 위택스 바로가기 표·점검 기록·official_links 종류 확장·계산기 공개 읽기 뷰 (마이그레이션 20261025000084, PRD-02 WETAX-01 · FAM-04 · CALC-14)
//  · official_links: 새 종류 3개 허용, 알 수 없는 종류 거부, 기존 종류 유지
//  · wetax_links: 씨앗 7행은 주소 비움·첫 화면 대체 연결, 주소에 쿼리·조각·사용자 정보 거부, 공개 읽기는 칸을 좁힌 활성 행만, 쓰기는 service_role만
//  · wetax_link_checks: 같은 실행 키 한 벌, 수정·삭제 권한 없음
//  · 공개 뷰: anon이 읽을 수 있고 원 표는 읽을 수 없음, 게이트 뷰는 5개 묶음 고정
// 모든 시험은 거래 안에서 돌고 되돌린다. 주소는 example.test 가짜다.
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
const uniq = (p) => `${p}_${process.pid}_${++seq}`;
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

test("official_links: 국세청 안내·법령정보센터·교육원 종류가 추가되고 알 수 없는 종류는 거부된다", async () =>
  tx(async () => {
    for (const kind of ["nts_guide", "law_center", "edu_site", "sm_calculator", "external_calculator", "fallback"]) {
      const r = await attempt("insert into public.official_links (kind, key, label) values ($1, $2, '시험용') returning id", [kind, uniq("k")]);
      assert.ok(r.ok, `${kind}: ${r.message}`);
    }
    const bad = await attempt("insert into public.official_links (kind, key, label) values ('unknown_kind', $1, '시험용')", [uniq("k")]);
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "23514");
    const seeded = await client.query("select kind, key, url from public.official_links where kind in ('nts_guide','law_center','edu_site') and key in ('nts_guide','law_info_center','edu')");
    assert.equal(seeded.rowCount, 3);
    assert.ok(seeded.rows.every((r) => r.url === null), "씨앗 주소는 비어 있다");
  }));

test("wetax_links 씨앗: 7행, 주소 비움, 메뉴는 첫 화면으로 대체 연결", async () =>
  tx(async () => {
    const { rows } = await client.query("select key, kind, tax_kind, url, status, fail_count, fallback_key from public.wetax_links order by sort");
    assert.deepEqual(rows.map((r) => r.kind), ["home", "filing", "payment", "payment", "payment", "refund", "app"]);
    assert.ok(rows.every((r) => r.url === null && r.status === "unchecked" && r.fail_count === 0));
    assert.equal(rows[0].fallback_key, null);
    assert.ok(rows.slice(1).every((r) => r.fallback_key === "wetax_home"));
    assert.deepEqual(rows.map((r) => r.tax_kind), ["all", "acquisition", "property", "comprehensive", "vehicle", "refund", "all"]);
  }));

test("wetax_links 주소 검사: 쿼리·조각·사용자 정보·공백·http 아닌 것은 거부, 깨끗한 주소는 허용", async () =>
  tx(async () => {
    const bad = ["https://w.example.test/a?x=1", "https://w.example.test/a#h", "https://u:p@w.example.test/a", "https://w.example.test/a b", "ftp://w.example.test/a", "javascript:alert(1)"];
    for (const url of bad) {
      const r = await attempt("insert into public.wetax_links (key, kind, tax_kind, label, url) values ($1, 'home', 'all', '시험용', $2)", [uniq("w"), url]);
      assert.equal(r.ok, false, url);
      assert.equal(r.code, "23514", url);
    }
    for (const url of ["https://w.example.test/a/b", "http://w.example.test/", null]) {
      const r = await attempt("insert into public.wetax_links (key, kind, tax_kind, label, url) values ($1, 'home', 'all', '시험용', $2)", [uniq("w"), url]);
      assert.ok(r.ok, `${url}: ${r.message}`);
    }
  }));

test("wetax_links 칸 검사: 종류·세목·상태·실패 횟수 범위·자기 자신 대체 거부", async () =>
  tx(async () => {
    const k = uniq("w");
    const cases = [
      ["kind 밖", "insert into public.wetax_links (key, kind, tax_kind, label) values ($1, 'other', 'all', 'x')"],
      ["세목 밖", "insert into public.wetax_links (key, kind, tax_kind, label) values ($1, 'home', 'transfer', 'x')"],
      ["상태 밖", "insert into public.wetax_links (key, kind, tax_kind, label, status) values ($1, 'home', 'all', 'x', 'dead')"],
      ["실패 횟수 100", "insert into public.wetax_links (key, kind, tax_kind, label, fail_count) values ($1, 'home', 'all', 'x', 100)"],
      ["실패 횟수 -1", "insert into public.wetax_links (key, kind, tax_kind, label, fail_count) values ($1, 'home', 'all', 'x', -1)"],
      ["자기 자신 대체", "insert into public.wetax_links (key, kind, tax_kind, label, fallback_key) values ($1, 'home', 'all', 'x', $1)"],
    ];
    for (const [name, sql] of cases) {
      const r = await attempt(sql, [k]);
      assert.equal(r.ok, false, name);
    }
    const ok = await attempt("insert into public.wetax_links (key, kind, tax_kind, label, fail_count) values ($1, 'home', 'all', 'x', 99) returning key", [k]);
    assert.ok(ok.ok, "실패 횟수 99는 허용");
  }));

test("wetax_links 권한: anon은 좁힌 칸의 활성 행만 읽고 쓰기·내부 칸 읽기는 거부, service_role은 쓰기 가능", async () =>
  tx(async () => {
    const k = uniq("w");
    await client.query("insert into public.wetax_links (key, kind, tax_kind, label, url, active) values ($1, 'home', 'all', '시험용 활성', 'https://w.example.test/x', true)", [k]);
    const k2 = uniq("w");
    await client.query("insert into public.wetax_links (key, kind, tax_kind, label, url, active) values ($1, 'home', 'all', '시험용 꺼짐', 'https://w.example.test/y', false)", [k2]);
    const read = await attempt("select key, url, fail_count from public.wetax_links where key in ($1, $2) order by key", [k, k2], "anon");
    assert.ok(read.ok, read.message);
    assert.deepEqual(read.rows.map((r) => r.key), [k], "꺼진 행은 안 보인다");
    const internal = await attempt("select checked_by from public.wetax_links", [], "anon");
    assert.equal(internal.ok, false, "내부 칸(checked_by) 읽기 거부");
    for (const role of ["anon", "authenticated"]) {
      const w = await attempt("update public.wetax_links set label = 'x' where key = $1", [k], role);
      assert.equal(w.ok, false, `${role} 쓰기 거부`);
    }
    const up = await attempt("update public.wetax_links set fail_count = 1, status = 'unchecked' where key = $1 returning fail_count", [k], "service_role");
    assert.ok(up.ok, up.message);
    assert.equal(up.rows[0].fail_count, 1);
  }));

test("wetax_link_checks: 같은 실행 키는 한 벌, 수정·삭제 권한 없음", async () =>
  tx(async () => {
    const k = uniq("w");
    await client.query("insert into public.wetax_links (key, kind, tax_kind, label) values ($1, 'home', 'all', '시험용')", [k]);
    const ins = (role) => attempt("insert into public.wetax_link_checks (link_key, run_key, result, http_status, method) values ($1, '2026-W43', 'ok', 200, 'auto')", [k], role);
    assert.ok((await ins("service_role")).ok);
    const dup = await ins("service_role");
    assert.equal(dup.ok, false);
    assert.equal(dup.code, "23505");
    assert.equal((await attempt("update public.wetax_link_checks set result = 'broken' where link_key = $1", [k], "service_role")).ok, false);
    assert.equal((await attempt("delete from public.wetax_link_checks where link_key = $1", [k], "service_role")).ok, false);
    assert.equal((await attempt("select * from public.wetax_link_checks", [], "anon")).ok, false);
  }));

test("공개 뷰: anon이 읽을 수 있고 원 표는 읽지 못한다", async () =>
  tx(async () => {
    for (const view of ["public_active_ruleset", "public_active_determination", "public_calc_gate"]) {
      const r = await attempt(`select * from public.${view}`, [], "anon");
      assert.ok(r.ok, `${view}: ${r.message}`);
    }
    for (const table of ["rulesets", "determination_tables", "calc_gate_status", "accuracy_cases"]) {
      const r = await attempt(`select 1 from public.${table} limit 1`, [], "anon");
      assert.equal(r.ok, false, `${table} 직접 읽기 거부`);
    }
  }));

test("공개 뷰 public_calc_gate: 묶음 7개 고정(W11-g가 증여·상속 추가), 칸은 건수와 공개 여부뿐", async () =>
  tx(async () => {
    const r = await attempt("select * from public.public_calc_gate order by tax_kind, cause_group", [], "anon");
    assert.ok(r.ok, r.message);
    assert.deepEqual(r.rows.map((x) => `${x.tax_kind}/${x.cause_group}`), ["acquisition/GIFT", "acquisition/INHERITANCE", "acquisition/OTHER", "comprehensive/ALL", "gift/ALL", "inheritance/ALL", "property/ALL"]);
    assert.deepEqual(Object.keys(r.rows[0]).sort(), ["cause_group", "engine_hash", "is_open", "official_cases", "official_matched", "ruleset_version", "run_at", "sample_cases", "sample_matched", "tax_kind"].sort());
    // 활성 룰셋·실행이 없으면 어떤 묶음도 열리지 않는다
    const active = await client.query("select count(*)::int as n from public.rulesets where status = 'active'");
    if (active.rows[0].n === 0) assert.ok(r.rows.every((x) => x.is_open === false));
  }));

test("공개 뷰 public_active_ruleset·public_active_determination: 초안 행은 보이지 않는다", async () =>
  tx(async () => {
    const v = uniq("v").slice(0, 0) + "2099.99";
    const ins = await attempt(
      "insert into public.determination_tables (kind, version, body, body_sha256, source_ref, basis_note, created_by) values ('refund', $1, '{\"kind\":\"refund\"}'::jsonb, 'x', '시험용', '시험용 근거', 'test') returning status",
      [v],
      "service_role",
    );
    assert.ok(ins.ok, ins.message);
    assert.equal(ins.rows[0].status, "draft");
    const seen = await attempt("select version from public.public_active_determination where version = $1", [v], "anon");
    assert.ok(seen.ok, seen.message);
    assert.equal(seen.rows.length, 0, "초안 판정표는 공개 뷰에 없다");
  }));
