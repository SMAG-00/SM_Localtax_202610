// W11-f DB — 프리미엄 리포트 · 견적 요청 · 파기 (마이그레이션 20261025000133 · 134, PRD-03 BIZ-07)
//  · 리포트 — 미리보기 길이 설정(premium_report_policy)이 없으면 본문 저장 거부, 설정 길이 초과 거부, 발행은 기준일·출처·세무 감수·편집 승인·법률 검토 기록이 모두 있어야 함
//  · 읽기 — has_entitlement(premium_report) 있는 회원만 본문, 개인 디지털 구독자·비좌석·비회원·초안은 null, 공개 뷰에는 본문 칸 없음
//  · 개인 구독 경로 — read_paid_body·public_paid_previews·public_digital_plans가 premium_report 종류를 건너뜀
//  · 견적 요청 — 연락 동의 필수·이메일 형식·소식 수신 동의 별도(기본 해제), 보존일 = 접수 한국 날짜 + 설정 일수, 정책이 비면 접수 0
//  · 파기 — 보존일 당일은 유지·다음 날 개인 칸 비움, 접수번호는 남음
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
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
const authUser = async () => (await client.query("insert into auth.users (id) values (gen_random_uuid()) returning id")).rows[0].id;
async function flags(patch) {
  const cur = (await client.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  await client.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...patch })]);
}
const setPolicy = (key, value) => client.query("update public.settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);
const PREVIEW = "시험용 미리보기입니다. ".repeat(3).trim(); // 가짜 글자
const BODY = "시험용 본문입니다. 지어낸 문장이며 실제 리포트가 아닙니다. ".repeat(10);

async function mkReport({ publish = true, sale = true, preview = PREVIEW } = {}) {
  const slug = uniq("rpt");
  await client.query("insert into public.premium_reports (slug, title, period_label, edited_by) values ($1, '시험 리포트', '2026-Q4', 'test')", [slug]);
  await client.query(
    `insert into public.paid_bodies (kind, ref_key, title, preview, body, sale_allowed, rights_ref, sale_confirmed_on, edited_by)
     values ('premium_report', $1, '시험 리포트', $2, $3, $4, $5, $6, 'test')`,
    [slug, preview, BODY, sale, sale ? "시험용 권리 확인 위치" : null, sale ? "2026-10-25" : null]);
  if (publish) {
    await client.query(
      `update public.premium_reports set status = 'published', as_of = '2026-09-30', sources = '[{"title":"시험 출처"}]'::jsonb,
         tax_reviewer = '시험 감수자', tax_reviewed_on = '2026-10-20', editor_approved_by = '시험 편집장', editor_approved_on = '2026-10-21',
         legal_review_ref = '시험용 법률 검토 위치', published_at = '2026-10-22T00:00:00+09' where slug = $1`, [slug]);
  }
  return slug;
}

test("정책 - 미리보기 길이 설정이 비어 있으면 리포트 본문 저장 거부, 범위 밖 설정값 거부, 설정 길이 초과 미리보기 거부", async () => tx(async () => {
  await setPolicy("premium_report_policy", {});
  const slug = uniq("rpt");
  await client.query("insert into public.premium_reports (slug, title, period_label, edited_by) values ($1, '시험', '2026-Q4', 'test')", [slug]);
  const noPolicy = await attempt(
    "insert into public.paid_bodies (kind, ref_key, title, preview, body, edited_by) values ('premium_report',$1,'시험',$2,$3,'test')", [slug, PREVIEW, BODY]);
  assert.equal(noPolicy.ok, false);
  assert.match(noPolicy.message, /premium_report_policy/);
  assert.equal((await attempt("update public.settings set value = '{\"preview_max_chars\": 10}'::jsonb where key = 'premium_report_policy'")).ok, false);
  assert.equal((await attempt("update public.settings set value = '{\"preview_max_chars\": 401}'::jsonb where key = 'premium_report_policy'")).ok, false);
  assert.equal((await attempt("update public.settings set value = '{\"other\": 100}'::jsonb where key = 'premium_report_policy'")).ok, false);
  await setPolicy("premium_report_policy", { preview_max_chars: 50 });
  const edge = await attempt(
    "insert into public.paid_bodies (kind, ref_key, title, preview, body, edited_by) values ('premium_report',$1,'시험',$2,$3,'test')", [slug, "가".repeat(50), BODY]);
  assert.ok(edge.ok, "정확히 50자는 허용");
  await client.query("delete from public.paid_bodies where ref_key = $1", [slug]);
  const over = await attempt(
    "insert into public.paid_bodies (kind, ref_key, title, preview, body, edited_by) values ('premium_report',$1,'시험',$2,$3,'test')", [slug, "가".repeat(51), BODY]);
  assert.equal(over.ok, false, "51자는 거부");
  const orphan = await attempt(
    "insert into public.paid_bodies (kind, ref_key, title, preview, body, edited_by) values ('premium_report','no-such-report','시험',$1,$2,'test')", [PREVIEW, BODY]);
  assert.equal(orphan.ok, false, "리포트 메타 없는 본문 거부");
}));

test("발행 기록 - 기준일·출처·세무 감수·편집 승인·법률 검토 중 하나라도 비면 published 거부", async () => tx(async () => {
  const slug = uniq("rpt");
  await client.query("insert into public.premium_reports (slug, title, period_label, edited_by) values ($1, '시험', '2026-Q4', 'test')", [slug]);
  const full = {
    as_of: "2026-09-30", sources: '[{"title":"시험 출처"}]', tax_reviewer: "감수자", tax_reviewed_on: "2026-10-20",
    editor_approved_by: "편집장", editor_approved_on: "2026-10-21", legal_review_ref: "법률 검토 위치", published_at: "2026-10-22T00:00:00+09",
  };
  const publish = (over) => {
    const v = { ...full, ...over };
    return attempt(
      `update public.premium_reports set status='published', as_of=$2, sources=$3::jsonb, tax_reviewer=$4, tax_reviewed_on=$5,
        editor_approved_by=$6, editor_approved_on=$7, legal_review_ref=$8, published_at=$9 where slug=$1`,
      [slug, v.as_of, v.sources, v.tax_reviewer, v.tax_reviewed_on, v.editor_approved_by, v.editor_approved_on, v.legal_review_ref, v.published_at]);
  };
  for (const [name, over] of Object.entries({
    기준일: { as_of: null }, 출처: { sources: "[]" }, 세무감수: { tax_reviewer: null }, 감수일: { tax_reviewed_on: null },
    편집승인: { editor_approved_by: null }, 법률검토: { legal_review_ref: null }, 발행시각: { published_at: null },
  })) {
    const r = await publish(over);
    assert.equal(r.ok, false, `${name} 없이 발행 불가`);
    assert.equal(r.code, "23514", name);
  }
  assert.ok((await publish({})).ok);
  assert.equal((await attempt("insert into public.premium_reports (slug, title, period_label, edited_by) values ('Bad Slug', '시험', '2026Q4', 'test')")).ok, false);
}));

test("읽기 - 리포트 좌석(premium_report 권한)만 본문, 개인 디지털 구독자·권한 없는 회원·비회원·초안·권리 미확인은 null", async () => tx(async () => {
  await setPolicy("premium_report_policy", { preview_max_chars: 100 });
  const slug = await mkReport();
  const draft = await mkReport({ publish: false });
  const noRights = await mkReport({ sale: false });
  const seat = await authUser();
  const digitalOnly = await authUser();
  const nobody = await authUser();
  await client.query(
    `insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until) values
       ($1,'premium_report','org',$3,'2026-01-01T00:00:00+09','2027-01-01T00:00:00+09'),
       ($2,'digital','manual',$4,'2026-01-01T00:00:00+09','2027-01-01T00:00:00+09')`,
    [seat, digitalOnly, uniq("seat:report"), uniq("manual")]);
  const read = async (user, s, at = "2026-11-01T00:00:00+09") =>
    (await client.query("select public.read_premium_report($1,$2,$3) as body", [user, s, at])).rows[0].body;
  assert.equal(await read(seat, slug), BODY);
  assert.equal(await read(digitalOnly, slug), null, "개인 디지털 구독자는 리포트 전문 0");
  assert.equal(await read(nobody, slug), null);
  assert.equal(await read(null, slug), null);
  assert.equal(await read(seat, draft), null, "초안은 좌석에게도 0");
  assert.equal(await read(seat, noRights), null, "판매 권리 미확인은 0");
  assert.equal(await read(seat, slug, "2027-01-01T00:00:00+09"), null, "권한 끝 시각부터 0");
  assert.equal(await read(seat, slug, "2026-12-31T23:59:59+09"), BODY, "끝 시각 직전은 허용");
  const viaOld = await client.query("select public.read_paid_body($1,'premium_report',$2,'2026-11-01T00:00:00+09') as body", [digitalOnly, slug]);
  assert.equal(viaOld.rows[0].body, null, "기존 읽기 함수로 리포트 본문을 읽을 수 없다");
  const viaOldSeat = await client.query("select public.read_paid_body($1,'premium_report',$2,'2026-11-01T00:00:00+09') as body", [seat, slug]);
  assert.equal(viaOldSeat.rows[0].body, null);
}));

test("공개 미리보기 뷰 - 기능 키가 꺼지면 0행, 켜지면 발행·권리 확인·정책 길이 이하인 것만, 본문 칸 없음, 개인 구독 뷰에는 리포트 0", async () => tx(async () => {
  await setPolicy("premium_report_policy", { preview_max_chars: 100 });
  const slug = await mkReport();
  await mkReport({ publish: false });
  await mkReport({ sale: false });
  await flags({ premium_reports: false, paywall: true });
  const off = await attempt("select slug from public.public_premium_report_previews", [], "anon");
  assert.deepEqual(off.rows, []);
  await flags({ premium_reports: true });
  const on = await attempt("select * from public.public_premium_report_previews", [], "anon");
  assert.ok(on.ok);
  assert.deepEqual(on.rows.map((r) => r.slug), [slug]);
  assert.deepEqual(Object.keys(on.rows[0]).sort(), ["as_of", "period_label", "preview", "published_at", "slug", "sources", "tax_reviewed_on", "tax_reviewer", "title"]);
  assert.equal(on.rows[0].preview, PREVIEW);
  assert.ok(!JSON.stringify(on.rows).includes("지어낸 문장"), "본문 글자 0");
  await setPolicy("premium_report_policy", {});
  assert.deepEqual((await attempt("select slug from public.public_premium_report_previews", [], "anon")).rows, [], "정책이 비면 공개 0");
  await setPolicy("premium_report_policy", { preview_max_chars: 100 });
  const old = await attempt("select ref_key from public.public_paid_previews where kind = 'premium_report'", [], "anon");
  assert.deepEqual(old.rows, [], "기존 유료 미리보기 뷰에 리포트 종류 0");
  const direct = await attempt("select body from public.paid_bodies", [], "anon");
  assert.equal(direct.ok, false);
  assert.equal(direct.code, "42501");
  const meta = await attempt("select slug from public.premium_reports", [], "authenticated");
  assert.equal(meta.ok, false);
  assert.equal(meta.code, "42501");
}));

test("견적 요청 - 연락 동의 없으면 거부, 소식 수신 동의는 기본 해제, 이메일 형식 오류 거부, 보존일 = 접수 한국 날짜 + 365일", async () => tx(async () => {
  const submit = (over = {}) => {
    const v = { receipt: uniq("RQ").replace(/[^A-Za-z0-9]/g, "").padEnd(10, "0").slice(0, 12), consent: true, marketing: null, email: "Buyer@Example.com", at: "2026-10-25T23:30:00+09", ...over };
    return attempt(
      "select public.institution_inquiry_submit($1,'tax_firm','시험 세무법인','홍시험',$2,'010-1234-5678',3,'시험 문의',$3,$4,'{}'::bigint[],$5) as id",
      [v.receipt, v.email, v.consent, v.marketing, v.at]);
  };
  const noConsent = await submit({ consent: false });
  assert.equal(noConsent.ok, false);
  assert.match(noConsent.message, /inquiry:consent_required/);
  const badEmail = await submit({ email: "not-an-email" });
  assert.equal(badEmail.ok, false);
  assert.equal(badEmail.code, "23514");
  const ok = await submit();
  assert.ok(ok.ok, ok.message);
  const row = (await client.query("select consent_marketing, contact_email, to_char(retention_until,'YYYY-MM-DD') as ru from public.institution_inquiries where id = $1", [ok.rows[0].id])).rows[0];
  assert.deepEqual(row, { consent_marketing: false, contact_email: "buyer@example.com", ru: "2027-10-25" });
  const withMarketing = await submit({ marketing: true });
  assert.equal((await client.query("select consent_marketing from public.institution_inquiries where id = $1", [withMarketing.rows[0].id])).rows[0].consent_marketing, true);
  const anon = await attempt("select * from public.institution_inquiries", [], "anon");
  assert.equal(anon.code, "42501");
}));

test("견적 요청 정책 - 보존 일수 설정이 비면 접수 0, 범위 밖 값 거부, 다른 일수는 보존일에 반영", async () => tx(async () => {
  const submit = (receipt) => attempt(
    "select public.institution_inquiry_submit($1,'financial','시험 기관','홍시험','a@example.com',null,1,null,true,false,'{}'::bigint[],$2) as id",
    [receipt, "2026-10-25T10:00:00+09"]);
  await setPolicy("institution_inquiry_policy", {});
  const closed = await submit("CLOSED0001");
  assert.equal(closed.ok, false);
  assert.match(closed.message, /inquiry:policy_missing/);
  assert.equal((await attempt("update public.settings set value = '{\"retention_days\": 5}'::jsonb where key = 'institution_inquiry_policy'")).ok, false);
  assert.equal((await attempt("update public.settings set value = '{\"retention_days\": 1096}'::jsonb where key = 'institution_inquiry_policy'")).ok, false);
  await setPolicy("institution_inquiry_policy", { retention_days: 30 });
  const r = await submit("OPEN000001");
  assert.ok(r.ok);
  assert.equal((await client.query("select to_char(retention_until,'YYYY-MM-DD') as ru from public.institution_inquiries where id = $1", [r.rows[0].id])).rows[0].ru, "2026-11-24");
}));

test("파기 - 보존일 당일에는 유지되고 다음 날 개인 칸이 비워지며 접수번호·동의 시각은 남는다, 되살릴 수 없다", async () => tx(async () => {
  await setPolicy("institution_inquiry_policy", { retention_days: 30 });
  const r = await attempt(
    "select public.institution_inquiry_submit('PURGE00001','local_government','시험 지자체','홍시험','p@example.com','02-123-4567',10,'시험 문의',true,true,'{}'::bigint[],'2026-10-25T10:00:00+09') as id");
  const id = r.rows[0].id;
  const n0 = await attempt("select public.institution_inquiries_purge($1) as n", ["2026-11-24T23:59:59+09"]);
  assert.equal(n0.rows[0].n, 0, "보존일 당일(2026-11-24)은 유지");
  const n1 = await attempt("select public.institution_inquiries_purge($1) as n", ["2026-11-25T00:00:00+09"]);
  assert.equal(n1.rows[0].n, 1);
  const row = (await client.query("select receipt_no, org_name, contact_name, contact_email, contact_phone, message, consent_contact_at is not null as has_consent, purged_at is not null as purged from public.institution_inquiries where id = $1", [id])).rows[0];
  assert.deepEqual(row, { receipt_no: "PURGE00001", org_name: null, contact_name: null, contact_email: null, contact_phone: null, message: null, has_consent: true, purged: true });
  const again = await attempt("select public.institution_inquiries_purge($1) as n", ["2026-12-31T00:00:00+09"]);
  assert.equal(again.rows[0].n, 0, "이미 파기한 행은 다시 세지 않는다");
  const revive = await attempt("update public.institution_inquiries set purged_at = null where id = $1", [id]);
  assert.equal(revive.ok, false);
}));
