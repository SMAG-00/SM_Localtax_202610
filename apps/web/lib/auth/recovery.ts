// 비밀번호 재설정·탈퇴·미확인 가입 정리의 순수 규칙 (W2-e 설계 4.2 · 9.3) — 시계·DB를 읽지 않는다(시각은 인자로 받는다).
import { createHmac, timingSafeEqual } from "node:crypto";

export const RECOVERY_SENT = "입력한 주소가 가입된 이메일이라면 재설정 안내 메일이 도착합니다 — 메일함을 확인해 주세요";
export const RESET_COOKIE = "ltr_reset";
/** 재설정 링크를 확인한 뒤 새 비밀번호를 정할 수 있는 시간 */
export const RESET_WINDOW_MINUTES = 15;
const MAX_EMAIL = 254;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 이메일 한 칸 — 앞뒤 공백을 떼고 소문자로. 모양이 틀리면 null */
export function parseEmailField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email !== "" && email.length <= MAX_EMAIL && EMAIL_SHAPE.test(email) ? email : null;
}

const mac = (secret: string, userId: string, expMs: number) => createHmac("sha256", secret).update(`reset:${userId}:${expMs}`).digest("hex").slice(0, 32);

/** 재설정 확인 표시 쿠키 값 = `계정번호.만료시각(ms).HMAC` — 재설정 링크를 확인한 세션만 새 비밀번호를 정할 수 있게 한다(그냥 로그인한 세션으로는 현재 비밀번호 없이 바꾸지 못한다) */
export function signResetCookie(secret: string, userId: string, nowMs: number): string {
  const exp = nowMs + RESET_WINDOW_MINUTES * 60_000;
  return `${userId}.${exp}.${mac(secret, userId, exp)}`;
}

export function checkResetCookie(secret: string, value: unknown, userId: string, nowMs: number): boolean {
  if (typeof value !== "string") return false;
  const m = /^([0-9a-f-]{36})\.(\d{10,16})\.([0-9a-f]{32})$/.exec(value);
  if (!m || m[1] !== userId) return false;
  const exp = Number(m[2]);
  if (!Number.isSafeInteger(exp) || exp <= nowMs) return false;
  const expected = Buffer.from(mac(secret, userId, exp));
  const given = Buffer.from(m[3]!);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** 확인 안 된 가입을 지우는 기준 시각 — 가입이 이 시각 이전(같은 시각 포함)이면 지운다. 7일이면 6일 23시간 59분 전 가입은 남고 정확히 7일 전은 지운다 */
export function unconfirmedCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/** 설정 privacy_retention에서 미확인 가입 보존 일수 — 모양이 틀리면 null(호출하는 쪽이 아무것도 지우지 않는다) */
export function unconfirmedSignupDays(value: unknown): number | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const days = (value as Record<string, unknown>).unconfirmed_signup_days;
  return typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= 365 ? days : null;
}

export const WITHDRAW_BLOCKED = "편집국 역할이나 관리자 권한이 있는 계정은 탈퇴할 수 없습니다 — 관리자에게 역할 회수를 먼저 요청해 주세요";

/** 탈퇴를 막아야 하나 — 역할이 하나라도 있거나 관리자 */
export const withdrawBlocked = (viewer: { isAdmin: boolean; roles: readonly string[] }): boolean => viewer.isAdmin || viewer.roles.length > 0;
