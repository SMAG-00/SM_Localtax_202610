// W11-c DB - 가이드 배치 · DF-08 공개 관문 · 단계 카드 판정 진입 칸 (마이그레이션 20261025000118 · 119, docs/dev/W11-c_설계.md 3장)
//  · 배치 표: 원고 칸 없음, 신탁 주제 중복(finance_tax 허브의 trust 주제) 거부, 허브·화면 종류 불일치 거부, 같은 배치 중복 거부, 삭제는 배치만
//  · DF-08 관문: 검토 기록 없이 finance_tax_guide 켜기 거부 / 모양 검사 / approved + ref 뒤 켜기 성공 / 끄기는 검사 없음
//  · 공개 뷰: 서명 전 0행, 공개 뒤 기능 키가 켜진 화면 종류만 1행, 같은 가이드는 두 화면에서 같은 버전·본문 해시(TRU-02 = DF-08)
//  · 119: determination_kind 값 목록 제약, 서명된 카드의 종류를 고치면 재감수 필요로
// 모든 시험은 거래 안에서 돌고 되돌린다. 내용은 시험용 가짜다 - 실제 법령·세율 없음.
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
const user = async () => (await one("insert into auth.users (id) values (gen_random_uuid()) returning id")).id;
async function withRole(role) {
  const id = await user();
  await client.query("insert into public.staff_roles (user_id, role, granted_by) values ($1, $2, 'test')", [id, role]);
  return `user:${id}`;
}
const guide = async (hub, topic) => one("insert into public.guides (hub, topic, slug, created_by) values ($1, $2, $3, 'test') returning *", [hub, topic, uniq("guide")]);
const draft = async (guideId) =>
  one("insert into public.guide_versions (guide_id, title, sections, tax_scope, as_of, created_by) values ($1, '시험용 가이드', '[]'::jsonb, 'local', '2099-01-01', 'test') returning *", [guideId]);
const place = (guideId, surface, key) => attempt("insert into public.guide_placements (guide_id, surface, target_key, created_by) values ($1, $2, $3, 'test')", [guideId, surface, key]);
async function setFlags(patch) {
  await client.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify(patch)]);
}
async function publishNew(g) {
  const v = await draft(g.id);
  const signer = await withRole("reviewer");
  assert.equal((await one("select public.guide_sign($1, $2, '시험용 시트') r", [v.id, signer])).r.ok, true);
  assert.equal((await one("select public.guide_publish($1, 'admin:test@example.test') r", [v.id])).r.ok, true);
  return v;
}
const anonRows = async (surface, key) => (await attempt("select * from public.public_guide_placements where surface = $1 and target_key = $2", [surface, key], "anon")).rows ?? [];

test("배치 표에는 원고 칸이 없다 - 가이드 ID·화면 종류·대상 키·순서·작성자·시각뿐", async () => {
  const cols = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'guide_placements' order by 1")).rows.map((r) => r.column_name);
  assert.deepEqual(cols, ["created_at", "created_by", "guide_id", "id", "sort", "surface", "target_key"]);
});

test("신탁 주제를 finance_tax 허브에 따로 두는 배치는 거부 (TRU-02 = DF-08 중복 원고 0)", () =>
  tx(async () => {
    const dup = await guide("finance_tax", "trust");
    const r = await place(dup.id, "finance_tax_hub", "trust");
    assert.equal(r.ok, false);
    assert.match(r.message, /허브 trust의 한 행/);
  }));

test("허브와 화면 종류가 맞지 않으면 거부, 맞으면 같은 신탁 가이드를 두 화면에 붙일 수 있다", () =>
  tx(async () => {
    const trust = await guide("trust", "trust");
    const redev = await guide("redevelopment", "stage_topic");
    assert.equal((await place(redev.id, "trust_type", "test-structure")).ok, false);
    assert.equal((await place(trust.id, "dev_method", "test-method")).ok, false);
    assert.equal((await place(trust.id, "trust_type", "test-structure")).ok, true);
    assert.equal((await place(trust.id, "finance_tax_hub", "trust")).ok, true);
    assert.equal((await place(redev.id, "stage", "test_stage")).ok, true);
  }));

test("같은 가이드·화면·대상 중복 배치와 모양 밖 대상 키는 거부", () =>
  tx(async () => {
    const g = await guide("trust", "trust");
    assert.equal((await place(g.id, "trust_type", "test-structure")).ok, true);
    assert.equal((await place(g.id, "trust_type", "test-structure")).ok, false);
    assert.equal((await place(g.id, "trust_type", "Bad Key")).ok, false);
  }));

test("권한: anon·authenticated는 표 직접 접근 0, service_role은 배치를 지울 수 있다(가이드는 불변)", () =>
  tx(async () => {
    const g = await guide("trust", "trust");
    await place(g.id, "trust_type", "test-structure");
    assert.equal((await attempt("select * from public.guide_placements", [], "anon")).ok, false);
    assert.equal((await attempt("select * from public.guide_placements", [], "authenticated")).ok, false);
    assert.equal((await attempt("delete from public.guide_placements where guide_id = $1", [g.id], "service_role")).ok, true);
    assert.equal((await attempt("delete from public.guides where id = $1", [g.id])).ok, false);
  }));

test("DF-08 관문: 검토 기록 없이 finance_tax_guide 켜기 거부, 모양 밖 기록 거부, approved + ref 뒤 켜기 성공, 끄기는 검사 없음", () =>
  tx(async () => {
    await setFlags({ finance_tax_guide: false });
    const noRecord = await attempt("update public.settings set value = value || '{\"finance_tax_guide\": true}'::jsonb where key = 'feature_flags'");
    assert.equal(noRecord.ok, false);
    assert.match(noRecord.message, /자본시장법 검토 기록/);

    const bad = (v) => attempt("update public.settings set value = $1::jsonb where key = 'finance_tax_guide_review'", [JSON.stringify(v)]);
    assert.equal((await bad({ reviewer: "시험 검토자" })).ok, false);
    assert.equal((await bad({ reviewer: "시험 검토자", reviewed_on: "2099-01-01", conclusion: "approved" })).ok, false, "ref 빠짐");
    assert.equal((await bad({ reviewer: "시험 검토자", reviewed_on: "2099-01-01", conclusion: "maybe", ref: "시험용 위치" })).ok, false);
    const rejected = { reviewer: "시험 검토자", reviewed_on: "2099-01-01", conclusion: "rejected", ref: "시험용 위치" };
    assert.equal((await bad(rejected)).ok, true);
    assert.equal((await attempt("update public.settings set value = value || '{\"finance_tax_guide\": true}'::jsonb where key = 'feature_flags'")).ok, false, "rejected로는 못 켠다");

    assert.equal((await bad({ ...rejected, conclusion: "approved" })).ok, true);
    assert.equal((await attempt("update public.settings set value = value || '{\"finance_tax_guide\": true}'::jsonb where key = 'feature_flags'")).ok, true);
    assert.equal((await attempt("update public.settings set value = value || '{\"finance_tax_guide\": false}'::jsonb where key = 'feature_flags'")).ok, true);
  }));

test("공개 뷰: 서명 전 0행, 공개 뒤에도 기능 키가 꺼지면 0행, 켜지면 1행 + 같은 가이드는 두 화면에서 같은 버전·본문 해시", () =>
  tx(async () => {
    await setFlags({ trust_tax_guide: false, finance_tax_guide: false });
    await client.query("update public.settings set value = $1::jsonb where key = 'finance_tax_guide_review'", [JSON.stringify({ reviewer: "시험 검토자", reviewed_on: "2099-01-01", conclusion: "approved", ref: "시험용 위치" })]);
    const g = await guide("trust", "trust");
    await place(g.id, "trust_type", "test-structure");
    await place(g.id, "finance_tax_hub", "trust");
    const v = await draft(g.id);
    await setFlags({ trust_tax_guide: true, finance_tax_guide: true });
    assert.equal((await anonRows("trust_type", "test-structure")).length, 0, "서명 전 0행");

    const signer = await withRole("reviewer");
    await one("select public.guide_sign($1, $2, '시험용 시트') r", [v.id, signer]);
    assert.equal((await anonRows("trust_type", "test-structure")).length, 0, "서명만 된 상태 0행");
    await one("select public.guide_publish($1, 'admin:test@example.test') r", [v.id]);

    const a = await anonRows("trust_type", "test-structure");
    const b = await anonRows("finance_tax_hub", "trust");
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.equal(a[0].version, b[0].version);
    assert.equal(a[0].body_sha256, b[0].body_sha256);
    assert.deepEqual(Object.keys(a[0]).sort(), ["body_sha256", "hub", "slug", "sort", "surface", "target_key", "topic", "version"]);

    await setFlags({ finance_tax_guide: false });
    assert.equal((await anonRows("finance_tax_hub", "trust")).length, 0, "허브 키가 꺼지면 0행");
    assert.equal((await anonRows("trust_type", "test-structure")).length, 1, "신탁 유형 키는 그대로");
  }));

test("공개 뷰: 개발방법·단계는 redevelopment_tax, 상황은 tax_lifecycle 키를 따른다", () =>
  tx(async () => {
    await setFlags({ redevelopment_tax: false, tax_lifecycle: false });
    const g = await guide("redevelopment", "stage_topic");
    await place(g.id, "dev_method", "test-method");
    await place(g.id, "stage", "test_stage");
    await publishNew(g);
    assert.equal((await anonRows("dev_method", "test-method")).length, 0);
    await setFlags({ redevelopment_tax: true });
    assert.equal((await anonRows("dev_method", "test-method")).length, 1);
    assert.equal((await anonRows("stage", "test_stage")).length, 1);
  }));

test("119: determination_kind 칸은 비어 있어도 되고, 값은 판정표 종류 4개로만 제한된다", async () => {
  const col = await one("select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'project_stage_lenses' and column_name = 'determination_kind'");
  assert.equal(col.is_nullable, "YES");
  const defs = (await client.query("select pg_get_constraintdef(c.oid) d from pg_constraint c where c.conrelid = 'public.project_stage_lenses'::regclass and c.contype = 'c'")).rows.map((r) => r.d).join(" | ");
  for (const k of ["redevelopment_right", "redevelopment_tax", "trust_acquisition", "trust_taxpayer"]) assert.ok(defs.includes(`'${k}'`), `${k} 허용`);
  assert.ok(!defs.includes("'house_count'"), "주택 수 판정은 단계 진입 종류가 아니다");
});
