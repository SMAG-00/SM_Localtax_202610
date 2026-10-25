import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readBillingConfig } from "./config";
import { PgError, createPgAdapter, type PgAdapter } from "./pg";

// 실제로 가짜 PG 서버(e2e/lib/fake-pg.mjs)를 띄워 어댑터가 승인·조회·빌링키·빌링 결제·인증 실패를 처리하는지 본다. 네트워크는 이 PC 안뿐이다.
interface Fake {
  url: string;
  registerPayment(paymentKey: string, orderId: string, amount: number): Promise<unknown>;
  registerAuthKey(authKey: string, customerKey: string): Promise<unknown>;
  setStatus(orderId: string, status: string): Promise<unknown>;
  failBilling(billingKey: string): Promise<unknown>;
  close(): Promise<void>;
}
let fake: Fake;
let adapter: PgAdapter;

beforeAll(async () => {
  const file = path.resolve(__dirname, "../../../../../e2e/lib/fake-pg.mjs");
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as { startFakePg(o?: object): Promise<Fake> };
  fake = await mod.startFakePg();
  const cfg = readBillingConfig({ PG_WEBHOOK_SECRET: "whsec_test_value", PG_FAKE_URL: fake.url });
  if (!cfg.ok) throw new Error(cfg.reason);
  adapter = createPgAdapter(cfg.config);
});
afterAll(async () => fake?.close());

describe("PgAdapter (fake)", () => {
  it("공급자·모드를 알려준다", () => {
    expect(adapter.provider).toBe("fake");
    expect(adapter.mode).toBe("test");
  });

  it("승인 -> 주문번호 조회가 같은 상태·금액을 돌려준다 (조회 시각 포함)", async () => {
    await fake.registerPayment("pay_k_0001", "ORD-PG-0001", 4200);
    const done = await adapter.confirm({ paymentKey: "pay_k_0001", orderNo: "ORD-PG-0001", amount: 4200 });
    expect(done).toMatchObject({ orderNo: "ORD-PG-0001", status: "DONE", amount: 4200, paymentKey: "pay_k_0001" });
    const looked = await adapter.lookup("ORD-PG-0001");
    expect(looked).toMatchObject({ status: "DONE", amount: 4200 });
    expect(looked?.checkedAt.getTime()).toBeGreaterThanOrEqual(done.checkedAt.getTime());
  });

  it("금액이 다르면 PG가 거부하고 PgError(400)로 올라온다", async () => {
    await fake.registerPayment("pay_k_0002", "ORD-PG-0002", 4200);
    await expect(adapter.confirm({ paymentKey: "pay_k_0002", orderNo: "ORD-PG-0002", amount: 1 })).rejects.toMatchObject({ httpStatus: 400, pgCode: "INVALID_REQUEST" });
  });

  it("없는 주문은 lookup이 null", async () => {
    expect(await adapter.lookup("ORD-PG-NONE-1")).toBeNull();
  });

  it("PG 쪽에서 취소된 결제는 조회에 CANCELED로 보인다", async () => {
    await fake.registerPayment("pay_k_0003", "ORD-PG-0003", 100);
    await adapter.confirm({ paymentKey: "pay_k_0003", orderNo: "ORD-PG-0003", amount: 100 });
    await fake.setStatus("ORD-PG-0003", "CANCELED");
    expect((await adapter.lookup("ORD-PG-0003"))?.status).toBe("CANCELED");
  });

  it("빌링키 발급 -> 빌링 결제, 실패 지정한 빌링키는 PgError", async () => {
    await fake.registerAuthKey("auth_ok_1", "cust-1");
    const { billingKey } = await adapter.issueBillingKey({ authKey: "auth_ok_1", customerKey: "cust-1" });
    expect(billingKey).toMatch(/^bk_fake_/);
    const paid = await adapter.chargeBilling({ billingKey, customerKey: "cust-1", orderNo: "ORD-PG-0004", amount: 900, orderName: "시험 상품" });
    expect(paid).toMatchObject({ status: "DONE", amount: 900 });
    await fake.failBilling(billingKey);
    await expect(adapter.chargeBilling({ billingKey, customerKey: "cust-1", orderNo: "ORD-PG-0005", amount: 900, orderName: "시험 상품" })).rejects.toMatchObject({ pgCode: "REJECT_CARD_PAYMENT" });
    expect((await adapter.lookup("ORD-PG-0005"))?.status).toBe("ABORTED");
  });

  it("인증 정보가 맞지 않는 빌링키 발급은 거부", async () => {
    await expect(adapter.issueBillingKey({ authKey: "auth_unknown", customerKey: "cust-1" })).rejects.toBeInstanceOf(PgError);
  });

  it("PG에 연결하지 못하면 503 PgError (키·주소를 문장에 넣지 않는다)", async () => {
    const dead = createPgAdapter({ mode: "test", provider: "fake", baseUrl: "http://127.0.0.1:1", secretKey: "fake-secret", webhookSecret: "x", clientKey: "" });
    const err = await dead.lookup("ORD-PG-0006").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PgError);
    expect((err as PgError).httpStatus).toBe(503);
    expect((err as PgError).message).not.toContain("fake-secret");
  });
});
