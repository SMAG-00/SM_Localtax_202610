// W2-b 공개 읽기 — docs/dev/W2-b_설계.md 4장. anon·authenticated는 공개 행·칸만 읽는다 (PostgREST anon 키 = anon 역할).
// 행정구역(전부) · 공개 상황 · 오늘 노출 중이고 대상이 공개인 홈 배치 · 용어사전 · 공개 기사의 태그 · 게재된 정정 · 실질 수정 기록 ·
// 공개 설정 키 · 편집 승인된 보도기사 표시 · 공개 기사의 본문 이미지. 숨긴 상황·끝난/시작 전 카드·초안 기사에 딸린 행·비공개 설정은 0행.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const DESIGN = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "dev", "W2-b_설계.md"), "utf8");
const PRD01A = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "PRD", "PRD-01A_1단계_기반_편집_유입.md"), "utf8");

/** 설계 문서 2.3 표의 한 줄 → 값 배열 */
function designList(name) {
  const line = DESIGN.split("\n").find((l) => l.startsWith(`| ${name} `));
  assert.ok(line, `설계 문서 2.3에 '${name}' 줄이 없다`);
  return [...line.split("|")[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

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
/** 한국 날짜 YYYY-MM-DD (오늘 + days) */
const kstDay = (days = 0) => new Date(Date.now() + 9 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);
const ids = (rows, key = "id") => rows.map((r) => Number(r[key])).sort((a, b) => a - b);
const sorted = (...xs) => xs.map(Number).sort((a, b) => a - b);

async function world(fn) {
  await client.query("begin");
  try {
    await client.query("delete from public.home_curations"); // 다른 시험이 남긴 배치와 섞이지 않게 (되돌린다)
    const reporter = await insert("people", { slug: uniq("p"), name: "공개 기자", roles: ["reporter"], visibility: "public" });
    const editor = await insert("people", { slug: uniq("p"), name: "편집자", roles: ["editor"] });
    const reviewer = await insert("people", { slug: uniq("p"), name: "감수위원", roles: ["reviewer"] });
    const photo = (path, confirmed = true) =>
      insert("media", confirmed ? { path, kind: "photo", rights_status: "confirmed", credit: "시험일보", photographer: "홍길동", license: "자체 촬영", license_type: "not_applicable", checked_at: new Date() } : { path, kind: "photo" });
    const bodyImage = await photo("body.jpg");
    const draftImage = await photo("draft-body.jpg");
    const unconfirmedImage = await photo("u-body.jpg", false);
    const body = (...media) => JSON.stringify({ blocks: [{ type: "paragraph", text: "본문" }, ...media.map((m) => ({ type: "image", mediaId: String(m.id), alt: "사진", caption: "" }))], claims: [] });
    const art = (over) => insert("articles", { slug: uniq("a"), title: "기사", section: "realestate", content_type: "explainer", author_id: reporter.id, ...over });
    const category = (await client.query("select id from public.categories where section = 'realestate' and slug = 'projects'")).rows[0];
    const pub = await art({ status: "published", body: body(bodyImage, unconfirmedImage), category_id: category.id });
    const draft = await art({ status: "draft", body: body(draftImage), category_id: category.id });
    const reportedApproved = await art({ status: "published", content_type: "reported_news", reporting_method: "qualitative" });
    await insert("editorial_reviews", { article_id: reportedApproved.id, kind: "desk_edit", reviewer_id: editor.id, decision: "approve" });
    const reportedPending = await art({ status: "published", content_type: "reported_news", reporting_method: "qualitative" });

    const checks = JSON.stringify([{ title: "1" }, { title: "2" }, { title: "3" }]);
    const sitVisible = await insert("situations", { slug: uniq("s"), section: "tax", title: "차를 팔았어요", pictogram: "car-sold", checks, reviewer_id: reviewer.id, reviewed_at: new Date(), visible: true, updated_by: "user:편집자" });
    const sitHidden = await insert("situations", { slug: uniq("s"), section: "tax", title: "고지서를 받았어요", pictogram: "notice-received", checks });

    const snap = await insert("raw_snapshots", { source: "mois", url: "https://www.mois.go.kr/a", content_hash: "h", payload: "원문" });
    const amPublic = await insert("amendments", { slug: uniq("am"), title: "공개 개정안", status: "public" });
    const amDraft = await insert("amendments", { slug: uniq("am"), title: "준비 중 개정안" });
    for (const m of [amPublic, amDraft]) {
      await insert("amendment_events", { amendment_id: m.id, stage: "announced", occurred_on: "2026-08-26", source_url: "https://www.mois.go.kr/a", snapshot_id: snap.id, recorded_by: "user:편집자" });
    }
    const card = (over) => insert("home_curations", { created_by: "user:편집자", ...over });
    const storyActive = await card({ kind: "story", article_id: pub.id, starts_on: kstDay(0), ends_on: kstDay(0) });
    const storyExpired = await card({ kind: "story", article_id: reportedApproved.id, starts_on: kstDay(-10), ends_on: kstDay(-1) });
    const storyFuture = await card({ kind: "story", article_id: reportedPending.id, starts_on: kstDay(1), ends_on: null });
    const storyDraft = await card({ kind: "story", article_id: draft.id, starts_on: kstDay(-1), ends_on: null });
    const trackerPublic = await card({ kind: "tracker", amendment_id: amPublic.id, starts_on: kstDay(-3), ends_on: null });
    const trackerDraft = await card({ kind: "tracker", amendment_id: amDraft.id, starts_on: kstDay(-3), ends_on: null });

    // 공개 용어 (W2-d 3단계 — 숨긴 용어 0행은 w2d-glossary 시험이 본다)
    const term = await insert("glossary_terms", { term: uniq("과세표준"), plain: "세금을 매기는 기준 금액", jargon: true, visible: true });
    const tagPub = await insert("tags", { name: uniq("취득세"), slug: uniq("acq") });
    const tagDraft = await insert("tags", { name: uniq("초안 태그"), slug: uniq("draft") });
    await insert("article_tags", { article_id: pub.id, tag_id: tagPub.id });
    await insert("article_tags", { article_id: draft.id, tag_id: tagDraft.id });

    const corr = (article, published_at) =>
      insert("article_corrections", { article_id: article.id, kind: "follow_up", reason: "후속 취재 반영", reader_notice: "추후보도 — 결과를 더했습니다", decided_by: "user:편집자", published_at });
    const corrPublished = await corr(pub, new Date(Date.now() - 60_000));
    const corrUnpublished = await corr(pub, null);
    const corrScheduled = await corr(pub, new Date(Date.now() + 3600_000));
    const corrDraft = await corr(draft, new Date(Date.now() - 60_000));

    const rev = (article, version, update_kind) =>
      insert("article_revisions", { article_id: article.id, version, title: "옛 제목", body: "[]", edited_by: "user:기자", reason: update_kind ? "통계 최신화" : null, update_kind });
    const revSubstantive = await rev(pub, 2, "substantive");
    const revTypo = await rev(pub, 3, "typo");
    const revDraft = await rev(draft, 2, "substantive");

    return await fn({
      category, pub, draft, reportedApproved, reportedPending, bodyImage, draftImage, unconfirmedImage, sitVisible, sitHidden,
      storyActive, storyExpired, storyFuture, storyDraft, trackerPublic, trackerDraft, term, tagPub, tagDraft,
      corrPublished, corrUnpublished, corrScheduled, corrDraft, revSubstantive, revTypo, revDraft,
    });
  } finally {
    await client.query("rollback");
  }
}

for (const role of ["anon", "authenticated"]) {
  test(`${role} — 행정구역은 모든 행·칸을 읽는다 (공개 참조 자료)`, () =>
    world(async () => {
      const r = await attempt("select code, parent_code, level, name, slug, aliases, valid_from, valid_to from public.regions where level = 'sido'", [], role);
      assert.ok(r.ok, r.message);
      assert.equal(r.rows.length, 17);
    }));

  test(`${role} — 상황은 공개(visible)만, 감수자·수정자 칸은 비공개`, () =>
    world(async (w) => {
      const r = await attempt("select id, checks from public.situations where id in ($1, $2)", [w.sitVisible.id, w.sitHidden.id], role);
      assert.ok(r.ok, r.message);
      assert.deepEqual(ids(r.rows), [Number(w.sitVisible.id)]);
      assert.equal(r.rows[0].checks.length, 3);
      for (const col of ["reviewer_id", "updated_by"]) {
        const c = await attempt(`select ${col} from public.situations limit 1`, [], role);
        assert.equal(c.ok, false, col);
        assert.equal(c.code, "42501");
      }
    }));

  test(`${role} — 홈 배치는 오늘 노출 중이고 대상이 공개인 것만 (끝난·시작 전·초안 기사·비공개 개정안 카드 0)`, () =>
    world(async (w) => {
      const r = await attempt("select id, kind from public.home_curations", [], role);
      assert.ok(r.ok, r.message);
      assert.deepEqual(ids(r.rows), sorted(w.storyActive.id, w.trackerPublic.id));
      const c = await attempt("select created_by from public.home_curations", [], role);
      assert.equal(c.ok, false, "만든 사람 칸은 비공개");
    }));

  test(`${role} — 용어사전은 읽고 전문 용어 표시(jargon) 칸은 비공개`, () =>
    world(async (w) => {
      const r = await attempt("select id, term, plain, definition, related, section, source from public.glossary_terms where id = $1", [w.term.id], role);
      assert.ok(r.ok, r.message);
      assert.equal(r.rows.length, 1);
      assert.equal((await attempt("select jargon from public.glossary_terms limit 1", [], role)).ok, false);
    }));

  test(`${role} — 태그·태그 연결은 공개 기사의 것만 (초안 기사의 태그 0)`, () =>
    world(async (w) => {
      const t = await attempt("select id from public.tags where id in ($1, $2)", [w.tagPub.id, w.tagDraft.id], role);
      assert.deepEqual(ids(t.rows), [Number(w.tagPub.id)]);
      const at = await attempt("select article_id from public.article_tags where article_id in ($1, $2)", [w.pub.id, w.draft.id], role);
      assert.deepEqual(ids(at.rows, "article_id"), [Number(w.pub.id)]);
    }));

  test(`${role} — 정정은 게재 시각이 지난 공개 기사의 것만, 이유·독자 표시는 읽고 결정자·문의·전후 버전은 비공개`, () =>
    world(async (w) => {
      const r = await attempt(
        "select id, kind, reason, reader_notice, published_at from public.article_corrections where article_id in ($1, $2)",
        [w.pub.id, w.draft.id],
        role,
      );
      assert.ok(r.ok, r.message);
      assert.deepEqual(ids(r.rows), [Number(w.corrPublished.id)], "게재 전(null)·게재 예정·초안 기사 정정 0");
      assert.equal(r.rows[0].reader_notice, "추후보도 — 결과를 더했습니다");
      for (const col of ["decided_by", "inquiry_id", "before_revision_id", "after_revision_id"]) {
        assert.equal((await attempt(`select ${col} from public.article_corrections limit 1`, [], role)).ok, false, col);
      }
    }));

  test(`${role} — 수정 이력은 공개 기사의 실질 수정 날짜·사유만, 옛 제목·본문·편집자는 비공개`, () =>
    world(async (w) => {
      const r = await attempt("select id, version, edited_at, reason, update_kind from public.article_revisions where article_id in ($1, $2)", [w.pub.id, w.draft.id], role);
      assert.ok(r.ok, r.message);
      assert.deepEqual(ids(r.rows), [Number(w.revSubstantive.id)], "오탈자·초안 기사 기록 0");
      for (const col of ["title", "body", "edited_by"]) assert.equal((await attempt(`select ${col} from public.article_revisions limit 1`, [], role)).ok, false, col);
    }));

  test(`${role} — 설정은 공개 키만 (금지·공포 표현 사전·유사도 기준 0행), 설명·수정자 칸 비공개`, () =>
    world(async () => {
      const r = await attempt("select key from public.settings order by key", [], role);
      assert.ok(r.ok, r.message);
      // 뒤 단계가 키 한 줄씩 따로 연 공개 정책 — W2-e company_info(바닥글 회사 정보) · W4 4단계 local_block_fields(지자체 허브 블록 대응, W4 설계 2.2) ·
      // W4 10단계 search_topics(검색 주제 사전, W4 설계 2.2) · W4 11단계 pilot_regions(시범 지역 — /local 시·도 카드 표시, W4 설계 2.2. 임계값 region_index_threshold는 비공개)
      const later = (await attempt("select key from public.settings where key = any($1::text[])", [["company_info", "local_block_fields", "pilot_regions", "search_topics"]])).rows.map((x) => x.key);
      assert.deepEqual(r.rows.map((x) => x.key), [...designList("settings.public_keys"), ...later].sort());
      for (const key of ["forbidden_phrases", "fear_phrases", "similarity_internal"]) {
        const p = await attempt("select count(*)::int n from public.settings where key = $1", [key], role);
        assert.equal(p.rows[0].n, 0, key);
      }
      for (const col of ["description", "updated_by"]) assert.equal((await attempt(`select ${col} from public.settings limit 1`, [], role)).ok, false, col);
    }));

  test(`${role} — 편집 승인된 보도기사 표시(reported_approved)는 읽고, 승인 상태 칸 자체는 여전히 비공개`, () =>
    world(async (w) => {
      const r = await attempt("select id, reported_approved from public.public_articles where id in ($1, $2, $3)", [w.pub.id, w.reportedApproved.id, w.reportedPending.id], role);
      assert.ok(r.ok, r.message);
      const byId = Object.fromEntries(r.rows.map((x) => [Number(x.id), x.reported_approved]));
      assert.deepEqual(byId, { [w.pub.id]: false, [w.reportedApproved.id]: true, [w.reportedPending.id]: false });
      assert.equal((await attempt("select editorial_status from public.articles limit 1", [], role)).ok, false);
    }));

  test(`${role} — 본문 이미지는 공개 기사의 권리 확인 이미지만 (초안 기사 본문·권리 미확인 0)`, () =>
    world(async (w) => {
      const r = await attempt("select id from public.media where id in ($1, $2, $3)", [w.bodyImage.id, w.draftImage.id, w.unconfirmedImage.id], role);
      assert.ok(r.ok, r.message);
      assert.deepEqual(ids(r.rows), [Number(w.bodyImage.id)]);
    }));

  test(`${role} — 하위 분야 기사 수 뷰는 공개 목록 기사만 센다 (초안 0 · digest 0)`, () =>
    world(async (w) => {
      await insert("articles", { slug: uniq("a"), title: "금주 핫뉴스", section: "realestate", content_type: "digest", digest_id: 1, status: "published", category_id: w.category.id });
      const { rows: all } = await client.query("select count(*)::int n from public.articles where category_id = $1", [w.category.id]);
      const { rows: expected } = await client.query(
        `select count(*)::int n from public.articles where category_id = $1 and status = 'published' and lead_media_cleared and not is_paid
           and content_type is not null and content_type <> 'digest'`,
        [w.category.id],
      );
      assert.ok(expected[0].n >= 1 && expected[0].n <= all[0].n - 2, "초안·digest가 시험 세계에 있다");
      const r = await attempt("select article_count from public.public_category_article_counts where category_id = $1", [w.category.id], role);
      assert.ok(r.ok, r.message);
      assert.equal(r.rows[0].article_count, expected[0].n);
    }));

  test(`${role} — 새 표에 쓰지 못한다 (행정구역·상황·홈 배치·용어·설정)`, () =>
    world(async (w) => {
      for (const sql of [
        "insert into public.regions (code, level, name, slug) values ('9900000000', 'sido', 'x', 'anon-region')",
        `update public.situations set title = '바꿈' where id = ${w.sitVisible.id}`,
        `delete from public.home_curations where id = ${w.storyActive.id}`,
        "insert into public.home_curations (kind, article_id, starts_on, created_by) values ('story', 1, current_date, 'anon')",
        `update public.glossary_terms set plain = '바꿈' where id = ${w.term.id}`,
        "update public.settings set value = 'true'::jsonb where key = 'feature_flags'",
        `delete from public.article_tags where article_id = ${w.pub.id}`,
      ]) {
        assert.equal((await attempt(sql, [], role)).ok, false, sql);
      }
    }));
}

test("공개 설정 씨앗 — 핵심 메시지는 PRD 문구, 기능 키는 설계 2.3 목록 모두 false, 다음 행동 우선순위는 설계 순서, 허브 상한 4, 추천 검색어 0개", async () => {
  const { rows } = await client.query("select key, value from public.settings where key = any($1::text[])", [designList("settings.public_keys")]);
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  assert.equal(Object.keys(v).length, designList("settings.public_keys").length, "공개 키가 모두 씨앗에 있다");
  assert.ok(PRD01A.includes(`"${v.home_core_message}"`), `핵심 메시지가 PRD-01A 문구와 같다: ${v.home_core_message}`);
  assert.deepEqual(Object.keys(v.feature_flags).sort(), [...designList("feature_flags")].sort());
  assert.ok(Object.values(v.feature_flags).every((x) => x === false), "공개 승인 전 — 모두 닫힘");
  assert.deepEqual(v.next_action_priority, designList("next_action"));
  assert.equal(v.hub_situation_limit, 4);
  assert.deepEqual(v.home_search_chips, []);
  assert.deepEqual(v.hub_intros, {});
});

test("service_role(서버)은 숨긴 상황·끝난 배치·비공개 설정을 모두 읽는다", () =>
  world(async (w) => {
    const s = await attempt("select count(*)::int n from public.situations where id in ($1, $2)", [w.sitVisible.id, w.sitHidden.id], "service_role");
    assert.equal(s.rows[0].n, 2);
    const h = await attempt("select count(*)::int n from public.home_curations", [], "service_role");
    assert.equal(h.rows[0].n, 6);
    const p = await attempt("select count(*)::int n from public.settings where key = 'forbidden_phrases'", [], "service_role");
    assert.equal(p.rows[0].n, 1);
  }));
