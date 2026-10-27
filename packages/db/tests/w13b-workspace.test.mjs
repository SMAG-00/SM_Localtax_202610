// W13-b DB - 워크스페이스 표 (마이그레이션 197·198·199, PRD-05 WS-03·04·05)
//  · 본인만 읽기(다른 회원·anon 0건) · 쓰기는 authenticated 직접 권한 0 · 다른 회원 폴더 사용 거부 · 소유자 변경 거부
//  · 저장 한도 n번째 성공 / n+1번째 거부 / 설정 비면 0 / 권한 만료 정각 경계 · 만료 뒤에도 자료 보존·열람
//  · 내보내기 이력은 추가만
// 글은 모두 시험용 가짜다. 모든 시험은 거래 안에서 돌고 되돌린다.
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

const user = async () => (await client.query("insert into auth.users (id) values (gen_random_uuid()) returning id")).rows[0].id;
const setLimit = (value) => client.query("update public.settings set value = $1::jsonb where key = 'saved_search_limit'", [JSON.stringify(value)]);
const grant = (uid, key = "workspace", from = "now() - interval '1 day'", until = "now() + interval '1 day'") =>
  client.query(`insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until) values ($1, $2, 'manual', $3, ${from}, ${until})`, [uid, key, h.uniq("w13b")]);
const asUser = async (uid, sql, params = []) => {
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
  return h.attempt(sql, params, "authenticated");
};
const create = async (uid, name, conditions = { q: "시험용" }) => (await client.query("select public.ws_saved_search_create($1, $2, $3::jsonb, false) as r", [uid, name, JSON.stringify(conditions)])).rows[0].r;

test("본인 행만 읽는다 - 다른 회원·anon은 0건, authenticated 직접 쓰기 권한은 없다", () =>
  h.tx(async () => {
    const a = await user();
    const b = await user();
    await client.query("insert into public.notes (user_id, body) values ($1, '시험용 메모 A')", [a]);
    await client.query("insert into public.scraps (user_id, target_kind, target_id, label, source_version) values ($1, 'article', '1', '시험용 제목', '1')", [a]);
    await client.query("insert into public.folders (user_id, name) values ($1, '시험용 폴더')", [a]);
    await client.query("insert into public.saved_searches (user_id, name, conditions) values ($1, '시험용', '{}'::jsonb)", [a]);
    for (const t of ["notes", "scraps", "folders", "saved_searches"]) {
      assert.equal((await asUser(a, `select * from public.${t}`)).rowCount, 1, `${t} 본인`);
      assert.equal((await asUser(b, `select * from public.${t}`)).rowCount, 0, `${t} 다른 회원`);
      assert.equal((await h.attempt(`select * from public.${t}`, [], "anon")).ok, false, `${t} anon 권한 거부`);
    }
    assert.equal((await asUser(a, "insert into public.notes (user_id, body) values ($1, 'x')", [a])).ok, false);
    assert.equal((await asUser(a, "update public.notes set body = 'y'")).ok, false);
    assert.equal((await asUser(a, "delete from public.scraps")).ok, false);
  }));

test("다른 회원의 폴더에는 넣을 수 없고 소유자는 바꿀 수 없다", () =>
  h.tx(async () => {
    const a = await user();
    const b = await user();
    const f = (await client.query("insert into public.folders (user_id, name) values ($1, '시험용') returning id", [a])).rows[0].id;
    assert.equal((await h.attempt("insert into public.notes (user_id, folder_id, body) values ($1, $2, 'x')", [b, f])).ok, false);
    assert.equal((await h.attempt("insert into public.notes (user_id, folder_id, body) values ($1, $2, 'x')", [a, f])).ok, true);
    const n = (await client.query("insert into public.notes (user_id, body) values ($1, 'x') returning id", [a])).rows[0].id;
    assert.equal((await h.attempt("update public.notes set user_id = $1 where id = $2", [b, n])).ok, false);
  }));

test("모양 검사 - 본문 20000자 경계, 대상 한쪽만 있으면 거부, 스크랩 번호 모양, 같은 대상 중복 거부", () =>
  h.tx(async () => {
    const a = await user();
    const note = (body, kind = null, id = null) => h.attempt("insert into public.notes (user_id, body, target_kind, target_id) values ($1, $2, $3, $4)", [a, body, kind, id]);
    assert.equal((await note("가".repeat(20000))).ok, true);
    assert.equal((await note("가".repeat(20001))).ok, false);
    assert.equal((await note("   ")).ok, false);
    assert.equal((await note("x", "node", null)).ok, false);
    assert.equal((await note("x", "bogus", "1")).ok, false);
    const scrap = (kind, id) => h.attempt("insert into public.scraps (user_id, target_kind, target_id, label, source_version) values ($1, $2, $3, '시험용', '1')", [a, kind, id]);
    assert.equal((await scrap("node", "12a")).ok, false);
    assert.equal((await scrap("agent_answer", "abc-1")).ok, true);
    assert.equal((await scrap("node", "12")).ok, true);
    assert.equal((await scrap("node", "12")).ok, false);
  }));

test("저장 검색 한도 - 설정이 비면 0(거부), n=2면 2번째 성공·3번째 거부, 중복 이름 거부", () =>
  h.tx(async () => {
    const u = await user();
    await grant(u);
    await setLimit({});
    const closed = await create(u, "첫째");
    assert.deepEqual({ ok: closed.ok, code: closed.code }, { ok: false, code: "limit" });
    await setLimit({ max: 2 });
    assert.equal((await create(u, "첫째")).ok, true);
    assert.equal((await create(u, "첫째")).code, "duplicate");
    const second = await create(u, "둘째");
    assert.equal(second.ok, true);
    assert.equal(second.count, 2);
    const third = await create(u, "셋째");
    assert.deepEqual({ ok: third.ok, code: third.code, limit: third.limit }, { ok: false, code: "limit", limit: 2 });
    assert.equal((await client.query("select count(*)::int n from public.saved_searches where user_id = $1", [u])).rows[0].n, 2);
    await setLimit({ max: -1 });
    assert.equal((await create(u, "넷째")).code, "limit");
    await setLimit({ max: 2.5 });
    assert.equal((await client.query("select public.ws_saved_search_limit() as l")).rows[0].l, 0);
  }));

test("저장 검색 - 권한 만료 정각 경계: 끝 시각 직전은 저장, 정각부터 거부 (has_entitlement 판정과 같음)", () =>
  h.tx(async () => {
    await setLimit({ max: 5 });
    const u = await user();
    await grant(u, "workspace", "'2026-01-01T00:00:00Z'::timestamptz", "'2026-06-01T00:00:00Z'::timestamptz");
    // 함수는 now()로 판정하므로 경계는 has_entitlement 같은 시각 인자 규칙을 직접 대조한다
    const at = async (t) => (await client.query("select public.has_entitlement($1, 'workspace', $2::timestamptz) as r", [u, t])).rows[0].r;
    assert.equal(await at("2026-05-31T23:59:59Z"), true);
    assert.equal(await at("2026-06-01T00:00:00Z"), false);
    // 이미 끝난 권한 - 지금 시각 기준 저장은 거부
    assert.equal((await create(u, "만료 뒤")).code, "no_entitlement");
    // 다른 키(digital)만 가진 회원도 거부
    const d = await user();
    await grant(d, "digital");
    assert.equal((await create(d, "다른 키")).code, "no_entitlement");
  }));

test("권한이 끝나도 메모·스크랩·저장 검색은 지워지지 않고 본인이 읽는다 (구독 종료 후 보존)", () =>
  h.tx(async () => {
    await setLimit({ max: 3 });
    const u = await user();
    await grant(u);
    assert.equal((await create(u, "보존")).ok, true);
    await client.query("insert into public.notes (user_id, body) values ($1, '시험용 보존 메모')", [u]);
    await client.query("update public.entitlements set valid_until = now() - interval '1 second', valid_from = now() - interval '2 days' where user_id = $1", [u]);
    assert.equal((await client.query("select public.has_entitlement($1, 'workspace') as r", [u])).rows[0].r, false);
    assert.equal((await asUser(u, "select * from public.notes")).rowCount, 1);
    assert.equal((await asUser(u, "select * from public.saved_searches")).rowCount, 1);
  }));

test("함수는 service_role만 부른다 (anon·authenticated 거부)", () =>
  h.tx(async () => {
    const u = await user();
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await h.attempt("select public.ws_saved_search_create($1, 'x', '{}'::jsonb, false)", [u], role)).ok, false);
    }
    assert.equal((await h.attempt("select public.ws_saved_search_create($1, 'x', '{}'::jsonb, false)", [u], "service_role")).ok, true);
  }));

test("내보내기 이력은 추가만 - 고치기·지우기·비우기 거부, 개수 칸 경계", () =>
  h.tx(async () => {
    const u = await user();
    const ins = (n) => h.attempt("insert into public.workspace_exports (user_id, format, target, item_count, citation_count, excerpt_chars) values ($1, 'csv', 'notes', $2, 0, 0)", [u, n]);
    assert.equal((await ins(0)).ok, true);
    assert.equal((await ins(100000)).ok, true);
    assert.equal((await ins(100001)).ok, false);
    assert.equal((await ins(-1)).ok, false);
    assert.equal((await h.attempt("insert into public.workspace_exports (user_id, format, target, item_count, citation_count, excerpt_chars) values ($1, 'pdf', 'notes', 1, 0, 0)", [u])).ok, false);
    assert.equal((await h.attempt("update public.workspace_exports set item_count = 1")).ok, false);
    assert.equal((await h.attempt("delete from public.workspace_exports")).ok, false);
    assert.equal((await h.attempt("truncate public.workspace_exports")).ok, false);
  }));

test("계정이 지워지면 개인 자료도 함께 지워진다 (탈퇴 연쇄) - 만료와는 별개", () =>
  h.tx(async () => {
    const u = await user();
    await client.query("insert into public.notes (user_id, body) values ($1, '시험용')", [u]);
    await client.query("insert into public.workspace_prefs (user_id, mode) values ($1, 'expert')", [u]);
    await client.query("insert into public.workspace_exports (user_id, format, target, item_count, citation_count, excerpt_chars) values ($1, 'docx', 'scraps', 1, 1, 0)", [u]);
    await client.query("delete from auth.users where id = $1", [u]);
    assert.equal((await client.query("select count(*)::int n from public.notes where user_id = $1", [u])).rows[0].n, 0);
    assert.equal((await client.query("select count(*)::int n from public.workspace_exports where user_id = $1", [u])).rows[0].n, 0);
    const v = await user();
    assert.equal((await h.attempt("insert into public.workspace_prefs (user_id, mode) values ($1, 'admin')", [v])).ok, false);
  }));

test("내보내기 발췌의 근거 library_read - workspace 권한만 있으면 미리보기(full false), library 권한 + 판매 권리 확인일 때만 전문", () =>
  h.tx(async () => {
    const u = await user();
    await grant(u, "workspace");
    await client.query("update public.settings set value = value || '{\"library\": true}'::jsonb where key = 'feature_flags'");
    await client.query("set local session_replication_role = replica");
    const pub = (await client.query("insert into public.publications (slug, title, kind) values ($1, '시험용', 'book') returning id", [h.uniq("w13b").toLowerCase().replace(/[^a-z0-9-]/g, "-")])).rows[0].id;
    const ed = (await client.query("insert into public.editions (publication_id, edition_label, as_of) values ($1, '1판', '2026-01-01') returning id", [pub])).rows[0].id;
    const node = (await client.query("insert into public.pub_nodes (edition_id, depth, ordinal, title, status, approved_job_id, rights_public, rights_ref, rights_confirmed_on) values ($1, 1, 0, '시험용', 'approved', 1, 'confirmed', '시험용 계약', '2026-01-02') returning id", [ed])).rows[0].id;
    await client.query("insert into public.library_bodies (kind, ref_id, body) values ('node', $1, '시험용 본문 가나다라마')", [node]);
    await client.query("set local session_replication_role = origin");
    const read = async () => (await client.query("select public.library_read($1, 'node', $2) as r", [u, node])).rows[0].r;
    assert.equal((await read()).full, false, "workspace만 -> 전문 아님");
    await grant(u, "library");
    assert.equal((await read()).full, false, "library 권한 있어도 판매 권리 미확인 -> 전문 아님");
    await client.query("set local session_replication_role = replica");
    await client.query("update public.pub_nodes set rights_sale = 'confirmed' where id = $1", [node]);
    await client.query("set local session_replication_role = origin");
    assert.equal((await read()).full, true, "library 권한 + 판매 권리 확인 -> 전문");
  }));
