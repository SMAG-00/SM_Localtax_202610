// W4 1단계 — 행정구역 적재 도구의 DB 자리 (docs/dev/W4_설계.md 1장 1단계 · 2.1 · 2.6 · 3장, 마이그레이션 20261022000039)
// ① 2.1 값(region_import_run.status · region_slug_redirect.reason · row_class · change) = 도구 값 = DB check
// ② region_import_runs — 해시·분류 수(합 = 행 수)·차이 수·applied는 적용자·시각, 같은 원본 applied 하나, 추가만
// ③ regions 후속 — 자기 자신 0 · 폐지 행만 · 오늘 유효 · 후속이 또 폐지면 최종 지역으로(연쇄 0) · 순환 거부 · 적재 행의 폐지는 후속 필수
// ④ region_slug_redirects — 형식 · 도착은 최종 지역 · 제자리 301 거부 · 도착이 폐지되면 같이 옮김
// ⑤ RLS — 두 표 anon·authenticated 0(권한 거부), regions 새 칸은 공개 참조 자료로 읽힌다
// ⑥ scripts/regions가 만든 데이터 마이그레이션이 로컬 DB에 깨끗이 적용된다(v1 → 같은 파일 다시 → v2) — 적용 뒤 상태 = 도구가 계산한 상태, 두 번 적용해도 같다
// 시험 지역은 접두 99 가짜 코드(가상도), 모두 되돌리고 끝에 행 수가 시험 전과 같은지 본다
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";
import { CHANGES, REDIRECT_REASONS, RESERVED_SLUGS, ROW_CLASSES, RUN_STATUSES } from "../../../scripts/regions/config.mjs";
import { currentFromDb, dryRunInsert, readSuccessors } from "../../../scripts/regions/diff.mjs";
import { emitMigration } from "../../../scripts/regions/emit-migration.mjs";
import { FICTIONAL_SIDO, designSection, fix, pipelineFor, tableRows, ticks } from "../../../scripts/__tests__/regions-fixtures.mjs";

let client;
let baseline;
const counts = async () => (await client.query("select (select count(*)::int from public.regions) as regions, (select count(*)::int from public.region_import_runs) as runs, (select count(*)::int from public.region_slug_redirects) as redirects")).rows[0];
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
  baseline = await counts();
});
after(async () => client?.end());

async function tx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}
async function attempt(sql, params = [], role) {
  await client.query("savepoint t");
  try {
    if (role) await client.query(`set local role ${role}`);
    const res = await client.query(sql, params);
    await client.query("rollback to savepoint t");
    return { ok: true, rows: res.rows };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, code: err.code, message: err.message };
  }
}
/** 성공하면 남기는 시도 (savepoint 해제) */
async function keep(sql, params = []) {
  await client.query("savepoint k");
  try {
    const res = await client.query(sql, params);
    await client.query("release savepoint k");
    return { ok: true, rows: res.rows };
  } catch (err) {
    await client.query("rollback to savepoint k");
    return { ok: false, code: err.code, message: err.message };
  }
}

const SHA = (n) => n.toString(16).padStart(64, "0");
const CLASS = { sido: 1, sigungu: 2, general_gu: 0, sub_district: 3 };
const CHANGE = { added: 2, renamed: 0, retired: 0, unchanged: 1 };
const run = (over = {}) => {
  const r = { file_name: "시험용.txt", file_date: "2026-10-01", sha256: SHA(1), rows_total: 6, class_counts: CLASS, change_counts: CHANGE, status: "dry_run", applied_by: null, applied_at: null, ...over };
  return [
    "insert into public.region_import_runs (file_name, file_date, sha256, rows_total, class_counts, change_counts, status, applied_by, applied_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id",
    [r.file_name, r.file_date, r.sha256, r.rows_total, JSON.stringify(r.class_counts), JSON.stringify(r.change_counts), r.status, r.applied_by, r.applied_at],
  ];
};
const kstDay = (days = 0) => new Date(Date.now() + 9 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);
const SIDO = FICTIONAL_SIDO[0];
const addSido = () => client.query("insert into public.regions (code, level, name, slug, aliases) values ($1, 'sido', $2, $3, $4)", [SIDO.code, SIDO.name, SIDO.slug, SIDO.aliases]);
const addGu = (code, slug, over = {}) =>
  client.query("insert into public.regions (code, parent_code, level, name, slug, valid_to, successor_code, import_run_id) values ($1, $2, 'sigungu', $3, $4, $5, $6, $7)", [
    code, SIDO.code, over.name ?? `시험용 ${slug}`, slug, over.valid_to ?? null, over.successor_code ?? null, over.import_run_id ?? null,
  ]);
const successorOf = async (code) => (await client.query("select successor_code from public.regions where code = $1", [code])).rows[0].successor_code;

test("① 설계 2.1 값 = 도구 값 = DB — 상태 3값·301 사유 2값은 받고 밖은 23514, 분류 수·차이 수 키는 정확히 4개", () =>
  tx(async () => {
    const rows = tableRows(designSection("2.1"));
    const values = (name) => ticks(rows.find(([n]) => n.split(/[\s(`)]+/).includes(name))[1]);
    assert.deepEqual(values("region_import_run.status"), [...RUN_STATUSES]);
    assert.deepEqual(values("region_slug_redirect.reason"), [...REDIRECT_REASONS]);
    assert.deepEqual(values("region_import.row_class"), [...ROW_CLASSES]);
    assert.deepEqual(values("region_import.change"), [...CHANGES]);
    let n = 10;
    for (const status of RUN_STATUSES) {
      const r = await attempt(...run({ status, sha256: SHA(n++), applied_by: status === "applied" ? "PO(시험)" : null, applied_at: status === "applied" ? new Date().toISOString() : null }));
      assert.ok(r.ok, `${status}: ${r.message}`);
    }
    const badStatus = await attempt(...run({ status: "pending" }));
    assert.equal(badStatus.code, "23514");
    for (const key of ROW_CLASSES) {
      const missing = { ...CLASS };
      delete missing[key];
      assert.equal((await attempt(...run({ class_counts: missing }))).code, "23514", `class_counts에 ${key}가 없으면 거부`);
    }
    assert.equal((await attempt(...run({ class_counts: { ...CLASS, ward: 0 } }))).code, "23514", "row_class 밖 키");
    for (const key of CHANGES) {
      const missing = { ...CHANGE };
      delete missing[key];
      assert.equal((await attempt(...run({ change_counts: missing }))).code, "23514", `change_counts에 ${key}가 없으면 거부`);
    }
    assert.equal((await attempt(...run({ change_counts: { ...CHANGE, moved: 1 } }))).code, "23514", "change 밖 키");
    await addSido();
    await addGu("9911000000", "siheom-a-gu");
    for (const reason of REDIRECT_REASONS) {
      const r = await attempt("insert into public.region_slug_redirects (old_path, region_code, reason) values ($1, '9911000000', $2)", [`/local/gasang-do/old-${reason}`, reason]);
      assert.ok(r.ok, `${reason}: ${r.message}`);
    }
    assert.equal((await attempt("insert into public.region_slug_redirects (old_path, region_code, reason) values ('/local/gasang-do/old-x', '9911000000', 'moved')")).code, "23514");
  }));

test("① 도구의 예약 slug = regions slug check 예약 이름 (W2-b 마이그레이션)", async () => {
  const { rows } = await client.query("select pg_get_constraintdef(c.oid) as def from pg_constraint c where c.conrelid = 'public.regions'::regclass and pg_get_constraintdef(c.oid) like '%events%'");
  assert.equal(rows.length, 1);
  const names = [...rows[0].def.matchAll(/'([a-z]+)'::text/g)].map((m) => m[1]);
  assert.deepEqual([...names].sort(), [...RESERVED_SLUGS].sort());
});

test("② region_import_runs — 해시 형식·분류 수 합 = 행 수·0 이상 정수·applied는 적용자·시각 필수·같은 원본 applied 하나", () =>
  tx(async () => {
    assert.ok((await attempt(...run())).ok);
    for (const sha256 of ["abc", SHA(1).toUpperCase().replace("0", "G"), `${SHA(1)}0`]) assert.equal((await attempt(...run({ sha256 }))).code, "23514", sha256);
    assert.equal((await attempt(...run({ rows_total: 7 }))).code, "23514", "분류 수 합 6 ≠ 행 수 7");
    assert.equal((await attempt(...run({ class_counts: { ...CLASS, sido: -1, sub_district: 5 } }))).code, "23514", "음수");
    assert.equal((await attempt(...run({ class_counts: { ...CLASS, sido: 0.5, sub_district: 3.5 } }))).code, "23514", "정수 아님");
    assert.equal((await attempt(...run({ class_counts: { ...CLASS, sido: "1" } }))).code, "23514", "숫자 아님");
    assert.equal((await attempt(...run({ class_counts: [1, 2, 3] }))).code, "23514", "객체 아님");
    assert.equal((await attempt(...run({ change_counts: { ...CHANGE, added: -1 } }))).code, "23514");
    assert.equal((await attempt(...run({ status: "applied" }))).code, "23514", "applied — 적용자·시각 없음");
    assert.equal((await attempt(...run({ status: "applied", applied_by: " ", applied_at: new Date().toISOString() }))).code, "23514", "빈 적용자");
    assert.equal((await attempt(...run({ status: "applied", applied_by: "PO(시험)" }))).code, "23514", "시각 없음");
    const first = await keep(...run({ status: "applied", sha256: SHA(2), applied_by: "PO(시험)", applied_at: new Date().toISOString() }));
    assert.ok(first.ok, first.message);
    const second = await attempt(...run({ status: "applied", sha256: SHA(2), applied_by: "PO(시험)", applied_at: new Date().toISOString() }));
    assert.equal(second.code, "23505", "같은 원본 applied 두 번");
    assert.ok((await attempt(...run({ sha256: SHA(2) }))).ok, "같은 원본의 dry_run·rejected는 여러 번");
  }));

test("② region_import_runs는 추가만 — 고치기·지우기·비우기 거부(소유자·service_role 모두)", () =>
  tx(async () => {
    const id = (await client.query(...run())).rows[0].id;
    for (const role of [undefined, "service_role"]) {
      const upd = await attempt("update public.region_import_runs set status = 'applied', applied_by = 'x', applied_at = now() where id = $1", [id], role);
      assert.equal(upd.code, "42501", `${role ?? "소유자"} 고치기`);
      const del = await attempt("delete from public.region_import_runs where id = $1", [id], role);
      assert.equal(del.code, "42501", `${role ?? "소유자"} 지우기`);
    }
    // 비우기 — regions가 이 표를 참조해 TRUNCATE는 cascade 없이 늘 거부되고, cascade면 regions까지 잠그므로 트리거가 걸려 있는지만 본다(같은 함수 append_only_guard)
    const trunc = (await client.query("select t.tgname, p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.region_import_runs'::regclass and not t.tgisinternal order by 1")).rows;
    assert.deepEqual(trunc, [{ tgname: "region_import_runs_no_truncate", proname: "append_only_guard" }, { tgname: "region_import_runs_no_update_delete", proname: "append_only_guard" }]);
    const sr = await attempt("insert into public.region_import_runs (file_name, file_date, sha256, rows_total, class_counts, change_counts, status) values ('a', '2026-10-01', $1, 0, '{\"sido\":0,\"sigungu\":0,\"general_gu\":0,\"sub_district\":0}', '{\"added\":0,\"renamed\":0,\"retired\":0,\"unchanged\":0}', 'dry_run') returning id", [SHA(5)], "service_role");
    assert.ok(sr.ok, `service_role 추가: ${sr.message}`);
  }));

test("② 도구의 dry_run 기록 문장이 그대로 들어간다", () =>
  tx(async () => {
    const r = pipelineFor("v1.utf8.txt");
    const { sql, params } = dryRunInsert({ fileName: r.source.fileName, fileDate: r.source.fileDate, sha256: r.source.sha256, rowsTotal: r.source.rowsTotal, classCounts: r.derived.class_counts, changeCounts: r.plan.counts, note: "시험" });
    const id = (await client.query(sql, params)).rows[0].id;
    const row = (await client.query("select status, rows_total, class_counts, change_counts, applied_by from public.region_import_runs where id = $1", [id])).rows[0];
    assert.deepEqual(row, { status: "dry_run", rows_total: 32, class_counts: { sido: 18, sigungu: 7, general_gu: 2, sub_district: 5 }, change_counts: { added: 6, renamed: 0, retired: 0, unchanged: 18 }, applied_by: null });
  }));

test("③ 후속 — 자기 자신·폐지 아닌 행의 후속·오늘 유효하지 않은 후속 거부, 적재 행의 폐지는 후속 필수, 손으로 넣은 폐지 행은 후속 없이도 된다", () =>
  tx(async () => {
    await addSido();
    await addGu("9911000000", "siheom-a-gu");
    await addGu("9913000000", "siheom-b-gu");
    const self = await attempt("update public.regions set valid_to = $2, successor_code = code where code = $1", ["9911000000", kstDay(-1)]);
    assert.equal(self.code, "23514", self.message);
    const notRetired = await attempt("update public.regions set successor_code = '9913000000' where code = '9911000000'");
    assert.equal(notRetired.code, "23514", "valid_to 없는 행의 후속");
    assert.match(notRetired.message, /regions_successor_retired_only/);
    assert.ok((await keep("update public.regions set valid_to = $1 where code = '9913000000'", [kstDay(-1)])).ok, "손으로 넣은 행은 후속 없이 폐지(W2-b 그대로)");
    const toRetired = await attempt("update public.regions set valid_to = $1, successor_code = '9913000000' where code = '9911000000'", [kstDay(-1)]);
    assert.equal(toRetired.code, "23514");
    assert.match(toRetired.message, /오늘 유효하지 않습니다/);
    const runId = (await client.query(...run({ sha256: SHA(7) }))).rows[0].id;
    await addGu("9915000000", "siheom-c-gu", { import_run_id: runId });
    const noSucc = await attempt("update public.regions set valid_to = $1 where code = '9915000000'", [kstDay(-1)]);
    assert.equal(noSucc.code, "23514", "적재 기록 행의 폐지는 후속 필수");
    assert.match(noSucc.message, /regions_import_retire_successor/);
    const insRetired = await attempt("insert into public.regions (code, parent_code, level, name, slug, valid_to, import_run_id) values ('9917000000', '9900000000', 'sigungu', '시험용', 'siheom-d-gu', $1, $2)", [kstDay(-1), runId]);
    assert.equal(insRetired.code, "23514");
    // 오늘이 폐지일이면 아직 유효 — 후속으로 둘 수 있다
    await addGu("9919000000", "siheom-e-gu", { valid_to: kstDay(0) });
    assert.ok((await attempt("update public.regions set valid_to = $1, successor_code = '9919000000' where code = '9911000000'", [kstDay(-1)])).ok);
  }));

test("③ 후속이 또 폐지면 최종 지역으로 바꿔 쓴다 · 나중에 후속이 폐지되면 앞 행도 옮긴다(연쇄 0) · 순환 거부", () =>
  tx(async () => {
    await addSido();
    for (const [code, slug] of [["9911000000", "a-gu"], ["9913000000", "b-gu"], ["9915000000", "c-gu"], ["9917000000", "d-gu"]]) await addGu(code, slug);
    await client.query("update public.regions set valid_to = $1, successor_code = '9915000000' where code = '9913000000'", [kstDay(-1)]);
    await client.query("update public.regions set valid_to = $1, successor_code = '9913000000' where code = '9911000000'", [kstDay(-1)]);
    assert.equal(await successorOf("9911000000"), "9915000000", "A → B(폐지 → C) 는 A → C로");
    await client.query("insert into public.region_slug_redirects (old_path, region_code, reason) values ('/local/gasang-do/old-c', '9915000000', 'retired')");
    await client.query("update public.regions set valid_to = $1, successor_code = '9917000000' where code = '9915000000'", [kstDay(-1)]);
    assert.equal(await successorOf("9911000000"), "9917000000");
    assert.equal(await successorOf("9913000000"), "9917000000");
    const redirect = (await client.query("select region_code from public.region_slug_redirects where old_path = '/local/gasang-do/old-c'")).rows[0];
    assert.equal(redirect.region_code, "9917000000", "옛 주소의 도착도 최종 지역");
    const chainLeft = (await client.query("select count(*)::int as n from public.regions r join public.regions s on s.code = r.successor_code where s.successor_code is not null")).rows[0].n;
    assert.equal(chainLeft, 0, "후속의 후속 0");
    // 순환 — D의 후속을 A로(A의 최종 후속이 D)
    const cycle = await attempt("update public.regions set valid_to = $1, successor_code = '9911000000' where code = '9917000000'", [kstDay(-1)]);
    assert.equal(cycle.code, "23514");
    assert.match(cycle.message, /순환/);
  }));

test("④ 옛 주소 — 형식 밖 거부 · 폐지 지역으로 넣으면 최종 후속으로 · 후속 없는 폐지 지역 거부 · 제자리 301 거부", () =>
  tx(async () => {
    await addSido();
    await addGu("9911000000", "siheom-si");
    await addGu("9913000000", "old-gu");
    await addGu("9915000000", "dead-gu", { valid_to: kstDay(-1) });
    await client.query("update public.regions set valid_to = $1, successor_code = '9911000000' where code = '9913000000'", [kstDay(-1)]);
    const ins = (path, code) => attempt("insert into public.region_slug_redirects (old_path, region_code, reason) values ($1, $2, 'retired') returning region_code", [path, code]);
    for (const bad of ["/region/gasang-do/x", "/local/Gasang-do/x", "/local/gasang-do/x/y", "local/gasang-do/x", "/local/gasang-do/x-"]) assert.equal((await ins(bad, "9911000000")).code, "23514", bad);
    const viaRetired = await ins("/local/gasang-do/older-gu", "9913000000");
    assert.ok(viaRetired.ok, viaRetired.message);
    assert.equal(viaRetired.rows[0].region_code, "9911000000");
    const dead = await ins("/local/gasang-do/x-gu", "9915000000");
    assert.equal(dead.code, "23514");
    assert.match(dead.message, /오늘 유효하지 않습니다/);
    const self = await ins("/local/gasang-do/siheom-si", "9911000000");
    assert.equal(self.code, "23514");
    assert.match(self.message, /제자리 301/);
    assert.equal((await ins("/local/gasang-do/nowhere", "9999000000")).code, "23503", "없는 지역");
  }));

test("⑤ RLS — 적재 기록·옛 주소 표는 anon·authenticated 권한 거부(0행), regions 새 칸은 공개 참조 자료로 읽힌다", () =>
  tx(async () => {
    await client.query(...run());
    await addSido();
    await addGu("9911000000", "siheom-si");
    await client.query("insert into public.region_slug_redirects (old_path, region_code, reason) values ('/local/gasang-do/old', '9911000000', 'renamed')");
    for (const role of ["anon", "authenticated"]) {
      for (const table of ["region_import_runs", "region_slug_redirects"]) {
        const r = await attempt(`select count(*) from public.${table}`, [], role);
        assert.equal(r.code, "42501", `${role} ${table}`);
        const w = await attempt(`delete from public.${table}`, [], role);
        assert.equal(w.code, "42501", `${role} ${table} 쓰기`);
      }
      const cols = await attempt("select code, successor_code, import_run_id from public.regions where code = '9911000000'", [], role);
      assert.ok(cols.ok, cols.message);
      assert.equal(cols.rows.length, 1);
    }
    const rls = (await client.query("select relname, relrowsecurity from pg_class where relname in ('region_import_runs', 'region_slug_redirects') order by relname")).rows;
    assert.deepEqual(rls, [{ relname: "region_import_runs", relrowsecurity: true }, { relname: "region_slug_redirects", relrowsecurity: true }]);
  }));

test("⑥ 도구가 만든 데이터 마이그레이션 — v1 적용 = 계산한 상태 · 두 번 적용 = 같음 · 같은 파일 다시 = 차이 0 · v2(개칭·폐지·새 지역) 적용 = 계산한 상태", () =>
  tx(async () => {
    await addSido(); // 가짜 시·도는 씨앗처럼 먼저 있다 (실제 적재에서 시·도 17은 씨앗)
    const r1 = pipelineFor("v1.utf8.txt", { current: await currentFromDb(client) });
    assert.deepEqual(r1.plan.counts, { added: 6, renamed: 0, retired: 0, unchanged: 18 });
    const sql1 = emitMigration({ source: r1.source, counts: r1.counts, plan: r1.plan, approvedBy: "PO(시험)" });
    await client.query(sql1);
    assert.deepEqual(await currentFromDb(client), r1.after, "DB 상태 = 도구가 계산한 적용 뒤 상태");
    const runs1 = (await client.query("select id, file_name, file_date::text, rows_total, class_counts, change_counts, status, applied_by, applied_at is not null as has_at from public.region_import_runs where sha256 = $1", [r1.source.sha256])).rows;
    assert.equal(runs1.length, 1);
    assert.deepEqual({ ...runs1[0], id: undefined }, {
      id: undefined, file_name: "v1.utf8.txt", file_date: "2026-10-01", rows_total: 32, class_counts: { sido: 18, sigungu: 7, general_gu: 2, sub_district: 5 },
      change_counts: { added: 6, renamed: 0, retired: 0, unchanged: 18 }, status: "applied", applied_by: "PO(시험)", has_at: true,
    });
    const tagged = (await client.query("select code from public.regions where import_run_id = $1 order by code", [runs1[0].id])).rows.map((x) => x.code);
    assert.deepEqual(tagged, ["9911000000", "9913000000", "9915000000", "9917000000", "9919000000", "9920000000"]);
    const general = (await client.query("select count(*)::int as n from public.regions where code in ('9911100000', '9911300000', '9922000000', '9911101000')")).rows[0].n;
    assert.equal(general, 0, "일반구·폐지·하위 행 0");
    const mid = await counts();
    await client.query(sql1);
    assert.deepEqual(await counts(), mid, "두 번 적용해도 행 수 같음");
    assert.deepEqual(await currentFromDb(client), r1.after);
    const again = pipelineFor("v1.utf8.txt", { current: await currentFromDb(client) });
    assert.deepEqual(again.plan.counts, { added: 0, renamed: 0, retired: 0, unchanged: 24 }, "같은 파일 두 번 = 차이 0");
    assert.deepEqual(again.plan.aliasUpdates, []);

    const r2 = pipelineFor("v2.utf8.txt", { current: await currentFromDb(client), successors: readSuccessors(fs.readFileSync(fix("v2.successors.csv"), "utf8")), fileDate: "2026-11-01" });
    assert.deepEqual(r2.plan.counts, { added: 1, renamed: 1, retired: 1, unchanged: 22 });
    await client.query(emitMigration({ source: r2.source, counts: r2.counts, plan: r2.plan, approvedBy: "PO(시험)" }));
    assert.deepEqual(await currentFromDb(client), r2.after);
    const redirects = (await client.query("select old_path, region_code, reason from public.region_slug_redirects where old_path like '/local/gasang-do/%'")).rows;
    assert.deepEqual(redirects, [{ old_path: "/local/gasang-do/na-gu", region_code: "9913000000", reason: "retired" }]);
    const renamed = (await client.query("select name, slug from public.regions where code = '9917000000'")).rows[0];
    assert.deepEqual(renamed, { name: "새예시군", slug: "yesi-gun" }, "이름만 바뀌고 slug 그대로");
    assert.equal((await client.query("select count(*)::int as n from public.region_import_runs where status = 'applied' and sha256 = any($1)", [[r1.source.sha256, r2.source.sha256]])).rows[0].n, 2);
  }));

test("시험 뒤 행 수가 시험 전과 같다 (가짜 지역·적재 기록·옛 주소 0)", async () => {
  assert.deepEqual(await counts(), baseline);
  assert.equal((await client.query("select count(*)::int as n from public.regions where code like '99%' and slug like any (array['gasang%', 'siheom%', 'na-gu', 'yesi-gun', 'moui%'])")).rows[0].n, 0);
});
