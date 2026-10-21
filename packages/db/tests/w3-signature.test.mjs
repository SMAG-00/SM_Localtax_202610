// W3 8단계 DB — 시그니처 칼럼 틀·'50년' 표기 막기·「그때와 지금」·편집 독립 (docs/dev/W3_설계.md 1장 8단계 · 2.6 · PRD-01C BR-01·04·08)
//  · brand_claim_token = 설계 2.6 표(막는 표기 전부 true, 막지 않는 표기 전부 false) — 공개 뷰 안의 같은 식도 같은 답
//  · 연재 제목: 승인 전 연수 표기 거부, 승인 뒤 저장 → 공개 뷰는 brand_copy + 근거 약력 줄(인물 페이지)이 있을 때만 제목, 근거를 거두면 null
//  · 회차 글·연재 이름 칸·비교 항목: 승인과 상관없이 연수 표기 거부 / 비교 항목은 출처·기준연도 필수 / 그때와 지금은 항목 1개 이상이어야 발행
//  · 칼럼 필자 계정 = 발행 기록 계정이면 발행 거부, 편집 승인(desk_edit)도 필자 본인 거부 / 표는 service_role만, 공개 뷰만 anon
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const DESIGN = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/dev/W3_설계.md"), "utf8");
const row = (marker) => {
  const line = DESIGN.split("\n").find((l) => l.startsWith(`| ${marker} `));
  assert.ok(line, `설계 문서에 '${marker}' 줄이 없다`);
  return [...line.split("|")[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
};
// 퍼센트 인코딩 풀기는 웹 검사만 한다 (설계 2.6) — DB는 저장된 글자를 본다
const BLOCKED = row("막는 표기").filter((t) => !t.includes("%"));
const ALLOWED = row("막지 않는 표기");

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
const body = (text = "시험용 가짜 본문입니다.") => JSON.stringify({ blocks: [{ type: "paragraph", text }], claims: [] });

const authUser = async () => (await client.query("insert into auth.users (id) values (gen_random_uuid()) returning id")).rows[0].id;
async function person({ user = null, consent = ["profile_page", "column", "home"], bio = [] } = {}) {
  const id = Number((await one("insert into public.people (slug, name, roles, visibility, staff_user_id) values ($1, '시험용 필자', array['writer'], 'public', $2) returning id", [uniq("sig-p"), user])).id);
  if (consent) await client.query("insert into public.name_likeness_consents (person_id, version, scope, doc_ref, recorded_by, valid_from) values ($1, $2, $3, '시험용 동의서 위치', 'admin:test', now() - interval '1 hour')", [id, uniq("v"), consent]);
  if (bio.length) await client.query("update public.people set bio_items = $2 where id = $1", [id, JSON.stringify(bio)]);
  return id;
}
const evidence = async (personId) =>
  Number((await one("insert into public.people_evidence (person_id, kind, doc_ref, recorded_by, approved, verified_by, verified_at) values ($1, 'document', '시험용 증빙 위치', 'admin:test', true, 'admin:test', now()) returning id", [personId])).id);
async function article({ title = "시험용 칼럼", summary = "시험용 요약", slug = uniq("sig-a"), contentType = "opinion", status = "draft", authorId = null, text } = {}) {
  return Number(
    (await one("insert into public.articles (slug, title, summary, section, content_type, status, author_id, body) values ($1, $2, $3, 'tax', $4, $5, $6, $7) returning id", [slug, title, summary, contentType, status, authorId, body(text)])).id,
  );
}
const episode = (articleId, seriesKey = "signature", n = 1) =>
  attempt("insert into public.signature_episodes (article_id, series_key, episode, assigned_by) values ($1, $2, $3, 'admin:test')", [articleId, seriesKey, n]);
const item = (articleId, over = {}) =>
  attempt("insert into public.then_now_items (article_id, position, then_text, now_text, source, base_year) values ($1, $2, $3, '시험용 현재 제도', $4, $5)", [
    articleId,
    over.position ?? 1,
    over.thenText ?? "시험용 과거 제도",
    over.source === undefined ? "시험용 출처" : over.source,
    over.baseYear === undefined ? 1995 : over.baseYear,
  ]);
const publish = (id) => attempt("update public.articles set status = 'published', first_published_at = now() where id = $1", [id]);
const setTitle = (key, title) => attempt("update public.settings set value = to_jsonb($2::text) where key = $1", [key, title]);
const seriesRow = async (key = "signature") => one("select * from public.public_signature_series where series_key = $1", [key]);

/** 경력 표시 승인까지 — 근거 증빙(승인)·약력 줄·동의서(profile_page)가 있는 인물 */
async function approveClaim() {
  const p = await person();
  const ev = await evidence(p);
  await client.query("update public.people set bio_items = $2 where id = $1", [p, JSON.stringify([{ item: "시험용 약력", evidence_id: String(ev) }])]);
  await client.query("update public.settings set value = $1 where key = 'career_claim_approved'", [JSON.stringify({ approved: true, basis_evidence_id: ev, approved_by: "admin:test", approved_at: new Date().toISOString() })]);
  return { personId: p, evidenceId: ev, slug: (await one("select slug from public.people where id = $1", [p])).slug };
}
async function brandCopyOn() {
  await client.query("update public.settings set value = $1 where key = 'brand_copy_review'", [JSON.stringify({ reviewed: true, record_id: "시험용 감수 기록" })]);
  await client.query("update public.settings set value = value || '{\"brand_copy\": true}'::jsonb where key = 'feature_flags'");
}

// ── 표기 검사 ─────────────────────────────────────────────────

test("brand_claim_token — 설계 2.6 표의 막는 표기 전부 true, 막지 않는 표기 전부 false (문장 안에서도)", async () => {
  assert.ok(BLOCKED.length >= 20 && ALLOWED.length >= 10, "표가 비어 있지 않다");
  for (const t of BLOCKED) {
    assert.equal((await one("select public.brand_claim_token($1) v", [t])).v, true, `막아야 한다: ${t}`);
    assert.equal((await one("select public.brand_claim_token($1) v", [`시험용 지방세 ${t} 칼럼`])).v, true, `문장 안: ${t}`);
  }
  for (const t of ALLOWED) assert.equal((await one("select public.brand_claim_token($1) v", [`시험용 ${t} 기준`])).v, false, `막지 않는다: ${t}`);
  assert.equal((await one("select public.brand_claim_token($1) v", ["5​0년"])).v, true, "폭 없는 공백");
  assert.equal((await one("select public.brand_claim_token(null) v")).v, false);
});

test("공개 뷰 안의 표기 식 = brand_claim_token (연재 제목 자리에서 같은 표 전부)", () =>
  tx(async () => {
    await client.query("set local session_replication_role = replica"); // 설정 검사 트리거를 끄고 제목만 바꿔 본다
    for (const t of [...BLOCKED, ...ALLOWED]) {
      await client.query("update public.settings set value = to_jsonb($1::text) where key = 'series_title_signature'", [`시험용 ${t}`]);
      const r = await seriesRow();
      const expected = (await one("select public.brand_claim_token($1) v", [`시험용 ${t}`])).v;
      assert.equal(r.title === null, expected, `뷰와 함수가 다르다: ${t}`);
    }
  }));

// ── 연재 제목 ─────────────────────────────────────────────────

test("연재 제목 씨앗 — 중립 가제('50년' 0), 발행 주기 빈 값, 공개 뷰 연재 2개·회차 0", async () => {
  const rows = (await client.query("select key, value from public.settings where key in ('series_title_signature', 'series_title_then_now', 'column_cadence') order by key")).rows;
  assert.equal(rows.length, 3);
  for (const r of rows) assert.equal((await one("select public.brand_claim_token($1) v", [r.value])).v, false, `${r.key} 씨앗에 연수 표기`);
  assert.equal(rows.find((r) => r.key === "column_cadence").value, "");
  const v = (await client.query("select series_key, cadence from public.public_signature_series order by ord")).rows;
  assert.deepEqual(v.map((r) => r.series_key), ["signature", "then_now"]);
  assert.ok(v.every((r) => r.cadence === null));
});

test("연재 제목 — 승인 전 '50년'·'50 년'·'오십 년' 거부, 중립 제목·빈 값·글자 아님·101자 규칙", () =>
  tx(async () => {
    for (const t of ["시험용 지방세 50년", "시험용 지방세 50 년", "시험용 지방세 오십 년"]) {
      const r = await setTitle("series_title_signature", t);
      assert.equal(r.code, "23514", t);
      assert.match(r.message, /career_claim_approved/);
    }
    assert.ok((await setTitle("series_title_then_now", "시험용 그때와 지금")).ok);
    assert.equal((await setTitle("series_title_signature", "  ")).code, "23514", "빈 제목");
    assert.equal((await setTitle("series_title_signature", "가".repeat(101))).code, "23514", "101자");
    assert.equal((await attempt("update public.settings set value = '1'::jsonb where key = 'series_title_signature'")).code, "23514", "글자 아님");
    assert.equal((await attempt("update public.settings set value = to_jsonb($1::text) where key = 'column_cadence'", ["가".repeat(101)])).code, "23514", "주기 101자");
    assert.ok((await attempt("update public.settings set value = to_jsonb('시험용 주기'::text) where key = 'column_cadence'")).ok);
    assert.equal((await seriesRow()).cadence, "시험용 주기");
  }));

test("연재 제목 — 승인 뒤 저장, 공개 뷰는 brand_copy + 근거 약력 줄이 있을 때만 제목·근거 재료, 근거 증빙을 거두면 null", () =>
  tx(async () => {
    const { evidenceId, slug, personId } = await approveClaim();
    assert.ok((await setTitle("series_title_signature", "시험용 지방세 50년")).ok, "승인 뒤 저장");
    let r = await seriesRow();
    assert.equal(r.title, null, "brand_copy 꺼짐 → 공개 제목 null");
    assert.equal(r.claim_shown, false);
    await brandCopyOn();
    r = await seriesRow();
    assert.equal(r.title, "시험용 지방세 50년");
    assert.equal(r.claim_shown, true);
    assert.equal(r.basis_person_slug, slug);
    assert.equal(Number(r.basis_evidence_id), evidenceId);
    // anon도 같은 뷰를 읽는다
    const anon = await attempt("select title, basis_person_slug from public.public_signature_series where series_key = 'signature'", [], "anon");
    assert.ok(anon.ok, anon.message);
    assert.deepEqual(anon.rows, [{ title: "시험용 지방세 50년", basis_person_slug: slug }]);
    // 근거 약력 줄이 없으면 null
    await client.query("update public.people set bio_items = '[]' where id = $1", [personId]);
    assert.equal((await seriesRow()).title, null, "근거 증빙이 약력 줄이 아니면 null");
    await client.query("update public.people set bio_items = $2 where id = $1", [personId, JSON.stringify([{ item: "시험용 약력", evidence_id: String(evidenceId) }])]);
    assert.equal((await seriesRow()).title, "시험용 지방세 50년");
    // 근거 증빙 승인을 거두면(설정은 남아도) 다음 읽기부터 null
    await client.query("update public.people_evidence set approved = false where id = $1", [evidenceId]);
    r = await seriesRow();
    assert.equal(r.title, null);
    assert.equal(r.basis_person_slug, null);
    // 연수 표기 없는 제목은 승인과 상관없이 그대로
    assert.equal((await seriesRow("then_now")).title, "그때와 지금");
  }));

// ── 회차·연재 이름 칸 ─────────────────────────────────────────

test("회차 지정 — 칼럼만, 기사 연재 이름 칸은 비움, 회차 글에 연수 표기 0(승인 뒤에도), 같은 연재 같은 회차 거부", () =>
  tx(async () => {
    const news = await article({ contentType: "explainer" });
    assert.equal((await episode(news)).code, "23514", "칼럼 아님");
    const series = await one("insert into public.articles (slug, title, section, content_type, series_title, series_episode) values ($1, '시험용', 'tax', 'opinion', '시험용 연재', 1) returning id", [uniq("sig-s")]);
    assert.equal((await episode(Number(series.id))).code, "23514", "기사 연재 이름 칸이 차 있음");
    for (const over of [{ title: "시험용 오십 년 칼럼" }, { summary: "시험용 50 년 요약" }, { slug: uniq("jibangse-50nyeon") }, { text: "시험용 반세기 이야기" }]) {
      const r = await episode(await article(over), "signature", 90 + seq);
      assert.equal(r.code, "23514", JSON.stringify(over));
      assert.match(r.message, /경력 연수 표기/);
    }
    await approveClaim();
    assert.equal((await episode(await article({ title: "시험용 50년 칼럼" }), "signature", 80)).code, "23514", "승인 뒤에도 회차 글은 거부");
    const a = await article();
    assert.ok((await episode(a, "signature", 1)).ok);
    assert.equal((await episode(await article(), "signature", 1)).code, "23505", "같은 연재 같은 회차");
    assert.ok((await episode(await article(), "then_now", 1)).ok, "다른 연재 1회");
    // 지정 뒤 기사를 고쳐 연수 표기를 넣거나 연재 이름 칸을 채우거나 유형을 바꾸면 거부
    assert.equal((await attempt("update public.articles set title = '시험용 오십여 년' where id = $1", [a])).code, "23514");
    assert.equal((await attempt("update public.articles set body = $2 where id = $1", [a, body("시험용 50년간")])).code, "23514");
    assert.equal((await attempt("update public.articles set series_title = '시험용', series_episode = 1 where id = $1", [a])).code, "23514");
    assert.equal((await attempt("update public.articles set content_type = 'explainer' where id = $1", [a])).code, "23514");
    assert.ok((await attempt("update public.articles set title = '시험용 1975년과 지금' where id = $1", [a])).ok, "연도는 쓸 수 있다");
  }));

test("기사 연재 이름 칸 — 어떤 기사든 연수 표기 거부(넣을 때·바꿀 때), 이미 있는 값은 다른 칸 수정에 걸리지 않는다", () =>
  tx(async () => {
    const ins = "insert into public.articles (slug, title, section, content_type, series_title, series_episode) values ($1, '시험용', 'tax', 'opinion', $2, 1)";
    assert.equal((await attempt(ins, [uniq("sig-f"), "지방세 50년"])).code, "23514");
    assert.equal((await attempt(ins, [uniq("sig-f"), "지방세 반세기"])).code, "23514");
    assert.ok((await attempt(ins, [uniq("sig-f"), "시험용 1950년대 이야기"])).ok);
    const a = await one("insert into public.articles (slug, title, section, content_type, series_title, series_episode) values ($1, '시험용', 'tax', 'opinion', '시험용 연재', 2) returning id", [uniq("sig-f")]);
    assert.equal((await attempt("update public.articles set series_title = '시험용 50 년' where id = $1", [a.id])).code, "23514");
    // 8단계 전에 들어간 값(트리거를 끄고 넣어 흉내)은 다른 칸을 고쳐도 그대로 둔다
    await client.query("set local session_replication_role = replica");
    await client.query("update public.articles set series_title = '시험용 50년 옛 값' where id = $1", [a.id]);
    await client.query("set local session_replication_role = origin");
    assert.ok((await attempt("update public.articles set summary = '시험용 요약' where id = $1", [a.id])).ok);
  }));

// ── 「그때와 지금」 ───────────────────────────────────────────

test("비교 항목 — 출처·기준연도 필수(제약), 그때와 지금 회차에만, 올해 뒤 기준연도·연수 표기 거부", () =>
  tx(async () => {
    const sig = await article();
    await episode(sig, "signature", 3);
    assert.equal((await item(sig)).code, "23514", "시그니처 칼럼 회차에는 비교 항목 없음");
    const tn = await article();
    await episode(tn, "then_now", 3);
    assert.equal((await item(tn, { source: null })).code, "23502", "출처 없음");
    assert.equal((await item(tn, { source: "  " })).code, "23514", "출처 빈 글자");
    assert.equal((await item(tn, { baseYear: null })).code, "23502", "기준연도 없음");
    assert.equal((await item(tn, { baseYear: 1899 })).code, "23514", "1899");
    const nextYear = Number((await one("select extract(year from now() at time zone 'Asia/Seoul')::int + 1 y")).y);
    assert.equal((await item(tn, { baseYear: nextYear })).code, "23514", "올해 뒤");
    assert.equal((await item(tn, { thenText: "시험용 50년 전 제도" })).code, "23514", "연수 표기");
    assert.ok((await item(tn, { baseYear: nextYear - 1 })).ok, "올해");
    assert.equal((await item(tn)).code, "23505", "같은 자리 두 번");
  }));

test("그때와 지금 발행 — 항목 0이면 거부, 1개면 발행, 발행 뒤 마지막 항목 삭제 거부, 한 벌 바꾸기는 한 번에, 공개 뷰는 공개 기사만", () =>
  tx(async () => {
    const tn = await article();
    await episode(tn, "then_now", 4);
    const r = await publish(tn);
    assert.equal(r.code, "23514");
    assert.match(r.message, /비교 항목/);
    assert.equal((await one("select count(*)::int n from public.public_then_now_items where article_id = $1", [tn])).n, 0, "초안 기사의 항목은 공개 0");
    assert.ok((await item(tn)).ok);
    assert.ok((await publish(tn)).ok);
    assert.equal((await one("select count(*)::int n from public.public_then_now_items where article_id = $1", [tn])).n, 1);
    assert.equal((await attempt("delete from public.then_now_items where article_id = $1", [tn])).code, "23514", "마지막 항목");
    const two = JSON.stringify([
      { then_text: "시험용 과거 1", now_text: "시험용 현재 1", source: "시험용 출처 1", base_year: 1990 },
      { label: "시험용 항목", then_text: "시험용 과거 2", now_text: "시험용 현재 2", source: "시험용 출처 2", source_url: "https://example.test/s", base_year: 2001 },
    ]);
    assert.equal(Number((await one("select public.then_now_replace($1, $2::jsonb) n", [tn, two])).n), 2);
    assert.deepEqual((await client.query("select position, source, base_year from public.public_then_now_items where article_id = $1 order by position", [tn])).rows, [
      { position: 1, source: "시험용 출처 1", base_year: 1990 },
      { position: 2, source: "시험용 출처 2", base_year: 2001 },
    ]);
    const bad = await attempt("select public.then_now_replace($1, $2::jsonb)", [tn, JSON.stringify([{ then_text: "a", now_text: "b", source: "s" }])]);
    assert.equal(bad.code, "23502", "기준연도 없는 한 벌");
    assert.equal((await one("select count(*)::int n from public.then_now_items where article_id = $1", [tn])).n, 2, "실패하면 앞 항목 그대로");
    assert.equal((await attempt("select public.then_now_replace($1, '[]'::jsonb)", [tn])).code, "23514", "발행된 회차의 빈 한 벌");
    assert.equal((await attempt("delete from public.signature_episodes where article_id = $1", [tn])).code, "23514", "항목이 있으면 연재에서 못 뺌");
    // 기사째 지우면 회차·항목도 함께 (외래 키 cascade — 검사가 막지 않는다)
    assert.ok((await attempt("delete from public.articles where id = $1", [tn])).ok);
    assert.equal((await one("select count(*)::int n from public.then_now_items where article_id = $1", [tn])).n, 0);
  }));

// ── 편집 독립 (BR-08) ────────────────────────────────────────

test("칼럼 필자 = 발행 승인자 거부 — 발행 기록 계정이 필자 계정이면 거부, 다른 계정은 발행, 필자 본인의 편집 승인도 거부", () =>
  tx(async () => {
    const authorUser = await authUser();
    const otherUser = await authUser();
    const writer = await person({ user: authorUser });
    const other = await person({ user: otherUser });
    const col = await article({ authorId: writer });
    const by = (user) => JSON.stringify({ publish: { at: new Date().toISOString(), by: `user:${user}`, version: 1 } });
    const own = await attempt("update public.articles set status = 'published', first_published_at = now(), check_log = $2 where id = $1", [col, by(authorUser)]);
    assert.equal(own.code, "23514");
    assert.match(own.message, /BR-08/);
    const desk = await attempt("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision) values ($1, 'desk_edit', $2, 'approve')", [col, writer]);
    assert.equal(desk.code, "23514", "필자 본인의 편집 승인");
    assert.ok((await attempt("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision) values ($1, 'desk_edit', $2, 'approve')", [col, other])).ok);
    assert.ok((await attempt("update public.articles set status = 'published', first_published_at = now(), check_log = $2 where id = $1", [col, by(otherUser)])).ok, "다른 계정의 발행");
    // 보도기사는 이 규칙 밖 (작성자 ≠ 편집 승인자는 W2-a가 따로 막는다)
    const news = await article({ contentType: "explainer", authorId: writer });
    assert.ok((await attempt("update public.articles set status = 'published', first_published_at = now(), check_log = $2 where id = $1", [news, by(authorUser)])).ok);
  }));

// ── 권한 ─────────────────────────────────────────────────────

for (const role of ["anon", "authenticated"]) {
  test(`${role} — 회차·비교 항목 표 0, 표기 검사·한 벌 바꾸기·승인 판정 함수 실행 0, 공개 뷰만 읽는다`, () =>
    tx(async () => {
      for (const t of ["signature_episodes", "then_now_items"]) {
        const r = await attempt(`select * from public.${t} limit 1`, [], role);
        assert.ok(!r.ok || r.rows.length === 0, `${t}를 읽었다`);
      }
      for (const f of ["public.brand_claim_token('50년')", "public.brand_claim_open()", "public.then_now_replace(1, '[]'::jsonb)"]) {
        assert.equal((await attempt(`select ${f}`, [], role)).code, "42501", f);
      }
      for (const v of ["public_signature_series", "public_signature_episodes", "public_then_now_items"]) {
        assert.ok((await attempt(`select * from public.${v} limit 1`, [], role)).ok, v);
      }
      const ins = await attempt("insert into public.signature_episodes (article_id, series_key, episode, assigned_by) values (1, 'signature', 1, 'x')", [], role);
      assert.equal(ins.ok, false);
    }));
}

test("공개 회차 뷰 — 공개 기사만(초안 0), 칸은 기사 번호·연재·회차뿐", () =>
  tx(async () => {
    const writer = await person();
    const draft = await article({ authorId: writer });
    const pub = await article({ authorId: writer });
    await episode(draft, "signature", 7);
    await episode(pub, "signature", 8);
    assert.ok((await publish(pub)).ok, "동의서(column) 있는 필자의 칼럼 발행");
    const r = await attempt("select * from public.public_signature_episodes where article_id in ($1, $2)", [draft, pub], "anon");
    assert.ok(r.ok, r.message);
    assert.deepEqual(r.rows.map((x) => [Number(x.article_id), x.series_key, x.episode]), [[pub, "signature", 8]]);
    assert.deepEqual(Object.keys(r.rows[0]).sort(), ["article_id", "episode", "series_key"]);
    assert.equal((await seriesRow()).episodes, 1, "공개 회차 수");
  }));
