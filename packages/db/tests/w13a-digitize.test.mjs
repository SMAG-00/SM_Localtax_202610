// W13-a a2 DB - O7 이관 상태기계 (마이그레이션 192, AIOPS-16)
//  · 권리 확인 전 작업 생성 거부 · 단계 건너뛰기·되돌리기 거부 · 오류율 0.5% 경계(0.5 통과, 0.51 거부) · 설정 비면 닫힘
//  · 승인 함수 밖 승인 거부 · 승인 뒤 변경 거부 · 거부도 감사 1행
// 출판물·원고는 모두 시험용 가짜다. 모든 시험은 거래 안에서 돌고 되돌린다.
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

const ACTOR = "admin:test@example.test";
async function target(confirmed = true) {
  const p = (await client.query("insert into public.publications (slug, title, kind) values ($1, '시험용', 'book') returning id", [h.uniq("pub").toLowerCase().replace(/[^a-z0-9-]/g, "-")])).rows[0].id;
  const ed = (await client.query("insert into public.editions (publication_id, edition_label, as_of) values ($1, '시험 1판', '2026-01-01') returning id", [p])).rows[0].id;
  const n = (await client.query("insert into public.pub_nodes (edition_id, depth, ordinal, title) values ($1, 1, 0, '시험용 장') returning id", [ed])).rows[0].id;
  if (confirmed) await client.query("update public.pub_nodes set rights_public = 'confirmed', rights_ref = '시험용 계약', rights_confirmed_on = '2026-01-02' where id = $1", [n]);
  return n;
}
const create = async (n) => (await h.one("select public.digitize_create('node', $1, '시험용 원본.txt', $2) r", [n, ACTOR])).r;
const advance = async (id, to) => (await h.one("select public.digitize_advance($1, $2, $3) r", [id, to, ACTOR])).r;
const approve = async (id, size, errs) => (await h.one("select public.digitize_approve($1, $2, $3, $4) r", [id, size, errs, ACTOR])).r;
async function toProofread(n) {
  const r = await create(n);
  for (const s of ["extracted", "structured", "proofread"]) assert.equal((await advance(r.jobId, s)).ok, true);
  return r.jobId;
}

test("권리 확인 전 원고는 이관 작업을 만들 수 없다", () => h.tx(async () => {
  const n = await target(false);
  assert.deepEqual(await create(n), { ok: false, code: "rights_not_confirmed" });
  assert.equal((await h.one("select count(*)::int c from public.digitization_audit where code = 'rights_not_confirmed'")).c >= 1, true);
}));

test("단계는 순서대로만 - 건너뛰기·승인 직행 거부", () => h.tx(async () => {
  const id = (await create(await target())).jobId;
  assert.deepEqual(await advance(id, "structured"), { ok: false, code: "skip" });
  assert.deepEqual(await advance(id, "approved"), { ok: false, code: "use_approve" });
  assert.deepEqual(await approve(id, 100, 0), { ok: false, code: "skip" });
  assert.equal((await advance(id, "extracted")).ok, true);
  assert.equal((await h.attempt("update public.digitization_jobs set stage = 'rights_confirmed' where id = $1", [id])).ok, false);
  assert.equal((await h.attempt("update public.digitization_jobs set stage = 'approved' where id = $1", [id])).ok, false);
}));

test("표본 오류율 경계 - 0.5%는 승인, 0.51%는 닫힘, 거부해도 노드는 초안", () => h.tx(async () => {
  const n1 = await target();
  const j1 = await toProofread(n1);
  const bad = await approve(j1, 10000, 51);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "error_rate");
  assert.equal((await h.one("select status from public.pub_nodes where id = $1", [n1])).status, "draft");
  assert.equal((await approve(j1, 10000, 50)).ok, true);
  assert.equal(Number((await h.one("select status, approved_job_id from public.pub_nodes where id = $1", [n1])).approved_job_id), j1);
}));

test("설정이 비어 있으면 승인이 닫힌다", () => h.tx(async () => {
  const j = await toProofread(await target());
  await client.query("update public.settings set value = '{}'::jsonb where key = 'digitization_sample_error_max'");
  assert.deepEqual(await approve(j, 100, 0), { ok: false, code: "setting_missing" });
}));

test("승인 함수 밖에서 대상을 승인하거나 승인된 작업을 바꿀 수 없다", () => h.tx(async () => {
  const n = await target();
  const j = await toProofread(n);
  assert.equal((await h.attempt("update public.pub_nodes set status = 'approved', approved_job_id = $2 where id = $1", [n, j])).ok, false);
  assert.equal((await approve(j, 100, 0)).ok, true);
  assert.equal((await h.attempt("update public.digitization_jobs set sample_errors = 0 where id = $1", [j])).ok, false);
  assert.equal((await h.attempt("delete from public.digitization_jobs where id = $1", [j])).ok, false);
  assert.equal((await h.attempt("delete from public.digitization_audit")).ok, false);
}));

test("열린 작업이 있는 대상에 두 번째 작업은 거부된다", () => h.tx(async () => {
  const n = await target();
  assert.equal((await create(n)).ok, true);
  assert.deepEqual(await create(n), { ok: false, code: "already_open" });
}));
