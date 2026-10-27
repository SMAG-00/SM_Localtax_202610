// W13-g DB - SM 전문가 계정 연결 · 라운지 (마이그레이션 20261027000216~220, docs/dev/W13-g_설계.md, PRD-05 EXP-01·02 QNA-01~08)
//  · 연결 - 공개 SM 프로필만, 계정당 1개·프로필당 1개, 기한·사유 검사, 프로필이 내려가면 자동 해제, 만료 배치, 이력은 추가만
//  · 배지 - 연결 없는 expert 답변 거부, 공무원 인증은 확인된 메일 + 도메인 정확 일치(notgo.kr 거부)
//  · 글 - 개인정보 모양 거부, 검출 사전에 걸리면 게시 보류, 제재 중 쓰기 거부, 채택 규칙(질문자만·자기 답변 불가·한 번만)
//  · 활동 집계 - 90일 경계(정확히 90일 포함·1초 전 제외), 채택률 분모, 제재 여부
//  · 신고·제재 - 중복·자기 글 거부, 받아들임 + 숨김 + 제재, 이미 처리된 신고 거부
//  · 설정 - 고지 승인 없이 qna 켜기 거부, 기준·사전·도메인 모양 거부
//  · 스키마 - 결제·수수료·별점·연락처·증빙 칸 0, chunks 허용 목록에 라운지 없음, 활동 함수에 결제·구독 표 0, anon 직접 접근 0
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0). 내용은 시험용 가짜다.
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
// role을 주면 그 역할(anon·authenticated)로 바꿔 실행하고 끝나면 되돌린다
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
    if (role) await client.query("reset role");
    return { ok: false, message: err.message, code: err.code };
  }
}
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
const user = async (email = null, confirmed = false) =>
  (await one("insert into auth.users (id, email, email_confirmed_at) values (gen_random_uuid(), $1, case when $2::boolean then now() end) returning id", [email, confirmed])).id;
let seq = 0;
const profile = async (status = "published") =>
  (
    await one(
      `insert into public.expert_profiles (slug, name, category_codes, office_name, house_relation, status, consent_version, consent_on, consent_doc_ref, published_by, edited_by)
       values ($1, '시험 전문가', '{tax-accountant}', '시험 사무소', 'employed', $2, 'c1', '2026-10-01', 'doc-1', 'tester', 'tester') returning id`,
      [`w13g-test-${Date.now()}-${seq++}`, status],
    )
  ).id;
const link = (u, p, exp = "2099-01-01T00:00:00Z") => one("select public.expert_link_create($1, $2, $3, 'tester') r", [u, p, exp]).then((x) => x.r);
const question = async (author, extra = {}) =>
  (
    await one("insert into public.qna_questions (author_id, tax_type, title, body) values ($1, '취득세', $2, $3) returning id", [author, extra.title ?? "시험 질문입니다", extra.body ?? "시험 본문입니다"])
  ).id;
const answer = (q, author, kind = "member", profileId = null, body = "시험 답변입니다") =>
  one("insert into public.qna_answers (question_id, author_id, author_kind, expert_profile_id, body) values ($1, $2, $3, $4, $5) returning id, status", [q, author, kind, profileId, body]);
const setSetting = (key, value) => client.query("update public.settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);
const NOTICE = { version: "n1", text: "시험용 고지(실제 문구 아님)", answer_footer: "시험용 하단 고지", approved: true, reviewed_by: "시험 검토자", reviewed_on: "2026-10-27" };
async function openLounge() {
  await setSetting("qna_neutrality_notice", NOTICE);
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  await setSetting("feature_flags", { ...cur, qna: true });
}

test("연결 - 공개 SM 프로필만 연결되고, 계정당 1개·프로필당 1개, 기한·번호 검사", () =>
  tx(async () => {
    const u1 = await user();
    const u2 = await user();
    const draft = await profile("draft");
    const p1 = await profile();
    const p2 = await profile();
    assert.deepEqual(await link(u1, draft), { ok: false, code: "profile_not_published" });
    assert.deepEqual(await link(u1, 999999999), { ok: false, code: "no_profile" });
    assert.deepEqual(await link("00000000-0000-0000-0000-000000000000", p1), { ok: false, code: "no_user" });
    assert.deepEqual(await link(u1, p1, "2020-01-01T00:00:00Z"), { ok: false, code: "bad_expiry" });
    const ok = await link(u1, p1);
    assert.equal(ok.ok, true);
    assert.deepEqual(await link(u1, p2), { ok: false, code: "user_already_linked" });
    assert.deepEqual(await link(u2, p1), { ok: false, code: "profile_already_linked" });
    assert.equal((await link(u2, p2)).ok, true);
    assert.equal((await one("select public.expert_badge_valid($1) v", [u1])).v, String(p1));
  }));

test("연결 - 프로필이 공개에서 내려가면 같은 거래에서 자동 해제되고 이력이 남는다, 해제 사유 필수, 이력은 추가만", () =>
  tx(async () => {
    const u = await user();
    const p = await profile();
    const id = (await link(u, p)).id;
    await client.query("update public.expert_profiles set status = 'draft' where id = $1", [p]);
    const row = await one("select status, ended_by from public.expert_verifications where id = $1", [id]);
    assert.deepEqual(row, { status: "revoked", ended_by: "system" });
    assert.equal((await one("select public.expert_badge_valid($1) v", [u])).v, null);
    const actions = (await client.query("select action from public.expert_verification_events where verification_id = $1 order by id", [id])).rows.map((r) => r.action);
    assert.deepEqual(actions, ["linked", "revoked"]);
    const upd = await attempt("update public.expert_verification_events set note = 'x' where verification_id = $1", [id]);
    assert.equal(upd.ok, false);
    const p2 = await profile();
    const id2 = (await link(u, p2)).id;
    assert.deepEqual((await one("select public.expert_link_end($1, '', 'tester') r", [id2])).r, { ok: false, code: "reason_required" });
    assert.deepEqual((await one("select public.expert_link_end($1, '소속 종료', 'tester') r", [id2])).r, { ok: true });
    assert.deepEqual((await one("select public.expert_link_end($1, '소속 종료', 'tester') r", [id2])).r, { ok: false, code: "already_ended" });
  }));

test("연결 - 재검증 기한: 기한 전 1초는 유효, 기한 시각은 무효, 만료 배치가 닫고, 갱신은 지금 기한보다 뒤여야 한다", () =>
  tx(async () => {
    const u = await user();
    const p = await profile();
    const id = (await link(u, p, "2030-01-01T00:00:00Z")).id;
    assert.notEqual((await one("select public.expert_badge_valid($1, '2029-12-31T23:59:59Z') v", [u])).v, null);
    assert.equal((await one("select public.expert_badge_valid($1, '2030-01-01T00:00:00Z') v", [u])).v, null);
    assert.deepEqual((await one("select public.expert_link_renew($1, '2029-01-01T00:00:00Z', 'tester') r", [id])).r, { ok: false, code: "bad_expiry" });
    assert.deepEqual((await one("select public.expert_link_renew($1, '2031-01-01T00:00:00Z', 'tester') r", [id])).r, { ok: true });
    assert.equal((await one("select public.expert_links_expire('2030-06-01T00:00:00Z') n")).n, 0, "갱신된 기한 전이라 닫을 것 없음");
    assert.equal((await one("select public.expert_links_expire('2031-01-01T00:00:00Z') n")).n, 1);
    assert.equal((await one("select status from public.expert_verifications where id = $1", [id])).status, "expired");
    const actions = (await client.query("select action from public.expert_verification_events where verification_id = $1 order by id", [id])).rows.map((r) => r.action);
    assert.deepEqual(actions, ["linked", "renewed", "expired"]);
  }));

test("답변 배지 - 연결 없는 expert 답변 거부, 연결이 있으면 허용, 다른 프로필 번호 거부, 공무원 인증은 확인된 메일 + 도메인 정확 일치", () =>
  tx(async () => {
    const asker = await user();
    const expert = await user();
    const stranger = await user();
    const p = await profile();
    const other = await profile();
    const q = await question(asker);
    assert.equal((await attempt("insert into public.qna_answers (question_id, author_id, author_kind, expert_profile_id, body) values ($1, $2, 'expert', $3, '시험 답변')", [q, stranger, p])).code, "23514");
    await link(expert, p);
    assert.equal((await attempt("insert into public.qna_answers (question_id, author_id, author_kind, expert_profile_id, body) values ($1, $2, 'expert', $3, '시험 답변')", [q, expert, other])).code, "23514", "남의 프로필 번호");
    const a = await answer(q, expert, "expert", p);
    assert.equal(a.status, "published");
    assert.equal((await attempt("insert into public.qna_answers (question_id, author_id, author_kind, body) values ($1, $2, 'expert', '시험')", [q, expert])).code, "23514", "expert는 프로필 번호 필수");
    const gov = await user("a@seoul.go.kr", true);
    const fake = await user("a@notgo.kr", true);
    const unconfirmed = await user("a@go.kr", false);
    assert.equal((await one("select public.qna_gov_verified($1) v", [gov])).v, true);
    assert.equal((await one("select public.qna_gov_verified($1) v", [fake])).v, false);
    assert.equal((await one("select public.qna_gov_verified($1) v", [unconfirmed])).v, false);
    assert.equal((await answer(q, gov, "gov")).status, "published");
    assert.equal((await attempt("insert into public.qna_answers (question_id, author_id, author_kind, body) values ($1, $2, 'gov', '시험')", [q, fake])).code, "23514");
  }));

test("글 규칙 - 개인정보 모양 거부, 검출 사전은 게시 보류, 숨김 상태로 새로 만들 수 없고 보류 질문에는 답할 수 없다", () =>
  tx(async () => {
    const u = await user();
    for (const bad of ["연락은 test@example.test 로", "계좌 1234567890123", "전화 010-1234-5678", "주민 900101-1234567"]) {
      assert.equal((await attempt("insert into public.qna_questions (author_id, tax_type, title, body) values ($1, '취득세', '시험 질문', $2)", [u, bad])).code, "23514", bad);
    }
    assert.equal((await attempt("insert into public.qna_questions (author_id, tax_type, title, body, status, hidden_at) values ($1, '취득세', '시험 질문', '시험 본문', 'hidden', now())", [u])).code, "23514");
    await setSetting("qna_detect_dictionary", { contact_terms: ["카톡 주세요"], consult_terms: ["상담 신청"] });
    const held = await one("insert into public.qna_questions (author_id, tax_type, title, body) values ($1, '취득세', '시험 질문', '카톡  주세요 부탁') returning id, status, hold_reason", [u]);
    assert.equal(held.status, "held");
    assert.equal(held.hold_reason, "contact_terms");
    assert.equal((await attempt("insert into public.qna_answers (question_id, author_id, author_kind, body) values ($1, $2, 'member', '시험 답변')", [held.id, await user()])).code, "23514");
    const q = await question(u);
    const a = await answer(q, await user(), "member", null, "상담 신청 하세요");
    assert.equal(a.status, "held");
    await setSetting("qna_detect_dictionary", {});
    assert.equal((await answer(q, await user(), "member", null, "상담 신청 하세요")).status, "published", "사전이 비면 걸리는 것 0");
  }));

test("채택 - 질문자만, 자기 답변 불가, 공개 답변만, 한 번만", () =>
  tx(async () => {
    const asker = await user();
    const other = await user();
    const q = await question(asker);
    const mine = await answer(q, asker);
    const theirs = await answer(q, other);
    const acc = async (u, a) => (await one("select public.qna_accept($1, $2, $3) r", [q, a, u])).r;
    assert.deepEqual(await acc(other, theirs.id), { ok: false, code: "not_author" });
    assert.deepEqual(await acc(asker, mine.id), { ok: false, code: "self_accept" });
    assert.deepEqual(await acc(asker, 999999999), { ok: false, code: "answer_not_found" });
    assert.deepEqual(await acc(asker, theirs.id), { ok: true });
    assert.deepEqual(await acc(asker, theirs.id), { ok: false, code: "already_accepted" });
  }));

test("활동 집계 - 90일 경계: 정확히 90일 전 채택은 포함, 1초 전은 제외, 채택률 분모는 창 안의 답변, 제재 중이면 표시", () =>
  tx(async () => {
    const P = "2026-10-27T00:00:00Z";
    const asker = await user();
    const ex = await user();
    const p = await profile();
    await link(ex, p);
    const mk = async (createdAt, acceptedAt) => {
      const q = await question(asker);
      const a = (
        await one("insert into public.qna_answers (question_id, author_id, author_kind, expert_profile_id, body, created_at) values ($1, $2, 'expert', $3, '시험 답변', $4) returning id", [q, ex, p, createdAt])
      ).id;
      if (acceptedAt) await client.query("update public.qna_answers set accepted_at = $2 where id = $1", [a, acceptedAt]);
      return a;
    };
    await mk("2026-07-01T00:00:00Z", "2026-07-29T00:00:00Z"); // 채택이 정확히 90일 전 -> 포함 (P - 90일 = 2026-07-29)
    await mk("2026-07-01T00:00:00Z", "2026-07-28T23:59:59Z"); // 1초 전 -> 제외
    await mk("2026-09-01T00:00:00Z", null); // 창 안에 쓴 답변, 채택 없음
    await mk("2026-10-20T00:00:00Z", "2026-10-21T00:00:00Z"); // 창 안 채택
    const r = await one("select answered_count, accepted_count, acceptance_rate::float8 as rate, sanctioned from public.expert_activity_at($1) where expert_profile_id = $2", [P, p]);
    assert.deepEqual(r, { answered_count: 3, accepted_count: 2, rate: 0.6667, sanctioned: false });
    await client.query("insert into public.qna_sanctions (user_id, reason, created_by, started_at, ends_at) values ($1, '시험 제재', 'tester', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')", [ex]);
    assert.equal((await one("select sanctioned from public.expert_activity_at($1) where expert_profile_id = $2", [P, p])).sanctioned, true);
    assert.equal((await one("select sanctioned from public.expert_activity_at('2027-06-01T00:00:00Z') where expert_profile_id = $1", [p])).sanctioned, false, "제재가 창 밖으로 밀려나고 기간이 끝나면 해제");
    await setSetting("qna_criteria", { window_days: 30 });
    assert.equal((await one("select accepted_count from public.expert_activity_at($1) where expert_profile_id = $2", [P, p])).accepted_count, 1, "기간 설정을 따른다");
  }));

test("활동 집계 - 연결이 끝난 전문가·비공개 프로필은 집계에 없다", () =>
  tx(async () => {
    const ex = await user();
    const p = await profile();
    const id = (await link(ex, p)).id;
    assert.equal((await client.query("select 1 from public.expert_activity_at(now()) where expert_profile_id = $1", [p])).rowCount, 1);
    await client.query("select public.expert_link_end($1, '시험 해제', 'tester')", [id]);
    assert.equal((await client.query("select 1 from public.expert_activity_at(now()) where expert_profile_id = $1", [p])).rowCount, 0);
  }));

test("신고·제재 - 자기 글·중복 거부, 받아들임 + 숨김 + 제재, 제재 중에는 글쓰기 거부, 이미 처리된 신고 거부, 보류 풀기", () =>
  tx(async () => {
    const author = await user();
    const reporter = await user();
    const q = await question(author);
    const due = new Date(Date.now() + 86400000).toISOString();
    const create = async (u) => (await one("select public.qna_report_create($1, 'question', $2, 'ad', '', $3) r", [u, q, due])).r;
    assert.deepEqual(await create(author), { ok: false, code: "own_post" });
    const made = await create(reporter);
    assert.equal(made.ok, true);
    assert.deepEqual(await create(reporter), { ok: false, code: "duplicate" });
    assert.deepEqual((await one("select public.qna_report_create($1, 'question', 999999999, 'ad', '', $2) r", [reporter, due])).r, { ok: false, code: "target_not_found" });
    assert.deepEqual((await one("select public.qna_report_handle($1, 'dismissed', true, null, '메모', 'tester') r", [made.id])).r, { ok: false, code: "dismiss_has_action" });
    assert.deepEqual((await one("select public.qna_report_handle($1, 'upheld', true, 3, '광고성 확인', 'tester') r", [made.id])).r, { ok: true });
    assert.equal((await one("select status from public.qna_questions where id = $1", [q])).status, "hidden");
    assert.equal((await one("select public.qna_user_sanctioned($1) v", [author])).v, true);
    assert.equal((await attempt("insert into public.qna_questions (author_id, tax_type, title, body) values ($1, '취득세', '시험 질문', '시험 본문')", [author])).code, "23514");
    assert.deepEqual((await one("select public.qna_report_handle($1, 'dismissed', false, null, '메모', 'tester') r", [made.id])).r, { ok: false, code: "already_handled" });
    const sid = (await one("select id from public.qna_sanctions where user_id = $1", [author])).id;
    assert.deepEqual((await one("select public.qna_sanction_lift($1, 'tester') r", [sid])).r, { ok: true });
    assert.equal((await one("select public.qna_user_sanctioned($1) v", [author])).v, false);
    // 보류 풀기: 가림이 끝난 글을 held로 만들고 운영자가 푼다
    const h = await one("insert into public.qna_questions (author_id, tax_type, title, body, status, hold_reason) values ($1, '취득세', '시험 질문', '시험 본문', 'held', 'pii') returning id", [author]);
    assert.deepEqual((await one("select public.qna_release('question', $1, 'tester') r", [h.id])).r, { ok: true });
    assert.deepEqual((await one("select public.qna_release('question', $1, 'tester') r", [h.id])).r, { ok: false, code: "not_held" });
  }));

test("설정 - 고지 승인 없이 qna 켜기 거부, 승인 뒤 허용, 기준·사전·도메인 모양 거부", () =>
  tx(async () => {
    const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
    assert.equal((await attempt("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, qna: true })])).code, "23514");
    assert.equal((await attempt("update public.settings set value = $1::jsonb where key = 'qna_neutrality_notice'", [JSON.stringify({ ...NOTICE, answer_footer: "" })])).code, "23514", "하단 고지 없이 승인 불가");
    await setSetting("qna_neutrality_notice", NOTICE);
    assert.equal((await attempt("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, qna: true })])).ok, true);
    for (const bad of [{ strip_size: 2 }, { strip_size: 6 }, { window_days: 0 }, { window_days: 366 }, { min_rate: 1.5 }, { min_accepted: -1 }, { price: 1 }]) {
      assert.equal((await attempt("update public.settings set value = $1::jsonb where key = 'qna_criteria'", [JSON.stringify(bad)])).code, "23514", JSON.stringify(bad));
    }
    assert.equal((await attempt("update public.settings set value = $1::jsonb where key = 'qna_criteria'", [JSON.stringify({ window_days: 90, min_accepted: 3, min_rate: 0.5, strip_size: 5 })])).ok, true);
    assert.equal((await attempt("update public.settings set value = $1::jsonb where key = 'qna_detect_dictionary'", [JSON.stringify({ other: [] })])).code, "23514");
    assert.equal((await attempt("update public.settings set value = $1::jsonb where key = 'qna_gov_domains'", [JSON.stringify({ domains: ["GO.KR"] })])).code, "23514");
    assert.deepEqual((await one("select value from public.settings where key = 'qna_gov_domains'")).value, { domains: ["go.kr"] }, "씨앗은 go.kr 하나");
  }));

test("공개 뷰 - 닫혀 있으면 0행, 열리면 공개 글만, 보류·숨김 제외, 프로필이 내려가면 답변 배지 해제(member로 표시)", () =>
  tx(async () => {
    const asker = await user();
    const ex = await user();
    const p = await profile();
    await link(ex, p);
    const q = await question(asker);
    const held = await one("insert into public.qna_questions (author_id, tax_type, title, body, status, hold_reason) values ($1, '취득세', '보류 질문', '본문', 'held', 'pii') returning id", [asker]);
    const a = await answer(q, ex, "expert", p);
    assert.equal((await client.query("select 1 from public.public_qna_questions")).rowCount, 0, "닫힘");
    assert.equal((await client.query("select 1 from public.public_qna_notice")).rowCount, 0);
    await openLounge();
    const qs = (await client.query("select id from public.public_qna_questions")).rows.map((r) => r.id);
    assert.ok(qs.includes(String(q)) || qs.includes(q));
    assert.ok(!qs.map(String).includes(String(held.id)), "보류 질문 비공개");
    const view = await one("select display_kind, expert_name from public.public_qna_answers where id = $1", [a.id]);
    assert.equal(view.display_kind, "expert");
    assert.equal(view.expert_name, "시험 전문가");
    // 행이 있을 때도 anon·authenticated 역할로 읽힌다 (뷰 안의 함수 실행 권한은 읽는 사람 기준 - 함수를 열지 않고 판정을 뷰에 둔다)
    for (const role of ["anon", "authenticated"]) {
      for (const v of ["public_qna_questions", "public_qna_answers", "public_expert_activity", "public_qna_notice"]) {
        const r = await attempt(`select * from public.${v}`, [], role);
        assert.equal(r.ok, true, `${role} ${v}: ${r.message}`);
      }
      const ans = await attempt("select display_kind from public.public_qna_answers where id = $1", [a.id], role);
      assert.equal(ans.rows[0].display_kind, "expert", `${role} 배지`);
    }
    await client.query("update public.expert_profiles set status = 'draft' where id = $1", [p]);
    const after = await one("select display_kind, expert_name from public.public_qna_answers where id = $1", [a.id]);
    assert.deepEqual(after, { display_kind: "member", expert_name: null });
    const cols = (await client.query("select column_name from information_schema.columns where table_name = 'public_qna_questions'")).rows.map((r) => r.column_name);
    assert.ok(!cols.includes("author_id"), "작성자 번호 열 없음");
  }));

test("스키마 - 결제·수수료·별점·연락처·증빙 칸이 없고, chunks 허용 목록에 라운지가 없고, 활동 함수는 결제·구독 표를 읽지 않는다", () =>
  tx(async () => {
    const cols = (
      await client.query(
        "select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('qna_questions','qna_answers','qna_reports','qna_sanctions','expert_verifications','expert_verification_events')",
      )
    ).rows;
    const banned = /price|fee|amount|payment|commission|reward|rating|score|stars|phone|email|contact|address|evidence|reg_no|office|license|referral/i;
    assert.deepEqual(cols.filter((c) => banned.test(c.column_name)), []);
    const chunkDef = (
      await one("select string_agg(pg_get_constraintdef(c.oid), ' ') d from pg_constraint c join pg_class t on t.oid = c.conrelid where t.relname = 'chunks' and c.contype = 'c'")
    ).d;
    assert.match(chunkDef, /source_type/);
    assert.doesNotMatch(chunkDef, /qna|lounge|post/);
    const fn = (await one("select pg_get_functiondef('public.expert_activity_at(timestamptz)'::regprocedure) d")).d;
    assert.doesNotMatch(fn, /subscriptions|orders|entitlements|payment|products|product_plans|campaign|sponsored|invoice/i);
    assert.match(fn, /qna_answers/);
  }));

test("권한 - anon·authenticated는 라운지·연결 표와 쓰기 함수에 접근할 수 없다", () =>
  tx(async () => {
    for (const role of ["anon", "authenticated"]) {
      await client.query(`set local role ${role}`);
      for (const t of ["qna_questions", "qna_answers", "qna_reports", "qna_sanctions", "expert_verifications", "expert_verification_events", "expert_activity"]) {
        const r = await attempt(`select 1 from public.${t} limit 1`);
        assert.equal(r.code, "42501", `${role} ${t}`);
      }
      for (const f of ["select public.qna_accept(1,1,gen_random_uuid())", "select public.expert_link_create(gen_random_uuid(), 1, now(), 'x')", "select public.qna_release('question', 1, 'x')", "select public.expert_badge_valid(gen_random_uuid())"]) {
        assert.equal((await attempt(f)).code, "42501", `${role} ${f}`);
      }
      await client.query("reset role");
    }
  }));
