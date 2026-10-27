// W13-a a6 DB - 프리미엄 칼럼 틀 (마이그레이션 194, PRD-05 LIB-07)
//  · 기사 제약 - 프리미엄은 opinion·본문 []·요약 없음·뉴스 전송 후보 아님·유료 표시
//  · 발행 가드 - 계약 없음/종료 거부, 종료일 당일 허용·다음 날 거부, 본문(판매 권리) 없으면 거부, 직접 SQL도 같은 가드
//  · column_read - 비구독자 미리보기, 구독자 전문, 기능 키 library_premium 꺼짐이면 not_found
//  · paid_bodies kind column, 공개 미리보기 뷰에서 칼럼 제외, 공개 칼럼 뷰에 본문 칸 없음
// 칼럼 글은 모두 시험용 가짜다. 모든 시험은 거래 안에서 돌고 되돌린다.
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

const BODY = "가나다라마바사아자차카타파하".repeat(10);
const flag = (key, on) => client.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify({ [key]: on })]);
const authUser = async () => (await client.query("insert into auth.users (id, aud, role, email) values (gen_random_uuid(), 'authenticated', 'authenticated', $1) returning id", [`${h.uniq("u")}@example.test`])).rows[0].id;

async function person(status = "active", until = "2026-12-31") {
  const id = (await client.query("insert into public.people (slug, name, roles, visibility, contract_status, contract_until) values ($1, '시험 필자', array['writer'], 'public', $2, $3) returning id", [h.uniq("w").toLowerCase().replace(/[^a-z0-9-]/g, "-"), status, status === "none" ? null : until])).rows[0].id;
  // 칼럼 발행 가드(W3 BR-07) - 이름·초상 동의서(범위 column)가 있어야 발행된다
  await client.query("insert into public.name_likeness_consents (person_id, version, scope, doc_ref, recorded_by) values ($1, '시험용', array['column'], '시험용 위치', 'admin:test')", [id]);
  return id;
}
async function column(authorId, over = {}) {
  const a = (
    await client.query(
      "insert into public.articles (slug, title, section, content_type, status, author_id, body, access_tier, is_paid) values ($1, '시험용 칼럼', 'tax', 'opinion', 'draft', $2, '[]'::jsonb, 'premium', true) returning id",
      [h.uniq("col"), authorId],
    )
  ).rows[0].id;
  if (over.body !== false) {
    await client.query(
      "insert into public.paid_bodies (kind, ref_key, article_id, preview, body, sale_allowed, rights_ref, sale_confirmed_on, edited_by) values ('column', $1::bigint::text, $1::bigint, '시험용 요약', $2, $3, '시험용 계약', '2026-01-02', 'test')",
      [String(a), BODY, over.sale ?? true],
    );
  }
  return a;
}
const publish = (id) => h.attempt("update public.articles set status = 'published', first_published_at = now() where id = $1", [id]);
const check = async (id, today) => (await h.one("select public.column_publish_check($1, $2::date) r", [id, today])).r;

test("프리미엄 기사 제약 - opinion·본문 []·요약 없음·뉴스 전송 후보 아님이 아니면 거부", () => h.tx(async () => {
  const p = await person();
  const base = "insert into public.articles (slug, title, section, content_type, author_id, body, summary, nav_candidate, access_tier, is_paid) values ($1, 't', 'tax', $2, $3, $4::jsonb, $5, $6, 'premium', $7)";
  const ok = (over = []) => {
    const a = ["col-" + h.uniq("x"), "opinion", p, "[]", null, false, true];
    over.forEach(([i, v]) => (a[i] = v));
    return h.attempt(base, a);
  };
  assert.equal((await ok()).ok, true);
  assert.equal((await ok([[1, "explainer"]])).ok, false);
  assert.equal((await ok([[3, '[{"type":"paragraph"}]']])).ok, false);
  assert.equal((await ok([[4, "요약"]])).ok, false);
  assert.equal((await ok([[5, true]])).ok, false);
  assert.equal((await ok([[6, false]])).ok, false);
}));

test("발행 판정 - 계약 없음·종료·본문 없음은 거부, 종료일 당일은 허용 다음 날은 거부", () => h.tx(async () => {
  const none = await column(await person("none"));
  assert.equal((await check(none, "2026-06-01")).code, "contract_none");
  const a = await column(await person("active", "2026-06-30"));
  assert.equal((await check(a, "2026-06-30")).ok, true);
  assert.equal((await check(a, "2026-07-01")).code, "contract_ended");
  const noBody = await column(await person(), { body: false });
  assert.equal((await check(noBody, "2026-06-01")).code, "no_body");
  const noSale = await column(await person(), { sale: false });
  assert.equal((await check(noSale, "2026-06-01")).code, "no_body");
}));

test("직접 SQL로 발행해도 가드가 막는다 - 계약이 유효하면 발행, 발행 뒤 등급 변경은 거부", () => h.tx(async () => {
  const pOk = await person("active", "2099-12-31");
  const good = await column(pOk);
  assert.equal((await publish(good)).ok, true);
  assert.equal((await h.attempt("update public.articles set access_tier = 'public' where id = $1", [good])).ok, false);
  const pEnded = await person("ended", "2020-01-01");
  const bad = await column(pEnded);
  assert.equal((await publish(bad)).ok, false);
  const direct = await h.attempt(
    "insert into public.articles (slug, title, section, content_type, status, author_id, body, access_tier, is_paid, first_published_at) values ($1, 't', 'tax', 'opinion', 'published', $2, '[]'::jsonb, 'premium', true, now())",
    [h.uniq("d"), pOk],
  );
  assert.equal(direct.ok, false);
}));

test("column_read - 비구독자 미리보기·구독자 전문·기능 키 꺼짐 not_found", () => h.tx(async () => {
  await flag("library_premium", true);
  await client.query("update public.settings set value = '{\"chars\": 12}'::jsonb where key = 'library_preview'");
  const a = await column(await person("active", "2099-12-31"));
  assert.equal((await publish(a)).ok, true);
  const sub = await authUser();
  await client.query("insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until) values ($1, 'library', 'manual', $2, '2026-01-01', '2099-01-01')", [sub, h.uniq("r")]);
  const anon = await authUser();
  const locked = (await h.one("select public.column_read($1, $2) r", [anon, a])).r;
  assert.equal(locked.full, false);
  assert.equal(locked.text, BODY.slice(0, 12));
  const full = (await h.one("select public.column_read($1, $2) r", [sub, a])).r;
  assert.equal(full.text, BODY);
  assert.equal((await h.one("select public.column_read(null, $1) r", [a])).r.reason, "login");
  await flag("library_premium", false);
  assert.deepEqual((await h.one("select public.column_read($1, $2) r", [sub, a])).r, { ok: false, code: "not_found" });
}));

test("공개 경로 - 칼럼은 public_paid_previews·public_articles에 없고 공개 칼럼 뷰에는 본문 칸이 없다", () => h.tx(async () => {
  await flag("library_premium", true);
  await flag("paywall", true);
  const a = await column(await person("active", "2099-12-31"));
  assert.equal((await publish(a)).ok, true);
  assert.equal((await h.one("select count(*)::int c from public.public_paid_previews where article_id = $1", [a])).c, 0);
  assert.equal((await h.one("select count(*)::int c from public.public_articles where id = $1", [a])).c, 0);
  assert.equal((await h.one("select count(*)::int c from public.public_library_columns where id = $1", [a])).c, 1);
  const cols = (await client.query("select column_name from information_schema.columns where table_name = 'public_library_columns'")).rows.map((r) => r.column_name);
  assert.equal(cols.some((c) => ["body", "summary", "preview"].includes(c)), false);
  await flag("library_premium", false);
  assert.equal((await h.one("select count(*)::int c from public.public_library_columns where id = $1", [a])).c, 0);
}));

test("시리즈 - 프리미엄이 아닌 기사에는 붙일 수 없고 같은 회차 번호는 하나", () => h.tx(async () => {
  const s = (await client.query("insert into public.column_series (slug, title) values ($1, '시험 시리즈') returning id", [h.uniq("s").toLowerCase().replace(/[^a-z0-9-]/g, "-")])).rows[0].id;
  const a = await column(await person());
  assert.equal((await h.attempt("update public.articles set series_id = $2, series_no = 1 where id = $1", [a, s])).ok, true);
  const b = await column(await person());
  assert.equal((await h.attempt("update public.articles set series_id = $2, series_no = 1 where id = $1", [b, s])).ok, false);
  assert.equal((await h.attempt("update public.articles set series_id = $2 where id = $1", [b, s])).ok, false);
  const pub = (await client.query("insert into public.articles (slug, title, section, content_type, status, first_published_at, body) values ($1, 't', 'tax', 'explainer', 'published', now(), '[]'::jsonb) returning id", [h.uniq("pub")])).rows[0].id;
  assert.equal((await h.attempt("update public.articles set series_id = $2, series_no = 2 where id = $1", [pub, s])).ok, false);
}));
