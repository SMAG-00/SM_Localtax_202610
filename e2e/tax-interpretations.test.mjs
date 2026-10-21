// 해석 해설 E2E (W3 5단계 — TX-09, docs/dev/W3_설계.md 1장 5단계 증거)
// standalone 빌드를 로컬 Supabase에 붙인다. 원문·해설은 전부 '시험용' 가짜 글자다.
//  a) 권한·입력 — 기자 403 · 잘못된 유형·주소 422 · 원문 글자를 붙이면 스냅샷+해시 저장
//  b) 발행 검사 — 원문 연결 0건 거부 · 필수 칸 빈 원문만 연결 거부 · 세무 감수 승인 없음 거부 · 모두 갖추면 발행
//  c) 공개 조건 — 심판은 비실명 확인 전 공개 읽기 0행, 확인 뒤 1행 · 필수 칸 빈 원문 공개 0
//  d) 원문 해시 변경 — 연결된 해설마다 검수 큐 1건(같은 해시 재저장은 추가 0) · 발행된 해설의 마지막 연결 해제 거부
//  e) 화면 — 기능 키 켜짐: 목록 필터(유형)·기사 상세 원문 블록 / 꺼짐: 원문 블록 0
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildWeb, localSupabase, startServer } from "./lib/local.mjs";
import { StaffFixture } from "./lib/staff.mjs";

const ADMIN_EMAIL = "tax-interp-e2e@example.test";
const SITE = "https://e2e.example.test";

let sb, server, staff, db, base;
const u = {};
const fx = { docs: {}, article: null, snaps: [] };
let flagsBefore;

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const show = (r) => JSON.stringify(r.body).slice(0, 600);
async function api(method, path, user, body) {
  const headers = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const post = (user, body) => api("POST", "/legal-docs", user, body);
const page = async (path) => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, html: await res.text() };
};
async function setInterpretations(on) {
  const r = await api("PATCH", "/settings/feature_flags", u.admin, { value: { ...flagsBefore, interpretations: on } });
  assert.equal(r.status, 200, show(r));
}
const anonRows = async (id) => {
  const res = await fetch(`${sb.url}/rest/v1/legal_docs?id=eq.${id}&select=id`, { headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}` } });
  return (await res.json()).length;
};
const fullDoc = (extra = {}) => ({
  op: "create",
  docType: "interpretation",
  issuer: "시험용 기관",
  docNo: `시험용-${staff.run}-${Math.random().toString(36).slice(2, 7)}`,
  decidedOn: "2026-01-15",
  taxKinds: ["시험세목"],
  provisions: ["시험 제1조"],
  sourceUrl: `https://example.test/e2e-${staff.run}`,
  rightsStatus: "confirmed",
  snapshotPayload: `시험용 가짜 원문 ${staff.run}`,
  ...extra,
});
const publish = (id) => db.query("update public.articles set status = 'published', first_published_at = now() where id = $1", [id]);

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
  u.editor = await staff.createUser({ label: "interp-editor", roles: ["editor"], person: { name: "해석 시험 편집자", roles: ["editor"] } });
  u.reporter = await staff.createUser({ label: "interp-reporter", roles: ["reporter"], person: { name: "해석 시험 기자", roles: ["reporter"] } });
  u.admin = await staff.createUser({ label: "interp-admin", email: ADMIN_EMAIL });
  flagsBefore = (await one("select value from public.settings where key = 'feature_flags'")).value;
  const { rows } = await db.query(
    `insert into public.articles (slug, title, summary, section, content_type, status, author_id, body)
     values ($1, $2, '시험용 가짜 해설', 'tax', 'explainer', 'draft', $3, $4) returning id, slug`,
    [`e2e-interp-art-${staff.run}`, `시험용 해석 해설 ${staff.run}`, u.editor.personId, JSON.stringify({ blocks: [{ type: "paragraph", text: "시험용 가짜 해설 본문입니다." }], claims: [] })],
  );
  staff.trackArticle(rows[0].id);
  fx.article = { id: Number(rows[0].id), slug: rows[0].slug };
});

after(async () => {
  try {
    await db.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify(flagsBefore)]);
    const ids = Object.values(fx.docs);
    await db.query("delete from public.legal_doc_review_queue where legal_doc_id = any($1::bigint[])", [ids]);
    await db.query("delete from public.interpretation_articles where article_id = $1", [fx.article.id]);
    await db.query("delete from public.article_legal_docs where legal_doc_id = any($1::bigint[])", [ids]);
    const { rows } = await db.query("select snapshot_id from public.legal_docs where id = any($1::bigint[])", [ids]);
    await db.query("delete from public.legal_docs where id = any($1::bigint[])", [ids]);
    await db.query("delete from public.raw_snapshots where id = any($1::bigint[])", [rows.map((r) => r.snapshot_id).filter(Boolean)]);
  } finally {
    await staff?.cleanup();
    server?.stop();
  }
});

test("a) 권한·입력 — 기자 403 · 잘못된 유형·주소 422 · 원문 글자를 붙이면 스냅샷과 해시 저장", async () => {
  assert.equal((await post(u.reporter, fullDoc())).status, 403);
  const bad = await post(u.editor, fullDoc({ docType: "memo" }));
  assert.equal(bad.status, 422, show(bad));
  assert.equal((await post(u.editor, fullDoc({ sourceUrl: "javascript:alert(1)" }))).status, 422);
  const ok = await post(u.editor, fullDoc());
  assert.equal(ok.status, 201, show(ok));
  fx.docs.main = Number(ok.body.legalDoc.id);
  const row = await one("select d.content_hash, s.content_hash as snap_hash, s.payload from public.legal_docs d join public.raw_snapshots s on s.id = d.snapshot_id where d.id = $1", [fx.docs.main]);
  assert.match(row.content_hash, /^[0-9a-f]{64}$/);
  assert.equal(row.content_hash, row.snap_hash);
  assert.equal(row.payload, `시험용 가짜 원문 ${staff.run}`);
});

test("b) 발행 검사 — 원문 연결 0건·필수 칸 빈 원문·세무 감수 없음은 거부, 모두 갖추면 발행", async () => {
  const id = fx.article.id;
  assert.equal((await post(u.editor, { op: "mark", articleId: id })).status, 201);
  await assert.rejects(publish(id), /원문.*1건 이상/, "원문 연결 0건");
  const empty = await post(u.editor, { op: "create", docType: "ruling", rightsStatus: "confirmed", sourceUrl: `https://example.test/e2e-empty-${staff.run}` });
  assert.equal(empty.status, 201, show(empty));
  fx.docs.empty = Number(empty.body.legalDoc.id);
  assert.equal((await post(u.editor, { op: "link", articleId: id, legalDocId: fx.docs.empty, role: "subject" })).status, 201);
  await assert.rejects(publish(id), /원문.*1건 이상/, "필수 칸이 빈 원문만 연결");
  assert.equal(await anonRows(fx.docs.empty), 0, "필수 칸 빈 원문 공개 0");
  assert.equal((await post(u.editor, { op: "link", articleId: id, legalDocId: fx.docs.main, role: "subject" })).status, 201);
  assert.equal((await post(u.editor, { op: "link", articleId: id, legalDocId: fx.docs.main, role: "subject" })).status, 409, "같은 연결 두 번");
  await assert.rejects(publish(id), /세무 감수/, "세무 감수 승인 없음");
  await db.query("insert into public.editorial_reviews (article_id, version, kind, reviewer_id, decision) values ($1, 1, 'tax_review', $2, 'approve')", [id, u.editor.personId]);
  assert.equal((await one("select tax_review_status from public.articles where id = $1", [id])).tax_review_status, "approved");
  await publish(id);
  assert.equal((await one("select status from public.articles where id = $1", [id])).status, "published");
  assert.equal(await anonRows(fx.docs.main), 1, "필수 칸 갖춘 확인 원문 공개 1");
});

test("c) 심판은 비실명 확인 전 공개 0행, 확인 뒤 1행", async () => {
  const t = await post(u.editor, fullDoc({ docType: "tribunal" }));
  assert.equal(t.status, 201, show(t));
  fx.docs.tribunal = Number(t.body.legalDoc.id);
  assert.equal(await anonRows(fx.docs.tribunal), 0);
  const up = await post(u.editor, { ...fullDoc({ docType: "tribunal", snapshotPayload: undefined, snapshotId: Number(t.body.legalDoc.snapshot_id) }), op: "update", id: fx.docs.tribunal, anonymityCheck: "confirmed" });
  assert.equal(up.status, 200, show(up));
  assert.equal(await anonRows(fx.docs.tribunal), 1);
});

test("d) 원문 해시 변경 — 연결된 해설마다 검수 큐 1건 · 같은 해시는 추가 0 · 마지막 연결 해제 거부", async () => {
  const before = (await one("select count(*)::int n from public.legal_doc_review_queue where legal_doc_id = $1", [fx.docs.main])).n;
  assert.equal(before, 0);
  const cur = await one("select doc_no, snapshot_id from public.legal_docs where id = $1", [fx.docs.main]);
  const changed = await post(u.editor, { ...fullDoc({ snapshotPayload: `시험용 바뀐 원문 ${staff.run}` }), op: "update", id: fx.docs.main, docNo: cur.doc_no });
  assert.equal(changed.status, 200, show(changed));
  const q = await db.query("select article_id from public.legal_doc_review_queue where legal_doc_id = $1 and resolved_at is null", [fx.docs.main]);
  assert.deepEqual(q.rows.map((r) => Number(r.article_id)), [fx.article.id]);
  assert.ok((await one("select hash_changed_at from public.legal_docs where id = $1", [fx.docs.main])).hash_changed_at);
  const again = await post(u.editor, { ...fullDoc({ snapshotPayload: undefined, snapshotId: Number(changed.body.legalDoc.snapshot_id) }), op: "update", id: fx.docs.main, docNo: cur.doc_no });
  assert.equal(again.status, 200, show(again));
  assert.equal((await one("select count(*)::int n from public.legal_doc_review_queue where legal_doc_id = $1", [fx.docs.main])).n, 1, "같은 해시 재저장은 큐 추가 0");
  const unlink = await post(u.editor, { op: "unlink", articleId: fx.article.id, legalDocId: fx.docs.main });
  assert.equal(unlink.status, 409, "발행된 해설의 마지막 공개 원문 연결");
  const queueId = Number((await one("select id from public.legal_doc_review_queue where legal_doc_id = $1", [fx.docs.main])).id);
  assert.equal((await post(u.editor, { op: "resolve", queueId })).status, 200);
  assert.equal((await post(u.editor, { op: "resolve", queueId })).status, 404, "이미 끝난 항목");
});

test("e) 화면 — 키 켜짐: 유형 필터·원문 블록 / 꺼짐: 원문 블록 0", async () => {
  await setInterpretations(true);
  const list = await page("/tax/interpretations?type=interpretation");
  assert.equal(list.status, 200);
  assert.ok(list.html.includes(`data-article="${fx.article.slug}"`), "유권해석 필터에 해설 노출");
  const other = await page("/tax/interpretations?type=tribunal");
  assert.ok(!other.html.includes(`data-article="${fx.article.slug}"`), "심판 필터에는 없음");
  const detail = await page(`/news/${fx.article.slug}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.html.includes('data-part="legal-docs"') && detail.html.includes(`data-legal-doc="${fx.docs.main}"`), "원문 블록");
  assert.ok(detail.html.includes("시험용 해석 해설"), "해설 블록(기사 본문)은 따로 그려짐");
  await setInterpretations(false);
  const off = await page(`/news/${fx.article.slug}`);
  assert.ok(!off.html.includes('data-part="legal-docs"'), "키 꺼짐이면 원문 블록 0");
});
