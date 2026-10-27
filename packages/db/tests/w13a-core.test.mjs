// W13-a a1 DB - 지식창고 표 (마이그레이션 191, PRD-05 LIB-01·02·06)
//  · 본문 직접 권한 0 · 새 행은 초안만 · 승인은 작업 번호 없이 불가 · 권리 확인은 근거·확인일 필수
//  · 권리 변경 기록 자동·추가만 · 승인 뒤 본문 수정 거부 · 철회 되살리기 거부 · 판차는 단행본만, 권호는 월간만
// 출판물·노드 글은 모두 시험용 가짜다.
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

const pub = async (kind) => (await client.query("insert into public.publications (slug, title, kind) values ($1, '시험용 출판물', $2) returning id", [h.uniq("pub").toLowerCase().replace(/[^a-z0-9-]/g, "-"), kind])).rows[0].id;
const edition = async (pubId, label = "시험 1판", asOf = "2026-01-01") =>
  (await client.query("insert into public.editions (publication_id, edition_label, as_of) values ($1, $2, $3) returning id", [pubId, label, asOf])).rows[0].id;
const node = async (ed, over = {}) =>
  (await client.query("insert into public.pub_nodes (edition_id, parent_id, depth, ordinal, title) values ($1, $2, $3, $4, $5) returning id", [ed, over.parent ?? null, over.depth ?? 1, over.ordinal ?? 0, over.title ?? "시험용 장"])).rows[0].id;

test("본문 표는 anon·authenticated 직접 권한이 없다", () => h.tx(async () => {
  const r = await client.query(
    "select has_table_privilege('anon', 'public.library_bodies', 'select') a, has_table_privilege('authenticated', 'public.library_bodies', 'select') b, has_table_privilege('anon', 'public.pub_nodes', 'select') c, has_table_privilege('authenticated', 'public.magazine_articles', 'select') d",
  );
  assert.deepEqual(r.rows[0], { a: false, b: false, c: false, d: false });
}));

test("판차는 단행본에만, 권호는 월간 출판물에만 둘 수 있다", () => h.tx(async () => {
  const book = await pub("book");
  const mag = await pub("magazine");
  assert.equal((await h.attempt("insert into public.editions (publication_id, edition_label, as_of) values ($1, 'x', '2026-01-01')", [mag])).ok, false);
  assert.equal((await h.attempt("insert into public.magazine_issues (publication_id, issue_no, issued_on, as_of) values ($1, 'x', '2026-01-01', '2026-01-01')", [book])).ok, false);
  assert.equal((await h.attempt("insert into public.magazine_issues (publication_id, issue_no, issued_on, as_of) values ($1, '1호', '2026-01-01', '2026-01-01')", [mag])).ok, true);
}));

test("새 노드는 초안으로만 만들고 작업 번호 없이는 승인 상태가 될 수 없다", () => h.tx(async () => {
  const ed = await edition(await pub("book"));
  const n = await node(ed);
  assert.equal((await h.one("select status from public.pub_nodes where id = $1", [n])).status, "draft");
  assert.equal((await h.attempt("insert into public.pub_nodes (edition_id, depth, ordinal, title, status) values ($1, 1, 5, 'x', 'approved')", [ed])).ok, false);
  assert.equal((await h.attempt("update public.pub_nodes set status = 'approved' where id = $1", [n])).ok, false);
}));

test("권리 확인은 근거와 확인일이 함께 있어야 한다 (경계: 근거만, 확인일만, 둘 다)", () => h.tx(async () => {
  const n = await node(await edition(await pub("book")));
  assert.equal((await h.attempt("update public.pub_nodes set rights_public = 'confirmed', rights_ref = '시험용 계약 1' where id = $1", [n])).ok, false);
  assert.equal((await h.attempt("update public.pub_nodes set rights_public = 'confirmed', rights_confirmed_on = '2026-01-02' where id = $1", [n])).ok, false);
  assert.equal((await h.attempt("update public.pub_nodes set rights_public = 'confirmed', rights_ref = '시험용 계약 1', rights_confirmed_on = '2026-01-02' where id = $1", [n])).ok, true);
  assert.equal((await h.attempt("update public.pub_nodes set rights_index = 'maybe' where id = $1", [n])).ok, false);
}));

test("권리 변경은 기록표에 자동으로 남고 기록은 고치거나 지울 수 없다", () => h.tx(async () => {
  const n = await node(await edition(await pub("book")));
  await client.query("select set_config('ltr.actor', 'admin:test@example.test', true)");
  await client.query("update public.pub_nodes set rights_public = 'confirmed', rights_ref = '시험용 계약 1', rights_confirmed_on = '2026-01-02' where id = $1", [n]);
  await client.query("update public.pub_nodes set rights_public = 'restricted' where id = $1", [n]);
  const log = (await client.query("select field, old_value, new_value, actor from public.library_rights_log where item_kind = 'node' and item_id = $1 order by id", [n])).rows;
  assert.deepEqual(log, [
    { field: "rights_public", old_value: "unchecked", new_value: "confirmed", actor: "admin:test@example.test" },
    { field: "rights_public", old_value: "confirmed", new_value: "restricted", actor: "admin:test@example.test" },
  ]);
  assert.equal((await h.attempt("update public.library_rights_log set actor = 'x'")).ok, false);
  assert.equal((await h.attempt("delete from public.library_rights_log")).ok, false);
  assert.equal((await h.attempt("truncate public.library_rights_log")).ok, false);
}));

test("노드 트리 - 상위는 같은 판의 한 단계 위여야 하고 같은 자리 순서는 하나", () => h.tx(async () => {
  const ed1 = await edition(await pub("book"));
  const ed2 = await edition(await pub("book"));
  const ch = await node(ed1);
  assert.equal((await h.attempt("insert into public.pub_nodes (edition_id, parent_id, depth, ordinal, title) values ($1, $2, 2, 0, '절')", [ed1, ch])).ok, true);
  assert.equal((await h.attempt("insert into public.pub_nodes (edition_id, parent_id, depth, ordinal, title) values ($1, $2, 3, 1, '건너뜀')", [ed1, ch])).ok, false);
  assert.equal((await h.attempt("insert into public.pub_nodes (edition_id, parent_id, depth, ordinal, title) values ($1, $2, 2, 0, '다른 판')", [ed2, ch])).ok, false);
  assert.equal((await h.attempt("insert into public.pub_nodes (edition_id, parent_id, depth, ordinal, title) values ($1, $2, 2, 0, '중복 순서')", [ed1, ch])).ok, false);
  assert.equal((await h.attempt("insert into public.pub_nodes (edition_id, depth, ordinal, title) values ($1, 4, 9, '깊이 초과')", [ed1])).ok, false);
}));

test("초안 본문은 쓰고 고칠 수 있고, 가리키는 항목이 없으면 거부한다", () => h.tx(async () => {
  const n = await node(await edition(await pub("book")));
  assert.equal((await h.attempt("insert into public.library_bodies (kind, ref_id, body) values ('node', $1, '시험용 본문')", [n])).ok, true);
  assert.equal((await h.attempt("update public.library_bodies set body = '시험용 본문 수정' where kind = 'node' and ref_id = $1", [n])).ok, true);
  assert.equal((await h.attempt("insert into public.library_bodies (kind, ref_id, body) values ('node', 999999999, '고아')")).ok, false);
  assert.equal((await h.attempt("insert into public.library_bodies (kind, ref_id, body) values ('node', $1, '   ')", [n])).ok, false);
}));

test("승인된 항목의 본문은 고치거나 지울 수 없고 철회는 되살릴 수 없다", () => h.tx(async () => {
  const n = await node(await edition(await pub("book")));
  await client.query("insert into public.library_bodies (kind, ref_id, body) values ('node', $1, '시험용 본문')", [n]);
  // 실제 경로: 권리 확인 -> 이관 작업(192) 단계 전이 -> 승인 함수
  await client.query("update public.pub_nodes set rights_public = 'confirmed', rights_ref = '시험용 계약 1', rights_confirmed_on = '2026-01-02' where id = $1", [n]);
  const job = (await h.one("select public.digitize_create('node', $1, '시험용 원본.txt', 'admin:test') r", [n])).r.jobId;
  for (const to of ["extracted", "structured", "proofread"]) await client.query("select public.digitize_advance($1, $2, 'admin:test')", [job, to]);
  assert.equal((await h.one("select public.digitize_approve($1, 100, 0, 'admin:test') r", [job])).r.ok, true);
  assert.equal((await h.one("select status from public.pub_nodes where id = $1", [n])).status, "approved");
  assert.equal((await h.attempt("update public.library_bodies set body = '바꿈' where kind = 'node' and ref_id = $1", [n])).ok, false);
  assert.equal((await h.attempt("delete from public.library_bodies where kind = 'node' and ref_id = $1", [n])).ok, false);
  assert.equal((await h.attempt("delete from public.pub_nodes where id = $1", [n])).ok, false);
  assert.equal((await h.attempt("update public.pub_nodes set status = 'draft' where id = $1", [n])).ok, false);
  assert.equal((await h.attempt("update public.pub_nodes set status = 'withdrawn' where id = $1", [n])).ok, true);
  assert.equal((await h.attempt("update public.pub_nodes set status = 'approved' where id = $1", [n])).ok, false);
}));

test("권호 기사도 초안으로 만들어지고 승인 상태로는 바로 만들 수 없다 (권호 가드가 기사 행에서도 돈다)", () => h.tx(async () => {
  const issue = (await client.query("insert into public.magazine_issues (publication_id, issue_no, issued_on, as_of) values ($1, '1호', '2026-01-01', '2026-01-01') returning id", [await pub("magazine")])).rows[0].id;
  const ok = await h.attempt("insert into public.magazine_articles (issue_id, ordinal, title) values ($1, 0, '시험용 기사') returning status", [issue]);
  assert.equal(ok.ok, true, ok.message);
  assert.equal(ok.rows[0].status, "draft");
  assert.equal((await h.attempt("insert into public.magazine_articles (issue_id, ordinal, title, status) values ($1, 1, '시험용 기사', 'approved')", [issue])).ok, false);
}));
