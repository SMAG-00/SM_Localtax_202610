// 브리핑 사전 알림 입력 검사와 토큰 (W2-e 설계 7.5) — 순수 함수. 거부 문장은 BRIEF_MESSAGES 한 표에서 온다(서버 응답과 화면이 같은 문장).
import { createHash, randomBytes } from "node:crypto";

export const BRIEF_MESSAGES = {
  sent: "확인 메일을 보냈습니다 — 메일함에서 링크를 눌러 신청을 마쳐 주세요",
  already: "이미 신청하셨습니다",
  bot: "제출할 수 없습니다 — 페이지를 새로 열어 다시 시도해 주세요",
  too_many: "시도가 너무 많습니다. 잠시 뒤 다시 시도하세요",
  mail_down: "지금 메일을 보낼 수 없습니다 — 잠시 뒤 다시 시도해 주세요",
  email: "이메일 주소 형식을 확인해 주세요",
  consent: "수신 동의에 체크해 주세요",
} as const;
export type BriefCode = keyof typeof BRIEF_MESSAGES;
export const isBriefCode = (v: unknown): v is BriefCode => typeof v === "string" && Object.hasOwn(BRIEF_MESSAGES, v);

/** consents.email 제약과 같은 모양 (소문자·공백 없음·320자 이하) */
const EMAIL_SHAPE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const MAX_EMAIL = 254;
const truthy = (v: unknown) => v === true || v === "on" || v === "true";

export type BriefParse = { ok: true; email: string } | { ok: false; code: "email" | "consent" };

export function parseBriefInput(raw: Record<string, unknown>): BriefParse {
  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  if (email === "" || email.length > MAX_EMAIL || !EMAIL_SHAPE.test(email)) return { ok: false, code: "email" };
  if (!truthy(raw.agree)) return { ok: false, code: "consent" };
  return { ok: true, email };
}

/** 메일 링크 토큰 — 43글자(256비트). DB에는 SHA-256 16진수 64글자만 저장한다 */
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32,64}$/;
export const newToken = (): string => randomBytes(32).toString("base64url");
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
