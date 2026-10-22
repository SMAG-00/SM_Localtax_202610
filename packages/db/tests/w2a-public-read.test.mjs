// 공개 읽기 — FND-04 · NAV-12 · W2-a 설계 3장. PostgREST는 anon 키 요청을 anon 역할로 실행하므로 같은 역할로 직접 읽는다.
// anon·authenticated는 공개 상태·권리 확인 행만 읽는다: 발행 기사(대표 이미지 권리 확인 또는 없음), 공개 인물·분야·제휴사,
// 발행 기사의 공개 출처, 공개 개정안과 그 단계. 비공개 취재 근거·초안·승인 기록·역할·설정은 0행이다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

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

let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
async function insert(table, cols) {
  const keys = Object.keys(cols);
  const sql = `insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
  return (await client.query(sql, keys.map((k) => cols[k]))).rows[0];
}

/** 공개·비공개 행을 고루 갖춘 시험 세계를 만들고 fn(world)을 돌린 뒤 되돌린다 */
async function world(fn) {
  await client.query("begin");
  try {
    const user = (await client.query("insert into auth.users (id) values (gen_random_uuid()) returning id")).rows[0].id;
    const reporter = await insert("people", { slug: uniq("p"), name: "공개 기자", roles: ["reporter"], visibility: "public", staff_user_id: user, conflicts: "내부 메모", bio_items: JSON.stringify([{ item: "세무사", evidence_id: "EV-1" }, { item: "경력 50년" }]) });
    const hidden = await insert("people", { slug: uniq("p"), name: "비공개 인물", roles: ["writer"] });
    const editor = await insert("people", { slug: uniq("p"), name: "편집자", roles: ["editor"] });
    const unconfirmed = await insert("media", { path: "u.jpg", kind: "photo" });
    const confirmed = await insert("media", { path: "c.jpg", kind: "photo", rights_status: "confirmed", credit: "시험일보", photographer: "홍길동", license: "자체 촬영", license_type: "not_applicable", checked_at: new Date() });
    const confirmedLoose = await insert("media", { path: "draft.jpg", alt: "엠바고 사진", kind: "photo", rights_status: "confirmed", credit: "시험일보", photographer: "홍길동", license: "자체 촬영", license_type: "not_applicable", checked_at: new Date() });
    const art = (over) => insert("articles", { slug: uniq("a"), title: "기사", section: "local", content_type: "reported_news", author_id: reporter.id, check_log: JSON.stringify({ x: 1 }), ...over });
    const pub = await art({ status: "published" });
    const pubConfirmed = await art({ status: "published", lead_media_id: confirmed.id });
    const pubUnconfirmed = await art({ status: "published", lead_media_id: unconfirmed.id });
    const draft = await art({ status: "draft", lead_media_id: confirmedLoose.id });
    const others = [];
    for (const status of ["in_review", "approved", "scheduled", "held", "deleted"]) others.push(await art({ status, publish_at: new Date() }));
    const visiblePartner = await insert("partners", { name: "공개 제휴사", kind: "media", visible: true, contract_from: "2026-01-01", contract_to: "2026-12-31" });
    const hiddenPartner = await insert("partners", { name: "비공개 제휴사", kind: "media" });
    const hiddenCategory = await insert("categories", { section: "tax", slug: uniq("hidden"), name: uniq("숨긴 분야"), visible: false });
    const SRC = { kind: "official_doc", source_url: "https://www.mois.go.kr/a", source_name: "행정안전부", last_verified_at: new Date(), license_status: "공공누리 제1유형", license_type: "kogl_1", published_on: "2026-10-01", reference_date: "2026-06-30", region_unit: "전국", collected_at: new Date() };
    const pubSource = await insert("article_sources", { article_id: pub.id, ...SRC });
    const draftSource = await insert("article_sources", { article_id: draft.id, ...SRC });
    const ev = await insert("article_evidence", { article_id: pub.id, evidence_type: "interview", location: "녹취 보관함 B-3" });
    await insert("article_interviews", { evidence_id: ev.id, subject_role: "구청 세무과 직원", record_location: "녹취 보관함 B-3", quote_consent: "full", anonymity: "named" });
    const evData = await insert("article_evidence", { article_id: pub.id, evidence_type: "dataset", location: "data/tax.csv" });
    await insert("article_datasets", { evidence_id: evData.id, definition: "취득세 세수", repro_file_hash: "abc" });
    await insert("editorial_reviews", { article_id: pub.id, kind: "desk_edit", reviewer_id: editor.id, decision: "approve" });
    await insert("staff_roles", { user_id: user, role: "reporter", granted_by: "admin:a" });
    const story = await insert("story_assignments", { section: "tax" });
    await insert("article_revisions", { article_id: pub.id, version: 1, title: "t", body: "[]", edited_by: "user:기자" });
    await insert("article_corrections", { article_id: pub.id, kind: "rebuttal", reason: "반론", decided_by: "user:편집자" });
    await insert("seo_checks", { target_type: "article", target_id: String(pub.id), rules_version: "r", engine_version: "e", scores: JSON.stringify({ seo: 1, aeo: 1, geo: 1, common: 1 }), checked_by: "system" });
    await insert("inquiries", { kind: "correction", body: "정정 요청" });
    const snap = await insert("raw_snapshots", { source: "mois", url: "https://www.mois.go.kr/a", content_hash: "h", payload: "원문" });
    await insert("glossary_terms", { term: uniq("과세표준"), plain: "세금을 매기는 기준 금액" });
    const tag = await insert("tags", { name: uniq("교육"), slug: uniq("edu") });
    await insert("article_tags", { article_id: pub.id, tag_id: tag.id });
    const amPublic = await insert("amendments", { slug: uniq("am"), title: "공개 개정안", status: "public" });
    const amDraft = await insert("amendments", { slug: uniq("am"), title: "준비 중 개정안" });
    const EV = { stage: "announced", occurred_on: "2026-07-25", source_url: "https://www.mois.go.kr/a", snapshot_id: snap.id, recorded_by: "user:편집자" };
    const amPublicEvent = await insert("amendment_events", { amendment_id: amPublic.id, ...EV });
    await insert("amendment_events", { amendment_id: amDraft.id, ...EV });
    return await fn({ reporter, hidden, pub, pubConfirmed, pubUnconfirmed, draft, others, confirmed, confirmedLoose, unconfirmed, visiblePartner, hiddenPartner, hiddenCategory, pubSource, draftSource, story, amPublic, amDraft, amPublicEvent });
  } finally {
    await client.query("rollback");
  }
}

// W2-b에서 공개 행·칸만 연 표(settings 공개 키 · glossary_terms · tags · article_tags · 게재된 article_corrections ·
// 실질 수정 article_revisions)는 여기서 빼고 tests/w2b-public-read.test.mjs가 공개·비공개 행을 함께 시험한다 (docs/dev/W2-b_설계.md 4장)
const PRIVATE = [
  "article_evidence",
  "article_datasets",
  "article_interviews",
  "editorial_reviews",
  "staff_roles",
  "story_assignments",
  "story_assignment_events",
  "seo_checks",
  "inquiries",
  "raw_snapshots",
  "legacy_category_map",
];

for (const role of ["anon", "authenticated"]) {
  test(`${role} — 비공개 취재 근거·승인 기록·역할·기획·점검 표는 0행 (행이 있어도)`, () =>
    world(async () => {
      for (const table of PRIVATE) {
        const owner = await attempt(`select count(*)::int n from public.${table}`);
        assert.ok(owner.rows[0].n > 0, `${table}: 시험 행이 없다`);
        const r = await attempt(`select count(*)::int n from public.${table}`, [], role);
        assert.ok(!r.ok || r.rows[0].n === 0, `${table}: ${role}가 ${r.rows?.[0]?.n}행을 읽음`);
      }
    }));

  test(`${role} — 발행 기사는 읽고 초안·검토·예약·보류·삭제 기사는 못 읽는다, 대표 이미지 권리 미확인 기사도 못 읽는다`, () =>
    world(async (w) => {
      const r = await attempt("select id, slug, title, status from public.articles where author_id = $1 order by id", [w.reporter.id], role);
      assert.ok(r.ok, r.message);
      assert.deepEqual(r.rows.map((x) => x.id), [w.pub.id, w.pubConfirmed.id]);
      const v = await attempt("select id from public.public_articles where author_id = $1 order by id", [w.reporter.id], role);
      assert.ok(v.ok, v.message);
      assert.deepEqual(v.rows.map((x) => x.id), [w.pub.id, w.pubConfirmed.id]);
    }));

  test(`${role} — 기사의 내부 칸(점검 기록·승인 상태·기획 연결·뉴스 전송 후보)은 읽을 수 없다`, () =>
    world(async () => {
      for (const col of ["check_log", "editorial_status", "tax_review_status", "story_assignment_id", "nav_candidate"]) {
        const r = await attempt(`select ${col} from public.articles limit 1`, [], role);
        assert.equal(r.ok, false, `${col}이 읽힌다`);
        assert.equal(r.code, "42501");
      }
    }));

  test(`${role} — 공개 인물만 읽고, 공개 약력은 증빙 있는 항목만, 계정·이해관계 메모 칸은 못 읽는다`, () =>
    world(async (w) => {
      const r = await attempt("select id, bio_items_public from public.people where id in ($1, $2)", [w.reporter.id, w.hidden.id], role);
      assert.deepEqual(r.rows.map((x) => x.id), [w.reporter.id]);
      assert.deepEqual(r.rows[0].bio_items_public.map((b) => b.item), ["세무사"]);
      const v = await attempt("select slug, bio_items from public.public_people where id = $1", [w.reporter.id], role);
      assert.ok(v.ok, v.message);
      assert.deepEqual(v.rows[0].bio_items.map((b) => b.item), ["세무사"]);
      for (const col of ["bio_items", "staff_user_id", "conflicts", "consent_doc_version"]) {
        assert.equal((await attempt(`select ${col} from public.people limit 1`, [], role)).ok, false, col);
      }
    }));

  test(`${role} — 공개 분야만 읽는다 (씨앗 분야는 공개, 숨긴 분야는 0)`, () =>
    world(async (w) => {
      const r = await attempt("select id, visible from public.categories", [], role);
      assert.ok(r.rows.length > 0);
      assert.ok(r.rows.every((x) => x.visible));
      assert.ok(!r.rows.some((x) => x.id === w.hiddenCategory.id));
    }));

  test(`${role} — 공개 제휴사만, 계약 기간 칸은 못 읽는다`, () =>
    world(async (w) => {
      const r = await attempt("select id, name from public.partners where id in ($1, $2)", [w.visiblePartner.id, w.hiddenPartner.id], role);
      assert.deepEqual(r.rows.map((x) => x.id), [w.visiblePartner.id]);
      assert.equal((await attempt("select contract_to from public.partners", [], role)).ok, false);
    }));

  test(`${role} — 발행 기사의 공개 출처만 읽고, 초안 기사의 출처는 0`, () =>
    world(async (w) => {
      const r = await attempt("select id from public.article_sources where id in ($1, $2)", [w.pubSource.id, w.draftSource.id], role);
      assert.deepEqual(r.rows.map((x) => x.id), [w.pubSource.id]);
    }));

  test(`${role} — 이미지는 공개 기사의 권리 확인 대표 이미지만 (권리 확인돼도 초안 기사의 이미지는 0)`, () =>
    world(async (w) => {
      const r = await attempt("select id, path from public.media where id in ($1, $2, $3)", [w.confirmed.id, w.confirmedLoose.id, w.unconfirmed.id], role);
      assert.deepEqual(r.rows.map((x) => x.id), [w.confirmed.id]);
    }));

  test(`${role} — 공개 개정안과 그 단계·현재 단계만 읽는다`, () =>
    world(async (w) => {
      const a = await attempt("select id from public.amendments where id in ($1, $2)", [w.amPublic.id, w.amDraft.id], role);
      assert.deepEqual(a.rows.map((x) => x.id), [w.amPublic.id]);
      const e = await attempt("select amendment_id from public.amendment_events where amendment_id in ($1, $2)", [w.amPublic.id, w.amDraft.id], role);
      assert.deepEqual(e.rows.map((x) => x.amendment_id), [w.amPublic.id]);
      const c = await attempt("select amendment_id, current_stage from public.amendment_current_stages where amendment_id in ($1, $2)", [w.amPublic.id, w.amDraft.id], role);
      assert.ok(c.ok, c.message);
      assert.deepEqual(c.rows, [{ amendment_id: w.amPublic.id, current_stage: "announced" }]);
      assert.equal((await attempt("select recorded_by from public.amendment_events", [], role)).ok, false, "기록자 칸은 비공개");
    }));

  test(`${role} — 어떤 표에도 쓰지 못한다 (기사·인물·출처·분야)`, () =>
    world(async (w) => {
      for (const sql of [
        "insert into public.articles (slug, title, section, content_type) values ('anon-write', 't', 'tax', 'explainer')",
        `update public.articles set title = '바꿈' where id = ${w.pub.id}`,
        `delete from public.articles where id = ${w.pub.id}`,
        "insert into public.people (slug, name, roles) values ('anon-p', 'x', '{reporter}')",
        `update public.categories set visible = false`,
        `insert into public.article_sources (article_id, kind) values (${w.pub.id}, 'other')`,
        "insert into public.settings (key, value) values ('anon_key', '1')",
      ]) {
        assert.equal((await attempt(sql, [], role)).ok, false, sql);
      }
    }));
}

test("service_role(서버)은 초안·비공개 행을 모두 읽는다", () =>
  world(async (w) => {
    const r = await attempt("select count(*)::int n from public.articles where author_id = $1", [w.reporter.id], "service_role");
    assert.equal(r.rows[0].n, 4 + w.others.length);
    assert.ok((await attempt("select count(*)::int n from public.article_evidence", [], "service_role")).rows[0].n > 0);
  }));
