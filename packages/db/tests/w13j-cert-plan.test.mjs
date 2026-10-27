// W13-j DB - 정보보호 인증 추진 계획 (마이그레이션 231·232, PRD-05 SEC-02)
//  · 계획 항목 제약 - 종류 3택·종료일 >= 시작일·비용 >= 0·필수 칸·기타 종류 이름·초안으로만 생성·내용 불변·직접 상태 변경 거부·삭제 거부
//  · 승인 함수 - 명의·위험 평가일·미래 위험 평가일·지난 종료일·인증 단정 표현 거부(+ 거부 감사 1행), 승인은 동시에 1건(새 승인이 이전 승인을 교체)
//  · 기관 판매 게이트 - 승인된 계획이 있을 때만 true, 철회하면 false
//  · 공개 뷰 - 기능 키 security_cert_plan ∧ /security 열림 ∧ 승인본일 때만 1행, 범위·비용·담당·명의 칸 없음
// 모든 시험은 거래 안에서 돌고 되돌린다. 값은 전부 시험용 가짜다.
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
const ITEM_KEYS = ["data_location", "encryption", "access_control", "ai_provider_data", "calc_input_not_stored", "conversation_retention", "vulnerability_contact"];

const base = { cert_kind: "iso27001", other_kind_name: null, scope: "시험용 범위", target_start_on: "2026-11-01", target_end_on: "2999-01-01", cost_estimate_krw: 5000000, owner_name: "시험용 담당", entity_name: "시험용 법인", risk_assessed_on: "2020-01-01", note: null };
async function plan(over = {}) {
  const v = { ...base, ...over };
  return h.attempt(
    "insert into public.security_cert_plans (cert_kind, other_kind_name, scope, target_start_on, target_end_on, cost_estimate_krw, owner_name, entity_name, risk_assessed_on, note, drafted_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'test') returning *",
    [v.cert_kind, v.other_kind_name, v.scope, v.target_start_on, v.target_end_on, v.cost_estimate_krw, v.owner_name, v.entity_name, v.risk_assessed_on, v.note],
  );
}
const approve = async (id) => (await h.one("select public.security_cert_plan_approve($1, $2) r", [id, ACTOR])).r;
const withdraw = async (id) => (await h.one("select public.security_cert_plan_withdraw($1, $2) r", [id, ACTOR])).r;
const gate = async () => (await h.one("select public.security_cert_gate_open() g")).g;
const setFlag = (k, on) => client.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify({ [k]: on })]);
const visible = async () => (await h.anon("select cert_kind from public.public_security_cert_status")).rows.length;

/** /security 열림 조건(7개 항목 게시 + 자가 점검 1회 + security_page 켜짐) */
async function openSecurityPage() {
  for (const k of ITEM_KEYS) {
    const d = await h.one("insert into public.security_policy_items (item_key, body, confirmed_on, contract_verified, drafted_by) values ($1, '시험용 본문', '2026-10-01', $2, 'test') returning id", [k, k === "ai_provider_data"]);
    assert.equal((await h.one("select public.security_item_publish($1, $2) r", [d.id, ACTOR])).r.ok, true);
  }
  await client.query("insert into public.security_control_checks (round_no, control_key, control_title, result, checked_on, checked_by) values (1, 'ctl_one', '시험용 통제', 'met', '2026-10-01', 'test')");
  assert.equal((await h.one("select public.security_self_check_complete(1, $1) r", [ACTOR])).r.ok, true);
  await setFlag("security_page", true);
}

test("계획 제약 — 종류 3택, 종료일 < 시작일 거부(같은 날 통과), 음수 비용 거부(0 통과), 필수 칸, 기타 종류 이름", () =>
  h.tx(async () => {
    assert.equal((await plan({ cert_kind: "x509" })).ok, false);
    assert.equal((await plan({ target_end_on: "2026-10-31" })).ok, false);
    assert.equal((await plan({ target_end_on: "2026-11-01" })).ok, true);
    assert.equal((await plan({ cost_estimate_krw: -1 })).ok, false);
    assert.equal((await plan({ cost_estimate_krw: 0 })).ok, true);
    assert.equal((await plan({ scope: "  " })).ok, false);
    assert.equal((await plan({ owner_name: "" })).ok, false);
    assert.equal((await plan({ cert_kind: "other" })).ok, false, "기타는 이름 필요");
    assert.equal((await plan({ cert_kind: "other", other_kind_name: "시험용 기타" })).ok, true);
    assert.equal((await plan({ cert_kind: "ismsp", other_kind_name: "시험용" })).ok, false, "기타 아닌 종류에는 이름 불가");
    assert.equal((await plan({ target_start_on: null })).ok, false);
  }));

test("계획 불변 — 초안으로만 생성, 내용 수정·직접 승인·삭제 거부", () =>
  h.tx(async () => {
    assert.equal((await h.attempt("insert into public.security_cert_plans (cert_kind, scope, target_start_on, target_end_on, cost_estimate_krw, owner_name, drafted_by, status, approved_by, approved_at) values ('ismsp','x','2026-11-01','2027-01-01',0,'o','t','approved','x',now())")).ok, false);
    const a = (await plan()).rows[0];
    assert.equal(a.status, "draft");
    assert.equal((await h.attempt("update public.security_cert_plans set scope = '바꿈' where id = $1", [a.id])).ok, false);
    assert.equal((await h.attempt("update public.security_cert_plans set cost_estimate_krw = 1 where id = $1", [a.id])).ok, false);
    assert.equal((await h.attempt("update public.security_cert_plans set status = 'approved', approved_by = 'x', approved_at = now() where id = $1", [a.id])).ok, false);
    assert.equal((await h.attempt("delete from public.security_cert_plans where id = $1", [a.id])).ok, false);
  }));

test("승인 거부 — 명의 없음·위험 평가일 없음·미래·지난 종료일·인증 단정 표현·승인자 표시, 거부도 감사 1행", () =>
  h.tx(async () => {
    const cases = [
      [{ entity_name: null }, "entity_missing"],
      [{ risk_assessed_on: null }, "risk_missing"],
      [{ risk_assessed_on: "2999-01-01" }, "risk_future"],
      [{ target_start_on: "2020-01-01", target_end_on: "2020-12-31" }, "schedule_past"],
      [{ scope: "시험용 인증 획득 범위" }, "cert_claim"],
      [{ note: "인증을 받은 상태" }, "cert_claim"],
      [{ cert_kind: "other", other_kind_name: "인증된 보안" }, "cert_claim"],
    ];
    for (const [over, code] of cases) {
      const p = (await plan(over)).rows[0];
      assert.equal((await approve(p.id)).code, code, JSON.stringify(over));
    }
    const ok = (await plan()).rows[0];
    assert.equal((await h.one("select public.security_cert_plan_approve($1, 'bad') r", [ok.id])).r.code, "actor_invalid");
    assert.equal((await approve(999999999)).code, "not_found");
    assert.equal((await h.one("select count(*)::int n from public.security_cert_audit where outcome = 'refused' and action = 'approve'")).n, cases.length + 2);
    assert.equal(await gate(), false, "거부만 있으면 게이트 닫힘");
  }));

test("승인 경계 — 종료일이 오늘이면 통과, 위험 평가일이 오늘이면 통과, 같은 계획 재승인 거부", () =>
  h.tx(async () => {
    const today = (await h.one("select (now() at time zone 'Asia/Seoul')::date::text d")).d;
    const p = (await plan({ target_start_on: today, target_end_on: today, risk_assessed_on: today })).rows[0];
    assert.equal((await approve(p.id)).ok, true);
    assert.equal((await approve(p.id)).code, "not_draft");
    assert.equal((await h.one("select count(*)::int n from public.security_cert_audit where outcome = 'ok' and action = 'approve' and plan_id = $1", [p.id])).n, 1);
  }));

test("승인은 동시에 1건 — 새 승인이 이전 승인을 교체하고, 철회하면 게이트가 닫힌다", () =>
  h.tx(async () => {
    assert.equal(await gate(), false, "승인 전 게이트 닫힘");
    const a = (await plan()).rows[0];
    const b = (await plan({ cert_kind: "ismsp", scope: "시험용 다른 범위" })).rows[0];
    assert.equal((await approve(a.id)).ok, true);
    assert.equal(await gate(), true);
    assert.equal((await approve(b.id)).ok, true);
    const rows = (await client.query("select id, status from public.security_cert_plans where id = any($1) order by id", [[a.id, b.id]])).rows;
    assert.deepEqual(rows.map((r) => r.status), ["superseded", "approved"]);
    assert.equal((await withdraw(a.id)).code, "not_open", "교체된 계획은 철회 대상 아님");
    assert.equal((await withdraw(b.id)).ok, true);
    assert.equal(await gate(), false, "승인본 철회 뒤 게이트 닫힘");
    assert.equal((await withdraw(b.id)).code, "not_open");
    const c = (await plan()).rows[0];
    assert.equal((await withdraw(c.id)).ok, true, "초안도 철회 가능");
  }));

test("공개 뷰 — 키 꺼짐·/security 닫힘·승인 전에는 0행, 모두 맞으면 종류·승인일만 1행", () =>
  h.tx(async () => {
    const p = (await plan({ scope: "시험용 비공개 범위", owner_name: "시험용 비공개 담당" })).rows[0];
    await setFlag("security_cert_plan", true);
    assert.equal(await visible(), 0, "승인 전 0행");
    assert.equal((await approve(p.id)).ok, true);
    assert.equal(await visible(), 0, "/security 닫힘이면 0행");
    await openSecurityPage();
    assert.equal(await visible(), 1);
    const row = (await h.anon("select * from public.public_security_cert_status")).rows[0];
    assert.deepEqual(Object.keys(row).sort(), ["approved_on", "cert_kind", "other_kind_name"], "범위·비용·담당·명의 칸 없음");
    assert.equal(row.cert_kind, "iso27001");
    await setFlag("security_cert_plan", false);
    assert.equal(await visible(), 0, "기능 키 꺼짐 0행");
    await setFlag("security_cert_plan", true);
    await withdraw(p.id);
    assert.equal(await visible(), 0, "철회 뒤 0행");
  }));

test("권한 — anon·authenticated는 표·함수에 접근할 수 없다", () =>
  h.tx(async () => {
    assert.equal((await h.anon("select id from public.security_cert_plans")).ok, false);
    assert.equal((await h.anon("select public.security_cert_gate_open()")).ok, false);
    assert.equal((await h.anon("select public.security_cert_plan_approve(1, 'admin:x')")).ok, false);
    assert.equal((await h.anon("insert into public.security_cert_audit (plan_id, action, outcome, code, actor) values (1, 'approve', 'ok', 'ok', 'x')")).ok, false);
  }));
