// W12-g DB - 보안 정책 페이지 항목·통제 자가 점검 (마이그레이션 177, PRD-04 SEC-01)
//  · 항목 키 7개 제약, 초안으로만 생성·버전 자동·내용 불변·직접 상태 변경 거부·삭제 거부, 확인일 NOT NULL
//  · 게시 함수 - 빈 본문·미래 확인일·인증 단정 표현·AI 제공사 계약 미확인 거부(+ 거부 감사 1행), 새 게시본이 이전 게시본을 내림
//  · 통제 점검 - 미흡은 조치 계획·기한 필수, 추가만, 완료한 회차에는 더 못 적음, 점검 0건 완료 거부
//  · 공개 뷰 - 7개 항목 게시 + 자가 점검 1회 + 기능 키가 모두 맞을 때만 행, 일부 게시는 0행
// 모든 시험은 거래 안에서 돌고 되돌린다. 본문·통제 이름은 모두 시험용 가짜다.
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

const ACTOR = "admin:test@example.test";
const KEYS = ["data_location", "encryption", "access_control", "ai_provider_data", "calc_input_not_stored", "conversation_retention", "vulnerability_contact"];
async function draft(item_key, over = {}) {
  const v = { body: "시험용 본문", confirmed_on: "2026-10-01", contract_verified: item_key === "ai_provider_data", ...over };
  return h.attempt("insert into public.security_policy_items (item_key, body, confirmed_on, contract_verified, drafted_by) values ($1, $2, $3, $4, 'test') returning *", [item_key, v.body, v.confirmed_on, v.contract_verified]);
}
const publish = async (id) => (await h.one("select public.security_item_publish($1, $2) r", [id, ACTOR])).r;
async function publishAll() {
  for (const k of KEYS) {
    const d = await draft(k);
    assert.ok(d.ok, d.message);
    assert.equal((await publish(d.rows[0].id)).ok, true, k);
  }
}
async function completedRound() {
  await client.query("insert into public.security_control_checks (round_no, control_key, control_title, result, checked_on, checked_by) values (1, 'ctl_one', '시험용 통제', 'met', '2026-10-01', 'test')");
  const r = (await h.one("select public.security_self_check_complete(1, $1) r", [ACTOR])).r;
  assert.equal(r.ok, true);
}
const visible = async () => (await h.anon("select item_key from public.public_security_items")).rows.length;

const setSecurityFlag = (on) => client.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify({ security_page: on })]);

test("항목 제약 — 키 7개만, 확인일 필수, 초안으로만 생성, 버전 자동", () =>
  h.tx(async () => {
    assert.equal((await draft("other_item")).ok, false);
    assert.equal((await h.attempt("insert into public.security_policy_items (item_key, body, drafted_by) values ('encryption', '시험용', 't')")).ok, false, "확인일 NOT NULL");
    assert.equal((await draft("encryption", { body: "  " })).ok, false);
    const a = await draft("encryption");
    const b = await draft("encryption", { body: "시험용 본문 고침" });
    assert.equal(a.rows[0].version, 1);
    assert.equal(b.rows[0].version, 2);
    assert.equal(a.rows[0].status, "draft");
    assert.equal((await h.attempt("insert into public.security_policy_items (item_key, body, confirmed_on, drafted_by, status, published_by, published_at) values ('encryption', 'x', '2026-10-01', 't', 'published', 'x', now())")).ok, false);
  }));

test("항목 불변 — 내용 수정·직접 상태 변경·삭제 거부", () =>
  h.tx(async () => {
    const a = (await draft("encryption")).rows[0];
    assert.equal((await h.attempt("update public.security_policy_items set body = '바꿈' where id = $1", [a.id])).ok, false);
    assert.equal((await h.attempt("update public.security_policy_items set confirmed_on = '2026-10-02' where id = $1", [a.id])).ok, false);
    assert.equal((await h.attempt("update public.security_policy_items set status = 'published', published_by = 'x', published_at = now() where id = $1", [a.id])).ok, false);
    assert.equal((await h.attempt("delete from public.security_policy_items where id = $1", [a.id])).ok, false);
  }));

test("게시 거부 — 미래 확인일·인증 단정 표현·AI 제공사 계약 미확인, 거부도 감사 1행", () =>
  h.tx(async () => {
    const future = (await draft("encryption", { confirmed_on: "2999-01-01" })).rows[0];
    assert.equal((await publish(future.id)).code, "confirmed_future");
    const claim = (await draft("access_control", { body: "시험용 인증 획득 문장" })).rows[0];
    assert.equal((await publish(claim.id)).code, "cert_claim");
    const claim2 = (await draft("access_control", { body: "인증받은 보안" })).rows[0];
    assert.equal((await publish(claim2.id)).code, "cert_claim");
    const ai = (await draft("ai_provider_data", { contract_verified: false })).rows[0];
    assert.equal((await publish(ai.id)).code, "contract_unverified");
    assert.equal((await h.one("select count(*)::int n from public.security_audit where outcome = 'refused' and subject = 'item'")).n, 4);
    const ok = (await draft("ai_provider_data", { contract_verified: true })).rows[0];
    assert.equal((await publish(ok.id)).ok, true);
    assert.equal((await h.one("select public.security_item_publish($1, 'bad') r", [ok.id])).r.code, "actor_invalid");
    assert.equal((await publish(ok.id)).code, "not_draft");
  }));

test("문구 검사 함수 — 단정 표현은 걸리고 일반 문장은 통과", () =>
  h.tx(async () => {
    const v = async (t) => (await h.one("select public.security_text_violations($1) r", [t])).r;
    assert.ok((await v("보안 인증 취득")).length > 0);
    assert.ok((await v("27001 준수")).length > 0);
    assert.ok((await v("완벽하게 안전")).length > 0);
    assert.deepEqual(await v("시험용 일반 문장입니다"), []);
  }));

test("새 게시본이 이전 게시본을 내린다 — 키마다 게시본 1개", () =>
  h.tx(async () => {
    const a = (await draft("encryption")).rows[0];
    await publish(a.id);
    const b = (await draft("encryption", { body: "시험용 새 본문" })).rows[0];
    assert.equal((await publish(b.id)).ok, true);
    const rows = (await client.query("select id, status from public.security_policy_items where item_key = 'encryption' order by id")).rows;
    assert.deepEqual(rows.map((r) => r.status), ["retired", "published"]);
    assert.equal((await h.one("select public.security_item_retire($1, $2) r", [b.id, ACTOR])).r.ok, true);
    assert.equal((await h.one("select public.security_item_retire($1, $2) r", [b.id, ACTOR])).r.code, "not_published");
  }));

test("통제 점검 — 미흡은 조치 계획·기한 필수, 수정·삭제 거부, 점검 0건 완료 거부, 완료한 회차에는 더 못 적음", () =>
  h.tx(async () => {
    const ins = (result, plan = null, due = null) =>
      h.attempt("insert into public.security_control_checks (round_no, control_key, control_title, result, checked_on, gap_plan, due_on, checked_by) values (1, 'ctl_x', '시험용 통제', $1, '2026-10-01', $2, $3, 't') returning id", [result, plan, due]);
    assert.equal((await ins("gap")).ok, false);
    assert.equal((await ins("gap", "시험용 계획")).ok, false, "기한 없음");
    const gap = await ins("gap", "시험용 계획", "2026-12-31");
    assert.ok(gap.ok, gap.message);
    assert.equal((await h.attempt("update public.security_control_checks set result = 'met' where id = $1", [gap.rows[0].id])).ok, false);
    assert.equal((await h.attempt("delete from public.security_control_checks where id = $1", [gap.rows[0].id])).ok, false);
    assert.equal((await h.one("select public.security_self_check_complete(9, $1) r", [ACTOR])).r.code, "no_checks");
    const done = (await h.one("select public.security_self_check_complete(1, $1) r", [ACTOR])).r;
    assert.equal(done.ok, true);
    assert.equal((await h.one("select gaps from public.security_self_check_rounds where round_no = 1")).gaps, 1);
    assert.equal((await h.one("select public.security_self_check_complete(1, $1) r", [ACTOR])).r.code, "already_complete");
    assert.equal((await ins("met")).ok, false, "완료한 회차에는 더 적을 수 없다");
  }));

test("공개 뷰 — 6개만 게시되면 0행, 7개 게시 + 자가 점검 전이면 0행, 둘 다 되고 기능 키가 켜져야 7행", () =>
  h.tx(async () => {
    await setSecurityFlag(true);
    for (const k of KEYS.slice(0, 6)) await publish((await draft(k)).rows[0].id);
    await completedRound();
    assert.equal(await visible(), 0, "일부 게시 0");
    await publish((await draft(KEYS[6])).rows[0].id);
    assert.equal(await visible(), 7);
    const row = (await h.anon("select confirmed_on from public.public_security_items limit 1")).rows[0];
    assert.ok(row.confirmed_on, "항목마다 확인일");
    const st = (await h.anon("select completed_on, controls from public.public_security_status")).rows;
    assert.equal(st.length, 1);
    assert.equal(st[0].controls, 1);
    await setSecurityFlag(false);
    assert.equal(await visible(), 0, "기능 키 꺼짐");
  }));

test("공개 뷰 — 자가 점검 완료 전에는 7개를 게시해도 0행", () =>
  h.tx(async () => {
    await setSecurityFlag(true);
    await publishAll();
    assert.equal(await visible(), 0);
    await completedRound();
    assert.equal(await visible(), 7);
  }));

test("권한 — anon은 표를 못 읽고 함수를 못 부른다", () =>
  h.tx(async () => {
    for (const t of ["security_policy_items", "security_control_checks", "security_self_check_rounds", "security_audit"]) {
      assert.equal((await h.anon(`select 1 from public.${t}`)).ok, false, t);
    }
    assert.equal((await h.anon("select public.security_item_publish(1, 'admin:x')")).ok, false);
    assert.equal((await h.anon("select public.security_text_violations('x')")).ok, false);
  }));
