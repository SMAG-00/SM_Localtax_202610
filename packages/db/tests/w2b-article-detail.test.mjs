// W2-b 4단계 DB — 칼럼 연재 회차(ART-04)와 삭제된 기사 주소(NAV-06 410) — docs/dev/W2-b_설계.md 3장·4장.
//  · series_title·series_episode: 칼럼(opinion)만, 둘 다 있거나 둘 다 없다, 회차 1 이상, 같은 분야·같은 연재의 같은 회차는 하나(삭제 기사 제외)
//  · article_tombstones: 공개됐던 기사가 삭제되면 트리거가 주소 한 줄을 남긴다(추가만). 발행된 적 없는 기사는 남기지 않는다.
//    anon·authenticated는 주소·삭제 시각만 읽고 쓰지 못한다
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
const tryInsert = (table, cols, role) => {
  const { sql, params } = insertSql(table, cols);
  return attempt(sql, params, role);
};
async function insert(table, cols) {
  const { sql, params } = insertSql(table, cols);
  return (await client.query(sql, params)).rows[0];
}
const column = (over = {}) => ({ slug: uniq("col"), title: "칼럼", section: "tax", content_type: "opinion", ...over });

// ── 칼럼 연재 회차 (ART-04) ─────────────────────────────────

test("연재 칸은 이름·회차가 함께 있거나 함께 없다 — 한쪽만은 거부, 단독 칼럼(둘 다 없음)은 저장된다", () =>
  tx(async () => {
    assert.ok((await tryInsert("articles", column({ series_title: "지방세 이야기", series_episode: 1 }))).ok, "둘 다");
    assert.ok((await tryInsert("articles", column())).ok, "둘 다 없음 — 단독 칼럼");
    const titleOnly = await tryInsert("articles", column({ series_title: "지방세 이야기" }));
    assert.equal(titleOnly.ok, false);
    assert.match(titleOnly.message, /articles_series_pair/);
    const episodeOnly = await tryInsert("articles", column({ series_episode: 2 }));
    assert.equal(episodeOnly.ok, false);
    assert.match(episodeOnly.message, /articles_series_pair/);
  }));

test("회차는 1 이상 — 0·음수 거부, 1 통과 / 연재 이름은 빈 글자·101자 거부, 100자 통과", () =>
  tx(async () => {
    for (const ep of [0, -1]) {
      const r = await tryInsert("articles", column({ series_title: "연재", series_episode: ep }));
      assert.equal(r.ok, false, `회차 ${ep}`);
      assert.match(r.message, /articles_series_episode_min/);
    }
    assert.ok((await tryInsert("articles", column({ series_title: "연재 하나", series_episode: 1 }))).ok);
    const blank = await tryInsert("articles", column({ series_title: "   ", series_episode: 3 }));
    assert.equal(blank.ok, false);
    assert.match(blank.message, /articles_series_title_text/);
    assert.equal((await tryInsert("articles", column({ series_title: "가".repeat(101), series_episode: 1 }))).ok, false, "101자");
    assert.ok((await tryInsert("articles", column({ series_title: "가".repeat(100), series_episode: 1 }))).ok, "100자");
  }));

test("연재 칸은 칼럼(opinion)만 — 해설·보도·광고에 연재를 달면 거부", () =>
  tx(async () => {
    const partner = await insert("partners", { name: uniq("제휴사"), kind: "institution" });
    for (const over of [
      { content_type: "explainer" },
      { content_type: "reported_news", reporting_method: "qualitative" },
      { content_type: "sponsored", label: "co_planned", partner_id: partner.id },
    ]) {
      const r = await tryInsert("articles", column({ ...over, series_title: "연재", series_episode: 1 }));
      assert.equal(r.ok, false, over.content_type);
      assert.match(r.message, /articles_series_opinion_only/);
    }
  }));

test("같은 분야·같은 연재의 같은 회차는 하나 — 다른 분야·다른 연재는 허용, 삭제된 회차는 세지 않는다", () =>
  tx(async () => {
    const first = await insert("articles", column({ series_title: "그때와 지금", series_episode: 1 }));
    const dup = await tryInsert("articles", column({ series_title: "그때와 지금", series_episode: 1 }));
    assert.equal(dup.ok, false);
    assert.equal(dup.code, "23505");
    assert.ok((await tryInsert("articles", column({ series_title: "그때와 지금", series_episode: 2 }))).ok, "다음 회차");
    assert.ok((await tryInsert("articles", column({ section: "finance", series_title: "그때와 지금", series_episode: 1 }))).ok, "다른 분야");
    assert.ok((await tryInsert("articles", column({ series_title: "다른 연재", series_episode: 1 }))).ok, "다른 연재");
    await client.query("update public.articles set status = 'deleted' where id = $1", [first.id]);
    assert.ok((await tryInsert("articles", column({ series_title: "그때와 지금", series_episode: 1 }))).ok, "삭제된 1회 자리에 새 1회");
  }));

for (const role of ["anon", "authenticated"]) {
  test(`${role} — 발행 칼럼의 연재 이름·회차를 공개 뷰와 표에서 읽는다, 초안 칼럼은 0행`, () =>
    tx(async () => {
      const pub = await insert("articles", column({ status: "published", series_title: "시험용 지방세 연재", series_episode: 3 }));
      const draft = await insert("articles", column({ status: "draft", series_title: "시험용 지방세 연재", series_episode: 4 }));
      const v = await attempt("select id, series_title, series_episode from public.public_articles where id in ($1, $2)", [pub.id, draft.id], role);
      assert.ok(v.ok, v.message);
      assert.deepEqual(v.rows.map((r) => [Number(r.id), r.series_title, r.series_episode]), [[Number(pub.id), "시험용 지방세 연재", 3]]);
      const t = await attempt("select series_title, series_episode from public.articles where id = $1", [pub.id], role);
      assert.ok(t.ok, t.message);
      assert.deepEqual(t.rows, [{ series_title: "시험용 지방세 연재", series_episode: 3 }]);
    }));
}

// ── 삭제된 기사 주소 (NAV-06 — 410) ─────────────────────────

const tombstonesOf = async (articleId) => (await client.query("select article_id, slug from public.article_tombstones where article_id = $1", [articleId])).rows;

test("공개된 기사를 삭제하면 주소 한 줄이 남는다 — 한 번만, 그 주소는 기사 slug", () =>
  tx(async () => {
    const a = await insert("articles", column({ status: "published" }));
    assert.deepEqual(await tombstonesOf(a.id), [], "공개 중에는 0");
    await client.query("update public.articles set status = 'deleted' where id = $1", [a.id]);
    const rows = await tombstonesOf(a.id);
    assert.deepEqual(rows.map((r) => r.slug), [a.slug]);
    // 삭제 상태에서 다른 칸을 고쳐도(같은 deleted) 다시 남기지 않는다
    await client.query("update public.articles set updated_reason = '삭제 사유 보강', status = 'deleted' where id = $1", [a.id]);
    assert.equal((await tombstonesOf(a.id)).length, 1);
  }));

test("발행된 적 없는 기사(첫 발행일 없음)를 삭제하면 주소를 남기지 않는다 — 그 주소는 404", () =>
  tx(async () => {
    const draft = await insert("articles", column({ status: "draft" }));
    await client.query("update public.articles set status = 'deleted' where id = $1", [draft.id]);
    assert.deepEqual(await tombstonesOf(draft.id), []);
    // 이관 기사처럼 첫 발행일을 넣어 삭제 상태로 들어온 행은 남긴다
    const legacy = await insert("articles", column({ status: "deleted", first_published_at: "2024-03-02T00:00:00Z" }));
    assert.equal((await tombstonesOf(legacy.id)).length, 1);
  }));

test("주소 표는 추가만 — service_role도 고치기·지우기 거부", () =>
  tx(async () => {
    const a = await insert("articles", column({ status: "published" }));
    await client.query("update public.articles set status = 'deleted' where id = $1", [a.id]);
    const upd = await attempt("update public.article_tombstones set slug = 'moved' where article_id = $1", [a.id], "service_role");
    assert.equal(upd.ok, false);
    const del = await attempt("delete from public.article_tombstones where article_id = $1", [a.id], "service_role");
    assert.equal(del.ok, false);
    const own = await attempt("delete from public.article_tombstones where article_id = $1", [a.id]);
    assert.equal(own.ok, false, "소유자도 지우지 못한다");
  }));

for (const role of ["anon", "authenticated"]) {
  test(`${role} — 삭제된 기사의 주소·삭제 시각만 읽는다 (기사 번호·본문 0), 쓰기 0, 삭제된 기사 자체는 0행`, () =>
    tx(async () => {
      const a = await insert("articles", column({ status: "published", title: "삭제될 칼럼" }));
      await client.query("update public.articles set status = 'deleted' where id = $1", [a.id]);
      const r = await attempt("select slug, removed_at from public.article_tombstones where slug = $1", [a.slug], role);
      assert.ok(r.ok, r.message);
      assert.equal(r.rows.length, 1);
      assert.ok(r.rows[0].removed_at instanceof Date);
      const idCol = await attempt("select article_id from public.article_tombstones limit 1", [], role);
      assert.equal(idCol.ok, false);
      assert.equal(idCol.code, "42501");
      const write = await attempt("insert into public.article_tombstones (article_id, slug) values ($1, 'x')", [a.id], role);
      assert.equal(write.ok, false);
      const gone = await attempt("select id from public.public_articles where id = $1", [a.id], role);
      assert.deepEqual(gone.rows, [], "삭제된 기사의 칸은 읽히지 않는다");
    }));
}

test("삭제 기록 함수는 anon·authenticated가 직접 부를 수 없다", async () => {
  const { rows } = await client.query(
    "select has_function_privilege('anon', 'public.article_tombstone_record()', 'execute') a, has_function_privilege('authenticated', 'public.article_tombstone_record()', 'execute') b",
  );
  assert.deepEqual(rows[0], { a: false, b: false });
});
