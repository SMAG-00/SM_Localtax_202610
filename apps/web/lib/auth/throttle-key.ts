// 시도 횟수 표의 키 (W2-e 설계 4.1) — HMAC-SHA256(GUARD_SECRET, 범위 + ":" + 값)의 앞 32글자(16진수).
// 값 = 소문자 이메일 / IP / 이메일|IP. 계정이 실제로 있는지와 상관없이 보낸 이메일 글자로 센다(계정 유무가 드러나지 않는다).
// 같은 값도 범위가 다르면 다른 키가 되고(범위를 해시에 넣는다), 열쇠가 없으면 원문을 되찾을 수 없다. 저장·기록하는 것은 이 해시뿐이다.
import { createHmac } from "node:crypto";
import type { ThrottleScope } from "./settings";

export const THROTTLE_KEY_CHARS = 32;

export function throttleKey(secret: string, scope: ThrottleScope, value: string): string {
  if (secret === "") throw new Error("해시 열쇠가 비어 있습니다");
  return createHmac("sha256", secret).update(`${scope}:${value}`).digest("hex").slice(0, THROTTLE_KEY_CHARS);
}

/** 로그인 이메일을 센 글자로 — 앞뒤 공백을 떼고 소문자로, 전각 글자를 반각으로(NFKC) 맞춘다. 대소문자·전각으로 한도를 피하지 못하게 */
export function normalizeEmailKey(email: string): string {
  return email.normalize("NFKC").trim().toLowerCase();
}

export interface LoginKeys {
  pair: string;
  account: string;
  ip: string;
}

/** 로그인 세 겹의 키 — 이메일+IP 짝 · 이메일 전체 · IP */
export function loginKeys(secret: string, email: string, ip: string): LoginKeys {
  const e = normalizeEmailKey(email);
  return {
    pair: throttleKey(secret, "login_pair", `${e}|${ip}`),
    account: throttleKey(secret, "login_account", e),
    ip: throttleKey(secret, "login_ip", ip),
  };
}
