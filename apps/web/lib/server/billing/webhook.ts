// PG 웹훅 검증·해석 (W10-f, PAY-02) — 순수 함수(node:crypto만).
//  · 서명: HMAC-SHA256(열쇠, `${본문}:${전송시각}`)의 base64를 `v1:` 뒤에 붙인 값이 머리글 tosspayments-webhook-signature에 있어야 한다.
//    서명이 없거나 틀리면 거부(DB 쓰기 0). 토스페이먼츠의 결제 상태 웹훅에 실제로 이 서명이 붙는지는 계약·시험 키를 받은 뒤 확인한다(PO 준비물).
//  · 서명이 맞아도 웹훅 본문의 상태·금액은 쓰지 않는다 — 주문번호만 뽑고, 최종 상태는 PG 조회로 정한다 (service.ts).
//  · 이벤트 번호(pg_event_id): 본문 eventId → 머리글 전송번호 → 본문 해시 순. 같은 본문 재전송은 같은 번호가 되어 멱등이다.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "tosspayments-webhook-signature";
export const TIME_HEADER = "tosspayments-webhook-transmission-time";
export const ID_HEADER = "tosspayments-webhook-transmission-id";

export interface HeaderReader {
  get(name: string): string | null;
}

export function signWebhook(secret: string, rawBody: string, transmissionTime: string): string {
  return `v1:${createHmac("sha256", secret).update(`${rawBody}:${transmissionTime}`).digest("base64")}`;
}

export function verifyWebhookSignature(secret: string, rawBody: string, headers: HeaderReader): boolean {
  const given = headers.get(SIGNATURE_HEADER);
  const time = headers.get(TIME_HEADER);
  if (!secret || !given || !time) return false;
  const expected = signWebhook(secret, rawBody, time);
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface WebhookEvent {
  eventId: string;
  eventType: string;
  orderNo: string | null;
  payloadHash: string;
}

const ORDER_NO = /^[A-Za-z0-9_-]{8,64}$/;

/** 서명 검증을 통과한 본문에서 이벤트 번호·종류·주문번호·해시를 뽑는다. 본문이 JSON 객체가 아니면 null */
export function parseWebhook(rawBody: string, headers: HeaderReader, provider: string): WebhookEvent | null {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  const data = typeof obj.data === "object" && obj.data !== null ? (obj.data as Record<string, unknown>) : {};
  const hash = createHash("sha256").update(rawBody).digest("hex");
  const eventId =
    typeof obj.eventId === "string" && obj.eventId.length > 0 && obj.eventId.length <= 150
      ? obj.eventId
      : headers.get(ID_HEADER)?.slice(0, 150) || `${provider}-${hash.slice(0, 40)}`;
  const orderId = typeof data.orderId === "string" ? data.orderId : typeof obj.orderId === "string" ? obj.orderId : null;
  return {
    eventId,
    eventType: typeof obj.eventType === "string" ? obj.eventType.slice(0, 80) : "unknown",
    orderNo: orderId && ORDER_NO.test(orderId) ? orderId : null,
    payloadHash: hash,
  };
}
