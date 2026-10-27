// W13-a a3 DB - 공개 뷰 · 서버 절단 함수 library_read · 열람 속도 제한 (마이그레이션 193, PRD-05 LIB-04·05·06)
//  · 공개 뷰 - 기능 키 꺼짐이면 0행, 승인 ∧ 공개 권리 확인만, 본문 칸 없음
//  · library_read - 비구독자·비로그인·만료 직후·판매 권리 없음은 미리보기만, 구독자 전문, 설정 비면 0자, 짧은 원고는 전체가 나가지 않음
//  · library_rate_hit - 한도 n번째 허용, n+1번째 차단 + 차단 기록, 설정 비면 닫힘
// 원고·출판물은 모두 시험용 가짜다. 모든 시험은 거래 안에서 돌고 되돌린다.
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
const BODY = "가나다라마바사아자차카타파하".repeat(10); // 140자 시험용 문자열
const flag = (on) => client.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify({ library: on })]);
const setting = (key, value) => client.query("update public.settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);
const authUser = async () => (await client.query("insert into auth.users (id, aud, role, email) values (gen_random_uuid(), 'authenticated', 'authenticated', $1) returning id", [`${h.uniq("u")}@example.test`])).rows[0].id;
const entitle = (u, from, until) =>
  client.query("insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until) values ($1, 'library', 'manual', $2, $3, $4)", [u, h.uniq("ref"), from, until]);

/** 승인된 노드 하나 (실제 경로: 권리 확인 -> 작업 -> 승인) */
async function approvedNode({ tier = "premium", sale = true, body = BODY } = {}) {
  const p = (await client.query("insert into public.publications (slug, title, kind) values ($1, '시험용', 'book') returning id", [h.uniq("pub").toLowerCase().replace(/[^a-z0-9-]/g, "-")])).rows[0].id;
  const ed = (await client.query("insert into public.editions (publication_id, edition_label, as_of) values ($1, '시험 1판', '2026-01-01') returning id", [p])).rows[0].id;
  const n = (await client.query("insert into public.pub_nodes (edition_id, depth, ordinal, title, access_tier) values ($1, 1, 0, '시험용 장', $2) returning id", [ed, tier])).rows[0].id;
  await client.query("insert into public.library_bodies (kind, ref_id, body) values ('node', $1, $2)", [n, body]);
  await client.query(
    `update public.pub_nodes set rights_public = 'confirmed', rights_sale = $2, rights_ref = '시험용 계약', rights_confirmed_on = '2026-01-02' where id = $1`,
    [n, sale ? "confirmed" : "unchecked"],
  );
  const job = (await h.one("select public.digitize_create('node', $1, '시험용.txt', $2) r", [n, ACTOR])).r.jobId;
  for (const to of ["extracted", "structured", "proofread"]) await client.query("select public.digitize_advance($1, $2, $3)", [job, to, ACTOR]);
  assert.equal((await h.one("select public.digitize_approve($1, 100, 0, $2) r", [job, ACTOR])).r.ok, true);
  return n;
}
const read = async (user, id, at = null) => (await h.one("select public.library_read($1, 'node', $2, coalesce($3::timestamptz, now())) r", [user, id, at])).r;

test("공개 뷰 - 기능 키가 꺼지면 0행, 켜져도 승인·권리 확인된 것만, 본문 칸은 없다", () => h.tx(async () => {
  const n = await approvedNode();
  await flag(false);
  assert.equal((await h.one("select count(*)::int c from public.public_library_nodes where id = $1", [n])).c, 0);
  await flag(true);
  assert.equal((await h.one("select count(*)::int c from public.public_library_nodes where id = $1", [n])).c, 1);
  const cols = (await client.query("select column_name from information_schema.columns where table_name = 'public_library_nodes'")).rows.map((r) => r.column_name);
  assert.equal(cols.includes("body"), false);
  const draft = (await client.query("insert into public.pub_nodes (edition_id, depth, ordinal, title) select edition_id, 1, 9, '초안' from public.pub_nodes where id = $1 returning id", [n])).rows[0].id;
  assert.equal((await h.one("select count(*)::int c from public.public_library_nodes where id = $1", [draft])).c, 0);
}));

test("권리가 확인에서 바뀌면 다음 요청부터 공개 뷰와 library_read에서 빠진다", () => h.tx(async () => {
  await flag(true);
  const n = await approvedNode({ tier: "public" });
  assert.equal((await read(null, n)).ok, true);
  await client.query("update public.pub_nodes set rights_public = 'restricted' where id = $1", [n]);
  assert.equal((await h.one("select count(*)::int c from public.public_library_nodes where id = $1", [n])).c, 0);
  assert.deepEqual(await read(null, n), { ok: false, code: "not_found" });
}));

test("비구독자는 설정 길이 미리보기만 받고 구독자는 전문을 받는다 (경계 -1/설정/+1)", () => h.tx(async () => {
  await flag(true);
  const n = await approvedNode();
  const sub = await authUser();
  await entitle(sub, "2026-01-01T00:00:00Z", "2099-01-01T00:00:00Z");
  const anon = await authUser();
  for (const chars of [19, 20, 21]) {
    await setting("library_preview", { chars });
    const r = await read(anon, n);
    assert.equal(r.full, false);
    assert.equal(r.text, BODY.slice(0, chars));
    assert.equal(r.reason, "subscribe");
  }
  const full = await read(sub, n);
  assert.equal(full.full, true);
  assert.equal(full.text, BODY);
  assert.equal((await read(null, n)).reason, "login");
}));

test("설정이 비면 미리보기 0자, 본문 길이 이상이면 전체가 나가지 않는다, 비율 상한이 더 작으면 그 값", () => h.tx(async () => {
  await flag(true);
  const n = await approvedNode();
  const u = await authUser();
  await setting("library_preview", {});
  assert.equal((await read(u, n)).text, "");
  await setting("library_preview", { chars: BODY.length });
  assert.equal((await read(u, n)).text, "");
  await setting("library_preview", { chars: BODY.length + 50 });
  assert.equal((await read(u, n)).text, "");
  await setting("library_preview", { chars: 100, max_ratio_percent: 10 });
  assert.equal((await read(u, n)).text, BODY.slice(0, 14));
}));

test("만료 직후·판매 권리 없음은 구독자여도 미리보기만 (끝 시각 직전은 전문)", () => h.tx(async () => {
  await flag(true);
  await setting("library_preview", { chars: 10 });
  const n = await approvedNode();
  const noSale = await approvedNode({ sale: false });
  const u = await authUser();
  await entitle(u, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z");
  assert.equal((await read(u, n, "2026-01-31T23:59:59Z")).full, true);
  const after = await read(u, n, "2026-02-01T00:00:00Z");
  assert.equal(after.full, false);
  assert.equal(after.text, BODY.slice(0, 10));
  const sale = await read(u, noSale, "2026-01-15T00:00:00Z");
  assert.equal(sale.full, false);
  assert.equal(sale.reason, "sale_rights");
}));

test("공개 등급 본문은 비로그인에게도 전문, 기능 키가 꺼지면 not_found", () => h.tx(async () => {
  await flag(true);
  const n = await approvedNode({ tier: "public" });
  const r = await read(null, n);
  assert.equal(r.full, true);
  assert.equal(r.text, BODY);
  await flag(false);
  assert.deepEqual(await read(null, n), { ok: false, code: "not_found" });
}));

test("anon·authenticated는 library_read·library_rate_hit을 실행할 수 없다", () => h.tx(async () => {
  const r = await client.query(
    "select has_function_privilege('anon', 'public.library_read(uuid,text,bigint,timestamptz)', 'execute') a, has_function_privilege('authenticated', 'public.library_read(uuid,text,bigint,timestamptz)', 'execute') b, has_function_privilege('anon', 'public.library_rate_hit(text,timestamptz)', 'execute') c",
  );
  assert.deepEqual(r.rows[0], { a: false, b: false, c: false });
}));

test("열람 속도 제한 - n번째 허용, n+1번째 차단과 차단 기록, 창이 지나면 다시 허용, 설정이 비면 닫힘", () => h.tx(async () => {
  const key = h.uniq("rate");
  await setting("library_rate_limit", {});
  assert.equal((await h.one("select public.library_rate_hit($1, now()) r", [key])).r.code, "rate_unset");
  await setting("library_rate_limit", { max: 3, window_seconds: 60 });
  const t0 = "2026-03-01T00:00:00Z";
  for (let i = 1; i <= 3; i++) {
    const r = (await h.one("select public.library_rate_hit($1, $2::timestamptz + make_interval(secs => $3)) r", [key, t0, i])).r;
    assert.equal(r.ok, true);
    assert.equal(r.count, i);
  }
  const blocked = (await h.one("select public.library_rate_hit($1, $2::timestamptz + interval '4 seconds') r", [key, t0])).r;
  assert.deepEqual(blocked, { ok: false, code: "limited", count: 3 });
  assert.equal((await h.one("select count(*)::int c from public.library_abuse_log where key = $1 and kind = 'rate'", [key])).c, 1);
  const later = (await h.one("select public.library_rate_hit($1, $2::timestamptz + interval '70 seconds') r", [key, t0])).r;
  assert.equal(later.ok, true);
  const other = (await h.one("select public.library_rate_hit($1, $2::timestamptz + interval '4 seconds') r", [h.uniq("other"), t0])).r;
  assert.equal(other.ok, true);
}));
