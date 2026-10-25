// W11-a DB - 감수 가이드 저장·서명·공개 (마이그레이션 20261025000111 · 113, PRD-03 5장·7장 guides, docs/dev/W11-a_설계.md 2·4장)
//  · 표 권한: RLS 켜짐, anon·authenticated 표 직접 접근 0, service_role은 읽기+추가만
//  · 초안으로만 생성, 버전 번호 자동(1, 2), 본문 해시는 DB가 계산, 내용·상태 직접 변경 거부, 삭제 거부
//  · 서명: 감수위원만(없는 계정·관리자만 가진 계정은 거부) / 초안만 / 감수 시트 필수 - 거부도 감사 1행
//  · 공개: 서명 없이 거부(감사 1행) / 서명 전 anon 0행 / 서명+공개 뒤 anon 1행(서명자 계정·시트 위치 칸 없음) / 새 버전 공개 시 이전 공개본 retired
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0). 내용은 시험용 가짜다 - 실제 세율·요건·법령 문장 없음.
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
async function guide(over = {}) {
  const slug = uniq("guide");
  return (await one("insert into public.guides (hub, topic, slug, created_by) values ($1, $2, $3, 'test') returning *", [over.hub ?? "realestate_tax", over.topic ?? "fixture_topic", slug]));
}
async function draft(guideId, over = {}) {
  const row = { title: "시험용 가이드", sections: [{ heading: "시험용 절", body: "시험용 본문" }], facts: {}, tax_scope: "local", as_of: "2099-01-01", ...over };
  return one(
    "insert into public.guide_versions (guide_id, title, sections, facts, tax_scope, as_of, created_by) values ($1, $2, $3::jsonb, $4::jsonb, $5, $6, 'test') returning *",
    [guideId, row.title, JSON.stringify(row.sections), JSON.stringify(row.facts), row.tax_scope, row.as_of],
  );
}
const sign = async (id, signer, sheet = "시험용 감수 시트") => (await one("select public.guide_sign($1, $2, $3) r", [id, signer, sheet])).r;
const publish = async (id, who = "admin:test@example.test") => (await one("select public.guide_publish($1, $2) r", [id, who])).r;
const audit = async (id) => (await client.query("select * from public.guides_audit where guide_version_id = $1 order by id", [id])).rows;

test("표 세 개 - RLS 켜짐, anon·authenticated 직접 접근 0, service_role은 읽기·추가만", () =>
  tx(async () => {
    for (const t of ["guides", "guide_versions", "guides_audit"]) {
      assert.equal((await one("select relrowsecurity rls from pg_class where oid = ('public.' || $1)::regclass", [t])).rls, true, t);
      for (const role of ["anon", "authenticated"]) assert.equal((await attempt(`select 1 from public.${t} limit 1`, [], role)).ok, false, `${role} ${t}`);
      assert.equal((await attempt(`update public.${t} set id = id`, [], "service_role")).ok, false, `service_role update ${t}`);
      assert.equal((await attempt(`delete from public.${t}`, [], "service_role")).ok, false, `service_role delete ${t}`);
    }
  }));

test("초안으로만 만들고, 버전 번호가 1, 2로 자동 매겨지며, 본문 해시는 DB가 계산한다", () =>
  tx(async () => {
    const g = await guide();
    const v1 = await draft(g.id);
    const v2 = await draft(g.id, { title: "시험용 가이드 둘째" });
    assert.deepEqual([v1.version, v2.version], [1, 2]);
    assert.equal(v1.status, "draft");
    assert.match(v1.body_sha256, /^[0-9a-f]{64}$/);
    assert.notEqual(v1.body_sha256, v2.body_sha256);
    const bad = await attempt("insert into public.guide_versions (guide_id, status, title, tax_scope, created_by, signed_by, signed_at, sheet_ref, signed_body_sha256) values ($1, 'reviewed', 't', 'local', 'x', 'x', now(), 's', 'h')", [g.id]);
    assert.equal(bad.ok, false);
  }));

test("만든 뒤 내용은 고칠 수 없고, 상태를 함수 밖에서 바꾸거나 지울 수도 없다", () =>
  tx(async () => {
    const v = await draft((await guide()).id);
    const t = await attempt("update public.guide_versions set title = '바꿈' where id = $1", [v.id]);
    assert.equal(t.ok, false);
    assert.equal(t.code, "42501");
    const s = await attempt("update public.guide_versions set status = 'published', published_by = 'x', published_at = now(), signed_by = 'x', signed_at = now(), sheet_ref = 's', signed_body_sha256 = body_sha256 where id = $1", [v.id]);
    assert.equal(s.ok, false);
    assert.equal((await attempt("delete from public.guide_versions where id = $1", [v.id])).ok, false);
    assert.equal((await one("select status, title from public.guide_versions where id = $1", [v.id])).title, "시험용 가이드");
  }));

test("서명 거부 - 감수위원이 아닌 계정·초안이 아닌 버전·감수 시트 없음, 거부마다 감사 1행", () =>
  tx(async () => {
    const v = await draft((await guide()).id);
    const editor = await withRole("editor");
    const r1 = await sign(v.id, editor);
    assert.deepEqual([r1.ok, r1.code], [false, "signer_not_reviewer"]);
    const r2 = await sign(v.id, "user:00000000-0000-0000-0000-000000000000");
    assert.equal(r2.code, "signer_not_reviewer");
    const reviewer = await withRole("reviewer");
    assert.equal((await sign(v.id, reviewer, "  ")).code, "sheet_missing");
    assert.equal((await sign(999999999, reviewer)).code, "not_found");
    assert.deepEqual((await audit(v.id)).map((a) => [a.action, a.outcome, a.code]), [["sign", "refused", "signer_not_reviewer"], ["sign", "refused", "signer_not_reviewer"], ["sign", "refused", "sheet_missing"]]);
    assert.equal((await one("select status from public.guide_versions where id = $1", [v.id])).status, "draft");
    assert.equal((await sign(v.id, reviewer)).ok, true);
    assert.equal((await sign(v.id, reviewer)).code, "not_draft");
  }));

test("공개 거부 - 서명 없이 공개하면 거부 + 감사 1행이고 anon은 0행", () =>
  tx(async () => {
    const g = await guide();
    const v = await draft(g.id);
    const r = await publish(v.id);
    assert.deepEqual([r.ok, r.code], [false, "not_signed"]);
    assert.deepEqual((await audit(v.id)).map((a) => [a.action, a.outcome, a.code]), [["publish", "refused", "not_signed"]]);
    assert.equal((await publish(v.id, "nobody")).code, "publisher_invalid");
    assert.equal((await attempt("select * from public.public_guides where slug = $1", [g.slug], "anon")).rows.length, 0);
    // 서명만 된 상태(reviewed)도 anon에게는 0행
    await sign(v.id, await withRole("reviewer"));
    assert.equal((await attempt("select * from public.public_guides where slug = $1", [g.slug], "anon")).rows.length, 0);
  }));

test("서명 + 공개 뒤에만 anon이 읽고, 서명자·시트 위치 칸은 뷰에 없으며, 새 버전 공개 시 이전 공개본은 내려간다", () =>
  tx(async () => {
    const g = await guide();
    const reviewer = await withRole("reviewer");
    const v1 = await draft(g.id, { facts: { fixture_value: "시험용" } });
    assert.equal((await sign(v1.id, reviewer)).ok, true);
    assert.equal((await publish(v1.id)).ok, true);
    const seen = (await attempt("select * from public.public_guides where slug = $1", [g.slug], "anon")).rows;
    assert.equal(seen.length, 1);
    assert.equal(seen[0].version, 1);
    assert.deepEqual(seen[0].facts, { fixture_value: "시험용" });
    assert.ok(seen[0].last_reviewed_at && seen[0].published_at);
    for (const hidden of ["signed_by", "sheet_ref", "published_by", "created_by"]) assert.equal(hidden in seen[0], false, hidden);
    assert.equal((await publish(v1.id)).code, "already_published");
    const v2 = await draft(g.id, { title: "시험용 개정 가이드" });
    assert.equal((await attempt("select * from public.public_guides where slug = $1", [g.slug], "anon")).rows[0].version, 1, "새 초안은 공개에 영향 없음");
    await sign(v2.id, reviewer);
    assert.equal((await publish(v2.id)).ok, true);
    const after2 = (await attempt("select * from public.public_guides where slug = $1", [g.slug], "anon")).rows;
    assert.deepEqual(after2.map((r) => [r.version, r.title]), [[2, "시험용 개정 가이드"]]);
    assert.equal((await one("select status from public.guide_versions where id = $1", [v1.id])).status, "retired");
    assert.equal((await publish(v1.id)).code, "retired");
    assert.deepEqual((await audit(v2.id)).map((a) => [a.action, a.outcome]), [["sign", "ok"], ["publish", "ok"]]);
  }));

test("허브·주제·세목 범위 값 제약 - 모르는 허브, 같은 허브·주제 중복, 잘못된 주소는 거부", () =>
  tx(async () => {
    const g = await guide({ hub: "trust", topic: "dup_topic" });
    assert.equal((await attempt("insert into public.guides (hub, topic, slug, created_by) values ('trust', 'dup_topic', $1, 'x')", [uniq("g")])).ok, false);
    assert.equal((await attempt("insert into public.guides (hub, topic, slug, created_by) values ('unknown_hub', 'a_topic', $1, 'x')", [uniq("g")])).code, "23514");
    assert.equal((await attempt("insert into public.guides (hub, topic, slug, created_by) values ('trust', 'other_topic', 'Bad Slug', 'x')")).code, "23514");
    assert.equal((await attempt("insert into public.guide_versions (guide_id, title, tax_scope, created_by) values ($1, 't', 'regional', 'x')", [g.id])).code, "23514");
  }));
