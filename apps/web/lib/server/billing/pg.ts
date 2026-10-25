// PG 연결부 (W10-f, PAY-02) — PgAdapter 하나, 구현 두 가지(fake · toss_test). PG SDK·HTTP 호출은 이 폴더(lib/server/billing)에만 둔다.
//  · 둘 다 토스페이먼츠 HTTP API 모양(결제 승인 · 주문번호 조회 · 빌링키 발급 · 빌링 결제 · 취소)을 따르고 기준 주소와 공급자 이름만 다르다.
//    fake는 로컬 가짜 PG 서버(e2e/lib/fake-pg.mjs)에 같은 경로로 요청한다. 실제 토스 시험 키로는 아직 호출해 본 적이 없다(키 없음) — 계약·시험 키 받은 뒤 확인.
//  · 카드번호는 이 모듈을 지나지 않는다: 브라우저가 PG에서 직접 카드 인증을 하고 우리는 authKey/paymentKey/빌링키 문자열만 받는다 (PAY-07).
//  · 오류에는 PG 응답의 code·message(PG가 정한 문장)만 담고 요청 헤더·키는 담지 않는다.
import type { BillingConfig, PgProvider } from "./config";

export interface PgPayment {
  orderNo: string;
  status: string;
  amount: number;
  paymentKey: string | null;
  /** 이 조회를 우리 서버가 끝낸 시각 — 오래된 조회가 새 조회를 덮지 못하게 DB가 비교한다 */
  checkedAt: Date;
}

export class PgError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly pgCode: string | null,
  ) {
    super(message);
    this.name = "PgError";
  }
}

export interface PgAdapter {
  readonly provider: PgProvider;
  readonly mode: "test" | "live";
  /** 주문번호로 PG에 조회 — 없으면 null. 결제 최종 상태의 근거 */
  lookup(orderNo: string): Promise<PgPayment | null>;
  /** 브라우저 인증을 마친 결제를 승인 */
  confirm(input: { paymentKey: string; orderNo: string; amount: number }): Promise<PgPayment>;
  issueBillingKey(input: { authKey: string; customerKey: string }): Promise<{ billingKey: string }>;
  chargeBilling(input: { billingKey: string; customerKey: string; orderNo: string; amount: number; orderName: string }): Promise<PgPayment>;
}

type Fetch = typeof fetch;

const TIMEOUT_MS = 10_000;

function basicAuth(secretKey: string): string {
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

interface TossPaymentBody {
  paymentKey?: unknown;
  orderId?: unknown;
  status?: unknown;
  totalAmount?: unknown;
}

function toPayment(body: TossPaymentBody, checkedAt: Date): PgPayment {
  if (typeof body.orderId !== "string" || typeof body.status !== "string" || typeof body.totalAmount !== "number") {
    throw new PgError("PG 응답 모양이 맞지 않습니다", 502, null);
  }
  return {
    orderNo: body.orderId,
    status: body.status,
    amount: body.totalAmount,
    paymentKey: typeof body.paymentKey === "string" ? body.paymentKey : null,
    checkedAt,
  };
}

export function createPgAdapter(config: BillingConfig, fetchImpl: Fetch = fetch): PgAdapter {
  async function call(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
    let res: Response;
    try {
      res = await fetchImpl(`${config.baseUrl}${path}`, {
        method,
        headers: { authorization: basicAuth(config.secretKey), ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new PgError("PG에 연결하지 못했습니다", 503, null);
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, json };
  }
  const fail = (res: { status: number; json: Record<string, unknown> }): never => {
    const code = typeof res.json.code === "string" ? res.json.code : null;
    const message = typeof res.json.message === "string" ? res.json.message.slice(0, 200) : "PG 요청이 거부됐습니다";
    throw new PgError(message, res.status, code);
  };

  return {
    provider: config.provider,
    mode: config.mode,
    async lookup(orderNo) {
      const res = await call("GET", `/v1/payments/orders/${encodeURIComponent(orderNo)}`);
      if (res.status === 404) return null;
      if (res.status !== 200) return fail(res);
      return toPayment(res.json, new Date());
    },
    async confirm({ paymentKey, orderNo, amount }) {
      const res = await call("POST", "/v1/payments/confirm", { paymentKey, orderId: orderNo, amount });
      if (res.status !== 200) return fail(res);
      return toPayment(res.json, new Date());
    },
    async issueBillingKey({ authKey, customerKey }) {
      const res = await call("POST", "/v1/billing/authorizations/issue", { authKey, customerKey });
      if (res.status !== 200) return fail(res);
      const billingKey = res.json.billingKey;
      if (typeof billingKey !== "string" || billingKey.length < 8) throw new PgError("PG 빌링키 응답이 맞지 않습니다", 502, null);
      return { billingKey };
    },
    async chargeBilling({ billingKey, customerKey, orderNo, amount, orderName }) {
      const res = await call("POST", `/v1/billing/${encodeURIComponent(billingKey)}`, { customerKey, amount, orderId: orderNo, orderName });
      if (res.status !== 200) return fail(res);
      return toPayment(res.json, new Date());
    },
  };
}
