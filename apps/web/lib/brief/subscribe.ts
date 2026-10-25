// 브리핑·개정 알림 구독 입력 검사와 토큰·수신자 판정 (W10-e - BRIEF-02 · TX-12 · BRIEF-05). 순수 함수 - 거부 문장은 SUBSCRIBE_MESSAGES 한 표.
import { createHmac } from "node:crypto";
import { parseBriefInput } from "./input";

export const SUBSCRIBE_MESSAGES = {
  sent: "확인 메일을 보냈습니다 - 메일함에서 링크를 눌러 신청을 마쳐 주세요",
  already: "이미 구독 중입니다",
  bot: "제출할 수 없습니다 - 페이지를 새로 열어 다시 시도해 주세요",
  too_many: "시도가 너무 많습니다. 잠시 뒤 다시 시도하세요",
  mail_down: "지금 메일을 보낼 수 없습니다 - 잠시 뒤 다시 시도해 주세요",
  email: "이메일 주소 형식을 확인해 주세요",
  consent: "받을 알림을 하나 이상 고르고 수신 동의에 체크해 주세요",
  prefs: "관심 세목·개정안 선택을 확인해 주세요",
} as const;
export type SubscribeCode = keyof typeof SUBSCRIBE_MESSAGES;

export const MAX_TAX_KINDS = 12;
export const MAX_AMENDMENTS = 50;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface SubscribeInput {
  email: string;
  brief: boolean;
  alert: boolean;
  taxKinds: string[];
  amendmentIds: number[];
  includeDocs: boolean;
}

const truthy = (v: unknown) => v === true || v === "on" || v === "true";
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === "string" && v !== "" ? v.split(",") : []);

/** 폼/JSON -> 구독 입력. 브리핑·알림 동의는 따로 받는다 (수신 동의는 가입 동의와 분리, 한쪽만 골라도 된다) */
export function parseSubscribeInput(raw: Record<string, unknown>): { ok: true; value: SubscribeInput } | { ok: false; code: "email" | "consent" | "prefs" } {
  const email = parseBriefInput({ email: raw.email, agree: true });
  if (!email.ok) return { ok: false, code: "email" };
  const brief = truthy(raw.agree_brief);
  const alert = truthy(raw.agree_alert);
  if (!brief && !alert) return { ok: false, code: "consent" };
  const taxKinds = [...new Set(list(raw.tax_kinds).map((v) => String(v).trim()).filter((v) => v !== ""))];
  const amendmentIds = [...new Set(list(raw.amendment_ids).map((v) => String(v).trim()).filter((v) => v !== "").map(Number))];
  if (taxKinds.length > MAX_TAX_KINDS || taxKinds.some((k) => !SLUG.test(k) || k.length > 60)) return { ok: false, code: "prefs" };
  if (amendmentIds.length > MAX_AMENDMENTS || amendmentIds.some((n) => !Number.isInteger(n) || n <= 0)) return { ok: false, code: "prefs" };
  // 관심 설정은 알림 구독에만 둔다 - 브리핑만 고르면 설정은 버린다
  return { ok: true, value: { email: email.email, brief, alert, taxKinds: alert ? taxKinds : [], amendmentIds: alert ? amendmentIds : [], includeDocs: alert && truthy(raw.include_docs) } };
}

/**
 * 수신 거부·재확인 링크 토큰 - 서버 열쇠와 동의 번호에서 만든 값(43글자). 메일마다 같은 링크를 쓸 수 있고 DB에는 해시만 둔다.
 * 용도(purpose)가 다르면 값이 다르다.
 */
export function deriveToken(secret: string, purpose: "revoke", consentId: number): string {
  return createHmac("sha256", secret).update(`${purpose}:${consentId}`).digest("base64url");
}

export interface PremiumCandidate {
  consentId: number;
  userId: string;
  confirmed: boolean;
  revoked: boolean;
}

/** 프리미엄 브리핑 수신자 (BRIEF-05) - 수신 동의(확인·미철회)와 디지털 구독 권한이 둘 다 있을 때만. 둘 중 하나만 있으면 0 */
export function selectPremiumRecipients(candidates: readonly PremiumCandidate[], entitledUserIds: ReadonlySet<string>): PremiumCandidate[] {
  return candidates.filter((c) => c.confirmed && !c.revoked && entitledUserIds.has(c.userId));
}
