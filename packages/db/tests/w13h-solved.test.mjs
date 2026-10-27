// W13-h DB - 홈 해결 사례 · O5 분류 (마이그레이션 20261027000223~224, docs/dev/W13-h_설계.md, PRD-05 HOME-11 · AIOPS-15)
//  · 동의 - 질문 등록 때만 켤 수 있고(기본 꺼짐) 이후에는 철회만, 철회 시각이 남고 카드가 함께 내려간다
//  · 후보 - 동의하지 않은 글·채택 없는 글·비공개 글은 카드 저장 거부
//  · 승인 - 가림 확인 없이 거부, 네 칸이 비면 거부, 승인 뒤 카드를 고치면 초안으로 돌아간다, 카드 문장에도 개인정보 모양 거부
//  · 공개 뷰 - 기능 키 꺼짐이면 0행, 켜짐 + 승인 + 동의면 1행(작성자 칸 없음), 철회·숨김이면 즉시 0행
//  · 분류 - source는 regex만, 제안은 질문당 1건, 수락은 세목 필수·거절은 세목 금지, 수락 세목이 공개 뷰에 반영
//  · 권한 - anon·authenticated 표 직접 접근 0, 함수는 service_role 전용
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
async function attempt(sql, params = []) {
  await client.query("savepoint t");
  try {
    const res = await client.query(sql, params);
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, message: err.message, code: err.code };
  }
}
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
const user = async () => (await one("insert into auth.users (id, email) values (gen_random_uuid(), null) returning id")).id;
const setSetting = (key, value) => client.query("update public.settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);
const NOTICE = { version: "n1", text: "시험용 고지(실제 문구 아님)", answer_footer: "시험용 하단 고지", approved: true, reviewed_by: "시험 검토자", reviewed_on: "2026-10-27" };
async function openAll(solved = true) {
  await setSetting("qna_neutrality_notice", NOTICE);
  const cur = (await one("select value from public.settings where key = 'feature_flags'")).value;
  await setSetting("feature_flags", { ...cur, qna: true, solved_cases: solved });
}
const question = async (author, consent = false, extra = {}) =>
  (
    await one("insert into public.qna_questions (author_id, tax_type, title, body, solved_consent) values ($1, $2, '시험 질문입니다', '시험 본문입니다', $3) returning id", [author, extra.tax ?? "취득세", consent])
  ).id;
/** 채택까지 끝낸 질문 */
async function resolved(consent = true) {
  const asker = await user();
  const other = await user();
  const q = await question(asker, consent);
  const a = (await one("insert into public.qna_answers (question_id, author_id, author_kind, body) values ($1, $2, 'member', '시험 답변입니다') returning id", [q, other])).id;
  assert.equal((await one("select public.qna_accept($1, $2, $3) r", [q, a, asker])).r.ok, true);
  return { q, asker };
}
const save = (q, over = {}) =>
  one("select public.qna_solved_case_save($1, $2, $3, $4, $5, 'tester') r", [q, over.s ?? "상황 문장", over.i ?? "쟁점 문장", over.r ?? "결과 문장", over.l ?? "교훈 문장"]).then((x) => x.r);
const approve = (id, confirmed = true) => one("select public.qna_solved_case_approve($1, $2, 'tester') r", [id, confirmed]).then((x) => x.r);
const publicCount = async () => Number((await one("select count(*) n from public.public_solved_cases")).n);

test("동의 - 기본 꺼짐, 등록 때만 켤 수 있고 이후 켜기 거부, 철회는 시각이 남고 재동의는 거부", () =>
  tx(async () => {
    const a = await user();
    const off = await question(a);
    assert.deepEqual(await one("select solved_consent c, solved_consent_at at, solved_consent_withdrawn_at w from public.qna_questions where id = $1", [off]), { c: false, at: null, w: null });
    assert.equal((await attempt("update public.qna_questions set solved_consent = true where id = $1", [off])).code, "23514", "등록 뒤 켜기 거부");
    const on = await question(a, true);
    const row = await one("select solved_consent c, solved_consent_at at from public.qna_questions where id = $1", [on]);
    assert.equal(row.c, true);
    assert.ok(row.at, "동의 시각이 남는다");
    assert.equal((await attempt("update public.qna_questions set solved_consent_at = now() - interval '1 day' where id = $1", [on])).code, "23514", "동의 시각 수정 거부");
    const b = await user();
    assert.deepEqual((await one("select public.qna_solved_consent_withdraw($1, $2) r", [on, b])).r, { ok: false, code: "not_author" });
    assert.deepEqual((await one("select public.qna_solved_consent_withdraw($1, $2) r", [on, a])).r, { ok: true });
    const after = await one("select solved_consent c, solved_consent_withdrawn_at w from public.qna_questions where id = $1", [on]);
    assert.equal(after.c, false);
    assert.ok(after.w, "철회 시각이 남는다");
    assert.deepEqual((await one("select public.qna_solved_consent_withdraw($1, $2) r", [on, a])).r, { ok: false, code: "no_consent" });
    assert.equal((await attempt("update public.qna_questions set solved_consent = true where id = $1", [on])).code, "23514", "재동의 거부");
  }));

test("후보 - 동의 없는 글·채택 없는 글·비공개 글은 카드 저장 거부", () =>
  tx(async () => {
    const noConsent = await resolved(false);
    assert.deepEqual(await save(noConsent.q), { ok: false, code: "no_consent" });
    const asker = await user();
    const unresolved = await question(asker, true);
    assert.deepEqual(await save(unresolved), { ok: false, code: "not_resolved" });
    const ok = await resolved(true);
    await client.query("update public.qna_questions set status = 'hidden', hidden_at = now(), hidden_reason = '시험' where id = $1", [ok.q]);
    assert.deepEqual(await save(ok.q), { ok: false, code: "not_found" });
    assert.deepEqual(await save(999999999), { ok: false, code: "not_found" });
    const fine = await resolved(true);
    assert.equal((await save(fine.q)).ok, true);
  }));

test("승인 - 가림 확인 없이 거부, 네 칸이 비면 거부, 개인정보 모양 카드 거부, 고치면 초안으로 복귀", () =>
  tx(async () => {
    const { q } = await resolved(true);
    assert.deepEqual(await save(q, { s: "문의는 someone@example.com 으로" }), { ok: false, code: "bad_input" });
    assert.deepEqual(await save(q, { l: "전화 010-1234-5678" }), { ok: false, code: "bad_input" });
    const partial = await save(q, { l: "" });
    assert.equal(partial.ok, true);
    assert.deepEqual(await approve(partial.id), { ok: false, code: "incomplete" });
    const full = await save(q);
    assert.deepEqual(await approve(full.id, false), { ok: false, code: "mask_not_confirmed" });
    assert.deepEqual(await approve(full.id, null), { ok: false, code: "mask_not_confirmed" });
    assert.deepEqual(await approve(full.id), { ok: true });
    const st = await one("select status, approved_by, mask_confirmed_by from public.qna_solved_cases where id = $1", [full.id]);
    assert.deepEqual(st, { status: "approved", approved_by: "tester", mask_confirmed_by: "tester" });
    assert.deepEqual(await approve(full.id), { ok: false, code: "not_draft" });
    await save(q, { r: "고친 결과 문장" });
    const back = await one("select status, approved_at, mask_confirmed_at from public.qna_solved_cases where id = $1", [full.id]);
    assert.deepEqual(back, { status: "draft", approved_at: null, mask_confirmed_at: null });
    assert.equal((await attempt("update public.qna_solved_cases set status = 'approved' where id = $1", [full.id])).code, "23514", "승인 기록 없이 승인 상태로 직접 바꿀 수 없다");
  }));

test("공개 뷰 - 키 꺼짐 0행, 승인 + 동의 + 키 켜짐 1행(작성자 칸 없음), 철회·숨김·내림은 즉시 0행", () =>
  tx(async () => {
    const { q, asker } = await resolved(true);
    const c = await save(q);
    await approve(c.id);
    await openAll(false);
    assert.equal(await publicCount(), 0, "solved_cases 키 꺼짐");
    await openAll(true);
    assert.equal(await publicCount(), 1);
    const cols = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'public_solved_cases'")).rows.map((r) => r.column_name);
    assert.deepEqual(cols.sort(), ["approved_at", "id", "issue", "lesson", "question_id", "result", "situation", "tax_type"]);
    const row = await one("select tax_type, situation from public.public_solved_cases");
    assert.deepEqual(row, { tax_type: "취득세", situation: "상황 문장" });
    // 동의 철회 -> 즉시 빠짐
    assert.deepEqual((await one("select public.qna_solved_consent_withdraw($1, $2) r", [q, asker])).r, { ok: true });
    assert.equal(await publicCount(), 0);
    assert.equal((await one("select status from public.qna_solved_cases where id = $1", [c.id])).status, "unpublished");
    // 질문 숨김 / 라운지 닫힘
    const r2 = await resolved(true);
    const c2 = await save(r2.q);
    await approve(c2.id);
    assert.equal(await publicCount(), 1);
    await client.query("update public.qna_questions set status = 'hidden', hidden_at = now(), hidden_reason = '시험' where id = $1", [r2.q]);
    assert.equal(await publicCount(), 0, "숨긴 질문의 카드는 나오지 않는다");
    const r3 = await resolved(true);
    const c3 = await save(r3.q);
    await approve(c3.id);
    assert.equal(await publicCount(), 1);
    assert.deepEqual((await one("select public.qna_solved_case_unpublish($1, '', 'tester') r", [c3.id])).r, { ok: false, code: "reason_required" });
    assert.deepEqual((await one("select public.qna_solved_case_unpublish($1, '시험 내림', 'tester') r", [c3.id])).r, { ok: true });
    assert.equal(await publicCount(), 0);
    await setSetting("qna_neutrality_notice", { ...NOTICE, approved: false });
    assert.equal(await publicCount(), 0);
  }));

test("분류 - source는 regex만, 질문당 1건, 수락은 세목 필수·거절은 세목 금지, 수락 세목이 공개 뷰에 반영", () =>
  tx(async () => {
    const { q } = await resolved(true);
    assert.deepEqual((await one("select public.qna_classify_propose($1, array['재산세','취득세'], false) r", [q])).r, { ok: true });
    assert.deepEqual((await one("select public.qna_classify_propose($1, array['주민세'], true) r", [q])).r, { ok: true }, "두 번째 제안은 무시");
    const k = await one("select id, proposed_tax_types t, pii_suspected p, source, status from public.qna_classifications where question_id = $1", [q]);
    assert.deepEqual({ t: k.t, p: k.p, source: k.source, status: k.status }, { t: ["재산세", "취득세"], p: false, source: "regex", status: "proposed" });
    assert.equal((await attempt("update public.qna_classifications set source = 'ai' where id = $1", [k.id])).code, "23514", "AI 출처는 허용되지 않는다");
    assert.deepEqual((await one("select public.qna_classify_propose(999999999, array['재산세'], false) r")).r, { ok: false, code: "not_found" });
    assert.deepEqual((await one("select public.qna_classify_review($1, 'accepted', '', 'tester') r", [k.id])).r, { ok: false, code: "tax_type_required" });
    assert.deepEqual((await one("select public.qna_classify_review($1, 'rejected', '재산세', 'tester') r", [k.id])).r, { ok: false, code: "reject_has_tax_type" });
    assert.deepEqual((await one("select public.qna_classify_review($1, 'maybe', null, 'tester') r", [k.id])).r, { ok: false, code: "bad_decision" });
    const c = await save(q);
    await approve(c.id);
    await openAll(true);
    assert.equal((await one("select tax_type from public.public_solved_cases")).tax_type, "취득세", "수락 전에는 질문 세목");
    assert.deepEqual((await one("select public.qna_classify_review($1, 'accepted', '재산세', 'tester') r", [k.id])).r, { ok: true });
    assert.equal((await one("select tax_type from public.public_solved_cases")).tax_type, "재산세", "수락한 세목이 카드에 쓰인다");
    assert.deepEqual((await one("select public.qna_classify_review($1, 'rejected', null, 'tester') r", [k.id])).r, { ok: false, code: "not_found" }, "한 번 검토한 제안은 다시 검토할 수 없다");
  }));

test("권한 - anon·authenticated는 표 직접 접근 0, 함수는 service_role만, 질문 표에 연락처 칸 없음", () =>
  tx(async () => {
    for (const t of ["qna_solved_cases", "qna_classifications"]) {
      for (const role of ["anon", "authenticated"]) {
        const r = await one("select has_table_privilege($1, $2, 'select') s", [role, `public.${t}`]);
        assert.equal(r.s, false, `${role}는 ${t}를 읽을 수 없다`);
      }
      assert.equal((await one("select has_table_privilege('service_role', $1, 'delete') d", [`public.${t}`])).d, false, "지우기 0");
    }
    for (const fn of [
      "qna_solved_case_save(bigint,text,text,text,text,text)",
      "qna_solved_case_approve(bigint,boolean,text)",
      "qna_solved_case_unpublish(bigint,text,text)",
      "qna_solved_consent_withdraw(bigint,uuid)",
      "qna_classify_propose(bigint,text[],boolean)",
      "qna_classify_review(bigint,text,text,text)",
    ]) {
      assert.equal((await one("select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') u, has_function_privilege('service_role', $1, 'execute') s", [`public.${fn}`])).a, false, `${fn} anon`);
      assert.equal((await one("select has_function_privilege('authenticated', $1, 'execute') u", [`public.${fn}`])).u, false, `${fn} authenticated`);
      assert.equal((await one("select has_function_privilege('service_role', $1, 'execute') s", [`public.${fn}`])).s, true, `${fn} service_role`);
    }
    assert.equal((await one("select has_table_privilege('anon', 'public.public_solved_cases', 'select') s")).s, true);
    const cols = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name in ('qna_solved_cases', 'qna_classifications')")).rows.map((r) => r.column_name);
    for (const bad of ["author_id", "user_id", "email", "phone", "contact", "fee", "price"]) assert.ok(!cols.includes(bad), `${bad} 칸 없음`);
  }));
