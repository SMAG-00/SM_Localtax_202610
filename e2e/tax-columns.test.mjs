// 칼럼 필자 체계 E2E (W3 6단계 — TX-14~17, docs/dev/W3_설계.md 1장 6단계 증거 · 12장 #8)
// standalone 빌드를 로컬 Supabase에 붙인다. 필자·계약·이해관계·고지 문구는 전부 '시험용' 가짜 글자다.
//  a) 권한·입력 — 기자 403 · 계약 범위 없음/AI 색인 없음/book 없는 도서 목록 422 · 이해관계 내용 없음·'없음' 확인자 없음 422
//  b) 발행 검사 — 필자 검증 없음 → 계약 없음 → 고지 문구 비어 있음 순으로 거부, 모두 갖추면 발행
//  c) 재검증 기한 — 만료되면 새 칼럼 발행 거부 + 경고 1건, 이미 공개된 칼럼은 유지
//  d) 발행 뒤 이해관계 변경 — 정정 이력 1건 · DB 제약(없음 확인 기록 없는 none_confirmed 거부)
//  e) 화면 — 기능 키 켜짐: 이해관계 줄 + 고지 1개 / 꺼짐: 0
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "tax-columns-e2e@example.test";
const SITE = "https://e2e.example.test";
const NOTICE_TEXT = "시험용 의견 고지 문구입니다";

let sb, server, staff, db, base;
const u = {};
const fx = { people: [], articles: [] };
let flagsBefore;
let noticeBefore;

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body).slice(0, 600);
async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const post = (user, body) => api("POST", "/columns", user, body);
const publish = (id) => db.query("update public.articles set status = 'published', first_published_at = now() where id = $1", [id]);
const setNotice = (text) => db.query("update public.settings set value = $1::jsonb where key = 'column_opinion_notice'", [JSON.stringify(text)]);
async function setFlag(on) {
  const r = await api("PATCH", "/settings/feature_flags", u.admin, { value: { ...flagsBefore, tax_columns: on } });
  assert.equal(r.status, 200, show(r));
}
async function newPerson(tag) {
  const { rows } = await db.query("insert into public.people (slug, name, roles, employment) values ($1, $2, array['writer'], 'external') returning id", [`e2e-col-${tag}-${staff.run}`, `시험용 필자 ${tag}`]);
  fx.people.push(Number(rows[0].id));
  return Number(rows[0].id);
}
async function newColumn(personId, tag) {
  const { rows } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, body)
     values ($1, $2, '시험용 가짜 칼럼', 'tax', 'opinion', 'draft', $3, $4) returning id, slug`,
    [`e2e-col-art-${tag}-${staff.run}`, `시험용 칼럼 ${tag} ${staff.run}`, personId, JSON.stringify({ blocks: [{ type: "paragraph", text: "시험용 가짜 칼럼 본문입니다." }], claims: [] })],
  );
  staff.trackArticle(rows[0].id);
  fx.articles.push(Number(rows[0].id));
  return { id: Number(rows[0].id), slug: rows[0].slug };
}
const contractBody = (personId, extra = {}) => ({ op: "contract", personId, docRef: "시험용 계약 위치", signedOn: "2026-01-10", reuseScope: ["print", "online"], aiIndexScope: "allow", ...extra });

before(async () => {
  sb = localSupabase();
  buildWeb();
  server = await startServer({
    NEXT_PUBLIC_SUPABASE_URL: sb.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceRoleKey,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_SITE_URL: SITE,
  });
  base = server.base;
  staff = new StaffFixture(sb);
  await staff.connect();
  db = staff.db;
  await staff.removeLeftover(ADMIN_EMAIL);
  await staff.snapshotOperations();
  u.editor = await staff.createUser({ label: "col-editor", roles: ["editor"], person: { name: "칼럼 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "col-reporter", roles: ["reporter"], person: { name: "칼럼 시험 기자", roles: ["reporter"] } });
  u.admin = await staff.createUser({ label: "col-admin", email: ADMIN_EMAIL });
  flagsBefore = (await one("select value from public.settings where key = 'feature_flags'")).value;
  noticeBefore = (await one("select value from public.settings where key = 'column_opinion_notice'")).value;
  fx.p1 = await newPerson("a");
  fx.p2 = await newPerson("b");
});

after(async () => {
  try {
    await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify(flagsBefore)]);
    await setNotice(noticeBefore);
    await db.query("delete from public.articles where id = any($1::bigint[])", [fx.articles]);
    await db.query("delete from public.column_contracts where person_id = any($1::bigint[])", [fx.people]);
    await db.query("delete from public.author_verifications where person_id = any($1::bigint[])", [fx.people]);
    await db.query("delete from public.people where id = any($1::bigint[])", [fx.people]);
  } finally {
    await staff?.cleanup();
    server?.stop();
  }
});

test("a) 권한·입력 — 기자 403 · 계약·이해관계 입력 검사 422", async () => {
  assert.equal((await post(u.reporter, contractBody(fx.p1))).status, 403);
  assert.equal((await api("GET", "/columns", u.reporter)).status, 403);
  const noScope = await post(u.editor, contractBody(fx.p1, { reuseScope: [] }));
  assert.equal(noScope.status, 422, show(noScope));
  assert.equal((await post(u.editor, contractBody(fx.p1, { aiIndexScope: undefined }))).status, 422, "AI 색인 범위 필수");
  const book = await post(u.editor, contractBody(fx.p1, { bookTitles: ["시험용 도서"] }));
  assert.equal(book.status, 422, show(book));
  assert.match(JSON.stringify(book.body), /book/);
  const art = await newColumn(fx.p1, "input");
  assert.equal((await post(u.editor, { op: "meta", articleId: art.id, personId: fx.p1, interestState: "declared" })).status, 422, "이해관계 내용 없음");
  assert.equal((await post(u.editor, { op: "meta", articleId: art.id, personId: fx.p1, interestState: "none_confirmed" })).status, 422, "'없음'은 확인자 필수");
  const dbBook = db.query("insert into public.column_contracts (person_id, doc_ref, signed_on, reuse_scope, ai_index_scope, book_titles) values ($1, 'x', '2026-01-01', array['print'], 'allow', array['시험용 도서'])", [fx.p1]);
  await assert.rejects(dbBook, /check/i, "DB도 book 없는 도서 목록 거부");
});

test("b) 발행 검사 — 필자 검증·계약·고지 문구 중 하나라도 빠지면 거부, 모두 갖추면 발행", async () => {
  const art = await newColumn(fx.p1, "pub");
  const meta = await post(u.editor, { op: "meta", articleId: art.id, personId: fx.p1, interestState: "declared", interestText: "시험용 이해관계 문구" });
  assert.equal(meta.status, 200, show(meta));
  await assert.rejects(publish(art.id), /필자 검증/);
  const ver = await post(u.editor, { op: "verify", personId: fx.p1, evidenceKind: "license", evidenceRef: "시험용 증빙 위치" });
  assert.equal(ver.status, 201, show(ver));
  const days = (Date.parse(ver.body.verification.expires_at) - Date.parse(ver.body.verification.verified_at)) / 86_400_000;
  assert.equal(Math.round(days), 365, "재검증 기한 기본 365일");
  await assert.rejects(publish(art.id), /계약/);
  const con = await post(u.editor, contractBody(fx.p1));
  assert.equal(con.status, 201, show(con));
  const wrong = await post(u.editor, { op: "meta", articleId: art.id, personId: fx.p2, contractId: con.body.contract.id, interestState: "declared", interestText: "시험용" });
  assert.equal(wrong.status, 422, "다른 필자의 계약은 연결 거부");
  assert.equal((await post(u.editor, { op: "meta", articleId: art.id, personId: fx.p1, contractId: con.body.contract.id, interestState: "declared", interestText: "시험용 이해관계 문구" })).status, 200);
  await setNotice("");
  await assert.rejects(publish(art.id), /의견 고지/, "고지 문구가 비면 거부(12장 #8)");
  await setNotice(NOTICE_TEXT);
  await publish(art.id);
  assert.equal((await one("select status from public.articles where id = $1", [art.id])).status, "published");
  fx.pub = art;
  fx.contractId = Number(con.body.contract.id);
});

test("c) 재검증 기한 — 만료되면 새 칼럼 발행 거부·경고 1건, 이미 공개된 칼럼은 유지", async () => {
  await db.query("update public.author_verifications set verified_at = now() - interval '2 days', expires_at = now() - interval '1 day' where person_id = $1", [fx.p1]);
  const second = await newColumn(fx.p1, "expired");
  assert.equal((await post(u.editor, { op: "meta", articleId: second.id, personId: fx.p1, contractId: fx.contractId, interestState: "none_confirmed", confirmedBy: "시험용 확인자" })).status, 200);
  await assert.rejects(publish(second.id), /재검증 기한/);
  assert.equal((await one("select status from public.articles where id = $1", [fx.pub.id])).status, "published", "공개분 유지");
  const list = await api("GET", "/columns", u.editor);
  assert.equal(list.status, 200, show(list));
  assert.deepEqual(list.body.warnings.filter((w) => w.personId === fx.p1).length, 1, "경고 1건");
  assert.equal(list.body.noticeSet, true);
  await post(u.editor, { op: "verify", personId: fx.p1, evidenceKind: "registration", evidenceRef: "시험용 재검증 위치" });
  await publish(second.id);
  assert.equal((await one("select status from public.articles where id = $1", [second.id])).status, "published", "재검증 뒤 발행");
  fx.second = second;
});

test("d) 발행 뒤 이해관계 변경은 정정 이력 1건 · none_confirmed는 확인 기록 필수", async () => {
  assert.equal((await one("select count(*)::int as n from public.column_meta_history where article_id = $1", [fx.pub.id])).n, 0);
  const changed = await post(u.editor, { op: "meta", articleId: fx.pub.id, personId: fx.p1, contractId: fx.contractId, interestState: "declared", interestText: "시험용 바뀐 이해관계" });
  assert.equal(changed.status, 200, show(changed));
  const h = await db.query("select before_text, after_text from public.column_meta_history where article_id = $1", [fx.pub.id]);
  assert.equal(h.rows.length, 1);
  assert.deepEqual(h.rows[0], { before_text: "시험용 이해관계 문구", after_text: "시험용 바뀐 이해관계" });
  const noConfirm = db.query("update public.column_meta set interest_state = 'none_confirmed', interest_confirmed_by = null where article_id = $1", [fx.pub.id]);
  await assert.rejects(noConfirm, /check/i);
});

test("e) 화면 — 기능 키 켜짐: 이해관계 줄·고지 1개 / 꺼짐: 없음", async () => {
  await setFlag(true);
  const on = await (await fetch(`${base}/news/${fx.pub.slug}`)).text();
  assert.match(on, /이해관계: 시험용 바뀐 이해관계/);
  assert.equal(on.split('data-part="column-opinion-notice"').length - 1, 1, "고지 1개");
  assert.ok(on.includes(NOTICE_TEXT));
  const none = await (await fetch(`${base}/news/${fx.second.slug}`)).text();
  assert.match(none, /이해관계: 필자가 밝힌 이해관계 없음/);
  await setFlag(false);
  const off = await (await fetch(`${base}/news/${fx.pub.slug}`)).text();
  assert.ok(!off.includes('data-part="column-disclosure"'), "꺼짐이면 고지 블록 0");
});
