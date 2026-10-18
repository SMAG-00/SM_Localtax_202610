// 기사(articles)와 딸린 표의 DB 제약 — ART-01 · ART-05 · ART-10 · CAT-01 · OPT-10 · LG-04 · NAV-06 · UX-01 · OPT-03 · ADM-03.
// 발행 판정(packages/editorial)이 막는 규칙과 별개로, 직접 SQL로도 깨지지 않아야 하는 저장 규칙을 본다.
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
function insertSql(table, cols) {
  const keys = Object.keys(cols);
  return { sql: `insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, params: keys.map((k) => cols[k]) };
}
async function insert(table, cols) {
  const { sql, params } = insertSql(table, cols);
  return (await client.query(sql, params)).rows[0];
}
const tryInsert = (table, cols, role) => {
  const { sql, params } = insertSql(table, cols);
  return attempt(sql, params, role);
};
const base = (over = {}) => ({ slug: uniq("a"), title: "시험 기사", section: "tax", content_type: "explainer", ...over });
const article = (over) => insert("articles", base(over));
const categoryId = async (section) => (await client.query("select id from public.categories where section = $1 order by sort limit 1", [section])).rows[0].id;

test("slug 예약 이름(video·photo·popular)은 대소문자와 상관없이 거부, 비슷한 이름은 허용 (ART-01)", () =>
  tx(async () => {
    for (const slug of ["video", "photo", "popular", "Video", "POPULAR"]) assert.equal((await tryInsert("articles", base({ slug }))).ok, false, slug);
    for (const slug of ["videos", "photo-essay", "popular-tax"]) assert.ok((await tryInsert("articles", base({ slug }))).ok, slug);
  }));

test("slug는 겹칠 수 없고 공백·빗금·빈 값은 거부", () =>
  tx(async () => {
    const a = await article();
    assert.equal((await tryInsert("articles", base({ slug: a.slug }))).ok, false);
    for (const slug of ["", "  ", "a b", "a/b"]) assert.equal((await tryInsert("articles", base({ slug }))).ok, false, JSON.stringify(slug));
  }));

test("분야(section) 없이 저장 불가, 콘텐츠 유형 없이 저장 불가 — 이관 기사(origin=legacy)만 유형을 비울 수 있다 (ART-01)", () =>
  tx(async () => {
    assert.equal((await tryInsert("articles", base({ section: null }))).ok, false);
    assert.equal((await tryInsert("articles", base({ content_type: null }))).ok, false);
    assert.ok((await tryInsert("articles", base({ content_type: null, origin: "legacy" }))).ok);
    assert.equal((await tryInsert("articles", base({ origin: "imported" }))).ok, false);
  }));

test("취재 방식(reporting_method)은 reported_news만 가진다", () =>
  tx(async () => {
    assert.ok((await tryInsert("articles", base({ content_type: "reported_news", reporting_method: "quantitative" }))).ok);
    assert.ok((await tryInsert("articles", base({ content_type: "reported_news" }))).ok, "비어 있으면 저장은 된다 (발행 판정이 막는다)");
    for (const t of ["explainer", "guide", "opinion"]) assert.equal((await tryInsert("articles", base({ content_type: t, reporting_method: "mixed" }))).ok, false, t);
  }));

test("표기(label)가 있으면 sponsored만, sponsored는 표기가 있어야 한다 (ART-01 · ART-10)", () =>
  tx(async () => {
    const partner = await insert("partners", { name: "시험 세무법인", kind: "tax_firm" });
    assert.equal((await tryInsert("articles", base({ content_type: "reported_news", label: "co_planned", partner_id: partner.id }))).ok, false, "표기 + reported_news");
    assert.equal((await tryInsert("articles", base({ content_type: "explainer", label: "ad" }))).ok, false, "표기 + explainer");
    assert.equal((await tryInsert("articles", base({ content_type: "sponsored", label: "none" }))).ok, false, "sponsored + 표기 없음");
    assert.equal((await tryInsert("articles", base({ content_type: "sponsored", label: "co_planned" }))).ok, false, "공동 기획인데 제휴사 없음");
    assert.ok((await tryInsert("articles", base({ content_type: "sponsored", label: "co_planned", partner_id: partner.id }))).ok);
    assert.ok((await tryInsert("articles", base({ content_type: "sponsored", label: "ad" }))).ok);
    assert.equal((await tryInsert("articles", base({ content_type: "sponsored", label: "co_planned,ad", partner_id: partner.id }))).ok, false, "두 표기를 함께");
  }));

test("digest는 주간 회차(digest_id)가 있어야 하고, 다른 유형은 회차를 가질 수 없다 (LG-04)", () =>
  tx(async () => {
    assert.equal((await tryInsert("articles", base({ content_type: "digest" }))).ok, false);
    assert.ok((await tryInsert("articles", base({ content_type: "digest", digest_id: 7 }))).ok);
    assert.equal((await tryInsert("articles", base({ content_type: "explainer", digest_id: 7 }))).ok, false);
  }));

test("digest를 reported_news로 바꾸는 편집은 거부 (LG-04)", () =>
  tx(async () => {
    const a = await article({ section: "local", content_type: "digest", digest_id: 3 });
    const r = await attempt("update public.articles set content_type = 'reported_news', digest_id = null where id = $1", [a.id], "service_role");
    assert.equal(r.ok, false);
    assert.match(r.message, /digest/);
  }));

test("처음 발행하면 최초 발행일이 찍히고, 그 뒤에는 바꾸거나 지울 수 없다 — 소유자도 (OPT-10)", () =>
  tx(async () => {
    const a = await article();
    assert.equal(a.first_published_at, null);
    const pub = await attempt("update public.articles set status = 'published' where id = $1 returning first_published_at", [a.id], "service_role");
    assert.ok(pub.rows[0].first_published_at instanceof Date);
    for (const role of ["service_role", null]) {
      assert.equal((await attempt("update public.articles set first_published_at = now() - interval '1 day' where id = $1", [a.id], role)).ok, false, String(role));
      assert.equal((await attempt("update public.articles set first_published_at = null where id = $1", [a.id], role)).ok, false, String(role));
    }
    assert.ok((await attempt("update public.articles set title = '제목 수정', status = 'held' where id = $1", [a.id], "service_role")).ok, "다른 칸 수정은 된다");
    const again = await attempt("update public.articles set status = 'published' where id = $1 returning first_published_at", [a.id]);
    assert.equal(again.rows[0].first_published_at.getTime(), pub.rows[0].first_published_at.getTime(), "재발행해도 최초 발행일 그대로");
  }));

test("이관 기사는 원래 발행일을 최초 발행일로 넣을 수 있다", () =>
  tx(async () => {
    const r = await tryInsert("articles", base({ origin: "legacy", content_type: null, status: "published", first_published_at: "2019-03-02T09:00:00+09:00" }));
    assert.ok(r.ok, r.message);
    assert.equal(r.rows[0].first_published_at.toISOString(), "2019-03-02T00:00:00.000Z");
  }));

test("예약 발행(scheduled)은 예약 시각이 있어야 한다", () =>
  tx(async () => {
    assert.equal((await tryInsert("articles", base({ status: "scheduled" }))).ok, false);
    assert.ok((await tryInsert("articles", base({ status: "scheduled", publish_at: "2026-10-20T09:00:00+09:00" }))).ok);
  }));

test("하위 분야는 기사의 분야(section) 안의 것만 (분야 체계 일관성, CAT-01)", () =>
  tx(async () => {
    assert.ok((await tryInsert("articles", base({ section: "tax", category_id: await categoryId("tax") }))).ok);
    assert.equal((await tryInsert("articles", base({ section: "local", category_id: await categoryId("tax") }))).ok, false);
  }));

test("발행 뒤 수정 종류(update_kind)를 고르면 수정 사유가 있어야 한다 (ART-05)", () =>
  tx(async () => {
    for (const reason of [null, "", "  "]) assert.equal((await tryInsert("articles", base({ update_kind: "typo", updated_reason: reason }))).ok, false, JSON.stringify(reason));
    assert.ok((await tryInsert("articles", base({ update_kind: "typo", updated_reason: "맞춤법" }))).ok);
  }));

test("수정 이력(article_revisions)도 수정 종류가 있으면 사유가 있어야 하고, 같은 버전은 두 번 남길 수 없다", () =>
  tx(async () => {
    const a = await article();
    const ins = "insert into public.article_revisions (article_id, version, title, body, edited_by, reason, update_kind) values ($1, $2, 't', '[]', 'user:기자', $3, $4)";
    assert.equal((await attempt(ins, [a.id, 2, null, "substantive"])).ok, false);
    assert.ok((await attempt(ins, [a.id, 1, null, null])).ok, "첫 버전은 종류·사유 없이");
    assert.ok((await attempt(ins, [a.id, 2, "통계 갱신", "substantive"])).ok);
    assert.equal((await attempt(ins, [a.id, 2, "다시", "typo"])).ok, false, "같은 버전");
  }));

test("대표 이미지 권리가 확인되지 않으면 기사의 공개 가능 표시(lead_media_cleared)가 꺼지고, 권리를 확인하면 켜진다", () =>
  tx(async () => {
    const m = await insert("media", { path: "articles/1.jpg", alt: "청사", kind: "photo" });
    const a = await article({ lead_media_id: m.id });
    assert.equal(a.lead_media_cleared, false);
    assert.equal((await article()).lead_media_cleared, true, "대표 이미지가 없으면 켜짐");
    await client.query(
      "update public.media set rights_status = 'confirmed', credit = '시험일보', photographer = '홍길동', license = '자체 촬영', checked_at = now() where id = $1",
      [m.id],
    );
    assert.equal((await client.query("select lead_media_cleared from public.articles where id = $1", [a.id])).rows[0].lead_media_cleared, true);
    await client.query("update public.media set rights_status = 'rejected' where id = $1", [m.id]);
    assert.equal((await client.query("select lead_media_cleared from public.articles where id = $1", [a.id])).rows[0].lead_media_cleared, false);
    const forged = await attempt("update public.articles set lead_media_cleared = true where id = $1 returning lead_media_cleared", [a.id], "service_role");
    assert.equal(forged.rows[0].lead_media_cleared, false, "직접 켜도 이미지 권리로 다시 계산된다");
  }));

test("사진 권리 확인(confirmed)은 출처·촬영자·이용 조건·확인일이 모두 있어야 한다 (REG1-09)", () =>
  tx(async () => {
    const full = { path: "p.jpg", kind: "photo", rights_status: "confirmed", credit: "시험일보", photographer: "홍길동", license: "자체 촬영", checked_at: new Date() };
    assert.ok((await tryInsert("media", full)).ok);
    for (const k of ["credit", "photographer", "license", "checked_at"]) {
      assert.equal((await tryInsert("media", { ...full, [k]: null })).ok, false, k);
    }
    assert.equal((await tryInsert("media", { ...full, credit: "  " })).ok, false, "공백 출처");
    assert.ok((await tryInsert("media", { path: "x.jpg", kind: "photo" })).ok, "미확인 상태로는 저장된다");
  }));

// W2-d 3단계에서 바꿨다 — GLO-01 '61자는 저장 경고'(편집 화면·API가 경고)라 DB는 61자를 받고, 한도(W2-d 설계 2.5 glossary.plain_max 120자)만 막는다.
// 경계 시험은 w2d-glossary.test.mjs
test("용어사전의 쉬운 풀이 61자는 저장된다 — 한도(120자)를 넘으면 거부 · 분야는 4종 (PRD-01A 6.1 · GLO-01)", () =>
  tx(async () => {
    assert.ok((await tryInsert("glossary_terms", { term: uniq("과세표준"), plain: "가".repeat(61) })).ok);
    assert.equal((await tryInsert("glossary_terms", { term: uniq("과세표준"), plain: "가".repeat(121) })).ok, false);
    assert.equal((await tryInsert("glossary_terms", { term: uniq("x"), section: ["tax", "tourism"] })).ok, false, "분야 4종 밖");
  }));

test("점검 결과(seo_checks) 점수는 seo·aeo·geo·common 네 축, 0~100 (OPT-03)", () =>
  tx(async () => {
    const row = (scores) => ({ target_type: "article", target_id: "1", rules_version: "r1", engine_version: "e1", scores: JSON.stringify(scores), checked_by: "system" });
    assert.ok((await tryInsert("seo_checks", row({ seo: 0, aeo: 100, geo: 55.5, common: 70 }))).ok);
    for (const bad of [
      { seo: -1, aeo: 1, geo: 1, common: 1 },
      { seo: 101, aeo: 1, geo: 1, common: 1 },
      { seo: "높음", aeo: 1, geo: 1, common: 1 },
      { seo: 1, aeo: 1, geo: 1 },
      { seo: 1, aeo: 1, geo: 1, common: 1, rank: 1 },
    ]) {
      assert.equal((await tryInsert("seo_checks", row(bad))).ok, false, JSON.stringify(bad));
    }
    assert.equal((await tryInsert("seo_checks", { ...row({ seo: 1, aeo: 1, geo: 1, common: 1 }), checked_by: "ai" })).ok, false);
    assert.equal((await tryInsert("seo_checks", { ...row({ seo: 1, aeo: 1, geo: 1, common: 1 }), rules_version: "" })).ok, false, "규칙 버전 필수");
  }));

test("정정·반론 문의는 처리 결과와 사유 없이 완료로 바꿀 수 없다 (ADM-03)", () =>
  tx(async () => {
    const q = await insert("inquiries", { kind: "correction", body: "기사 수치가 틀렸습니다" });
    assert.equal(q.status, "received");
    assert.equal((await attempt("update public.inquiries set status = 'done' where id = $1", [q.id], "service_role")).ok, false);
    assert.equal((await attempt("update public.inquiries set status = 'done', resolution = 'dismissed' where id = $1", [q.id])).ok, false, "사유 없음");
    assert.equal((await attempt("update public.inquiries set status = 'done', resolution = 'ignored', resolution_reason = 'x' where id = $1", [q.id])).ok, false, "결과 값 밖");
    assert.ok((await attempt("update public.inquiries set status = 'done', resolution = 'correction_published', resolution_reason = '수치 정정' where id = $1", [q.id])).ok);
    const tip = await insert("inquiries", { kind: "tip", body: "제보" });
    assert.ok((await attempt("update public.inquiries set status = 'done' where id = $1", [tip.id])).ok, "다른 종류는 결과 없이 완료 가능");
    assert.equal((await tryInsert("inquiries", { kind: "expert_request", body: "x" })).ok, false, "전문가 연락 요청은 문의함 종류가 아니다 (HELP-01)");
  }));

test("정정·삭제·제목 변경은 이유와 전후 버전을 남긴다 — 이유·버전이 없거나 다른 기사의 버전이면 거부 (NAV-06)", () =>
  tx(async () => {
    const a = await article();
    const other = await article();
    const rev = (articleId, v) =>
      insert("article_revisions", { article_id: articleId, version: v, title: "t", body: "[]", edited_by: "user:기자", reason: v > 1 ? "정정" : null, update_kind: v > 1 ? "correction" : null });
    const r1 = await rev(a.id, 1);
    const r2 = await rev(a.id, 2);
    const o1 = await rev(other.id, 1);
    const row = (over) => ({ article_id: a.id, kind: "correction", before_revision_id: r1.id, after_revision_id: r2.id, reason: "수치 오류", decided_by: "user:편집자", ...over });
    assert.ok((await tryInsert("article_corrections", row())).ok);
    for (const reason of [null, "", "  "]) assert.equal((await tryInsert("article_corrections", row({ reason }))).ok, false, JSON.stringify(reason));
    for (const kind of ["correction", "title_change"]) {
      assert.equal((await tryInsert("article_corrections", row({ kind, after_revision_id: null }))).ok, false, `${kind} 후 버전 없음`);
      assert.equal((await tryInsert("article_corrections", row({ kind, before_revision_id: null }))).ok, false, `${kind} 전 버전 없음`);
    }
    assert.equal((await tryInsert("article_corrections", row({ kind: "deletion", before_revision_id: null, after_revision_id: null }))).ok, false, "삭제 전 버전 없음");
    assert.ok((await tryInsert("article_corrections", row({ kind: "deletion", after_revision_id: null }))).ok);
    assert.ok((await tryInsert("article_corrections", row({ kind: "rebuttal", before_revision_id: null, after_revision_id: null }))).ok, "반론은 버전 없이");
    assert.equal((await tryInsert("article_corrections", row({ before_revision_id: o1.id }))).ok, false, "다른 기사의 버전");
  }));

test("개정 브리핑 기사는 개정 트래커를 가리키고, 기사에 단계 값을 따로 저장하는 칸이 없다 (CAT-04)", () =>
  tx(async () => {
    const am = await insert("amendments", { slug: uniq("am"), title: "2026년 지방세제 개편안" });
    assert.ok((await tryInsert("articles", base({ amendment_id: am.id }))).ok);
    assert.equal((await tryInsert("articles", base({ amendment_id: -1 }))).ok, false);
    const { rows } = await client.query(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'articles' and column_name ~ 'stage'",
    );
    assert.deepEqual(rows, []);
  }));

test("행사·분양 정보를 기사로 저장하는 칸이 없다 (CAT-01 — 정보 목록은 별도 표)", async () => {
  const all = await client.query("select count(*)::int n from information_schema.columns where table_schema = 'public' and table_name = 'articles'");
  assert.ok(all.rows[0].n > 30, "articles 표가 없다");
  const { rows } = await client.query(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'articles' and column_name ~ '(event|venue|supply|start_at|end_at)'",
  );
  assert.deepEqual(rows, []);
});
