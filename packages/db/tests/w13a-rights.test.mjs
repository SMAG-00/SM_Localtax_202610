// W13-a a8 DB - 권리 기록·철회·색인 제외·대량 복사 탐지 (마이그레이션 193·195, PRD-05 LIB-05·06)
//  · library_rights_set - 확인은 근거·확인일 필수, 철회하면 다음 요청부터 library_read/공개 뷰에서 빠짐, 변경 기록 남음
//  · library_index_sync - 색인 자격(승인 ∧ 색인 권리 ∧ 프리미엄)만 대기열, 철회하면 청크 retired_at, 같은 해시는 다시 쌓지 않음
//  · library_chunk_source_load - 자격 없으면 null
//  · 대량 복사 탐지 - 긴 창 상한 도달 시 차단과 기록
// 원고는 모두 시험용 가짜다. 모든 시험은 거래 안에서 돌고 되돌린다.
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
const BODY = "가나다라마바사아자차카타파하".repeat(10);
const flag = (on) => client.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify({ library: on })]);
const rights = async (kind, id, field, value, ref = "시험용 계약", on = "2026-01-02") => (await h.one("select public.library_rights_set($1, $2, $3, $4, $5, $6::date, $7) r", [kind, id, field, value, ref, on, ACTOR])).r;

async function approvedNode({ tier = "premium" } = {}) {
  const p = (await client.query("insert into public.publications (slug, title, kind) values ($1, '시험용', 'book') returning id", [h.uniq("pub").toLowerCase().replace(/[^a-z0-9-]/g, "-")])).rows[0].id;
  const ed = (await client.query("insert into public.editions (publication_id, edition_label, as_of) values ($1, '시험 1판', '2026-01-01') returning id", [p])).rows[0].id;
  const n = (await client.query("insert into public.pub_nodes (edition_id, depth, ordinal, title, access_tier) values ($1, 1, 0, '시험용 장', $2) returning id", [ed, tier])).rows[0].id;
  await client.query("insert into public.library_bodies (kind, ref_id, body) values ('node', $1, $2)", [n, BODY]);
  assert.equal((await rights("node", n, "rights_public", "confirmed")).ok, true);
  const job = (await h.one("select public.digitize_create('node', $1, '시험용.txt', $2) r", [n, ACTOR])).r.jobId;
  for (const to of ["extracted", "structured", "proofread"]) await client.query("select public.digitize_advance($1, $2, $3)", [job, to, ACTOR]);
  assert.equal((await h.one("select public.digitize_approve($1, 100, 0, $2) r", [job, ACTOR])).r.ok, true);
  return n;
}

test("권리 확인은 근거·확인일이 없으면 거부, 잘못된 칸·값·대상도 거부", () => h.tx(async () => {
  const p = (await client.query("insert into public.publications (slug, title, kind) values ($1, '시험용', 'book') returning id", [h.uniq("pub").toLowerCase().replace(/[^a-z0-9-]/g, "-")])).rows[0].id;
  const ed = (await client.query("insert into public.editions (publication_id, edition_label, as_of) values ($1, 'x', '2026-01-01') returning id", [p])).rows[0].id;
  const n = (await client.query("insert into public.pub_nodes (edition_id, depth, ordinal, title) values ($1, 1, 0, 't') returning id", [ed])).rows[0].id;
  assert.deepEqual(await rights("node", n, "rights_public", "confirmed", null, null), { ok: false, code: "record_required" });
  assert.deepEqual(await rights("node", n, "rights_public", "maybe"), { ok: false, code: "bad_value" });
  assert.deepEqual(await rights("node", n, "rights_pdf", "confirmed"), { ok: false, code: "bad_field" });
  assert.deepEqual(await rights("node", 999999999, "rights_public", "confirmed"), { ok: false, code: "no_target" });
  assert.equal((await rights("node", n, "rights_index", "confirmed")).ok, true);
  assert.equal((await rights("node", n, "rights_sale", "confirmed", null, null)).ok, true, "이미 근거·확인일이 있으면 새 값 없이도 확인할 수 있다");
}));

test("권리 철회 - 다음 요청부터 library_read와 공개 뷰에서 빠지고 변경 기록이 남는다", () => h.tx(async () => {
  await flag(true);
  const n = await approvedNode({ tier: "public" });
  assert.equal((await h.one("select public.library_read(null, 'node', $1) r", [n])).r.ok, true);
  assert.equal((await rights("node", n, "rights_public", "restricted")).ok, true);
  assert.deepEqual((await h.one("select public.library_read(null, 'node', $1) r", [n])).r, { ok: false, code: "not_found" });
  assert.equal((await h.one("select count(*)::int c from public.public_library_nodes where id = $1", [n])).c, 0);
  const log = (await client.query("select old_value, new_value, actor from public.library_rights_log where item_kind = 'node' and item_id = $1 and field = 'rights_public' order by id", [n])).rows;
  assert.deepEqual(log.at(-1), { old_value: "confirmed", new_value: "restricted", actor: ACTOR });
}));

test("색인 동기화 - 자격 있는 원천만 대기열, 같은 해시는 다시 쌓지 않고 철회하면 청크를 뺀다", () => h.tx(async () => {
  const n = await approvedNode();
  const sid = `node:${n}`;
  let r = (await h.one("select public.library_index_sync('test-v1') r")).r;
  assert.equal((await h.one("select count(*)::int c from public.index_queue where source_type = 'publication' and source_id = $1", [sid])).c, 0, "색인 권리 확인 전에는 대기열 0");
  assert.equal((await rights("node", n, "rights_index", "confirmed")).ok, true);
  r = (await h.one("select public.library_index_sync('test-v1') r")).r;
  assert.equal(r.ok, true);
  assert.equal((await h.one("select count(*)::int c from public.index_queue where source_type = 'publication' and source_id = $1 and done_at is null", [sid])).c, 1);
  await h.one("select public.library_index_sync('test-v1') r");
  assert.equal((await h.one("select count(*)::int c from public.index_queue where source_type = 'publication' and source_id = $1", [sid])).c, 1, "대기 중인 원천은 중복해서 쌓지 않는다");
  const load = (await h.one("select public.library_chunk_source_load($1) r", [sid])).r;
  assert.equal(load.sourceType, "publication");
  assert.equal(load.accessTier, "premium");
  assert.equal(load.body, BODY);
  // 청크가 색인된 뒤 색인 권리를 거두면 다음 동기화에서 retired_at이 채워진다
  const put = (await h.one(
    `select public.chunk_index_put('publication', $1, 'test-v1', $2::jsonb, $3::jsonb) r`,
    [sid, JSON.stringify({ docType: "publication", taxItems: ["지식창고"], validFrom: "2026-01-01", accessTier: "premium", rightsStatus: "confirmed", scope: "base", sourceHash: load.sourceHash }),
      JSON.stringify([{ chunkNo: 0, path: load.path, content: "시험용 청크 내용", tokenEst: 5, contentHash: "a".repeat(64) }])],
  )).r;
  assert.equal(put.ok, true);
  assert.equal((await rights("node", n, "rights_index", "restricted")).ok, true);
  const sync = (await h.one("select public.library_index_sync('test-v1') r")).r;
  assert.equal(sync.retired >= 1, true);
  assert.equal((await h.one("select count(*)::int c from public.chunks where source_type = 'publication' and source_id = $1 and retired_at is null", [sid])).c, 0);
  assert.equal((await h.one("select public.library_chunk_source_load($1) r", [sid])).r, null);
}));

test("공개 등급 노드는 색인 자격이 없다 (출판물 색인은 프리미엄만)", () => h.tx(async () => {
  const n = await approvedNode({ tier: "public" });
  await rights("node", n, "rights_index", "confirmed");
  await h.one("select public.library_index_sync('test-v1') r");
  assert.equal((await h.one("select count(*)::int c from public.index_queue where source_type = 'publication' and source_id = $1", [`node:${n}`])).c, 0);
}));

test("대량 복사 탐지 - 긴 창 상한에 닿으면 차단하고 기록한다", () => h.tx(async () => {
  const key = h.uniq("bulk");
  await client.query("update public.settings set value = $1::jsonb where key = 'library_rate_limit'", [JSON.stringify({ max: 100, window_seconds: 60, bulk_copy_max: 3, bulk_copy_window_seconds: 3600 })]);
  const t0 = "2026-04-01T00:00:00Z";
  for (let i = 0; i < 3; i++) {
    const r = (await h.one("select public.library_rate_hit($1, $2::timestamptz + make_interval(mins => $3)) r", [key, t0, i * 5])).r;
    assert.equal(r.ok, true);
  }
  const blocked = (await h.one("select public.library_rate_hit($1, $2::timestamptz + interval '20 minutes') r", [key, t0])).r;
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "bulk_copy");
  assert.equal((await h.one("select count(*)::int c from public.library_abuse_log where key = $1 and kind = 'bulk_copy'", [key])).c, 1);
}));
