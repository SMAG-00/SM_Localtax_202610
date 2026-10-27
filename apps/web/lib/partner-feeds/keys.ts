import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// 제휴 피드 키의 순수 규칙 (W13-i PART-01 - docs/dev/W13-i_설계.md 1·3장). DB·네트워크를 읽지 않는다.
//  · 키 모양: pf_<번호>.<비밀 43자> - 번호로 한 줄을 찾고, 비밀의 HMAC-SHA256(후추) 해시를 저장값과 맞춘다. 원문은 저장하지 않는다.
//  · 후추(PARTNER_FEED_KEY_PEPPER)는 서버 비밀이다. 비어 있거나 짧으면 해시를 만들지 않는다(발급 0).

export const MIN_PEPPER_LENGTH = 16;
const KEY_PATTERN = /^pf_([1-9][0-9]{0,15})\.([A-Za-z0-9_-]{43})$/;

export class PepperMissingError extends Error {
  constructor() {
    super("PARTNER_FEED_KEY_PEPPER가 비어 있거나 너무 짧습니다 - 제휴 피드 키를 만들거나 확인하지 않습니다");
    this.name = "PepperMissingError";
  }
}

export function requirePepper(value: string | undefined | null): string {
  const v = (value ?? "").trim();
  if (v.length < MIN_PEPPER_LENGTH) throw new PepperMissingError();
  return v;
}

/** 새 비밀 (256비트, base64url 43자) */
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSecret(secret: string, pepper: string): string {
  return createHmac("sha256", requirePepper(pepper)).update(secret, "utf8").digest("hex");
}

export function formatKey(feedId: number, secret: string): string {
  return `pf_${feedId}.${secret}`;
}

export function parseKey(key: string): { feedId: number; secret: string } | null {
  const m = KEY_PATTERN.exec(key);
  if (!m) return null;
  const feedId = Number(m[1]);
  return Number.isSafeInteger(feedId) ? { feedId, secret: m[2] } : null;
}

/** Authorization 헤더에서 Bearer 키를 꺼낸다 (형식이 맞지 않으면 null) */
export function bearerKey(header: string | null | undefined): string | null {
  const m = /^Bearer ([^\s]+)$/.exec((header ?? "").trim());
  return m ? m[1] : null;
}

/** 해시 두 개를 시간이 일정하게 비교 */
export function hashesEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}
