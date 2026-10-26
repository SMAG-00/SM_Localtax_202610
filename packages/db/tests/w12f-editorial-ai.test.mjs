// W12-f DB 시험 - 결정례 요지·AI 태그 후보(마이그레이션 172) · 기사 요약 상자·개정 영향 배너·정합성 감시(마이그레이션 173)
//  (PRD-04 AIOPS-07~10 · CASE-05 · ART-13·14, docs/dev/W12-f_설계.md)
//  · AI 태그 후보는 전용 함수로만 origin ai · proposed, 직접 INSERT 거부, editor 행은 건수·출처 불변, 승인은 기존 승인 함수
//  · 요지 - 사건번호·일자 칸 없음, 승인은 검수 항목 승인 뒤에만, 승인 전 공개 뷰 0, 원문이 바뀌면 공개 뷰에서 빠지고 승인도 거부, 내용 불변·삭제 거부
//  · 요약 상자 - 승인 전 공개 0, 기사 버전이 바뀌면 빠짐
//  · 정합성 - 개정으로 글이 달라진 조문을 인용하는 공개 기사만 찾고, 경보 1건·배너 제안(재실행 중복 0), 확인 전 배너 공개 0
// 모든 시험은 거래 안에서 돌고 되돌린다. 법령·결정례·기사는 전부 시험용 가짜 글이다.
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

const ADMIN = "admin:test@example.test";
const ALL_CHECKS = {
  case_summary: ["original_compared", "numbers_dates_links", "no_personal_info", "case_facts_from_source"],
  article_ai_box: ["original_compared", "numbers_dates_links", "no_personal_info", "box_matches_article"],
};
const setFlags = (patch) => client.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify(patch)]);
const key = () => `tag_${h.uniq("k").replace(/[^a-z0-9]/gi, "_").toLowerCase()}`.slice(0, 39);

async function approvedTag(taxItems = []) {
  const k = key();
  const row = (await client.query("insert into public.issue_tags (tag_key, label, hub, tax_items, proposed_by) values ($1, '시험용 태그', 'trust', $2, 'test') returning id", [k, taxItems])).rows[0];
  const r = (await h.one("select public.issue_tag_approve($1, $2) r", [row.id, ADMIN])).r;
  assert.equal(r.ok, true);
  return { id: row.id, key: k };
}
const rpc = async (sql, params) => (await h.one(sql, params)).r;
async function draft(caseId, hash, lines = ["첫째 줄입니다.", "둘째 줄입니다.", "셋째 줄입니다."], payload = {}) {
  return rpc("select public.case_summary_draft_add($1, $2, $3, 'dismissed', 40, 'fake-model', 'job:case-summary-draft', $4::jsonb) r", [caseId, hash, lines, JSON.stringify(payload)]);
}
const approveItem = async (itemId, kind) => {
  await client.query("select public.review_item_transition($1, 'in_review', $2)", [itemId, ADMIN]);
  await client.query("select public.review_item_transition($1, 'approved', $2, null, $3)", [itemId, ADMIN, ALL_CHECKS[kind]]);
};

// ── 172 AI 태그 후보 ──────────────────────────────────────────

test("tax_items - 태그 사전에 세목 칸이 생기고 만든 뒤 고칠 수 없다", () =>
  h.tx(async () => {
    const t = await approvedTag(["취득세"]);
    const row = await h.one("select tax_items from public.issue_tags where id = $1", [t.id]);
    assert.deepEqual(row.tax_items, ["취득세"]);
    const upd = await h.attempt("update public.issue_tags set tax_items = '{재산세}' where id = $1", [t.id]);
    assert.equal(upd.ok, false);
  }));

test("AI 태그 후보 - 직접 INSERT는 거부, 전용 함수는 origin ai · proposed로만 넣고 같은 (결정례, 태그)는 한 번", () =>
  h.tx(async () => {
    const doc = await h.doc();
    const t = await approvedTag();
    const direct = await h.attempt("insert into public.case_issue_tags (case_id, issue_tag_id, origin, applied_by) values ($1, $2, 'ai', 'job:x')", [doc, t.id]);
    assert.equal(direct.ok, false);
    const first = await rpc("select public.case_issue_tag_ai_propose($1, $2, 'job:case-summary-draft') r", [doc, t.key]);
    assert.deepEqual([first.ok, first.code], [true, "created"]);
    const row = await h.one("select origin, status, approved_by from public.case_issue_tags where id = $1", [first.id]);
    assert.deepEqual([row.origin, row.status, row.approved_by], ["ai", "proposed", null]);
    const again = await rpc("select public.case_issue_tag_ai_propose($1, $2, 'job:case-summary-draft') r", [doc, t.key]);
    assert.deepEqual([again.ok, again.code], [false, "exists"]);
    assert.equal((await h.one("select count(*)::int n from public.case_issue_tags where case_id = $1", [doc])).n, 1);
  }));

test("AI 태그 후보 - 승인 전 공개 뷰 0, 편집자 승인 뒤 1행, origin은 바뀌지 않는다", () =>
  h.tx(async () => {
    await setFlags({ case_db: true });
    const doc = await h.doc();
    const t = await approvedTag();
    const p = await rpc("select public.case_issue_tag_ai_propose($1, $2, 'job:x') r", [doc, t.key]);
    assert.equal((await h.one("select count(*)::int n from public.public_case_issue_tags where case_id = $1", [doc])).n, 0);
    const ok = await rpc("select public.case_issue_tag_approve($1, $2) r", [p.id, ADMIN]);
    assert.equal(ok.ok, true);
    assert.equal((await h.one("select count(*)::int n from public.public_case_issue_tags where case_id = $1", [doc])).n, 1);
    assert.equal((await h.one("select origin from public.case_issue_tags where id = $1", [p.id])).origin, "ai");
    const flip = await h.attempt("update public.case_issue_tags set origin = 'editor' where id = $1", [p.id]);
    assert.equal(flip.ok, false);
  }));

test("origin=editor 행은 AI 함수가 건드리지 않는다 - 같은 태그를 AI가 제안해도 건수·출처·상태 그대로, 삭제 거부", () =>
  h.tx(async () => {
    const doc = await h.doc();
    const a = await approvedTag();
    const b = await approvedTag();
    const ed = (await client.query("insert into public.case_issue_tags (case_id, issue_tag_id, applied_by) values ($1, $2, 'user:editor') returning id", [doc, a.id])).rows[0];
    const before = (await client.query("select id, origin, status, applied_by from public.case_issue_tags where origin = 'editor' and case_id = $1 order by id", [doc])).rows;
    const same = await rpc("select public.case_issue_tag_ai_propose($1, $2, 'job:x') r", [doc, a.key]);
    assert.equal(same.code, "exists");
    const other = await rpc("select public.case_issue_tag_ai_propose($1, $2, 'job:x') r", [doc, b.key]);
    assert.equal(other.ok, true);
    const after = (await client.query("select id, origin, status, applied_by from public.case_issue_tags where origin = 'editor' and case_id = $1 order by id", [doc])).rows;
    assert.deepEqual(after, before);
    assert.equal((await h.attempt("delete from public.case_issue_tags where id = $1", [ed.id])).ok, false);
  }));

test("AI 태그 후보 - 승인되지 않은 태그·없는 결정례는 거부", () =>
  h.tx(async () => {
    const doc = await h.doc();
    const k = key();
    await client.query("insert into public.issue_tags (tag_key, label, hub, proposed_by) values ($1, '제안만', 'trust', 'test')", [k]);
    assert.equal((await rpc("select public.case_issue_tag_ai_propose($1, $2, 'job:x') r", [doc, k])).code, "tag_not_approved");
    assert.equal((await rpc("select public.case_issue_tag_ai_propose(999999999, $1, 'job:x') r", [k])).code, "case_not_found");
  }));

// ── 172 결정례 요지 ───────────────────────────────────────────

test("요지 표에는 사건번호·일자 칸이 없다", () =>
  h.tx(async () => {
    const cols = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'case_summaries'")).rows.map((r) => r.column_name);
    for (const banned of ["doc_no", "decided_on", "issuer", "case_no"]) assert.ok(!cols.includes(banned), `${banned} 칸이 있으면 안 됩니다`);
    const view = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'public_case_summaries'")).rows.map((r) => r.column_name);
    assert.deepEqual(view.sort(), ["approved_on", "case_id", "result_type", "summary_lines"]);
  }));

test("요지 후보 선별 - 요지가 없는 결정례만, 원문 해시가 없는 문서는 제외", () =>
  h.tx(async () => {
    const good = await h.doc({}, "시험용 원문 A");
    const noHash = await h.doc({ content_hash: null }, "시험용 원문 B");
    const cands = (await client.query("select case_id from public.case_summary_candidates(100)")).rows.map((r) => Number(r.case_id));
    assert.ok(cands.includes(Number(good)));
    assert.ok(!cands.includes(Number(noHash)));
    const hash = (await h.one("select content_hash from public.legal_docs where id = $1", [good])).content_hash;
    assert.equal((await draft(good, hash)).code, "created");
    const after = (await client.query("select case_id from public.case_summary_candidates(100)")).rows.map((r) => Number(r.case_id));
    assert.ok(!after.includes(Number(good)), "요지가 생긴 결정례는 후보에서 빠진다");
  }));

test("요지 초안 - 검수 항목(case_summary)이 함께 생기고 재실행은 중복 0, 줄 수·글자 수 위반 거부", () =>
  h.tx(async () => {
    const doc = await h.doc();
    const hash = (await h.one("select content_hash from public.legal_docs where id = $1", [doc])).content_hash;
    const first = await draft(doc, hash, undefined, { warnings: ["숫자가 원문에 없습니다: 9"] });
    assert.deepEqual([first.ok, first.code], [true, "created"]);
    const item = await h.one("select kind, status, required_checks, payload from public.review_items where id = $1", [first.reviewItemId]);
    assert.equal(item.kind, "case_summary");
    assert.equal(item.status, "drafted");
    assert.ok(item.required_checks.includes("case_facts_from_source"));
    assert.equal(Number(item.payload.caseId), Number(doc));
    const again = await draft(doc, hash);
    assert.equal(again.code, "exists");
    assert.equal((await h.one("select count(*)::int n from public.case_summaries where case_id = $1", [doc])).n, 1);
    const doc2 = await h.doc();
    const hash2 = (await h.one("select content_hash from public.legal_docs where id = $1", [doc2])).content_hash;
    assert.equal((await h.attempt("select public.case_summary_draft_add($1, $2, '{a,b}', 'dismissed', 1, 'm', 'job:x', '{}')", [doc2, hash2])).ok, false);
    assert.equal((await h.attempt("select public.case_summary_draft_add($1, $2, $3, 'dismissed', 1, 'm', 'job:x', '{}')", [doc2, hash2, ["가".repeat(141), "b", "c"]])).ok, false);
    assert.equal((await draft(doc2, "다른 해시")).code, "source_changed");
  }));

test("요지 승인 - 검수 항목 승인 전에는 거부(+감사), 승인 후에는 가능, 승인 전 공개 뷰 0 -> 승인 뒤 1행", () =>
  h.tx(async () => {
    await setFlags({ case_db: true, case_summaries: true });
    const doc = await h.doc();
    const hash = (await h.one("select content_hash from public.legal_docs where id = $1", [doc])).content_hash;
    const d = await draft(doc, hash);
    const view = () => h.one("select count(*)::int n from public.public_case_summaries where case_id = $1", [doc]);
    assert.equal((await view()).n, 0, "승인 전 공개 0");
    const early = await rpc("select public.case_summary_approve($1, $2) r", [d.id, ADMIN]);
    assert.deepEqual([early.ok, early.code], [false, "review_not_approved"]);
    const audit = await h.one("select outcome, code from public.issue_audit where subject = 'case_summary' and target_id = $1 order by id desc limit 1", [d.id]);
    assert.deepEqual([audit.outcome, audit.code], ["refused", "review_not_approved"]);
    assert.equal((await view()).n, 0);
    const noActor = await rpc("select public.case_summary_approve($1, 'someone') r", [d.id]);
    assert.equal(noActor.code, "actor_invalid");
    await approveItem(d.reviewItemId, "case_summary");
    const ok = await rpc("select public.case_summary_approve($1, $2) r", [d.id, ADMIN]);
    assert.equal(ok.ok, true);
    assert.equal((await view()).n, 1);
    const pub = await h.one("select summary_lines, result_type from public.public_case_summaries where case_id = $1", [doc]);
    assert.equal(pub.summary_lines.length, 3);
    assert.equal(pub.result_type, "dismissed");
    await setFlags({ case_summaries: false });
    assert.equal((await view()).n, 0, "기능 키가 꺼지면 공개 0");
  }));

test("요지 - 체크리스트 없이 검수 항목을 승인할 수 없으므로 요지도 승인되지 않는다", () =>
  h.tx(async () => {
    const doc = await h.doc();
    const hash = (await h.one("select content_hash from public.legal_docs where id = $1", [doc])).content_hash;
    const d = await draft(doc, hash);
    await client.query("select public.review_item_transition($1, 'in_review', $2)", [d.reviewItemId, ADMIN]);
    const partial = await h.attempt("select public.review_item_transition($1, 'approved', $2, null, $3)", [d.reviewItemId, ADMIN, ["original_compared"]]);
    assert.equal(partial.ok, false);
    assert.equal((await rpc("select public.case_summary_approve($1, $2) r", [d.id, ADMIN])).code, "review_not_approved");
  }));

test("요지 - 원문 해시가 바뀌면 공개 뷰에서 빠지고 아직 초안인 요지의 승인은 source_changed로 거부", () =>
  h.tx(async () => {
    await setFlags({ case_db: true, case_summaries: true });
    const doc = await h.doc();
    const hash = (await h.one("select content_hash from public.legal_docs where id = $1", [doc])).content_hash;
    const d = await draft(doc, hash);
    await approveItem(d.reviewItemId, "case_summary");
    assert.equal((await rpc("select public.case_summary_approve($1, $2) r", [d.id, ADMIN])).ok, true);
    await client.query("update public.legal_docs set content_hash = $2 where id = $1", [doc, h.uniq("새해시")]);
    assert.equal((await h.one("select count(*)::int n from public.public_case_summaries where case_id = $1", [doc])).n, 0);

    const doc2 = await h.doc();
    const hash2 = (await h.one("select content_hash from public.legal_docs where id = $1", [doc2])).content_hash;
    const d2 = await draft(doc2, hash2);
    await approveItem(d2.reviewItemId, "case_summary");
    await client.query("update public.legal_docs set content_hash = $2 where id = $1", [doc2, h.uniq("새해시")]);
    assert.equal((await rpc("select public.case_summary_approve($1, $2) r", [d2.id, ADMIN])).code, "source_changed");
  }));

test("요지 - 내용 고치기·직접 상태 변경·삭제 거부, 반려는 사유 필수, 새 승인은 이전 승인본을 retired로", () =>
  h.tx(async () => {
    const doc = await h.doc();
    const hash = (await h.one("select content_hash from public.legal_docs where id = $1", [doc])).content_hash;
    const d = await draft(doc, hash);
    assert.equal((await h.attempt("update public.case_summaries set summary_lines = '{x,y,z}' where id = $1", [d.id])).ok, false);
    assert.equal((await h.attempt("update public.case_summaries set status = 'approved', approved_by = 'x', approved_at = now() where id = $1", [d.id])).ok, false);
    assert.equal((await h.attempt("delete from public.case_summaries where id = $1", [d.id])).ok, false);
    assert.equal((await rpc("select public.case_summary_reject($1, $2, '  ') r", [d.id, ADMIN])).code, "reason_required");
    await approveItem(d.reviewItemId, "case_summary");
    assert.equal((await rpc("select public.case_summary_approve($1, $2) r", [d.id, ADMIN])).ok, true);
    // 같은 결정례의 새 원문 버전 -> 새 초안 -> 승인하면 이전 승인본은 retired
    const newHash = h.uniq("두번째해시");
    await client.query("update public.legal_docs set content_hash = $2 where id = $1", [doc, newHash]);
    const d2 = await draft(doc, newHash);
    await approveItem(d2.reviewItemId, "case_summary");
    assert.equal((await rpc("select public.case_summary_approve($1, $2) r", [d2.id, ADMIN])).ok, true);
    const rows = (await client.query("select id, status from public.case_summaries where case_id = $1 order by id", [doc])).rows;
    assert.deepEqual(rows.map((r) => r.status), ["retired", "approved"]);
  }));

test("권한 - anon·authenticated는 요지·상자·배너 표와 편집국 AI 함수를 읽거나 실행하지 못한다", () =>
  h.tx(async () => {
    for (const t of ["case_summaries", "article_ai_boxes", "impact_banners"]) {
      assert.equal((await h.anon(`select 1 from public.${t} limit 1`)).ok, false, t);
    }
    assert.equal((await h.anon("select * from public.case_summary_candidates(1)")).ok, false);
    assert.equal((await h.anon("select public.case_issue_tag_ai_propose(1, 'x', 'a')")).ok, false);
    assert.equal((await h.anon("select * from public.consistency_scan('-infinity')")).ok, false);
    assert.equal((await h.attempt("select * from public.case_summary_candidates(1)", [], "authenticated")).ok, false);
  }));

// ── 173 기사 요약 상자 ────────────────────────────────────────

async function publishedArticle(over = {}) {
  const person = (await client.query("insert into public.people (slug, name, roles, visibility) values ($1, '시험 기자', array['reporter'], 'public') returning id", [h.uniq("p")])).rows[0];
  const a = (
    await client.query(
      `insert into public.articles (slug, title, section, content_type, status, author_id, body, first_published_at)
       values ($1, '시험용 기사', 'tax', 'explainer', 'published', $2, $3, now()) returning id, version`,
      [h.uniq("art"), person.id, JSON.stringify({ blocks: [{ type: "paragraph", text: "시험용 본문" }], claims: [] })],
    )
  ).rows[0];
  void over;
  return a;
}
const addBox = (a, lines = ["첫째 요약입니다.", "둘째 요약입니다.", "셋째 요약입니다."]) =>
  rpc("select public.article_ai_box_add($1, $2, $3, '독자에게 주는 의미입니다.', 'fake-model', 'job:article-ai-box', '{}'::jsonb) r", [a.id, a.version, lines]);

test("요약 상자 - 초안 + 검수 항목, 승인 전 공개 0, 검수 승인 전 승인 거부, 승인 뒤 공개 1행, 키 꺼지면 0", () =>
  h.tx(async () => {
    await setFlags({ article_ai_box: true });
    const a = await publishedArticle();
    const b = await addBox(a);
    assert.deepEqual([b.ok, b.code], [true, "created"]);
    assert.equal((await addBox(a)).code, "exists");
    const view = () => h.one("select count(*)::int n from public.public_article_ai_boxes where article_id = $1", [a.id]);
    assert.equal((await view()).n, 0);
    assert.equal((await rpc("select public.article_ai_box_approve($1, $2) r", [b.id, ADMIN])).code, "review_not_approved");
    await approveItem(b.reviewItemId, "article_ai_box");
    assert.equal((await rpc("select public.article_ai_box_approve($1, $2) r", [b.id, ADMIN])).ok, true);
    assert.equal((await view()).n, 1);
    await setFlags({ article_ai_box: false });
    assert.equal((await view()).n, 0);
  }));

test("요약 상자 - 기사 버전이 바뀌면 공개 뷰에서 빠지고, 낡은 초안은 article_changed로 승인 거부, 줄 수·글자 수 위반 거부", () =>
  h.tx(async () => {
    await setFlags({ article_ai_box: true });
    const a = await publishedArticle();
    const b = await addBox(a);
    await approveItem(b.reviewItemId, "article_ai_box");
    assert.equal((await rpc("select public.article_ai_box_approve($1, $2) r", [b.id, ADMIN])).ok, true);
    await client.query("update public.articles set version = version + 1 where id = $1", [a.id]);
    assert.equal((await h.one("select count(*)::int n from public.public_article_ai_boxes where article_id = $1", [a.id])).n, 0);
    assert.equal((await addBox(a)).code, "article_changed", "옛 버전으로는 새 초안을 만들 수 없다");

    const a2 = await publishedArticle();
    const b2 = await addBox(a2);
    await approveItem(b2.reviewItemId, "article_ai_box");
    await client.query("update public.articles set version = version + 1 where id = $1", [a2.id]);
    assert.equal((await rpc("select public.article_ai_box_approve($1, $2) r", [b2.id, ADMIN])).code, "article_changed");

    const a3 = await publishedArticle();
    assert.equal((await h.attempt("select public.article_ai_box_add($1, $2, '{a,b}', 'm', 'fake', 'job:x', '{}')", [a3.id, a3.version])).ok, false);
    assert.equal((await h.attempt("select public.article_ai_box_add($1, $2, $3, 'm', 'fake', 'job:x', '{}')", [a3.id, a3.version, ["가".repeat(121), "b", "c"]])).ok, false);
  }));

test("요약 상자 - 내용 고치기·직접 상태 변경·삭제 거부, 반려는 사유 필수", () =>
  h.tx(async () => {
    const a = await publishedArticle();
    const b = await addBox(a);
    assert.equal((await h.attempt("update public.article_ai_boxes set meaning = '바꿈' where id = $1", [b.id])).ok, false);
    assert.equal((await h.attempt("update public.article_ai_boxes set status = 'approved', approved_by = 'x', approved_at = now() where id = $1", [b.id])).ok, false);
    assert.equal((await h.attempt("delete from public.article_ai_boxes where id = $1", [b.id])).ok, false);
    assert.equal((await rpc("select public.article_ai_box_reject($1, $2, '') r", [b.id, ADMIN])).code, "reason_required");
    assert.equal((await rpc("select public.article_ai_box_reject($1, $2, '기사와 다름') r", [b.id, ADMIN])).ok, true);
  }));

// ── 173 정합성 감시 ───────────────────────────────────────────

/** 법령 하나 + 이전 개정판(1조 글 A) + 새 개정판(1조 글 B 또는 같은 글) + 개정 사건, 기사 -> 조문 확인된 연결 */
async function amended({ changed = true, publish = true } = {}) {
  const law = await h.law(h.uniq("시험용법"));
  const v1 = await h.version(law, { effective_on: "2026-01-01" });
  await h.article(v1, 1, 0, "① 시험용 조문 옛 글");
  const v2 = await h.version(law, { effective_on: "2026-06-01" });
  await h.article(v2, 1, 0, changed ? "① 시험용 조문 새 글" : "① 시험용 조문 옛 글");
  const snap = await h.snapshot();
  const ev = (await client.query("insert into public.law_events (law_id, kind, event_key, version_id, snapshot_id) values ($1, 'revision', $2, $3, $4) returning id", [law, h.uniq("ek"), v2, snap])).rows[0];
  const art = await publishedArticle();
  if (!publish) await client.query("update public.articles set status = 'draft' where id = $1", [art.id]);
  const l = await h.link({ src_kind: "article", src_id: art.id, dst_kind: "law_provision", dst_id: law, dst_article_no: 1, dst_branch_no: 0, relation: "cites" });
  assert.ok(l.ok, l.message);
  await h.confirm(l.rows[0].id);
  return { law, ev: ev.id, art };
}

test("정합성 스캔 - 글이 달라진 조문을 확인된 연결로 인용하는 공개 기사만, 글이 같으면 0, 비공개 기사 0, 후보(미확인) 연결 0", () =>
  h.tx(async () => {
    const x = await amended();
    const same = await amended({ changed: false });
    const draftArt = await amended({ publish: false });
    const rows = (await client.query("select law_event_id, article_id, change from public.consistency_scan('-infinity')")).rows;
    assert.ok(rows.some((r) => Number(r.law_event_id) === Number(x.ev) && Number(r.article_id) === Number(x.art.id) && r.change === "text_changed"));
    assert.ok(!rows.some((r) => Number(r.law_event_id) === Number(same.ev)), "글이 같으면 0");
    assert.ok(!rows.some((r) => Number(r.law_event_id) === Number(draftArt.ev)), "발행되지 않은 기사 0");
    const cand = await amended();
    await client.query("update public.links set status = 'rejected', confirmed_by = null, confirmed_at = null where src_id = $1 and src_kind = 'article'", [cand.art.id]);
    const rows2 = (await client.query("select article_id from public.consistency_scan('-infinity')")).rows;
    assert.ok(!rows2.some((r) => Number(r.article_id) === Number(cand.art.id)), "확인되지 않은 연결 0");
  }));

test("정합성 제안 - 경보 검수 항목 1건 + 배너 제안, 재실행해도 중복 0, 확인 전 배너 공개 0 -> 확인 뒤 1행(법령명·시행일은 원문 값)", () =>
  h.tx(async () => {
    await setFlags({ impact_banner: true });
    const x = await amended();
    const first = await rpc("select public.consistency_propose($1, 'job:consistency-watch', $2::jsonb) r", [x.ev, JSON.stringify({ [x.art.id]: "참고 문장" })]);
    assert.equal(first.ok, true);
    assert.equal(first.banners, 1);
    const again = await rpc("select public.consistency_propose($1, 'job:consistency-watch', '{}'::jsonb) r", [x.ev]);
    assert.equal(again.banners, 0);
    assert.equal((await h.one("select count(*)::int n from public.review_items where kind = 'consistency_alert' and source_key = $1", [`consistency:event:${x.ev}`])).n, 1);
    const banner = await h.one("select id, status, note from public.impact_banners where article_id = $1", [x.art.id]);
    assert.equal(banner.status, "proposed");
    assert.equal(banner.note, "참고 문장");
    const view = () => h.one("select count(*)::int n from public.public_impact_banners where article_id = $1", [x.art.id]);
    assert.equal((await view()).n, 0, "확인 전 노출 0");
    assert.equal((await rpc("select public.impact_banner_decide($1, $2, false, null) r", [banner.id, ADMIN])).code, "reason_required");
    assert.equal((await rpc("select public.impact_banner_decide($1, $2, true) r", [banner.id, ADMIN])).ok, true);
    assert.equal((await view()).n, 1);
    const pub = await h.one("select law_name, effective_on::text from public.public_impact_banners where article_id = $1", [x.art.id]);
    assert.ok(pub.law_name.startsWith("시험용법"));
    assert.equal(pub.effective_on, "2026-06-01");
    const cols = (await client.query("select column_name from information_schema.columns where table_name = 'public_impact_banners'")).rows.map((r) => r.column_name);
    assert.ok(!cols.includes("note"), "AI 참고 문장은 공개 뷰에 없다");
    assert.equal((await rpc("select public.impact_banner_retire($1, $2) r", [banner.id, ADMIN])).ok, true);
    assert.equal((await view()).n, 0);
    await setFlags({ impact_banner: false });
  }));

test("배너 - 기능 키가 꺼지면 확인된 배너도 공개 0, 내용 고치기·삭제 거부, 처리한 배너는 다시 처리 불가", () =>
  h.tx(async () => {
    await setFlags({ impact_banner: false });
    const x = await amended();
    await rpc("select public.consistency_propose($1, 'job:x', '{}'::jsonb) r", [x.ev]);
    const banner = await h.one("select id from public.impact_banners where article_id = $1", [x.art.id]);
    assert.equal((await rpc("select public.impact_banner_decide($1, $2, true) r", [banner.id, ADMIN])).ok, true);
    assert.equal((await h.one("select count(*)::int n from public.public_impact_banners where article_id = $1", [x.art.id])).n, 0);
    assert.equal((await rpc("select public.impact_banner_decide($1, $2, true) r", [banner.id, ADMIN])).code, "not_proposed");
    assert.equal((await h.attempt("update public.impact_banners set change = 'removed' where id = $1", [banner.id])).ok, false);
    assert.equal((await h.attempt("update public.impact_banners set status = 'proposed', decided_by = null, decided_at = null where id = $1", [banner.id])).ok, false);
    assert.equal((await h.attempt("delete from public.impact_banners where id = $1", [banner.id])).ok, false);
  }));

test("깨진 연결 점검 - 최신 개정판에 조문이 없는 확인된 연결만, 주마다 경보 1건", () =>
  h.tx(async () => {
    const law = await h.law(h.uniq("시험용법"));
    const v1 = await h.version(law, { effective_on: "2026-01-01" });
    await h.article(v1, 1);
    await h.article(v1, 2);
    const v2 = await h.version(law, { effective_on: "2026-06-01" });
    await h.article(v2, 1);
    const art = await publishedArticle();
    for (const no of [1, 2]) {
      const l = await h.link({ src_kind: "article", src_id: art.id, dst_kind: "law_provision", dst_id: law, dst_article_no: no, dst_branch_no: 0, relation: "cites" });
      await h.confirm(l.rows[0].id);
    }
    const broken = (await client.query("select article_no from public.consistency_broken_links() where article_id = $1", [art.id])).rows.map((r) => r.article_no);
    assert.deepEqual(broken, [2]);
    const week = h.uniq("2026-W99");
    const first = await rpc("select public.consistency_links_alert($1, 'job:consistency-watch') r", [week]);
    assert.equal(first.code, "created");
    assert.equal((await rpc("select public.consistency_links_alert($1, 'job:consistency-watch') r", [week])).code, "exists");
    assert.equal((await h.one("select count(*)::int n from public.review_items where kind = 'consistency_alert' and source_key = $1", [`consistency:links:${week}`])).n, 1);
  }));

test("감사 - 요지·상자·배너 승인과 거부가 같은 감사 표에 남고 지울 수 없다", () =>
  h.tx(async () => {
    const a = await publishedArticle();
    const b = await addBox(a);
    await rpc("select public.article_ai_box_approve($1, $2) r", [b.id, ADMIN]);
    const row = await h.one("select subject, action, outcome from public.issue_audit where subject = 'article_ai_box' and target_id = $1 order by id desc limit 1", [b.id]);
    assert.deepEqual([row.subject, row.action, row.outcome], ["article_ai_box", "approve", "refused"]);
    assert.equal((await h.attempt("delete from public.issue_audit where subject = 'article_ai_box'")).ok, false);
  }));
