import { describe, expect, it } from "vitest";
import { ID_HEADER, SIGNATURE_HEADER, TIME_HEADER, parseWebhook, signWebhook, verifyWebhookSignature } from "./webhook";

const SECRET = "whsec_test_value";
const headersOf = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
const BODY = JSON.stringify({ eventId: "evt-0001", eventType: "PAYMENT_STATUS_CHANGED", data: { orderId: "ORD-20261025-0001", status: "DONE" } });

describe("웹훅 서명 검증", () => {
  it("맞는 서명은 통과", () => {
    const time = "2026-10-25T00:00:00Z";
    const h = headersOf({ [SIGNATURE_HEADER]: signWebhook(SECRET, BODY, time), [TIME_HEADER]: time });
    expect(verifyWebhookSignature(SECRET, BODY, h)).toBe(true);
  });

  it("본문이 한 글자라도 바뀌면 거부", () => {
    const time = "2026-10-25T00:00:00Z";
    const h = headersOf({ [SIGNATURE_HEADER]: signWebhook(SECRET, BODY, time), [TIME_HEADER]: time });
    expect(verifyWebhookSignature(SECRET, BODY.replace("DONE", "DONX"), h)).toBe(false);
  });

  it("다른 열쇠·다른 전송 시각·서명 없음·시각 없음·열쇠 없음은 거부", () => {
    const time = "2026-10-25T00:00:00Z";
    const sig = signWebhook(SECRET, BODY, time);
    expect(verifyWebhookSignature("other-secret", BODY, headersOf({ [SIGNATURE_HEADER]: sig, [TIME_HEADER]: time }))).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, headersOf({ [SIGNATURE_HEADER]: sig, [TIME_HEADER]: "2026-10-25T00:00:01Z" }))).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, headersOf({ [TIME_HEADER]: time }))).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, headersOf({ [SIGNATURE_HEADER]: sig }))).toBe(false);
    expect(verifyWebhookSignature("", BODY, headersOf({ [SIGNATURE_HEADER]: sig, [TIME_HEADER]: time }))).toBe(false);
  });

  it("길이가 다른 서명도 예외 없이 거부", () => {
    expect(verifyWebhookSignature(SECRET, BODY, headersOf({ [SIGNATURE_HEADER]: "v1:x", [TIME_HEADER]: "t" }))).toBe(false);
  });
});

describe("웹훅 본문 해석", () => {
  it("이벤트 번호·종류·주문번호를 뽑고 본문 해시는 64자리 16진수", () => {
    const e = parseWebhook(BODY, headersOf({}), "fake");
    expect(e).toMatchObject({ eventId: "evt-0001", eventType: "PAYMENT_STATUS_CHANGED", orderNo: "ORD-20261025-0001" });
    expect(e?.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("본문에 이벤트 번호가 없으면 전송번호 머리글, 그것도 없으면 본문 해시로 정해 같은 본문은 같은 번호", () => {
    const raw = JSON.stringify({ eventType: "X", data: { orderId: "ORD-20261025-0002" } });
    expect(parseWebhook(raw, headersOf({ [ID_HEADER]: "tx-77" }), "fake")?.eventId).toBe("tx-77");
    const a = parseWebhook(raw, headersOf({}), "fake");
    const b = parseWebhook(raw, headersOf({}), "fake");
    expect(a?.eventId).toBe(b?.eventId);
    expect(a?.eventId).toMatch(/^fake-[0-9a-f]{40}$/);
  });

  it("주문번호 모양이 틀리면 null로 두고, JSON이 아니거나 배열이면 해석하지 않는다", () => {
    expect(parseWebhook(JSON.stringify({ data: { orderId: "짧음" } }), headersOf({}), "fake")?.orderNo).toBeNull();
    expect(parseWebhook("not json", headersOf({}), "fake")).toBeNull();
    expect(parseWebhook("[]", headersOf({}), "fake")).toBeNull();
  });
});
