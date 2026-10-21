// W3 7단계 DB — 브랜드: 증빙 people_evidence · 이름/초상 동의서 name_likeness_consents · 감수 표시 article_review_marks (docs/dev/W3_설계.md 3장 · PRD-01C BR-01·02·03·07)
//  · 공개 약력 = 같은 인물의 승인된 증빙을 가리키는 항목만 (승인 안 됨·남의 증빙·없는 번호·번호 없음 = 0)
//  · 동의서: 현재 버전(가장 늦게 시작한 문서)이 활성 + 범위 포함일 때만. 철회·만료 → 공개 뷰·인물 페이지 원본(사이트맵 원본) 0행. 기록은 고치지 못하고 철회는 한 번
//  · 칼럼 발행: 기능 키와 상관없이 필자의 현재 동의서(범위 column)가 있어야 한다
//  · 감수 표시: 최근 세무 감수 승인 기록에서만. 서명 뒤 오탈자 수정은 유지, 실질 수정 → hidden_changed + 재감수 큐 1건, 다시 서명하면 shown
//  · 설정: brand_copy는 광고 규정 감수 + 경력 증빙 승인 뒤에만, people_pages는 동의서·증빙 약력이 있는 인물이 있을 때만 켠다
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

async function tx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

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
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
const ago = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();

const person = async (over = {}) =>
  one("insert into public.people (slug, name, roles, visibility, bio_items) values ($1, $2, $3, $4, $5) returning id", [
    uniq("brand-p"),
    over.name ?? "시험용 인물",
    over.roles ?? ["writer"],
    over.visibility ?? "public",
    JSON.stringify(over.bio ?? []),
  ]).then((r) => Number(r.id));
const evidence = async (personId, { approved = false, kind = "document" } = {}) =>
  Number(
    (
      await one(
        "insert into public.people_evidence (person_id, kind, doc_ref, recorded_by, approved, verified_by, verified_at) values ($1, $2, '시험용 증빙 위치', 'admin:test', $3, $4, $5) returning id",
        [personId, kind, approved, approved ? "admin:test" : null, approved ? new Date().toISOString() : null],
      )
    ).id,
  );
const consent = async (personId, { version = uniq("v"), scope = ["profile_page", "column"], validFrom = ago(1), validTo = null } = {}) =>
  Number(
    (
      await one(
        "insert into public.name_likeness_consents (person_id, version, scope, doc_ref, recorded_by, valid_from, valid_to) values ($1, $2, $3, '시험용 동의서 위치', 'admin:test', $4, $5) returning id",
        [personId, version, scope, validFrom, validTo],
      )
    ).id,
  );
const withdraw = (id) => client.query("update public.name_likeness_consents set withdrawn_at = now(), withdrawn_by = 'admin:test' where id = $1", [id]);
const scopesOf = async (personId) => (await client.query("select scope from public.public_name_consents where person_id = $1", [personId])).rows.map((r) => r.scope);
const bioOf = async (personId) => (await client.query("select bio_items from public.public_person_bio where person_id = $1", [personId])).rows[0]?.bio_items;
const article = async (over = {}) =>
  Number(
    (
      await one("insert into public.articles (slug, title, section, content_type, status, author_id) values ($1, '시험용 기사', 'tax', $2, $3, $4) returning id", [
        uniq("brand-a"),
        over.contentType ?? "explainer",
        over.status ?? "published",
        over.authorId ?? null,
      ])
    ).id,
  );

// ── 증빙 ─────────────────────────────────────────────────────

test("증빙 — 종류는 설계 값만, 승인은 확인자·확인 시각이 있을 때만, 문서 위치는 빈 값 거부", () =>
  tx(async () => {
    const p = await person();
    const ins = "insert into public.people_evidence (person_id, kind, doc_ref, recorded_by, approved, verified_by, verified_at) values ($1, $2, $3, 'admin:test', $4, $5, $6)";
    assert.equal((await attempt(ins, [p, "license", "위치", false, null, null])).code, "23514", "설계 밖 종류");
    assert.equal((await attempt(ins, [p, "document", " ", false, null, null])).code, "23514", "빈 위치");
    assert.equal((await attempt(ins, [p, "document", "위치", true, null, null])).code, "23514", "확인자 없이 승인");
    assert.equal((await attempt(ins, [p, "document", "위치", true, "admin:test", null])).code, "23514", "확인 시각 없이 승인");
    assert.ok((await attempt(ins, [p, "official_record", "위치", true, "admin:test", new Date().toISOString()])).ok);
    assert.ok((await attempt(ins, [p, "publisher_history", "위치", false, null, null])).ok);
  }));

test("공개 약력 — 같은 인물의 승인된 증빙을 가리키는 항목만, 순서 유지, 승인하면 다음 읽기부터 늘어난다", () =>
  tx(async () => {
    const other = await person();
    const otherEv = await evidence(other, { approved: true });
    const p = await person();
    const ok1 = await evidence(p, { approved: true });
    const pending = await evidence(p);
    const ok2 = await evidence(p, { approved: true, kind: "official_record" });
    await client.query("update public.people set bio_items = $2 where id = $1", [
      p,
      JSON.stringify([
        { item: "시험용 약력 A", evidence_id: String(ok1) },
        { item: "시험용 약력 B(미승인)", evidence_id: String(pending) },
        { item: "시험용 약력 C(남의 증빙)", evidence_id: String(otherEv) },
        { item: "시험용 약력 D(번호 없음)" },
        { item: "시험용 약력 E(없는 번호)", evidence_id: "999999999" },
        { item: "시험용 약력 F", evidence_id: ` ${ok2} ` },
      ]),
    ]);
    assert.deepEqual((await bioOf(p)).map((b) => b.item), ["시험용 약력 A", "시험용 약력 F"]);
    const approvedLines = Number((await one("select count(*)::int n from public.people_evidence where person_id = $1 and approved", [p])).n);
    assert.equal((await bioOf(p)).length, approvedLines, "렌더 약력 수 = 승인 증빙 수");
    await client.query("update public.people_evidence set approved = true, verified_by = 'admin:test', verified_at = now() where id = $1", [pending]);
    assert.deepEqual((await bioOf(p)).map((b) => b.item), ["시험용 약력 A", "시험용 약력 B(미승인)", "시험용 약력 F"]);
    await client.query("update public.people_evidence set approved = false where id = $1", [ok1]);
    assert.deepEqual((await bioOf(p)).map((b) => b.item), ["시험용 약력 B(미승인)", "시험용 약력 F"], "승인을 거두면 빠진다");
    const hidden = await person({ visibility: "hidden", bio: [{ item: "숨은 사람", evidence_id: String(ok2) }] });
    assert.equal(await bioOf(hidden), undefined, "비공개 인물은 0행");
  }));

for (const role of ["anon", "authenticated"]) {
  test(`${role} — 증빙·동의서 표와 관리용 뷰는 못 읽고, 공개 뷰는 문서 위치·확인자 없이 읽는다`, () =>
    tx(async () => {
      const p = await person();
      const ev = await evidence(p, { approved: true });
      await client.query("update public.people set bio_items = $2 where id = $1", [p, JSON.stringify([{ item: "시험용 약력", evidence_id: String(ev) }])]);
      await consent(p);
      for (const t of ["people_evidence", "name_likeness_consents", "name_consent_docs", "tax_rereview_queue"]) {
        const r = await attempt(`select count(*)::int n from public.${t}`, [], role);
        assert.ok(!r.ok && r.code === "42501", `${t}: ${role}가 읽음`);
      }
      const bio = await attempt("select * from public.public_person_bio where person_id = $1", [p], role);
      assert.ok(bio.ok, bio.message);
      assert.deepEqual(Object.keys(bio.rows[0]).sort(), ["bio_items", "person_id"]);
      assert.deepEqual(bio.rows[0].bio_items, [{ item: "시험용 약력", evidence_id: String(ev) }]);
      const c = await attempt("select * from public.public_name_consents where person_id = $1", [p], role);
      assert.deepEqual(Object.keys(c.rows[0]).sort(), ["person_id", "scope"]);
      const pp = await attempt("select * from public.public_profile_pages where person_id = $1", [p], role);
      assert.deepEqual(Object.keys(pp.rows[0]).sort(), ["person_id", "slug", "updated_at"]);
      for (const t of ["people_evidence", "name_likeness_consents"]) {
        assert.equal((await attempt(`delete from public.${t}`, [], role)).code, "42501", `${t} 지우기`);
      }
    }));
}

// ── 동의서 ───────────────────────────────────────────────────

test("동의서 — 범위는 설계 값만, 기간 거꾸로·미래 시작 거부, 같은 사람 같은 버전 한 번", () =>
  tx(async () => {
    const p = await person();
    const ins = "insert into public.name_likeness_consents (person_id, version, scope, doc_ref, recorded_by, valid_from, valid_to) values ($1, $2, $3, '위치', 'admin:test', $4, $5)";
    assert.equal((await attempt(ins, [p, "v1", ["person_page"], ago(1), null])).code, "23514", "설계 밖 범위");
    assert.equal((await attempt(ins, [p, "v1", [], ago(1), null])).code, "23514", "빈 범위");
    assert.equal((await attempt(ins, [p, "v1", ["column"], ago(1), ago(2)])).code, "23514", "끝이 시작보다 앞");
    assert.equal((await attempt(ins, [p, "v1", ["column"], new Date(Date.now() + 86_400_000).toISOString(), null])).code, "23514", "미래 시작");
    assert.ok((await attempt(ins, [p, "v1", ["profile_page", "column", "home", "external_profile", "product", "ad", "video"], ago(1), null])).ok);
    assert.equal((await attempt(ins, [p, "v1", ["column"], ago(1), null])).code, "23505", "같은 버전 두 번");
  }));

test("동의서 — 기록 내용은 고치지 못하고 철회만 한 번, 철회한 문서는 되돌리지 못한다", () =>
  tx(async () => {
    const p = await person();
    const id = await consent(p, { scope: ["column"] });
    assert.equal((await attempt("update public.name_likeness_consents set scope = array['column', 'product'] where id = $1", [id])).code, "23514", "범위 고치기");
    assert.equal((await attempt("update public.name_likeness_consents set doc_ref = '다른 곳' where id = $1", [id])).code, "23514", "위치 고치기");
    assert.equal((await attempt("update public.name_likeness_consents set withdrawn_at = now() where id = $1", [id])).code, "23514", "철회자 없는 철회");
    await withdraw(id);
    assert.equal((await attempt("update public.name_likeness_consents set withdrawn_at = null, withdrawn_by = null where id = $1", [id])).code, "23514", "철회 되돌리기");
  }));

test("현재 동의서 — 가장 늦게 시작한 버전만 보고, 철회·만료면 0행, 철회는 옛 버전으로 되살아나지 않는다", () =>
  tx(async () => {
    const p = await person();
    const v1 = await consent(p, { version: "시험용-1", scope: ["profile_page", "column", "home"], validFrom: ago(48) });
    assert.deepEqual(await scopesOf(p), [["profile_page", "column", "home"]]);
    const v2 = await consent(p, { version: "시험용-2", scope: ["column"], validFrom: ago(24) });
    assert.deepEqual(await scopesOf(p), [["column"]], "새 버전이 범위를 좁히면 옛 범위는 0");
    await withdraw(v2);
    assert.deepEqual(await scopesOf(p), [], "현재 버전 철회 → 0행 (옛 버전이 활성이어도)");
    const states = new Map((await client.query("select id, status, is_current from public.name_consent_docs where person_id = $1", [p])).rows.map((r) => [Number(r.id), r]));
    assert.equal(states.get(v1).status, "active");
    assert.equal(states.get(v1).is_current, false);
    assert.equal(states.get(v2).status, "withdrawn");
    assert.equal(states.get(v2).is_current, true);

    const q = await person();
    await consent(q, { scope: ["profile_page"], validFrom: ago(48), validTo: ago(1) });
    assert.deepEqual(await scopesOf(q), [], "만료");
    assert.equal((await one("select status from public.name_consent_docs where person_id = $1", [q])).status, "expired");
    await consent(q, { scope: ["profile_page"], validFrom: ago(0.5), validTo: new Date(Date.now() + 86_400_000).toISOString() });
    assert.deepEqual(await scopesOf(q), [["profile_page"]], "새 버전을 기록하면 다시 활성");
  }));

test("인물 페이지 원본(사이트맵 원본) — 공개 인물 + 현재 동의서 범위에 profile_page일 때만, 철회하면 0행", () =>
  tx(async () => {
    const slugOf = async (id) => (await client.query("select slug from public.public_profile_pages where person_id = $1", [id])).rows.map((r) => r.slug);
    const none = await person();
    assert.deepEqual(await slugOf(none), [], "동의서 없음");
    const columnOnly = await person();
    await consent(columnOnly, { scope: ["column"] });
    assert.deepEqual(await slugOf(columnOnly), [], "범위에 profile_page 없음");
    const hidden = await person({ visibility: "hidden" });
    await consent(hidden, { scope: ["profile_page"] });
    assert.deepEqual(await slugOf(hidden), [], "비공개 인물");
    const p = await person();
    const c = await consent(p, { scope: ["profile_page"] });
    assert.equal((await slugOf(p)).length, 1);
    await withdraw(c);
    assert.deepEqual(await slugOf(p), [], "철회 → 0행");
  }));

// ── 칼럼 발행과 동의서 ───────────────────────────────────────

test("칼럼 발행 — 필자의 현재 동의서(범위 column)가 없으면 발행·예약 거부, 있으면 허용, 필자 없는 글·다른 유형은 해당 없음", () =>
  tx(async () => {
    const w = await person();
    const ins = "insert into public.articles (slug, title, section, content_type, status, author_id) values ($1, '시험용 칼럼', 'tax', 'opinion', $2, $3) returning id";
    assert.equal((await attempt(ins, [uniq("c"), "published", w])).code, "23514", "동의서 없음");
    assert.equal((await attempt(ins, [uniq("c"), "scheduled", w])).code, "23514", "예약도 거부");
    assert.ok((await attempt(ins, [uniq("c"), "draft", w])).ok, "초안은 저장된다");
    await consent(w, { scope: ["profile_page"] });
    assert.equal((await attempt(ins, [uniq("c"), "published", w])).code, "23514", "범위에 column 없음");
    assert.ok((await attempt(ins, [uniq("c"), "published", null])).ok, "필자 없는 글");
    assert.ok((await attempt("insert into public.articles (slug, title, section, content_type, status, author_id) values ($1, '시험용 해설', 'tax', 'explainer', 'published', $2)", [uniq("e"), w])).ok, "칼럼 아닌 글");

    const w2 = await person();
    const c = await consent(w2, { scope: ["column"] });
    const draft = Number((await one(ins, [uniq("c"), "draft", w2])).id);
    assert.ok((await attempt("update public.articles set status = 'published' where id = $1", [draft])).ok, "동의서 있음 → 발행");
    await withdraw(c);
    assert.ok((await attempt("update public.articles set title = '시험용 칼럼 고침' where id = $1", [draft])).ok, "이미 공개된 칼럼은 그대로");
    assert.equal((await attempt("update public.articles set author_id = $2 where id = $1", [draft, w])).code, "23514", "공개 칼럼의 필자를 동의서 없는 사람으로 바꾸기");
    const later = Number((await one(ins, [uniq("c"), "draft", w2])).id);
    assert.equal((await attempt("update public.articles set status = 'published' where id = $1", [later])).code, "23514", "철회 뒤 새 발행 거부");
  }));

// ── 감수 표시 ────────────────────────────────────────────────

const markOf = async (articleId) => (await client.query("select * from public.article_review_marks where article_id = $1", [articleId])).rows[0];
const review = (articleId, reviewer, { version = 1, decision = "approve", at = new Date().toISOString() } = {}) =>
  client.query("insert into public.editorial_reviews (article_id, version, kind, reviewer_id, decision, at) values ($1, $2, 'tax_review', $3, $4, $5)", [articleId, version, reviewer, decision, at]);
const revision = (articleId, version, kind) =>
  client.query("insert into public.article_revisions (article_id, version, title, body, edited_by, reason, update_kind) values ($1, $2, '시험용', '{}'::jsonb, 'admin:test', $3, $4)", [
    articleId,
    version,
    kind ? "시험용 수정" : null,
    kind,
  ]);
const queueOf = async (articleId) => (await client.query("select * from public.tax_rereview_queue where article_id = $1", [articleId])).rows;

test("감수 표시 — 기록 없으면 none(서명자 0), 승인하면 shown, 오탈자 수정은 유지, 실질 수정은 hidden_changed + 재감수 큐 1건, 다시 서명하면 shown", () =>
  tx(async () => {
    const reviewer = await person({ roles: ["reviewer"] });
    const a = await article();
    let m = await markOf(a);
    assert.equal(m.state, "none");
    assert.equal(m.reviewer_person_id, null);
    await review(a, reviewer, { version: 1, at: ago(5) });
    m = await markOf(a);
    assert.equal(m.state, "shown");
    assert.equal(Number(m.reviewer_person_id), reviewer);
    assert.equal(m.version, 1);

    await revision(a, 2, "typo");
    assert.equal((await markOf(a)).state, "shown", "오탈자 수정은 유지");
    assert.deepEqual(await queueOf(a), []);

    await revision(a, 3, "substantive");
    assert.equal((await markOf(a)).state, "hidden_changed", "서명 뒤 실질 수정");
    const q = await queueOf(a);
    assert.equal(q.length, 1, "재감수 큐 1건");
    assert.equal(q[0].reviewed_version, 1);

    await review(a, reviewer, { version: 3, at: ago(1) });
    assert.equal((await markOf(a)).state, "shown", "현재 버전에 다시 서명");
    assert.deepEqual(await queueOf(a), []);

    await review(a, reviewer, { version: 3, decision: "reject", at: ago(0.5) });
    m = await markOf(a);
    assert.equal(m.state, "none", "최근 기록이 반려");
    assert.equal(m.reviewed_at, null);
  }));

test("감수 표시 — 서명 뒤 실질 수정 시각(substantive_updated_at)이 생겨도 hidden_changed, 발행 전 수정(종류 없음)도 실질 수정으로 본다, 비공개 기사는 0행", () =>
  tx(async () => {
    const reviewer = await person({ roles: ["reviewer"] });
    const a = await article();
    await review(a, reviewer, { at: ago(5) });
    await client.query("update public.articles set substantive_updated_at = $2 where id = $1", [a, ago(1)]);
    assert.equal((await markOf(a)).state, "hidden_changed");
    const b = await article();
    await review(b, reviewer, { at: ago(5) });
    await revision(b, 2, null);
    assert.equal((await markOf(b)).state, "hidden_changed");
    const draft = await article({ status: "draft" });
    await review(draft, reviewer, { at: ago(5) });
    assert.equal(await markOf(draft), undefined, "초안은 0행");
  }));

for (const role of ["anon", "authenticated"]) {
  test(`${role} — 감수 표시 뷰는 읽고 쓰지 못한다 (손입력 칸 0)`, () =>
    tx(async () => {
      const reviewer = await person({ roles: ["reviewer"] });
      const a = await article();
      await review(a, reviewer, { at: ago(2) });
      const r = await attempt("select state, reviewer_person_id from public.article_review_marks where article_id = $1", [a], role);
      assert.ok(r.ok, r.message);
      assert.equal(r.rows[0].state, "shown");
      assert.equal((await attempt("update public.article_review_marks set state = 'shown' where article_id = $1", [a], role)).ok, false);
    }));
}

// ── 설정과 기능 키 ───────────────────────────────────────────

const setFlag = (key, on) => attempt("update public.settings set value = value || jsonb_build_object($1::text, $2::boolean) where key = 'feature_flags'", [key, on]);
const setSetting = (key, value) => attempt("update public.settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);

test("brand_copy — 광고 규정 감수와 경력 증빙 승인(근거 증빙이 지금도 승인) 둘 다 있어야 켠다, 승인 기록 모양도 검사", () =>
  tx(async () => {
    assert.equal((await setFlag("brand_copy", true)).code, "23514", "기록 없음");
    const p = await person();
    const pending = await evidence(p);
    const ok = await evidence(p, { approved: true });
    const now = new Date().toISOString();
    assert.equal((await setSetting("career_claim_approved", { approved: true, basis_evidence_id: null, approved_by: "admin:test", approved_at: now })).code, "23514", "근거 없음");
    assert.equal((await setSetting("career_claim_approved", { approved: true, basis_evidence_id: pending, approved_by: "admin:test", approved_at: now })).code, "23514", "미승인 근거");
    assert.equal((await setSetting("career_claim_approved", { approved: true, basis_evidence_id: ok, approved_by: null, approved_at: now })).code, "23514", "승인자 없음");
    assert.ok((await setSetting("career_claim_approved", { approved: true, basis_evidence_id: ok, approved_by: "admin:test", approved_at: now })).ok);
    assert.equal((await setFlag("brand_copy", true)).code, "23514", "감수 기록 없음");
    assert.equal((await setSetting("brand_copy_review", { reviewed: true, record_id: " " })).code, "23514", "감수 기록 위치 없음");
    assert.ok((await setSetting("brand_copy_review", { reviewed: true, record_id: "시험용 감수 기록" })).ok);
    assert.ok((await setFlag("brand_copy", true)).ok, "둘 다 있음 → 켜짐");
    assert.ok((await setFlag("people_pages", false)).ok, "이미 켜진 키는 다른 키를 바꿀 때 다시 보지 않는다");
    assert.ok((await setFlag("brand_copy", false)).ok, "끄기는 언제나");
    await client.query("update public.people_evidence set approved = false where id = $1", [ok]);
    assert.equal((await setFlag("brand_copy", true)).code, "23514", "근거 증빙 승인을 거두면 다시 못 켠다");
  }));

test("people_pages — 동의서(profile_page)와 증빙 승인 약력이 있는 공개 인물이 1명 이상일 때만 켠다", () =>
  tx(async () => {
    // 이 DB의 다른 시험 자료와 섞이지 않게 — 트랜잭션 안에서 기존 동의서를 모두 철회한 것처럼 지운다(되돌림)
    await client.query("delete from public.name_likeness_consents");
    assert.equal((await setFlag("people_pages", true)).code, "23514", "아무도 없음");
    const p = await person();
    await consent(p, { scope: ["profile_page"] });
    assert.equal((await setFlag("people_pages", true)).code, "23514", "동의서만 있고 승인 약력 0");
    const ev = await evidence(p, { approved: true });
    await client.query("update public.people set bio_items = $2 where id = $1", [p, JSON.stringify([{ item: "시험용 약력", evidence_id: String(ev) }])]);
    assert.ok((await setFlag("people_pages", true)).ok);
  }));

test("새 함수는 anon·authenticated가 실행하지 못한다", () =>
  tx(async () => {
    for (const fn of ["brand_settings_guard()", "column_consent_guard()", "name_likeness_consents_guard()"]) {
      const r = await one(`select has_function_privilege('anon', 'public.${fn}', 'EXECUTE') a, has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') b`);
      assert.deepEqual([r.a, r.b], [false, false], fn);
    }
  }));
