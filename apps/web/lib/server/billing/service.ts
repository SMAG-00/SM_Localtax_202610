import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/server/http";
import { containsCardNumber } from "./card-scan";
import type { BillingConfig } from "./config";
import { isReadinessViolation, mapBillingError } from "./errors";
import { PgError, type PgAdapter, type PgPayment } from "./pg";
import { parseWebhook, verifyWebhookSignature, type HeaderReader } from "./webhook";

// 결제 서비스 (W10-f, PAY-01·02·03·05·07) — DB 결제 함수(마이그레이션 95)와 PgAdapter를 잇는 서버 로직. 결제 규칙의 서버 쪽은 이 파일 한 곳.
//  · 최종 상태는 항상 PG 조회 결과다. 복귀 주소의 쿼리값·웹훅 본문의 상태·금액은 판정에 쓰지 않는다.
//  · 권한은 DB 함수 billing_apply_payment가 PG 조회 결과를 받았을 때만 만들어진다. 이 파일은 entitlements를 직접 쓰지 않는다.
//  · 가격·기간은 product_plans 데이터이고 이 파일에 금액 상수가 없다.

type Db = SupabaseClient;
type Json = Record<string, unknown>;

async function rpc(db: Db, fn: string, args: Json): Promise<Json> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    const mapped = mapBillingError(error.message);
    if (mapped) throw new HttpError(mapped.status, mapped.message, { code: mapped.code });
    if (isReadinessViolation(error.message)) throw new HttpError(403, "실결제 준비 확인 기록이 없어 이 결제를 만들 수 없습니다");
    console.error(`[billing] ${fn} 실패:`, error.code, error.message);
    throw new HttpError(500, "결제 처리 중 오류가 났습니다 — 잠시 뒤 다시 시도하세요");
  }
  return (data ?? {}) as Json;
}

const newOrderNo = (): string => `O${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(8).toString("hex").toUpperCase()}`;

/** PG에 넘기는 회원 식별자 — 회원 번호·이메일을 그대로 쓰지 않는다 */
export function customerKeyOf(userId: string, secret: string): string {
  return `c_${createHash("sha256").update(`${userId}:${secret}`).digest("hex").slice(0, 32)}`;
}

/** 실결제(live) 주문을 열기 전 확인 - 철회되지 않은 commerce_readiness 행이 있어야 한다 (DB 트리거가 한 번 더 막는다) */
export async function liveReady(db: Db): Promise<boolean> {
  const { count, error } = await db.from("commerce_readiness").select("id", { count: "exact", head: true }).is("revoked_at", null);
  if (error) throw new HttpError(503, "실결제 준비 기록을 읽지 못했습니다");
  return (count ?? 0) > 0;
}

export interface CheckoutInfo {
  orderNo: string;
  amount: number;
  provider: BillingConfig["provider"];
  mode: BillingConfig["mode"];
  clientKey: string;
  customerKey: string;
  replayed: boolean;
}

export async function createCheckout(
  db: Db,
  config: BillingConfig,
  userId: string,
  input: { planId: number; idempotencyKey: string; termsAck: boolean },
): Promise<CheckoutInfo> {
  if (config.mode === "live" && !(await liveReady(db))) {
    throw new HttpError(403, "실결제 준비 확인 기록이 없어 결제를 열 수 없습니다");
  }
  const r = await rpc(db, "billing_create_order", {
    p_user: userId,
    p_plan: input.planId,
    p_provider: config.provider,
    p_mode: config.mode,
    p_idem: input.idempotencyKey,
    p_order_no: newOrderNo(),
    p_terms_ack: input.termsAck,
  });
  return {
    orderNo: String(r.order_no),
    amount: Number(r.amount),
    provider: config.provider,
    mode: config.mode,
    clientKey: config.clientKey,
    customerKey: customerKeyOf(userId, config.secretKey),
    replayed: r.replayed === true,
  };
}

interface OrderRow {
  order_no: string;
  user_id: string | null;
  amount: number;
  status: string;
  plan_id: number;
  kind: string;
}

async function loadOrder(db: Db, orderNo: string): Promise<OrderRow | null> {
  const { data, error } = await db.from("orders").select("order_no, user_id, amount, status, plan_id, kind").eq("order_no", orderNo).maybeSingle();
  if (error) throw new HttpError(503, "주문을 읽지 못했습니다");
  return (data as OrderRow | null) ?? null;
}

/** PG 조회 결과를 DB 결제 함수에 넘긴다 - 상태·금액·시각은 모두 PG 조회에서 온 값이다 */
async function applyLookup(db: Db, payment: PgPayment, billingKey: string | null): Promise<Json> {
  return rpc(db, "billing_apply_payment", {
    p_order_no: payment.orderNo,
    p_pg_status: payment.status,
    p_amount: payment.amount,
    p_payment_key: payment.paymentKey,
    p_billing_key: billingKey,
    p_looked_up_at: payment.checkedAt.toISOString(),
  });
}

function pgFailure(err: unknown): HttpError {
  if (err instanceof PgError) {
    return new HttpError(err.httpStatus >= 500 ? 502 : 422, err.httpStatus >= 500 ? "결제 회사 연결에 문제가 있습니다 — 잠시 뒤 다시 확인하세요" : "결제 회사가 결제를 받아들이지 않았습니다", {
      pgCode: err.pgCode,
    });
  }
  return err instanceof HttpError ? err : new HttpError(500, "결제 처리 중 오류가 났습니다");
}

/**
 * 결제 마무리 (브라우저가 PG 인증을 마치고 돌아온 뒤) - 복귀 주소의 값은 authKey/paymentKey 문자열뿐이고 상태·금액은 받지 않는다.
 * 금액은 우리 주문에서 읽고, 승인/빌링 결제를 PG에 요청한 뒤, 다시 PG에 조회한 결과로 반영한다.
 */
export async function completeCheckout(
  db: Db,
  adapter: PgAdapter,
  config: BillingConfig,
  userId: string,
  input: { orderNo: string; paymentKey?: string | undefined; authKey?: string | undefined },
): Promise<{ orderStatus: string }> {
  const order = await loadOrder(db, input.orderNo);
  if (!order || order.user_id !== userId) throw new HttpError(404, "주문을 찾을 수 없습니다");
  if (order.status !== "created") return { orderStatus: order.status };
  let billingKey: string | null = null;
  try {
    if (input.authKey) {
      const issued = await adapter.issueBillingKey({ authKey: input.authKey, customerKey: customerKeyOf(userId, config.secretKey) });
      billingKey = issued.billingKey;
      const { data: plan } = await db.from("product_plans").select("title").eq("id", order.plan_id).maybeSingle();
      await adapter.chargeBilling({
        billingKey,
        customerKey: customerKeyOf(userId, config.secretKey),
        orderNo: order.order_no,
        amount: order.amount,
        orderName: (plan as { title?: string } | null)?.title ?? order.order_no,
      });
    } else if (input.paymentKey) {
      await adapter.confirm({ paymentKey: input.paymentKey, orderNo: order.order_no, amount: order.amount });
    } else {
      throw new HttpError(422, "결제 인증 값(authKey 또는 paymentKey)이 필요합니다");
    }
    const looked = await adapter.lookup(order.order_no);
    if (!looked) throw new HttpError(502, "결제 회사에서 주문을 찾지 못했습니다");
    const result = await applyLookup(db, looked, billingKey);
    return { orderStatus: String(result.order_status) };
  } catch (err) {
    // 승인 단계에서 PG가 거절했어도 PG 쪽 최종 상태를 조회해 반영한다 (실패도 PG 조회 결과로 기록)
    if (err instanceof PgError) {
      const looked = await adapter.lookup(order.order_no).catch(() => null);
      if (looked) await applyLookup(db, looked, null).catch(() => undefined);
    }
    throw pgFailure(err);
  }
}

export interface WebhookOutcome {
  status: number;
  body: Json;
}

/** 웹훅 한 건 처리 - 서명 -> 이벤트 기록(멱등) -> PG 조회 -> 반영. 본문의 상태·금액은 쓰지 않는다 */
export async function handleWebhook(db: Db, adapter: PgAdapter, config: BillingConfig, rawBody: string, headers: HeaderReader): Promise<WebhookOutcome> {
  if (!verifyWebhookSignature(config.webhookSecret, rawBody, headers)) return { status: 401, body: { error: "서명이 맞지 않습니다" } };
  const event = parseWebhook(rawBody, headers, config.provider);
  if (!event) return { status: 400, body: { error: "본문을 해석하지 못했습니다" } };
  const { data: recorded, error: recordError } = await db.rpc("billing_record_event", {
    p_event_id: event.eventId,
    p_provider: config.provider,
    p_type: event.eventType,
    p_order_no: event.orderNo,
    p_hash: event.payloadHash,
  });
  if (recordError) return { status: 500, body: { error: "이벤트를 기록하지 못했습니다 - 다시 보내 주세요" } };
  const state = String(recorded);
  if (state === "duplicate") return { status: 200, body: { duplicate: true } };
  if (!event.orderNo) {
    await rpc(db, "billing_mark_event", { p_event_id: event.eventId, p_status: "ignored" });
    return { status: 200, body: { ignored: true } };
  }
  const order = await loadOrder(db, event.orderNo);
  if (!order) {
    await rpc(db, "billing_mark_event", { p_event_id: event.eventId, p_status: "ignored" });
    return { status: 200, body: { ignored: true } };
  }
  try {
    const looked = await adapter.lookup(event.orderNo);
    if (!looked) {
      await rpc(db, "billing_mark_event", { p_event_id: event.eventId, p_status: "ignored" });
      return { status: 200, body: { ignored: true } };
    }
    const result = await applyLookup(db, looked, null);
    await rpc(db, "billing_mark_event", { p_event_id: event.eventId, p_status: "processed" });
    return { status: 200, body: { order_status: result.order_status } };
  } catch (err) {
    await rpc(db, "billing_mark_event", { p_event_id: event.eventId, p_status: "failed" }).catch(() => undefined);
    // 5xx로 돌려 PG가 다시 보내게 한다 (다시 오면 같은 이벤트 번호가 'retry'로 처리된다)
    return { status: 500, body: { error: "처리하지 못했습니다 - 다시 보내 주세요", detail: err instanceof PgError ? "pg" : "server" } };
  }
}

/** 해지 - 자동갱신을 끄고 남은 기간 끝까지 이용 (본인 구독만) */
export async function cancelSubscription(db: Db, userId: string, subscriptionId: string): Promise<{ endsAt: string; already: boolean }> {
  const r = await rpc(db, "billing_cancel_subscription", { p_user: userId, p_sub: subscriptionId });
  return { endsAt: String(r.ends_at), already: r.already === true };
}

// ── 내 구독 화면 데이터 ──
export interface MyBilling {
  subscription: {
    id: string;
    status: string;
    autoRenew: boolean;
    periodEnd: string;
    graceUntil: string | null;
    cancelRequestedAt: string | null;
    planTitle: string;
    amount: number;
    nextNotice: { kind: string; amount: number; notifiedAt: string } | null;
  } | null;
  orders: { orderNo: string; amount: number; status: string; paidAt: string | null; kind: string }[];
}

export async function loadMyBilling(db: Db, userId: string): Promise<MyBilling> {
  const { data: subs, error } = await db
    .from("subscriptions")
    .select("id, status, auto_renew, current_period_end, grace_until, cancel_requested_at, plan_id")
    .eq("user_id", userId)
    .in("status", ["active", "past_due"])
    .limit(1);
  if (error) throw new HttpError(503, "구독 정보를 읽지 못했습니다");
  const s = (subs ?? [])[0] as { id: string; status: string; auto_renew: boolean; current_period_end: string; grace_until: string | null; cancel_requested_at: string | null; plan_id: number } | undefined;
  const { data: orders } = await db.from("orders").select("order_no, amount, status, paid_at, kind").eq("user_id", userId).order("created_at", { ascending: false }).limit(20);
  const orderRows = ((orders ?? []) as { order_no: string; amount: number; status: string; paid_at: string | null; kind: string }[]).map((o) => ({
    orderNo: o.order_no,
    amount: o.amount,
    status: o.status,
    paidAt: o.paid_at,
    kind: o.kind,
  }));
  if (!s) return { subscription: null, orders: orderRows };
  const [{ data: plan }, { data: notice }] = await Promise.all([
    db.from("product_plans").select("title, amount").eq("id", s.plan_id).maybeSingle(),
    db.from("renewal_notices").select("kind, amount, notified_at").eq("subscription_id", s.id).eq("period_end", s.current_period_end).order("notified_at", { ascending: false }).limit(1),
  ]);
  const n = ((notice ?? []) as { kind: string; amount: number; notified_at: string }[])[0];
  return {
    subscription: {
      id: s.id,
      status: s.status,
      autoRenew: s.auto_renew,
      periodEnd: s.current_period_end,
      graceUntil: s.grace_until,
      cancelRequestedAt: s.cancel_requested_at,
      planTitle: (plan as { title?: string } | null)?.title ?? "",
      amount: (plan as { amount?: number } | null)?.amount ?? 0,
      nextNotice: n ? { kind: n.kind, amount: n.amount, notifiedAt: n.notified_at } : null,
    },
    orders: orderRows,
  };
}

// ── 권한 · 유료 본문 (권한 판정 함수는 DB의 has_entitlement 하나) ──
export async function hasDigitalEntitlement(db: Db, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await db.rpc("has_entitlement", { p_user: userId, p_key: "digital" });
  if (error) {
    console.error("[billing] has_entitlement 실패:", error.code);
    return false; // 모르면 열지 않는다
  }
  return data === true;
}

/** 유료 본문 - 회원 번호는 서버가 세션에서 정한 값만 넘긴다. 권한 없음·판매 권리 미확인이면 null */
export async function readPaidBody(db: Db, userId: string | null, kind: "article" | "brief" | "interpretation", ref: string): Promise<string | null> {
  if (!userId) return null;
  const { data, error } = await db.rpc("read_paid_body", { p_user: userId, p_kind: kind, p_ref: ref });
  if (error) {
    console.error("[billing] read_paid_body 실패:", error.code);
    return null;
  }
  return typeof data === "string" ? data : null;
}

// ── 정기 작업 ──
export interface ReconcileResult {
  pendingChecked: number;
  pendingApplied: number;
  renewalsCharged: number;
  renewalsFailed: number;
  renewalsRefused: number;
  lapsed: number;
  cardPatternHits: number;
}

const PENDING_AFTER_MS = 10 * 60 * 1000;

/** 하루 한 번 - 오래 끝나지 않은 주문을 PG 조회로 정리, 만기 구독 갱신 결제, 만기 정리, 카드번호 패턴 스캔. 결과는 수뿐(개인 값 0) */
export async function reconcile(db: Db, adapter: PgAdapter | null, config: BillingConfig | null, now: Date): Promise<ReconcileResult> {
  const result: ReconcileResult = { pendingChecked: 0, pendingApplied: 0, renewalsCharged: 0, renewalsFailed: 0, renewalsRefused: 0, lapsed: 0, cardPatternHits: 0 };
  if (adapter && config) {
    const before = new Date(now.getTime() - PENDING_AFTER_MS).toISOString();
    const { data: pending } = await db.from("orders").select("order_no").eq("status", "created").lt("created_at", before).limit(200);
    for (const row of (pending ?? []) as { order_no: string }[]) {
      result.pendingChecked += 1;
      try {
        const looked = await adapter.lookup(row.order_no);
        if (looked) {
          const r = await applyLookup(db, looked, null);
          if (r.changed === true) result.pendingApplied += 1;
        }
      } catch {
        // 다음 실행에서 다시 본다
      }
    }
    const { data: due } = await db
      .from("subscriptions")
      .select("id, billing_key, user_id, plan_id")
      .in("status", ["active", "past_due"])
      .eq("auto_renew", true)
      .is("cancel_requested_at", null)
      .lte("current_period_end", now.toISOString())
      .limit(200);
    for (const sub of (due ?? []) as { id: string; billing_key: string | null; user_id: string; plan_id: number }[]) {
      let order: Json;
      try {
        order = await rpc(db, "billing_create_renewal_order", {
          p_sub: sub.id,
          p_provider: adapter.provider,
          p_mode: adapter.mode,
          p_order_no: newOrderNo(),
          p_now: now.toISOString(),
        });
      } catch (err) {
        if (err instanceof HttpError && err.extra.code === "renewal_notice_missing") {
          result.renewalsRefused += 1;
          await db.rpc("billing_lapse_subscription", { p_sub: sub.id });
        }
        continue;
      }
      if (order.replayed === true && order.status !== "created") continue;
      try {
        const { data: plan } = await db.from("product_plans").select("title").eq("id", sub.plan_id).maybeSingle();
        const charged = await adapter.chargeBilling({
          billingKey: String(order.billing_key ?? sub.billing_key),
          customerKey: customerKeyOf(String(order.user_id ?? sub.user_id), config.secretKey),
          orderNo: String(order.order_no),
          amount: Number(order.amount),
          orderName: (plan as { title?: string } | null)?.title ?? String(order.order_no),
        });
        await applyLookup(db, charged, null);
        result.renewalsCharged += 1;
      } catch {
        // PG가 거절했거나 응답이 없다 - PG 조회가 있으면 그 결과로, 주문 자체를 PG가 모르면 실패(ABORTED)로 반영한다
        const looked =
          (await adapter.lookup(String(order.order_no)).catch(() => null)) ??
          ({ orderNo: String(order.order_no), status: "ABORTED", amount: Number(order.amount), paymentKey: null, checkedAt: new Date() } satisfies PgPayment);
        await applyLookup(db, looked, null).catch(() => undefined);
        result.renewalsFailed += 1;
      }
    }
  }
  const { data: closed } = await db.rpc("billing_close_lapsed", { p_now: now.toISOString() });
  result.lapsed = typeof closed === "number" ? closed : 0;
  result.cardPatternHits = await scanCardPatterns(db);
  return result;
}

/** 결제 표의 글자 칸에 카드번호 모양(Luhn 통과 13~19자리)이 있는 행 수 - 값은 읽고 버린다 */
export async function scanCardPatterns(db: Db): Promise<number> {
  let hits = 0;
  for (const table of ["orders", "subscriptions", "payment_events", "renewal_notices", "entitlements"]) {
    const { data } = await db.from(table).select("*").limit(5000);
    for (const row of (data ?? []) as Json[]) if (containsCardNumber(row)) hits += 1;
  }
  return hits;
}

/** 가격 변경 사전 고지 기록 (작업 renewal-notice) - 기록한 수만 돌려준다 */
export async function recordRenewalNotices(db: Db, now: Date): Promise<{ priceNotices: number }> {
  const { data, error } = await db.rpc("billing_record_price_notices", { p_now: now.toISOString() });
  if (error) throw new HttpError(500, "고지 기록을 만들지 못했습니다");
  return { priceNotices: typeof data === "number" ? data : 0 };
}
