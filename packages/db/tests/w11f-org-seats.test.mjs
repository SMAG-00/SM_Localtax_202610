// W11-f DB — 기관 · 계약 · 좌석 · 확인표 · 세금계산서 요청 (마이그레이션 20261025000131 · 132 · 135, PRD-03 BIZ-07·PAY-04)
//  · 씨앗 — 기능 키 institution_subscription·premium_reports·institution_inquiry 꺼짐, anon·authenticated는 표·함수 0
//  · 확인표 — 승인 행은 위치·검토자·검토일 필수, 승인 전 계약 개통·초대 거부, 가장 최근 행이 반려면 다시 거부, 추가만
//  · 좌석 — n좌석: n번째 초대 성공·n+1번째 거부, 회수하면 즉시 다시 초대 가능, 비관리자 초대 거부, 좌석 수를 사용량 아래로 줄일 수 없음
//  · 권한 — 수락해야 권한(source org) 생성, 계약 범위(디지털·리포트)별 키, 같은 기관 중복 좌석 거부, 만료·재사용 초대 거부
//  · 경계 — 종료일 당일 23:59:59 KST 허용, 다음 날 00:00:00 KST 거부, 회수 시각 직전 허용·그 시각부터 거부, 종료일 앞당김·연장이 모든 좌석에 반영
//  · 세금계산서 — 사업자 정보 없으면 접수 불가, 비관리자 거부, 수기 발행 기록 필수, 매출 원장 뷰에 식별 칸 0
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0). 내용은 시험용 가짜다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
    return { ok: false, code: err.code, message: err.message };
  }
}
let seq = 0;
const authUser = async () => (await client.query("insert into auth.users (id) values (gen_random_uuid()) returning id")).rows[0].id;
const hash = () => createHash("sha256").update(`t-${process.pid}-${++seq}`).digest("hex");
const KST = (s) => `${s}+09:00`;

async function mkOrg(extra = {}) {
  const o = { name: "시험기관", org_type: "local_government", business_no: null, tax_invoice_email: null, ...extra };
  return (await client.query(
    "insert into public.orgs (name, org_type, business_no, tax_invoice_email, created_by) values ($1,$2,$3,$4,'test') returning id",
    [o.name, o.org_type, o.business_no, o.tax_invoice_email])).rows[0].id;
}
async function approve(org, status = "approved") {
  await client.query(
    "insert into public.org_security_reviews (org_id, status, checklist_ref, reviewer, reviewed_on, created_by) values ($1,$2,$3,$4,$5,'test')",
    [org, status, status === "approved" ? "시험용 확인표 위치" : null, status === "approved" ? "시험 검토자" : null, status === "approved" ? "2026-10-25" : null]);
}
async function mkContract(org, { seats = 2, starts = "2026-11-01", ends = "2026-12-31", digital = true, reports = true, amount = null, activate = true } = {}) {
  const id = (await client.query(
    `insert into public.org_contracts (org_id, contract_ref, seats, starts_on, ends_on, includes_digital, includes_reports, amount, edited_by)
     values ($1, '시험용 계약서 위치', $2, $3, $4, $5, $6, $7, 'test') returning id`,
    [org, seats, starts, ends, digital, reports, amount])).rows[0].id;
  if (activate) await client.query("select public.org_contract_activate($1, 'test', $2)", [id, KST("2026-10-30T00:00:00")]);
  return id;
}
const invite = (actor, org, h, at = KST("2026-11-01T09:00:00")) =>
  attempt("select public.org_seat_invite($1,$2,$3,$4,$5) as id", [actor, org, h, KST("2027-03-01T00:00:00"), at]);
const accept = (user, h, at = KST("2026-11-01T09:00:00")) =>
  attempt("select public.org_seat_accept($1,$2,$3) as id", [user, h, at]);
const has = async (user, key, at) =>
  (await client.query("select public.has_entitlement($1,$2,$3) as ok", [user, key, at])).rows[0].ok;
const hasCode = (r, code) => r.ok === false && r.message.startsWith(`org:${code}`);

test("씨앗 - 새 기능 키 3개는 꺼짐이고 anon·authenticated는 기관 표·함수에 접근할 수 없다", async () => tx(async () => {
  const f = (await client.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  for (const k of ["institution_subscription", "premium_reports", "institution_inquiry"]) assert.equal(f[k], false, k);
  for (const role of ["anon", "authenticated"]) {
    for (const t of ["orgs", "org_contracts", "org_seats", "org_admins", "org_security_reviews", "tax_invoice_requests", "org_revenue_ledger"]) {
      const r = await attempt(`select count(*) from public.${t}`, [], role);
      assert.equal(r.ok, false, `${role} ${t}`);
      assert.equal(r.code, "42501", `${role} ${t}`);
    }
    const fn = await attempt("select public.org_seat_accept(null, $1, now())", [hash()], role);
    assert.equal(fn.ok, false, `${role} 함수`);
    assert.equal(fn.code, "42501");
  }
}));

test("확인표 - 승인 행은 위치·검토자·검토일이 없으면 거부, 승인 전에는 계약 개통·초대가 거부된다", async () => tx(async () => {
  const org = await mkOrg();
  const bad = await attempt("insert into public.org_security_reviews (org_id, status, created_by) values ($1,'approved','test')", [org]);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "23514");
  const c = await mkContract(org, { activate: false });
  const act = await attempt("select public.org_contract_activate($1,'test',$2)", [c, KST("2026-10-30T00:00:00")]);
  assert.equal(act.ok, false);
  assert.match(act.message, /org:security_not_approved/);
  const direct = await attempt("update public.org_contracts set status = 'active' where id = $1", [c]);
  assert.equal(direct.ok, false, "update로 우회 개통 불가");
  assert.match(direct.message, /org:security_not_approved/);
  await approve(org, "requested");
  assert.equal((await client.query("select public.org_security_approved($1) as ok", [org])).rows[0].ok, false);
}));

test("확인표 - 가장 최근 행이 반려이면 이미 개통된 계약이라도 새 초대는 거부되고, 행은 수정·삭제할 수 없다", async () => tx(async () => {
  const org = await mkOrg();
  await approve(org);
  const c = await mkContract(org);
  assert.ok(c);
  assert.ok((await invite(null, org, hash())).ok);
  await approve(org, "rejected");
  const r = await invite(null, org, hash());
  assert.ok(hasCode(r, "security_not_approved"), r.message);
  const upd = await attempt("update public.org_security_reviews set status = 'approved' where org_id = $1", [org]);
  assert.equal(upd.ok, false);
  const del = await attempt("delete from public.org_security_reviews where org_id = $1", [org]);
  assert.equal(del.ok, false);
}));

test("좌석 n·n+1 - 2좌석 계약에서 2번째 초대는 성공하고 3번째는 거부, 회수하면 즉시 다시 초대할 수 있다", async () => tx(async () => {
  const org = await mkOrg();
  const admin = await authUser();
  await client.query("insert into public.org_admins (org_id, user_id, added_by) values ($1,$2,'test')", [org, admin]);
  await approve(org);
  await mkContract(org, { seats: 2 });
  const a = await invite(admin, org, hash());
  const b = await invite(admin, org, hash());
  const c = await invite(admin, org, hash());
  assert.ok(a.ok && b.ok);
  assert.ok(hasCode(c, "seat_limit"), c.message);
  assert.equal((await attempt("select public.org_seat_revoke($1,$2,'admin_revoke',$3)", [admin, a.rows[0].id, KST("2026-11-01T10:00:00")])).ok, true);
  const d = await invite(admin, org, hash());
  assert.ok(d.ok, "회수한 좌석은 즉시 돌아온다");
  const e = await invite(admin, org, hash());
  assert.ok(hasCode(e, "seat_limit"));
}));

test("좌석 1개 계약 - 경계 n=1: 첫 초대 성공, 두 번째 거부 / 비관리자·다른 기관 관리자는 초대할 수 없다", async () => tx(async () => {
  const org = await mkOrg();
  const other = await mkOrg();
  const admin = await authUser();
  const stranger = await authUser();
  await client.query("insert into public.org_admins (org_id, user_id, added_by) values ($1,$2,'test'), ($3,$2,'test')", [org, admin, other]);
  await approve(org);
  await mkContract(org, { seats: 1 });
  assert.ok(hasCode(await invite(stranger, org, hash()), "not_admin"));
  assert.ok(hasCode(await invite(admin, other, hash()), "not_admin") || hasCode(await invite(admin, other, hash()), "no_active_contract"));
  assert.ok((await invite(admin, org, hash())).ok);
  assert.ok(hasCode(await invite(admin, org, hash()), "seat_limit"));
}));

test("좌석 수 - 사용 중인 좌석보다 적게 계약 좌석을 줄일 수 없다", async () => tx(async () => {
  const org = await mkOrg();
  await approve(org);
  const c = await mkContract(org, { seats: 3 });
  await invite(null, org, hash());
  await invite(null, org, hash());
  const low = await attempt("update public.org_contracts set seats = 1 where id = $1", [c]);
  assert.equal(low.ok, false);
  assert.match(low.message, /org:seats_below_usage/);
  assert.ok((await attempt("update public.org_contracts set seats = 2 where id = $1", [c])).ok);
}));

test("수락 - 수락 전에는 권한 0, 수락하면 디지털·리포트 권한 2건(source org), 같은 초대 재사용·만료·중복 좌석은 거부", async () => tx(async () => {
  const org = await mkOrg();
  await approve(org);
  await mkContract(org, { seats: 3 });
  const user = await authUser();
  const h1 = hash();
  assert.ok((await invite(null, org, h1)).ok);
  assert.equal(await has(user, "premium_report", KST("2026-11-01T09:30:00")), false, "수락 전 권한 0");
  assert.ok((await accept(user, h1)).ok);
  assert.equal(await has(user, "premium_report", KST("2026-11-01T09:30:00")), true);
  assert.equal(await has(user, "digital", KST("2026-11-01T09:30:00")), true);
  const rows = (await client.query("select key, source from public.entitlements where user_id = $1 order by key", [user])).rows;
  assert.deepEqual(rows, [{ key: "digital", source: "org" }, { key: "premium_report", source: "org" }]);
  assert.ok(hasCode(await accept(user, h1), "invite_invalid"), "같은 초대 재사용 거부");
  const h2 = hash();
  await invite(null, org, h2);
  assert.ok(hasCode(await accept(user, h2), "already_seated"), "같은 기관 중복 좌석 거부");
  const h3 = hash();
  const other = await authUser();
  await invite(null, org, h3, KST("2026-11-01T09:00:00"));
  assert.ok(hasCode(await accept(other, h3, KST("2027-03-01T00:00:00")), "invite_expired") || hasCode(await accept(other, h3, KST("2027-03-01T00:00:00")), "no_active_contract"));
  assert.ok(hasCode(await accept(null, h3), "login_required"));
}));

test("범위 - 리포트만 포함한 계약은 premium_report 권한만, 디지털만 포함한 계약은 digital 권한만 만든다", async () => tx(async () => {
  const orgA = await mkOrg();
  const orgB = await mkOrg();
  await approve(orgA);
  await approve(orgB);
  await mkContract(orgA, { digital: false, reports: true });
  await mkContract(orgB, { digital: true, reports: false });
  const ua = await authUser();
  const ub = await authUser();
  const ha = hash();
  const hb = hash();
  await invite(null, orgA, ha);
  await invite(null, orgB, hb);
  await accept(ua, ha);
  await accept(ub, hb);
  const at = KST("2026-11-02T00:00:00");
  assert.deepEqual([await has(ua, "premium_report", at), await has(ua, "digital", at)], [true, false]);
  assert.deepEqual([await has(ub, "premium_report", at), await has(ub, "digital", at)], [false, true]);
  const none = await attempt("insert into public.org_contracts (org_id, seats, starts_on, ends_on, includes_digital, includes_reports, edited_by) values ($1,1,'2026-11-01','2026-11-30',false,false,'test')", [orgA]);
  assert.equal(none.ok, false, "포함 범위가 하나도 없는 계약 거부");
}));

test("종료일 경계 - 종료일 12-31 23:59:59 KST는 허용, 다음 날 00:00:00 KST부터 거부, 시작일 전에는 거부", async () => tx(async () => {
  const org = await mkOrg();
  await approve(org);
  await mkContract(org, { starts: "2026-11-01", ends: "2026-12-31" });
  const user = await authUser();
  const h = hash();
  await invite(null, org, h, KST("2026-10-31T10:00:00"));
  assert.ok((await accept(user, h, KST("2026-10-31T10:30:00"))).ok);
  assert.equal(await has(user, "premium_report", KST("2026-10-31T23:59:59")), false, "시작일 전 거부");
  assert.equal(await has(user, "premium_report", KST("2026-11-01T00:00:00")), true, "시작일 00:00부터 허용");
  assert.equal(await has(user, "premium_report", KST("2026-12-31T00:00:00")), true, "종료일 당일 허용");
  assert.equal(await has(user, "premium_report", KST("2026-12-31T23:59:59")), true, "종료일 마지막 초 허용");
  assert.equal(await has(user, "premium_report", KST("2027-01-01T00:00:00")), false, "다음 날 00:00 KST 거부");
  assert.equal(await has(user, "digital", KST("2027-01-01T00:00:00")), false);
}));

test("회수 - 회수 직전 요청은 허용, 회수 시각부터 거부, 다른 좌석 사용자는 영향 없음", async () => tx(async () => {
  const org = await mkOrg();
  await approve(org);
  await mkContract(org, { seats: 2 });
  const u1 = await authUser();
  const u2 = await authUser();
  const h1 = hash();
  const h2 = hash();
  const s1 = (await invite(null, org, h1)).rows[0].id;
  await invite(null, org, h2);
  await accept(u1, h1);
  await accept(u2, h2);
  const at = KST("2026-11-05T12:00:00");
  assert.equal(await has(u1, "premium_report", KST("2026-11-05T11:59:59")), true);
  assert.ok((await attempt("select public.org_seat_revoke(null,$1,'admin_revoke',$2)", [s1, at])).ok);
  assert.equal(await has(u1, "premium_report", KST("2026-11-05T11:59:59")), true, "회수 시각 이전 시각은 그대로 허용");
  assert.equal(await has(u1, "premium_report", at), false, "회수 시각부터 거부");
  assert.equal(await has(u1, "digital", at), false);
  assert.equal(await has(u2, "premium_report", at), true);
  const again = await attempt("select public.org_seat_revoke(null,$1,'admin_revoke',$2)", [s1, at]);
  assert.ok(again.ok, "두 번 회수해도 오류 없음");
}));

test("계약 종료일 변경 - 앞당기면 모든 좌석 권한이 새 종료일 다음 날 00:00 KST에 끝나고, 연장하면 함께 늘어난다", async () => tx(async () => {
  const org = await mkOrg();
  await approve(org);
  const c = await mkContract(org, { seats: 2 });
  const u1 = await authUser();
  const u2 = await authUser();
  const h1 = hash();
  const h2 = hash();
  await invite(null, org, h1);
  await invite(null, org, h2);
  await accept(u1, h1);
  await accept(u2, h2);
  const now = KST("2026-11-15T09:00:00");
  assert.ok((await attempt("select public.org_contract_set_end($1, '2026-11-15', 'test', $2)", [c, now])).ok);
  for (const u of [u1, u2]) {
    assert.equal(await has(u, "premium_report", KST("2026-11-15T23:59:59")), true, "새 종료일 당일 허용");
    assert.equal(await has(u, "premium_report", KST("2026-11-16T00:00:00")), false, "새 종료일 다음 날 거부");
  }
  assert.equal((await client.query("select status from public.org_contracts where id = $1", [c])).rows[0].status, "active");
  assert.ok((await attempt("select public.org_contract_set_end($1, '2027-01-31', 'test', $2)", [c, now])).ok);
  assert.equal(await has(u1, "premium_report", KST("2027-01-31T23:59:59")), true);
  assert.equal(await has(u1, "premium_report", KST("2027-02-01T00:00:00")), false);
  const before = await attempt("select public.org_contract_set_end($1, '2026-10-01', 'test', $2)", [c, now]);
  assert.ok(hasCode(before, "end_before_start"));
}));

test("정리 작업 - 종료 시각이 지난 계약은 ended, 남은 좌석은 회수 처리되고 아직 안 지난 계약은 그대로", async () => tx(async () => {
  const org = await mkOrg();
  await approve(org);
  await mkContract(org, { seats: 2, ends: "2026-12-31" });
  const user = await authUser();
  const h = hash();
  await invite(null, org, h);
  await accept(user, h);
  const n0 = await attempt("select public.org_contracts_close_expired($1) as n", [KST("2026-12-31T23:59:59")]);
  assert.equal(n0.rows[0].n, 0);
  const n1 = await attempt("select public.org_contracts_close_expired($1) as n", [KST("2027-01-01T00:00:00")]);
  assert.equal(n1.rows[0].n, 1);
  assert.equal((await client.query("select status from public.org_contracts where org_id = $1", [org])).rows[0].status, "ended");
  assert.equal((await client.query("select status from public.org_seats where org_id = $1", [org])).rows[0].status, "revoked");
}));

test("세금계산서 요청 - 사업자 정보 없으면 접수 불가, 비관리자 거부, 수기 발행 기록(번호·날짜·담당) 있어야 issued", async () => tx(async () => {
  const noInfo = await mkOrg();
  const full = await mkOrg({ business_no: "1234567890", tax_invoice_email: "tax@example.com" });
  const admin = await authUser();
  const stranger = await authUser();
  await client.query("insert into public.org_admins (org_id, user_id, added_by) values ($1,$2,'test'), ($3,$2,'test')", [noInfo, admin, full]);
  await approve(noInfo);
  await approve(full);
  const c1 = await mkContract(noInfo, { amount: 1000 });
  const c2 = await mkContract(full, { amount: 2000 });
  const miss = await attempt("select public.tax_invoice_request_create($1,$2,$3,'tax_invoice',1000)", [admin, noInfo, c1]);
  assert.equal(miss.ok, false);
  assert.match(miss.message, /tax_invoice:business_info_missing/);
  const notAdmin = await attempt("select public.tax_invoice_request_create($1,$2,$3,'tax_invoice',2000)", [stranger, full, c2]);
  assert.match(notAdmin.message, /tax_invoice:not_admin/);
  const wrongContract = await attempt("select public.tax_invoice_request_create($1,$2,$3,'tax_invoice',2000)", [admin, full, c1]);
  assert.match(wrongContract.message, /tax_invoice:no_contract/);
  const ok = await attempt("select public.tax_invoice_request_create($1,$2,$3,'tax_invoice',2000) as id", [admin, full, c2]);
  assert.ok(ok.ok);
  const row = (await client.query("select status, business_no_snapshot, supply_amount from public.tax_invoice_requests where id = $1", [ok.rows[0].id])).rows[0];
  assert.deepEqual(row, { status: "requested", business_no_snapshot: "1234567890", supply_amount: 2000 });
  const noRecord = await attempt("update public.tax_invoice_requests set status = 'issued' where id = $1", [ok.rows[0].id]);
  assert.equal(noRecord.ok, false, "발행 기록 없이 issued 불가(권한상 update 자체가 막힘)");
  const issued = await attempt("select public.tax_invoice_mark_issued($1,'수기-0001','2026-11-02','담당자')", [ok.rows[0].id]);
  assert.ok(issued.ok);
  assert.equal((await client.query("select status from public.tax_invoice_requests where id = $1", [ok.rows[0].id])).rows[0].status, "issued");
  const twice = await attempt("select public.tax_invoice_mark_issued($1,'수기-0002','2026-11-03','담당자')", [ok.rows[0].id]);
  assert.match(twice.message, /tax_invoice:not_requested/);
}));

test("매출 원장 뷰 - 상품·기관 유형·기간·좌석·금액만 있고 기관명·사업자번호·회원·메일 칸이 없다", async () => tx(async () => {
  const org = await mkOrg({ business_no: "1234567891", tax_invoice_email: "ledger@example.com" });
  await approve(org);
  await mkContract(org, { seats: 5, amount: 5000 });
  const rows = (await client.query("select * from public.org_revenue_ledger")).rows;
  assert.equal(rows.length >= 1, true);
  const mine = rows.find((r) => r.seats === 5 && r.amount === 5000);
  assert.ok(mine);
  assert.deepEqual(Object.keys(mine).sort(), ["amount", "ends_on", "org_type", "product_id", "seats", "starts_on", "status"]);
  const cols = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'org_revenue_ledger'")).rows.map((r) => r.column_name);
  for (const bad of ["name", "business_no", "user_id", "email", "tax_invoice_email", "org_id"]) assert.ok(!cols.includes(bad), bad);
}));
