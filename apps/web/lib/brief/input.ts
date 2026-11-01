// 알림 구독 이메일 검사와 메일 링크 토큰 (W2-e 설계 7.5 · W10-e) — 순수 함수. 브리핑 사전 알림 신청(/api/brief)과 그 거부 문장 표는 주간 브리핑 호와 함께 지웠다 (PO 2026-11-01).
import { createHash, randomBytes } from "node:crypto";

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
