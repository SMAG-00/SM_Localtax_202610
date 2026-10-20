// 보존 기한 설정 읽기와 기준 시각 계산 (W2-e 설계 2.2 privacy_retention · 9.3) — 순수 모듈.
//  · 모양이 틀리면 null — 호출하는 쪽이 아무것도 지우지 않는다(기한을 모르는 채로 지우면 안 된다)
//  · 기준 시각(now)을 인자로 받는다 — 경계 하루 전(남음)·당일(지움)을 같은 함수로 시험한다. 한국은 일광절약시간이 없어 24시간×일수와 날짜 계산이 같다

export interface RetentionRules {
  unconfirmedSignupDays: number;
  unconfirmedConsentDays: number;
  revokedConsentDays: number;
  inquiryContactDays: number;
  inquiryAttachmentDays: number;
  throttleHours: number;
}

const DAY_MS = 86_400_000;
const DAY_KEYS = ["unconfirmed_signup_days", "unconfirmed_consent_days", "revoked_consent_days", "inquiry_contact_days", "inquiry_attachment_days"] as const;
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export function parseRetention(value: unknown): RetentionRules | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!DAY_KEYS.every((k) => isInt(v[k], 1, 3650)) || !isInt(v.throttle_hours, 1, 720)) return null;
  return {
    unconfirmedSignupDays: v.unconfirmed_signup_days as number,
    unconfirmedConsentDays: v.unconfirmed_consent_days as number,
    revokedConsentDays: v.revoked_consent_days as number,
    inquiryContactDays: v.inquiry_contact_days as number,
    inquiryAttachmentDays: v.inquiry_attachment_days as number,
    throttleHours: v.throttle_hours as number,
  };
}

/** now에서 days일 전 — 이 시각과 같거나 이전인 것이 기한이 지난 것이다(당일 지움) */
export const cutoffBefore = (now: Date, days: number): Date => new Date(now.getTime() - days * DAY_MS);

/** 기한이 지났나 — 경계 포함(정확히 days일 된 것은 지운다) */
export const isExpired = (at: Date, now: Date, days: number): boolean => at.getTime() <= cutoffBefore(now, days).getTime();
