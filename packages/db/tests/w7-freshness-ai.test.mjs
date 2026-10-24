// W7 4단계 DB — 신선도 검수 큐(OPT-07)·핵심 질문 50개·AI 인용 표본(OPT-09)  (마이그레이션 …73, docs/dev/W7_설계.md 2장)
//  · 개정 `공포`·`시행` 기록 → 그 개정을 단 공개 기사(법령 기준일 있는 것) n건에 검수 큐 n건, 같은 기록 중복 0, 정정 기록·건너뜀·다른 단계는 0
//  · 처리한 항목은 고칠 수 없고 지울 수 없다, 처리 결과 3종 밖·사유 없음 거부, 처리해도 기사 실질 수정일은 그대로
//  · 공개 뷰는 열린 항목의 공개 기사 번호만, anon은 큐 표 접근 0
//  · 핵심 질문 — 49·51문항은 활성화 거부, 정확히 50문항만 활성화, 활성화 뒤 문항 추가·수정·삭제 거부, 1~50 밖 번호 거부
//  · 인용 표본 — 월 시작일 아님 거부, 50 × 엔진 수만큼 `unknown` 행, 두 번 불러도 행 불변, 미확인은 확인자·시각 없이, 확인한 칸은 확인자·시각 필수, yes는 주소 필수, 같은 칸 중복 거부
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0).
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
    return { ok: true, rows: res.rows, rowCount: res.rowCount };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, message: err.message, code: err.code };
  }
}
async function tx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}
let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
const one = async (sql, params) => (await client.query(sql, params)).rows[0];

const amendment = async () => (await one("insert into public.amendments (slug, title) values ($1, '시험용 개정') returning id", [uniq("w7am")])).id;
const snapshot = async () => (await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('mois', 'https://www.mois.go.kr/a', 'h', '원문') returning id")).id;
const article = (over = {}) => {
  const row = { slug: uniq("w7fr"), title: "시험용 기사", section: "tax", content_type: "explainer", status: "published", first_published_at: new Date(), ...over };
  const keys = Object.keys(row);
  return one(`insert into public.articles (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id, substantive_updated_at`, keys.map((k) => row[k]));
};
async function stage(amendmentId, st, over = {}) {
  const cols = { amendment_id: amendmentId, stage: st, occurred_on: "2026-08-01", source_url: "https://www.mois.go.kr/a.do", snapshot_id: await snapshot(), recorded_by: "user:w7", ...over };
  const keys = Object.keys(cols);
  return attempt(`insert into public.amendment_events (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, keys.map((k) => cols[k]));
}
const queueOf = (eventId) => client.query("select * from public.freshness_review_queue where amendment_event_id = $1 order by article_id", [eventId]).then((r) => r.rows);

test("공포 기록 → 그 개정을 단 공개 기사(법령 기준일 있음) n건에 큐 n건, 다른 개정·기준일 없음·비공개·초안은 0", () =>
  tx(async () => {
    const am = await amendment();
    const other = await amendment();
    const a1 = await article({ amendment_id: am, legal_basis_date: "2026-08-01" });
    const a2 = await article({ amendment_id: am, legal_basis_date: "2026-08-02" });
    await article({ amendment_id: am });
    await article({ amendment_id: am, legal_basis_date: "2026-08-01", status: "draft", first_published_at: null });
    await article({ amendment_id: other, legal_basis_date: "2026-08-01" });
    const ev = await stage(am, "promulgated");
    assert.ok(ev.ok, ev.message);
    const rows = await queueOf(ev.rows[0].id);
    assert.deepEqual(rows.map((r) => Number(r.article_id)).sort(), [Number(a1.id), Number(a2.id)].sort());
    assert.ok(rows.every((r) => r.resolved_at === null && r.resolution === null));
  }));

test("시행 기록도 큐를 만들고, 입법예고·정정·건너뜀 기록은 만들지 않는다 — 같은 기록 중복 0", () =>
  tx(async () => {
    const am = await amendment();
    await article({ amendment_id: am, legal_basis_date: "2026-08-01" });
    const early = await stage(am, "pre_notice");
    assert.equal((await queueOf(early.rows[0].id)).length, 0);
    const eff = await stage(am, "effective");
    assert.equal((await queueOf(eff.rows[0].id)).length, 1);
    const fix = await stage(am, "effective", { correction_of: eff.rows[0].id, reason: "시험용 정정" });
    assert.ok(fix.ok, fix.message);
    assert.equal((await queueOf(fix.rows[0].id)).length, 0, "정정 기록은 큐 0");
    const skipped = await stage(am, "promulgated", { skipped: true, skip_reason: "시험용", occurred_on: null, source_url: null, snapshot_id: null });
    assert.ok(skipped.ok, skipped.message);
    assert.equal((await queueOf(skipped.rows[0].id)).length, 0, "건너뜀 기록은 큐 0");
    const dup = await attempt("insert into public.freshness_review_queue (amendment_event_id, article_id) select amendment_event_id, article_id from public.freshness_review_queue limit 1");
    assert.equal(dup.ok, false);
  }));

test("처리 — 결과 3종만, 처리자·사유 필수, 처리한 항목은 고치거나 지울 수 없고 기사 실질 수정일은 그대로", () =>
  tx(async () => {
    const am = await amendment();
    const a = await article({ amendment_id: am, legal_basis_date: "2026-08-01" });
    const ev = await stage(am, "promulgated");
    const [q] = await queueOf(ev.rows[0].id);
    const resolve = (resolution, by = "user:w7", note = "시험용 사유") =>
      attempt("update public.freshness_review_queue set resolved_at = now(), resolved_by = $2, resolution = $3, note = $4 where id = $1", [q.id, by, resolution, note]);
    assert.equal((await resolve("typo")).ok, false, "결과 3종 밖");
    assert.equal((await resolve("no_change", "user:w7", "  ")).ok, false, "사유 없음");
    assert.equal((await resolve("no_change", " ")).ok, false, "처리자 없음");
    assert.ok((await resolve("no_change")).ok);
    assert.equal((await resolve("substantive")).ok, false, "처리한 항목 고치기 거부");
    assert.equal((await attempt("delete from public.freshness_review_queue where id = $1", [q.id])).ok, false);
    const after = await one("select substantive_updated_at from public.articles where id = $1", [a.id]);
    assert.equal(after.substantive_updated_at, a.substantive_updated_at, "변경 없음 처리는 실질 수정일을 바꾸지 않는다");
  }));

test("공개 뷰 — 열린 항목의 공개 기사 번호만 (처리하면 사라짐), anon은 큐 표 접근 0", () =>
  tx(async () => {
    const am = await amendment();
    const a = await article({ amendment_id: am, legal_basis_date: "2026-08-01" });
    const ev = await stage(am, "promulgated");
    const view = () => attempt("select article_id from public.public_freshness_reviews where article_id = $1", [a.id], "anon");
    assert.equal((await view()).rows.length, 1);
    assert.equal((await attempt("select * from public.freshness_review_queue", [], "anon")).ok, false);
    const [q] = await queueOf(ev.rows[0].id);
    await client.query("update public.freshness_review_queue set resolved_at = now(), resolved_by = 'user:w7', resolution = 'no_change', note = '시험용' where id = $1", [q.id]);
    assert.equal((await view()).rows.length, 0);
  }));

// ── 핵심 질문 ─────────────────────────────────────────────

async function questionSet(count, version = 9000 + (seq += 1)) {
  await client.query("insert into public.ai_question_sets (version, created_by) values ($1, 'user:w7')", [version]);
  for (let i = 1; i <= count; i++) await client.query("insert into public.ai_core_questions (version, question_no, text) values ($1, $2, $3)", [version, i, `시험용 질문 ${i}`]);
  return version;
}
const activate = (v) => attempt("update public.ai_question_sets set activated_at = now() where version = $1", [v]);

test("핵심 질문 — 49·51문항 목록은 활성화 거부, 51번째 문항 번호 거부, 정확히 50문항만 활성화", () =>
  tx(async () => {
    const v49 = await questionSet(49);
    assert.match((await activate(v49)).message, /50문항/);
    const v50 = await questionSet(50);
    assert.equal((await attempt("insert into public.ai_core_questions (version, question_no, text) values ($1, 51, '넘침')", [v50])).ok, false, "번호 1~50 밖");
    assert.equal((await attempt("insert into public.ai_core_questions (version, question_no, text) values ($1, 50, '중복')", [v50])).ok, false, "같은 번호 중복");
    assert.ok((await activate(v50)).ok);
  }));

test("활성화된 목록은 문항 추가·수정·삭제와 지우기 모두 거부, 새 버전은 만들 수 있다", () =>
  tx(async () => {
    const v = await questionSet(50);
    await activate(v);
    assert.equal((await attempt("update public.ai_core_questions set text = '바꿈' where version = $1 and question_no = 1", [v])).ok, false);
    assert.equal((await attempt("delete from public.ai_core_questions where version = $1 and question_no = 2", [v])).ok, false);
    assert.equal((await attempt("delete from public.ai_question_sets where version = $1", [v])).ok, false);
    assert.equal((await attempt("update public.ai_question_sets set activated_at = null where version = $1", [v])).ok, false);
    assert.ok(await questionSet(3));
  }));

// ── 인용 표본 ─────────────────────────────────────────────

test("표본 만들기 — 50 × 엔진 수 행이 `unknown`으로, 두 번 불러도 행 불변, 월 시작일이 아니면 거부", () =>
  tx(async () => {
    const v = await questionSet(50);
    await activate(v);
    assert.equal((await attempt("select public.ai_citation_month_init('2026-10-15', $1, array['시험엔진A'])", [v])).ok, false);
    const first = await one("select public.ai_citation_month_init('2026-10-01', $1, array['시험엔진A', '시험엔진B', ' ']) n", [v]);
    assert.equal(first.n, 100, "50문항 × 엔진 2개 (빈 엔진 이름은 제외)");
    const again = await one("select public.ai_citation_month_init('2026-10-01', $1, array['시험엔진A', '시험엔진B']) n", [v]);
    assert.equal(again.n, 0);
    const counts = await one("select count(*)::int n, count(*) filter (where cited = 'unknown')::int u from public.ai_citation_samples where month = '2026-10-01' and question_set_version = $1", [v]);
    assert.deepEqual({ ...counts }, { n: 100, u: 100 });
    assert.equal((await attempt("select public.ai_citation_month_init('2026-10-01', 1234567, array['x'])")).ok, false, "없는 버전");
    const draftV = await questionSet(50);
    assert.equal((await attempt("select public.ai_citation_month_init('2026-10-01', $1, array['x'])", [draftV])).ok, false, "활성화 전 목록");
  }));

test("표본 입력 — 미확인은 확인자 없이, 확인한 칸은 확인자·시각 필수, yes는 주소 필수, 같은 칸 중복 거부, anon 접근 0", () =>
  tx(async () => {
    const v = await questionSet(50);
    await activate(v);
    await client.query("select public.ai_citation_month_init('2026-10-01', $1, array['시험엔진A'])", [v]);
    const set = (cols, no = 1) =>
      attempt(`update public.ai_citation_samples set ${cols} where question_set_version = $1 and question_no = ${no} and engine = '시험엔진A'`, [v]);
    assert.equal((await set("cited = 'no'")).ok, false, "확인자·시각 없이 no");
    assert.equal((await set("cited = 'yes', checked_at = now(), checker_id = 'user:w7'")).ok, false, "yes인데 주소 없음");
    assert.ok((await set("cited = 'yes', checked_at = now(), checker_id = 'user:w7', cited_url = 'https://sample.example.test/a'")).ok);
    assert.ok((await set("cited = 'no', checked_at = now(), checker_id = 'user:w7'", 2)).ok);
    assert.equal((await set("cited = 'maybe', checked_at = now(), checker_id = 'user:w7'", 3)).ok, false, "값 목록 밖");
    assert.equal((await set("cited_url = 'javascript:alert(1)'", 4)).ok, false, "주소 모양");
    assert.equal((await attempt("insert into public.ai_citation_samples (month, question_set_version, question_no, engine) values ('2026-10-01', $1, 1, '시험엔진A')", [v])).ok, false, "같은 칸 중복");
    assert.equal((await attempt("select * from public.ai_citation_samples", [], "anon")).ok, false);
    assert.equal((await attempt("select * from public.ai_core_questions", [], "authenticated")).ok, false);
  }));
