// W10-f DB — 결제 기반 · 디지털 구독 · 유료 본문 (마이그레이션 20261025000095 · 96, PRD-02 PAY-02·03·05·07, BIZ-04, BRIEF-05)
//  · 씨앗 — 요금제·구독·주문·권한 0행, 실결제 준비 기록 0행, 기능 키 billing·digital_subscription·paywall 꺼짐
//  · 상품 — digital_subscription은 order_mode·billing_mode가 pg여야 하고, pg 상품은 W8 공개 뷰에 나오지 않는다
//  · 주문 — 기능 키 꺼짐·약관 확인 없음·판매 중 아닌 요금제 거부, 같은 멱등 키는 같은 주문, 금액은 요금제 데이터에서 복사, live는 준비 기록 없으면 DB가 거부, fake는 test만
//  · 결제 반영 — PG 조회 결과(DONE)로만 권한, 두 번 반영해도 한 번, 금액 불일치 거부, 오래된 조회 무시(취소가 승인보다 먼저 와도 최종 = 최근 조회), 환불은 권한 즉시 회수
//  · 권한 판정 — valid_until 직전 허용·그 시각부터 거부, 해지는 남은 기간 끝까지, 유예 마지막 날까지(한국 날짜) 이용
//  · 갱신 — 고지 기록 없으면 거부, 가격이 바뀌면 같은 금액의 새 고지가 있어야 하고, 고지 기한(설정 days, 기본 30)은 구독 기간보다 길 수 없다
//  · 웹훅 기록 — 같은 pg_event_id는 한 번만 처리
//  · 유료 본문 — anon·authenticated 표 권한 0, 구독자(권한 있음 + 판매 권리 확인)만 읽기 함수로 본문, 공개 미리보기 뷰에 본문 칸 없음
//  · 카드번호 패턴 0 — 결제 표의 모든 글자 칸 검사, 카드 칸 이름 0
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
/** 13~19자리 숫자열(공백·하이픈 허용)이면서 Luhn 검사를 통과하는 것 - 날짜·식별자 오탐을 줄인다 */
function cardLikeRuns(text) {
  const out = [];
  for (const m of text.matchAll(/(?<![0-9])[0-9](?:[ -]?[0-9]){12,18}(?![0-9])/g)) {
    const d = m[0].replace(/[ -]/g, "");
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      let n = Number(d[d.length - 1 - i]);
      if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
    }
    if (sum % 10 === 0) out.push(d);
  }
  return out;
}
let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
const authUser = async () => (await client.query("insert into auth.users (id) values (gen_random_uuid()) returning id")).rows[0].id;
async function flags(patch) {
  const cur = (await client.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  await client.query("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...patch })]);
}
const setting = (key, value) => client.query("update public.settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);
const rpc = async (fn, args, role = "service_role") => {
  const ph = args.map((_, i) => `$${i + 1}`).join(", ");
  return attempt(`select public.${fn}(${ph}) as r`, args, role);
};

/** 시험용 상품 + 월·연 요금제. 금액은 지어낸 시험 값이다 */
async function catalog(over = {}) {
  const p = (
    await client.query(
      `insert into public.products (slug, title, kind, order_mode, billing_mode, status, verified_on, verified_ref, edited_by)
       values ($1, '시험용 디지털 구독', 'digital_subscription', 'pg', 'pg', 'on_sale', '2026-10-20', '시험 확인 기록', 'test') returning id`,
      [uniq("zz-digital")],
    )
  ).rows[0];
  const plan = async (key, months, amount, status = "active") =>
    (
      await client.query(
        `insert into public.product_plans (product_id, plan_key, title, period_months, amount, status, edited_by) values ($1, $2, $3, $4, $5, $6, 'test') returning id`,
        [p.id, key, `시험 ${key}`, months, amount, status],
      )
    ).rows[0].id;
  return { productId: p.id, monthly: await plan("monthly", 1, over.monthly ?? 7777), yearly: await plan("yearly", 12, over.yearly ?? 55555) };
}
async function open() {
  await flags({ billing: true, digital_subscription: true, paywall: true });
}
async function order(userId, planId, extra = {}) {
  const idem = extra.idem ?? uniq("idem-key");
  const r = await rpc("billing_create_order", [userId, planId, "fake", "test", idem, uniq("ORD"), extra.ack ?? true]);
  assert.ok(r.ok, r.message);
  return r.rows[0].r;
}
const at = (iso) => new Date(iso);
const apply = (orderNo, status, amount, t = new Date(), billingKey = "bk_test_0001") =>
  rpc("billing_apply_payment", [orderNo, status, amount, "pay_test_1", billingKey, t]);

test("씨앗 — 요금제·구독·주문·권한·준비 기록 0행, 기능 키 꺼짐", () =>
  tx(async () => {
    for (const t of ["product_plans", "subscriptions", "orders", "entitlements", "payment_events", "renewal_notices", "commerce_readiness", "paid_bodies"]) {
      assert.equal((await client.query(`select count(*)::int n from public.${t}`)).rows[0].n, 0, t);
    }
    const f = (await client.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
    for (const k of ["billing", "digital_subscription", "paywall"]) assert.equal(f[k], false, k);
  }));

test("상품 — 디지털 구독은 pg 방식이어야 하고, pg 상품은 W8 공개 뷰에 나오지 않는다", () =>
  tx(async () => {
    const bad = await attempt(
      `insert into public.products (slug, title, kind, order_mode, status, edited_by) values ($1, '시험', 'digital_subscription', 'request_form', 'draft', 't')`,
      [uniq("zz-bad")],
    );
    assert.equal(bad.ok, false);
    const bad2 = await attempt(
      `insert into public.products (slug, title, kind, order_mode, billing_mode, status, edited_by) values ($1, '시험', 'book', 'pg', 'pg', 'draft', 't')`,
      [uniq("zz-bad")],
    );
    assert.equal(bad2.ok, false);
    await flags({ store: true });
    const c = await catalog();
    const seen = (await client.query("select count(*)::int n from public.public_store_products where id = $1", [c.productId])).rows[0].n;
    assert.equal(seen, 0);
  }));

test("요금제 — 활성은 금액 0 거부, 일반 상품에는 못 둔다, 가격은 표의 데이터", () =>
  tx(async () => {
    const c = await catalog();
    const zero = await attempt("update public.product_plans set amount = 0 where id = $1", [c.monthly]);
    assert.equal(zero.ok, false);
    const book = (
      await client.query(
        `insert into public.products (slug, title, kind, order_mode, status, edited_by) values ($1, '시험 도서', 'book', 'request_form', 'draft', 't') returning id`,
        [uniq("zz-book")],
      )
    ).rows[0];
    const onBook = await attempt(
      `insert into public.product_plans (product_id, plan_key, title, period_months, amount, edited_by) values ($1, 'monthly', 't', 1, 100, 't')`,
      [book.id],
    );
    assert.equal(onBook.ok, false);
  }));

test("주문 — 기능 키 꺼짐 거부 · 약관 확인 없음 거부 · 초안 요금제 거부 · 같은 멱등 키는 같은 주문 · 금액은 요금제에서 복사", () =>
  tx(async () => {
    const c = await catalog({ monthly: 4321 });
    const u = await authUser();
    const closed = await rpc("billing_create_order", [u, c.monthly, "fake", "test", "idem-closed-1", "ORD-CLOSED-1", true]);
    assert.match(closed.message, /billing:closed/);
    await open();
    const noAck = await rpc("billing_create_order", [u, c.monthly, "fake", "test", "idem-noack-1", "ORD-NOACK-1", false]);
    assert.match(noAck.message, /billing:terms_ack_required/);
    const draftPlan = (
      await client.query(`insert into public.product_plans (product_id, plan_key, title, period_months, amount, status, edited_by) values ($1, 'draft1', 't', 1, 10, 'draft', 't') returning id`, [c.productId])
    ).rows[0].id;
    const unavailable = await rpc("billing_create_order", [u, draftPlan, "fake", "test", "idem-draft-1", "ORD-DRAFT-1", true]);
    assert.match(unavailable.message, /billing:plan_unavailable/);
    const o1 = await order(u, c.monthly, { idem: "idem-same-key-1" });
    assert.equal(o1.amount, 4321);
    assert.equal(o1.replayed, false);
    const o2 = await rpc("billing_create_order", [u, c.monthly, "fake", "test", "idem-same-key-1", "ORD-OTHER-99", true]);
    assert.equal(o2.rows[0].r.order_no, o1.order_no);
    assert.equal(o2.rows[0].r.replayed, true);
    assert.equal((await client.query("select count(*)::int n from public.orders where user_id = $1", [u])).rows[0].n, 1);
    // 요금제 금액을 바꿔도 이미 만든 주문 금액은 그대로
    await client.query("update public.product_plans set amount = 9999 where id = $1", [c.monthly]);
    assert.equal((await client.query("select amount from public.orders where order_no = $1", [o1.order_no])).rows[0].amount, 4321);
    const edit = await attempt("update public.orders set amount = 1 where order_no = $1", [o1.order_no]);
    assert.equal(edit.ok, false);
  }));

test("live 주문 — 실결제 준비 기록이 없으면 DB가 거부, 기록이 있으면 통과, 철회하면 다시 거부, fake는 test만", () =>
  tx(async () => {
    const c = await catalog();
    await open();
    const u = await authUser();
    const no = await rpc("billing_create_order", [u, c.monthly, "toss", "live", "idem-live-0001", "ORD-LIVE-0001", true]);
    assert.equal(no.ok, false);
    assert.match(no.message, /commerce_readiness/);
    const fakeLive = await rpc("billing_create_order", [u, c.monthly, "fake", "live", "idem-live-0002", "ORD-LIVE-0002", true]);
    assert.equal(fakeLive.ok, false);
    const rid = (
      await client.query(
        `insert into public.commerce_readiness (contract_ref, business_report_ref, policy_ref, vat_review_ref, confirmed_by, confirmed_on)
         values ('시험 위치 A', '시험 위치 B', '시험 위치 C', '시험 위치 D', 'test', '2026-10-25') returning id`,
      )
    ).rows[0].id;
    const yes = await rpc("billing_create_order", [u, c.monthly, "toss", "live", "idem-live-0003", "ORD-LIVE-0003", true]);
    assert.ok(yes.ok, yes.message);
    const edit = await attempt("update public.commerce_readiness set contract_ref = '바꿈' where id = $1", [rid]);
    assert.equal(edit.ok, false);
    await client.query("update public.commerce_readiness set revoked_at = now() where id = $1", [rid]);
    const u2 = await authUser();
    const again = await rpc("billing_create_order", [u2, c.monthly, "toss", "live", "idem-live-0004", "ORD-LIVE-0004", true]);
    assert.equal(again.ok, false);
    const del = await attempt("delete from public.commerce_readiness where id = $1", [rid]);
    assert.equal(del.ok, false);
  }));

test("결제 반영 — DONE이어야 권한, 두 번 반영해도 구독·권한 한 개, 고지 기록 생성", () =>
  tx(async () => {
    const c = await catalog({ monthly: 5000 });
    await open();
    const u = await authUser();
    const o = await order(u, c.monthly);
    assert.equal((await client.query("select public.has_entitlement($1, 'digital') as ok", [u])).rows[0].ok, false);
    const pending = await apply(o.order_no, "IN_PROGRESS", 5000);
    assert.equal(pending.rows[0].r.order_status, "created");
    assert.equal((await client.query("select public.has_entitlement($1, 'digital') as ok", [u])).rows[0].ok, false);
    const done = await apply(o.order_no, "DONE", 5000, new Date(Date.now() + 1000));
    assert.equal(done.rows[0].r.order_status, "paid");
    const again = await apply(o.order_no, "DONE", 5000, new Date(Date.now() + 2000));
    assert.equal(again.rows[0].r.changed, false);
    assert.equal((await client.query("select count(*)::int n from public.subscriptions where user_id = $1", [u])).rows[0].n, 1);
    assert.equal((await client.query("select count(*)::int n from public.entitlements where user_id = $1", [u])).rows[0].n, 1);
    assert.equal((await client.query("select public.has_entitlement($1, 'digital') as ok", [u])).rows[0].ok, true);
    const notice = (await client.query("select kind, amount from public.renewal_notices")).rows;
    assert.deepEqual(notice, [{ kind: "checkout", amount: 5000 }]);
    const sub = (await client.query("select auto_renew, billing_key from public.subscriptions where user_id = $1", [u])).rows[0];
    assert.equal(sub.auto_renew, true);
    const dup = await order(await authUser(), c.monthly);
    assert.ok(dup.order_no);
    const already = await rpc("billing_create_order", [u, c.monthly, "fake", "test", "idem-already-1", "ORD-ALREADY-1", true]);
    assert.match(already.message, /billing:already_subscribed/);
  }));

test("결제 반영 — 금액이 다르면 실패 처리하고 권한 0", () =>
  tx(async () => {
    const c = await catalog({ monthly: 5000 });
    await open();
    const u = await authUser();
    const o = await order(u, c.monthly);
    const r = await apply(o.order_no, "DONE", 4999);
    assert.equal(r.rows[0].r.order_status, "failed");
    assert.equal((await client.query("select failure_code from public.orders where order_no = $1", [o.order_no])).rows[0].failure_code, "amount_mismatch");
    assert.equal((await client.query("select public.has_entitlement($1, 'digital') as ok", [u])).rows[0].ok, false);
  }));

test("결제 반영 — 취소 조회가 승인 조회보다 먼저 반영돼도 최종 상태는 가장 최근 PG 조회(취소) 그대로", () =>
  tx(async () => {
    const c = await catalog({ monthly: 5000 });
    await open();
    const u = await authUser();
    const o = await order(u, c.monthly);
    const t1 = new Date(Date.now() + 1000);
    const t2 = new Date(Date.now() + 5000);
    const cancel = await apply(o.order_no, "CANCELED", 5000, t2);
    assert.equal(cancel.rows[0].r.order_status, "canceled");
    const late = await apply(o.order_no, "DONE", 5000, t1);
    assert.equal(late.rows[0].r.stale, true);
    assert.equal((await client.query("select status from public.orders where order_no = $1", [o.order_no])).rows[0].status, "canceled");
    assert.equal((await client.query("select count(*)::int n from public.entitlements where user_id = $1", [u])).rows[0].n, 0);
  }));

test("환불 — 결제된 주문의 취소 조회는 권한을 즉시 회수하고 구독을 닫는다", () =>
  tx(async () => {
    const c = await catalog({ monthly: 5000 });
    await open();
    const u = await authUser();
    const o = await order(u, c.monthly);
    await apply(o.order_no, "DONE", 5000, new Date(Date.now() + 1000));
    assert.equal((await client.query("select public.has_entitlement($1, 'digital') as ok", [u])).rows[0].ok, true);
    const r = await apply(o.order_no, "CANCELED", 5000, new Date(Date.now() + 2000));
    assert.equal(r.rows[0].r.order_status, "refunded");
    assert.equal((await client.query("select public.has_entitlement($1, 'digital') as ok", [u])).rows[0].ok, false);
    assert.equal((await client.query("select status, auto_renew from public.subscriptions where user_id = $1", [u])).rows[0].status, "canceled");
  }));

test("권한 판정 경계 — valid_until 직전(1ms 전)은 허용, 정확히 그 시각부터 거부, 시작 전 거부", () =>
  tx(async () => {
    const u = await authUser();
    const row = (await client.query(
      `insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until)
       values ($1, 'digital', 'manual', $2, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z') returning valid_until`,
      [u, uniq("ref")],
    )).rows[0];
    const has = async (iso) => (await client.query("select public.has_entitlement($1, 'digital', $2::timestamptz) as ok", [u, iso])).rows[0].ok;
    assert.equal(await has("2026-01-31T23:59:59.999Z"), true);
    assert.equal(await has(row.valid_until.toISOString()), false);
    assert.equal(await has("2026-02-01T00:00:00.001Z"), false);
    assert.equal(await has("2025-12-31T23:59:59Z"), false);
    assert.equal((await client.query("select public.has_entitlement($1, 'other') as ok", [u])).rows[0].ok, false);
  }));

test("해지 — 자동갱신만 끄고 남은 기간은 이용, 본인 구독만, 만기 뒤 정리하면 canceled", () =>
  tx(async () => {
    const c = await catalog();
    await open();
    const u = await authUser();
    const other = await authUser();
    const o = await order(u, c.monthly);
    await apply(o.order_no, "DONE", 7777, new Date(Date.now() + 1000));
    const sub = (await client.query("select id, current_period_end from public.subscriptions where user_id = $1", [u])).rows[0];
    const foreign = await rpc("billing_cancel_subscription", [other, sub.id]);
    assert.match(foreign.message, /billing:subscription_not_found/);
    const r = await rpc("billing_cancel_subscription", [u, sub.id]);
    assert.ok(r.ok, r.message);
    const row = (await client.query("select auto_renew, status, cancel_requested_at from public.subscriptions where id = $1", [sub.id])).rows[0];
    assert.equal(row.auto_renew, false);
    assert.equal(row.status, "active");
    assert.ok(row.cancel_requested_at);
    assert.equal((await client.query("select public.has_entitlement($1, 'digital') as ok", [u])).rows[0].ok, true);
    const after = new Date(sub.current_period_end.getTime() + 1000);
    assert.equal((await rpc("billing_close_lapsed", [after])).rows[0].r, 1);
    assert.equal((await client.query("select status from public.subscriptions where id = $1", [sub.id])).rows[0].status, "canceled");
    assert.equal((await client.query("select public.has_entitlement($1, 'digital', $2) as ok", [u, after])).rows[0].ok, false);
  }));

/** 만기가 1시간 지난 자동갱신 구독을 직접 만든다(고지 기록 선택). 기간은 지금 기준 상대값 */
async function dueSubscription(c, withNotice) {
  const u = await authUser();
  const end = new Date(Math.floor(Date.now() / 1000) * 1000 - 3600000);
  const start = (await client.query("select ($1::timestamptz - interval '1 month') as s", [end])).rows[0].s;
  const sub = (
    await client.query(
      `insert into public.subscriptions (user_id, product_id, plan_id, auto_renew, billing_key, current_period_start, current_period_end)
       values ($1, $2, $3, true, 'bk_test_0001', $4, $5) returning id`,
      [u, c.productId, c.monthly, start, end],
    )
  ).rows[0].id;
  await client.query(
    `insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until) values ($1, 'digital', 'subscription', $2, $3, $4)`,
    [u, sub, start, end],
  );
  if (withNotice) {
    await client.query(`insert into public.renewal_notices (subscription_id, kind, period_end, amount, notified_at) values ($1, 'checkout', $2, 7777, $3)`, [sub, end, start]);
  }
  return { u, sub, end };
}

test("갱신 — 고지 기록이 없으면 갱신 주문 0, 만기 전이면 거부, 있으면 주문 한 개(재호출은 같은 주문)", () =>
  tx(async () => {
    const c = await catalog({ monthly: 7777 });
    await open();
    const none = await dueSubscription(c, false);
    const after = (d, ms) => new Date(d.getTime() + ms);
    const r1 = await rpc("billing_create_renewal_order", [none.sub, "fake", "test", "ORD-RENEW-001", after(none.end, 1000)]);
    assert.match(r1.message, /billing:renewal_notice_missing/);
    assert.equal((await client.query("select count(*)::int n from public.orders where subscription_id = $1", [none.sub])).rows[0].n, 0);

    const ok = await dueSubscription(c, true);
    const early = await rpc("billing_create_renewal_order", [ok.sub, "fake", "test", "ORD-RENEW-002", after(ok.end, -1000)]);
    assert.match(early.message, /billing:not_due/);
    const r2 = await rpc("billing_create_renewal_order", [ok.sub, "fake", "test", "ORD-RENEW-003", after(ok.end, 1000)]);
    assert.ok(r2.ok, r2.message);
    assert.equal(r2.rows[0].r.amount, 7777);
    const r3 = await rpc("billing_create_renewal_order", [ok.sub, "fake", "test", "ORD-RENEW-004", after(ok.end, 300000)]);
    assert.equal(r3.rows[0].r.order_no, "ORD-RENEW-003");
    assert.equal(r3.rows[0].r.replayed, true);

    // 갱신 결제가 확인되면 같은 권한 행의 끝이 늘어난다 (이어지는 기간: 옛 끝 -> 옛 끝 + 1개월)
    const paid = await apply("ORD-RENEW-003", "DONE", 7777, new Date(Date.now() + 1000));
    assert.equal(paid.rows[0].r.order_status, "paid");
    assert.equal((await client.query("select count(*)::int n from public.entitlements where user_id = $1", [ok.u])).rows[0].n, 1);
    const sub = (await client.query("select current_period_start, current_period_end, ($1::timestamptz + interval '1 month') as want from public.subscriptions where id = $2", [ok.end, ok.sub])).rows[0];
    assert.equal(sub.current_period_start.toISOString(), ok.end.toISOString());
    assert.equal(sub.current_period_end.toISOString(), sub.want.toISOString());
    assert.equal((await client.query("select valid_until from public.entitlements where user_id = $1", [ok.u])).rows[0].valid_until.toISOString(), sub.want.toISOString());
  }));

test("가격 변경 — 요금제 금액이 바뀌면 같은 금액의 새 고지가 있어야 갱신, 작업이 고지를 기록하되 기한을 넘기면 거부", () =>
  tx(async () => {
    const c = await catalog({ monthly: 7777, yearly: 55555 });
    await open();
    // 연 요금제: 기한(기본 30일)이 기간보다 짧아 고지 시각이 만기 30일 전이어야 한다
    const u = await authUser();
    const start = at("2026-01-01T00:00:00Z");
    const end = at("2027-01-01T00:00:00Z");
    const sub = (
      await client.query(
        `insert into public.subscriptions (user_id, product_id, plan_id, auto_renew, billing_key, current_period_start, current_period_end)
         values ($1, $2, $3, true, 'bk_test_0001', $4, $5) returning id`,
        [u, c.productId, c.yearly, start, end],
      )
    ).rows[0].id;
    await client.query(`insert into public.renewal_notices (subscription_id, kind, period_end, amount, notified_at) values ($1, 'checkout', $2, 55555, $3)`, [sub, end, start]);
    assert.equal((await client.query("select public.billing_notice_lead_days($1, $2) as d", [start, end])).rows[0].d, 30);
    // 금액이 바뀜 -> 이전 금액 고지로는 갱신 거부
    await client.query("update public.product_plans set amount = 66666 where id = $1", [c.yearly]);
    const refused = await rpc("billing_create_renewal_order", [sub, "fake", "test", "ORD-PRICE-001", at("2027-01-01T00:00:01Z")]);
    assert.match(refused.message, /billing:renewal_notice_missing/);
    // 작업이 새 금액 고지를 기록 - 고지 시각이 만기 30일 전보다 늦으면 여전히 거부
    const n = await rpc("billing_record_price_notices", [at("2026-12-25T00:00:00Z")]);
    assert.equal(n.rows[0].r, 1);
    const late = await rpc("billing_create_renewal_order", [sub, "fake", "test", "ORD-PRICE-002", at("2027-01-01T00:00:01Z")]);
    assert.match(late.message, /billing:renewal_notice_missing/);
    // 기한 안(만기 31일 전)에 고지했다면 통과
    await client.query("set session_replication_role = replica");
    await client.query("delete from public.renewal_notices where kind = 'price_change'");
    await client.query("set session_replication_role = origin");
    assert.equal((await rpc("billing_record_price_notices", [at("2026-11-30T00:00:00Z")])).rows[0].r, 1);
    const ok = await rpc("billing_create_renewal_order", [sub, "fake", "test", "ORD-PRICE-003", at("2027-01-01T00:00:01Z")]);
    assert.ok(ok.ok, ok.message);
    assert.equal(ok.rows[0].r.amount, 66666);
    // 고지 기한 설정 — 설정이 있으면 그 일수, 기간보다 길지 않다
    await setting("renewal_notice_policy", { days: 10 });
    assert.equal((await client.query("select public.billing_notice_lead_days($1, $2) as d", [start, end])).rows[0].d, 10);
    await setting("renewal_notice_policy", { days: 90 });
    const month = (await client.query("select public.billing_notice_lead_days($1, $2) as d", [at("2026-02-01T00:00:00Z"), at("2026-03-01T00:00:00Z")])).rows[0].d;
    assert.equal(month, 28);
    const badSetting = await attempt("update public.settings set value = '{\"days\": 0}'::jsonb where key = 'renewal_notice_policy'");
    assert.equal(badSetting.ok, false);
  }));

test("결제 실패 — 재시도·유예 설정이 비어 있으면 바로 만료, 유예가 있으면 마지막 날(한국)까지 이용하고 다음 날 0시에 회수", () =>
  tx(async () => {
    const c = await catalog();
    await open();
    const a = await dueSubscription(c, true);
    const r0 = await rpc("billing_mark_charge_failed", [a.sub]);
    assert.equal(r0.rows[0].r.status, "expired");

    await setting("billing_retry_policy", { max_retries: 2, grace_days: 3 });
    const b = await dueSubscription(c, true);
    const r1 = await rpc("billing_mark_charge_failed", [b.sub]);
    assert.equal(r1.rows[0].r.status, "past_due");
    // 유예 3일: 만기 + 3일이 속한 한국 날짜가 마지막 이용일, 그다음 한국 0시에 회수 (JS로 따로 계산)
    const KST = 9 * 3600000;
    const lastDay = Math.floor((b.end.getTime() + 3 * 86400000 + KST) / 86400000);
    const want = new Date((lastDay + 1) * 86400000 - KST);
    const until = (await client.query("select valid_until from public.entitlements where user_id = $1", [b.u])).rows[0].valid_until;
    assert.equal(until.toISOString(), want.toISOString());
    const has = async (t) => (await client.query("select public.has_entitlement($1, 'digital', $2::timestamptz) as ok", [b.u, t])).rows[0].ok;
    assert.equal(await has(new Date(want.getTime() - 1000)), true);
    assert.equal(await has(want), false);
    await rpc("billing_mark_charge_failed", [b.sub]);
    const r3 = await rpc("billing_mark_charge_failed", [b.sub]);
    assert.equal(r3.rows[0].r.status, "expired");
    const bad = await attempt("update public.settings set value = '{\"max_retries\": 99}'::jsonb where key = 'billing_retry_policy'");
    assert.equal(bad.ok, false);
  }));

test("웹훅 기록 — 같은 pg_event_id는 처음 한 번만 new, 처리 끝낸 뒤에는 duplicate, 처리 못 끝낸 뒤에는 retry", () =>
  tx(async () => {
    const hash = "a".repeat(64);
    assert.equal((await rpc("billing_record_event", ["evt-1", "fake", "payment.done", "ORD-X-0001", hash])).rows[0].r, "new");
    assert.equal((await rpc("billing_record_event", ["evt-1", "fake", "payment.done", "ORD-X-0001", hash])).rows[0].r, "retry");
    await rpc("billing_mark_event", ["evt-1", "processed"]);
    assert.equal((await rpc("billing_record_event", ["evt-1", "fake", "payment.done", "ORD-X-0001", hash])).rows[0].r, "duplicate");
    assert.equal((await client.query("select count(*)::int n from public.payment_events where pg_event_id = 'evt-1'")).rows[0].n, 1);
    const badHash = await rpc("billing_record_event", ["evt-2", "fake", "payment.done", null, "not-a-hash"]);
    assert.equal(badHash.ok, false);
  }));

test("접근 — anon·authenticated는 결제 표·함수를 쓸 수 없고, 읽기 함수는 service_role만", () =>
  tx(async () => {
    const tables = ["product_plans", "subscriptions", "orders", "renewal_notices", "payment_events", "entitlements", "commerce_readiness", "paid_bodies"];
    for (const role of ["anon", "authenticated"]) {
      for (const t of tables) {
        const r = await attempt(`select * from public.${t}`, [], role);
        assert.equal(r.ok, false, `${role} ${t}`);
        assert.equal(r.code, "42501");
      }
      for (const [fn, args] of [
        ["has_entitlement", ["00000000-0000-0000-0000-000000000000", "digital"]],
        ["read_paid_body", ["00000000-0000-0000-0000-000000000000", "article", "x"]],
        ["billing_cancel_subscription", ["00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000"]],
      ]) {
        const r = await rpc(fn, args, role);
        assert.equal(r.ok, false, `${role} ${fn}`);
        assert.equal(r.code, "42501");
      }
    }
    const direct = await attempt("insert into public.entitlements (user_id, key, source, valid_until) values (gen_random_uuid(), 'digital', 'manual', now() + interval '1 day')", [], "service_role");
    assert.equal(direct.ok, false);
  }));

async function paidArticle() {
  const reporter = (await client.query(`insert into public.people (slug, name, roles, visibility) values ($1, '시험 기자', array['reporter'], 'public') returning id`, [uniq("p")])).rows[0];
  return (
    await client.query(
      `insert into public.articles (slug, title, section, content_type, status, author_id, body, is_paid, first_published_at)
       values ($1, '시험 유료 기사', 'tax', 'explainer', 'published', $2, $3, true, now()) returning id, slug`,
      [uniq("a"), reporter.id, JSON.stringify({ blocks: [{ type: "paragraph", text: "본문" }], claims: [] })],
    )
  ).rows[0];
}

test("유료 본문 — 구독자만 읽기 함수로 본문, 비구독자·판매 권리 미확인·만기 뒤는 null", () =>
  tx(async () => {
    const c = await catalog();
    await open();
    const a = await paidArticle();
    const MARK = "시험본문표식ZZ9";
    await client.query(
      `insert into public.paid_bodies (kind, ref_key, article_id, preview, body, sale_allowed, rights_ref, sale_confirmed_on, edited_by)
       values ('article', $1, $2, '시험 미리보기', $3, true, '시험 권리 기록', '2026-10-20', 't')`,
      [String(a.id), a.id, `시험 미리보기 ${MARK} 이어지는 유료 본문`],
    );
    const sub = await authUser();
    const non = await authUser();
    await apply((await order(sub, c.monthly)).order_no, "DONE", 7777, new Date(Date.now() + 1000));
    const read = async (u, t) => (await client.query("select public.read_paid_body($1, 'article', $2, $3::timestamptz) as b", [u, String(a.id), t ?? new Date()])).rows[0].b;
    assert.match(await read(sub), new RegExp(MARK));
    assert.equal(await read(non), null);
    assert.equal(await read(null), null);
    assert.equal(await read(sub, new Date(Date.now() + 40 * 86400000)), null);
    await client.query("update public.paid_bodies set sale_allowed = false, rights_ref = null, sale_confirmed_on = null");
    assert.equal(await read(sub), null);
  }));

test("유료 본문 — 판매 권리 확인에는 근거·확인일 필요, 미리보기 400자 초과·본문보다 긴 미리보기·무료 기사 연결 거부", () =>
  tx(async () => {
    const a = await paidArticle();
    const ins = (over) =>
      attempt(
        `insert into public.paid_bodies (kind, ref_key, article_id, preview, body, sale_allowed, rights_ref, sale_confirmed_on, edited_by)
         values ('article', $1, $2, $3, $4, $5, $6, $7, 't')`,
        [over.ref ?? uniq("k"), over.article ?? a.id, over.preview ?? "미리보기", over.body ?? "미리보기 이어지는 본문", over.sale ?? false, over.rights ?? null, over.on ?? null],
      );
    assert.equal((await ins({ sale: true })).ok, false);
    assert.equal((await ins({ preview: "가".repeat(401), body: "가".repeat(500) })).ok, false);
    assert.equal((await ins({ preview: "같은 길이 글", body: "같은 길이 글" })).ok, false);
    const free = (await client.query(`insert into public.articles (slug, title, section, content_type, status, author_id, body)
      select $1, '무료', 'tax', 'explainer', 'published', author_id, body from public.articles where id = $2 returning id`, [uniq("free"), a.id])).rows[0];
    assert.equal((await ins({ article: free.id })).ok, false);
    assert.ok((await ins({})).ok);
  }));

test("공개 뷰 — 요금표·미리보기는 기능 키가 켜지고 판매 권리가 확인된 것만, 미리보기 뷰에 본문 칸 없음, 공개 기사 뷰에는 유료 기사 0", () =>
  tx(async () => {
    const c = await catalog();
    const a = await paidArticle();
    await client.query(
      `insert into public.paid_bodies (kind, ref_key, article_id, preview, body, sale_allowed, rights_ref, sale_confirmed_on, edited_by)
       values ('article', $1, $2, '시험 미리보기', '시험 미리보기 그리고 유료 본문 전체', true, '시험 권리 기록', '2026-10-20', 't')`,
      [String(a.id), a.id],
    );
    const anon = async (sql, p = []) => (await attempt(sql, p, "anon")).rows ?? [];
    assert.equal((await anon("select * from public.public_digital_plans where product_id = $1", [c.productId])).length, 0);
    assert.equal((await anon("select * from public.public_paid_previews where article_id = $1", [a.id])).length, 0);
    await flags({ billing: true, digital_subscription: true, paywall: true });
    const plans = await anon("select * from public.public_digital_plans where product_id = $1 order by period_months", [c.productId]);
    assert.deepEqual(plans.map((p) => [p.plan_key, p.amount]), [["monthly", 7777], ["yearly", 55555]]);
    const prev = await anon("select * from public.public_paid_previews where article_id = $1", [a.id]);
    assert.equal(prev.length, 1);
    assert.equal(prev[0].preview, "시험 미리보기");
    assert.ok(!("body" in prev[0]));
    assert.equal((await anon("select * from public.articles where id = $1", [a.id])).length, 0);
    assert.equal((await anon("select * from public.search_documents where false")).length === 0, true);
    await client.query("update public.paid_bodies set sale_allowed = false, rights_ref = null, sale_confirmed_on = null");
    assert.equal((await anon("select * from public.public_digital_plans where product_id = $1", [c.productId])).length, 0);
    assert.equal((await anon("select * from public.public_paid_previews where article_id = $1", [a.id])).length, 0);
  }));

test("카드 정보 0 — 결제 표에 카드 이름 칸이 없고, 모든 글자 칸에 13~19자리 카드번호 패턴이 없다", () =>
  tx(async () => {
    const cols = (
      await client.query(
        `select table_name, column_name from information_schema.columns
          where table_schema = 'public' and table_name in ('orders','subscriptions','payment_events','entitlements','renewal_notices','product_plans','commerce_readiness','paid_bodies')`,
      )
    ).rows;
    for (const c of cols) assert.ok(!/(card|cvc|cvv|pan\b|카드)/i.test(c.column_name), `${c.table_name}.${c.column_name}`);
    // 정상 사용 한 벌을 돌린 뒤 모든 글자 칸을 훑는다
    const c = await catalog();
    await open();
    const u = await authUser();
    const o = await order(u, c.monthly);
    await apply(o.order_no, "DONE", 7777, new Date(Date.now() + 1000));
    await rpc("billing_record_event", ["evt-card-1", "fake", "payment.done", o.order_no, "b".repeat(64)]);
    for (const t of ["orders", "subscriptions", "payment_events", "entitlements", "renewal_notices", "product_plans"]) {
      const rows = (await client.query(`select x::text as s from public.${t} x`)).rows;
      for (const r of rows) assert.deepEqual(cardLikeRuns(r.s), [], `${t}에 카드번호 모양 값`);
    }
    // 스캐너 자체 확인 - 통과하는 시험용 번호(공개된 시험 카드 번호)는 잡고, 날짜·UUID 같은 긴 숫자열은 잡지 않는다
    assert.equal(cardLikeRuns("카드 4111 1111 1111 1111 입니다").length, 1);
    assert.equal(cardLikeRuns("2026-10-24 23:51:43.641+00 6f1c2a9e-0000-4000-8000-123456789012").length, 0);
  }));

test("빌링키 뒤늦게 붙이기 - 웹훅이 먼저 반영해 빌링키 없이 만든 구독에 승인 경로의 빌링키가 붙고 자동갱신이 켜진다", () =>
  tx(async () => {
    const c = await catalog({ monthly: 5000 });
    await open();
    const u = await authUser();
    const o = await order(u, c.monthly);
    await apply(o.order_no, "DONE", 5000, new Date(Date.now() + 1000), null);
    const first = (await client.query("select auto_renew, billing_key from public.subscriptions where user_id = $1", [u])).rows[0];
    assert.deepEqual(first, { auto_renew: false, billing_key: null });
    await apply(o.order_no, "DONE", 5000, new Date(Date.now() + 2000), "bk_late_00001");
    const second = (await client.query("select auto_renew, billing_key from public.subscriptions where user_id = $1", [u])).rows[0];
    assert.deepEqual(second, { auto_renew: true, billing_key: "bk_late_00001" });
    assert.equal((await client.query("select count(*)::int n from public.subscriptions where user_id = $1", [u])).rows[0].n, 1);
  }));
